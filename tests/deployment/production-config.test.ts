import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, relativePath), "utf8"),
  ) as Record<string, unknown>;
}

async function readText(relativePath: string): Promise<string> {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function composeService(source: string, serviceName: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  if (start < 0) return "";
  const relativeEnd = lines
    .slice(start + 1)
    .findIndex((line) => /^  [a-zA-Z0-9_-]+:\s*$|^(?:volumes|networks):\s*$/.test(line));
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start + 1, end).join("\n");
}

function memoryLimitMiB(service: string): number {
  const value = service.match(/mem_limit:\s*(\d+)m/)?.[1];
  if (!value) throw new Error("service has no MiB memory limit");
  return Number(value);
}

describe("production deployment configuration", () => {
  it("declares every compiled API import as an API runtime dependency", async () => {
    const apiPackage = await readJson("apps/api/package.json");
    const dependencies = apiPackage.dependencies as Record<string, string>;

    expect(Object.keys(dependencies).sort()).toEqual([
      "@fastify/cors",
      "@prisma/adapter-pg",
      "@prisma/client",
      "decimal.js",
      "dotenv",
      "fastify",
      "pg",
    ]);
  });

  it("builds separate production-only API, migration, and static Web targets", async () => {
    const dockerfile = await readText("Dockerfile");
    const dockerignore = await readText(".dockerignore");
    const workspace = await readText("pnpm-workspace.yaml");

    expect(dockerfile).toMatch(/pnpm install --frozen-lockfile/);
    expect(dockerfile).toMatch(/DATABASE_URL=postgresql:\/\/build:build@127\.0\.0\.1:5432\/build pnpm exec prisma generate/);
    expect(dockerfile).toMatch(/AS api-runtime/i);
    expect(dockerfile).toMatch(/AS migrate/i);
    expect(dockerfile).toMatch(/AS web-runtime/i);
    expect(workspace).toContain("injectWorkspacePackages: true");
    expect(dockerfile).toMatch(/deploy --prod --no-optional \/opt\/api/);
    expect(dockerfile).toMatch(/cp -a "\$build_modules\/\.prisma" "\$runtime_modules\/\.prisma"/);
    expect(dockerfile).not.toContain("--legacy");
    expect(dockerfile).toMatch(/VITE_API_BASE_URL=""/);

    const apiRuntime = dockerfile.split(/FROM .* AS api-runtime/i)[1] ?? "";
    expect(apiRuntime).not.toMatch(/\b(src|typescript|tsx|vitest|playwright|vite)\b/i);
    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain("deploy/.env.production");
  });

  it("keeps PostgreSQL and API internal while gating API startup on migration", async () => {
    const compose = await readText("docker-compose.prod.yml");
    const postgresService = composeService(compose, "postgres");
    const apiService = composeService(compose, "api");

    expect(compose).toMatch(/postgres:\s*[\s\S]*image: postgres:16-alpine/);
    expect(compose).toMatch(/postgres:\s*[\s\S]*healthcheck:/);
    expect(compose).toMatch(/warehouse-postgres:\/var\/lib\/postgresql\/data/);
    expect(compose).toMatch(/migrate:\s*[\s\S]*condition: service_healthy/);
    expect(compose).toMatch(/api:\s*[\s\S]*condition: service_completed_successfully/);
    expect(compose).toMatch(/api:\s*[\s\S]*\/health/);
    expect(compose).toMatch(/web:\s*[\s\S]*"80:80"[\s\S]*"443:443"/);
    expect(postgresService).not.toMatch(/^    ports\s*:/m);
    expect(apiService).not.toMatch(/^    ports\s*:/m);
    expect(compose).toMatch(/mem_limit:/);
    expect(compose).toMatch(/max-size:/);
    expect(compose).toMatch(/max-file:/);
    expect(postgresService).toContain("- backend");
    expect(postgresService).not.toContain("- edge");
    expect(apiService).toContain("- backend");
    expect(apiService).toContain("- edge");
    expect(compose).toMatch(/backend:\s*\n\s+internal: true/);
  });

  it("leaves host headroom and bounds the migration peak on a 2 GiB server", async () => {
    const compose = await readText("docker-compose.prod.yml");
    const postgres = memoryLimitMiB(composeService(compose, "postgres"));
    const migrate = memoryLimitMiB(composeService(compose, "migrate"));
    const api = memoryLimitMiB(composeService(compose, "api"));
    const web = memoryLimitMiB(composeService(compose, "web"));

    expect(postgres + migrate).toBeLessThanOrEqual(768);
    expect(postgres + api + web).toBeLessThanOrEqual(1024);
  });

  it("checks Caddy locally without depending on its public hostname or HTTPS policy", async () => {
    const compose = await readText("docker-compose.prod.yml");
    const caddyfile = await readText("deploy/Caddyfile");
    const webService = compose.split("\n  web:")[1]?.split("\nvolumes:")[0] ?? "";

    expect(caddyfile).toMatch(/admin 127\.0\.0\.1:2019/);
    expect(webService).toContain("http://127.0.0.1:2019/config/");
    expect(webService).not.toContain("http://127.0.0.1/health");
  });

  it("keeps warehouse and fixed-assets hosts on separate upstreams", async () => {
    const caddyfile = await readText("deploy/Caddyfile");
    const [warehouseSite, assetsSite] = caddyfile.split(
      /^assets\.beikexiang\.cn\s*\{$/m,
    );

    expect(warehouseSite).toContain("reverse_proxy api:3001");
    expect(assetsSite).toContain("reverse_proxy beikexiang-assets:8088");
    expect(assetsSite).not.toContain("reverse_proxy api:3001");
  });

  it("keeps the fixed-assets front-door override limited to the Caddy web service", async () => {
    const override = await readText("deploy/frontdoor-assets.override.yml");

    expect(override).toContain("web:");
    expect(override).toContain("FRONTDOOR_IMAGE");
    expect(override).toContain("build: null");
    expect(override).not.toMatch(/^\s+(?:api|migrate|postgres):/m);
  });

  it("keeps the local smoke deployment on an isolated loopback port", async () => {
    const smokeCompose = await readText("tests/deployment/docker-compose.smoke.yml");

    expect(smokeCompose).toMatch(/ports:\s*!override/);
    expect(smokeCompose).toContain('"127.0.0.1:18080:80"');
    expect(smokeCompose).not.toMatch(/(?:^|[^0-9])(80|443):(?:80|443)(?:\D|$)/);
  });

  it("serves browser admin documents as SPA routes and proxies admin fetches", async () => {
    const caddyfile = await readText("deploy/Caddyfile");

    const documentMatcher = caddyfile.indexOf("@admin_document");
    const adminProxy = caddyfile.indexOf("handle /admin/*");
    expect(documentMatcher).toBeGreaterThanOrEqual(0);
    expect(caddyfile).toMatch(/@admin_document\s*\{[\s\S]*method GET[\s\S]*header Accept \*text\/html\*/);
    expect(caddyfile).toMatch(/handle @admin_document\s*\{[\s\S]*try_files \{path\} \/index\.html/);
    expect(adminProxy).toBeGreaterThan(documentMatcher);
    expect(caddyfile).toMatch(/handle \/admin\/\*\s*\{[\s\S]*reverse_proxy api:3001/);
    expect(caddyfile).toMatch(/path \/auth\/\* \/wecom\/\* \/health/);
    expect(caddyfile).toMatch(/encode zstd gzip/);
    expect(caddyfile).toMatch(/X-Content-Type-Options/);
  });

  it("documents placeholder-only staging and HTTPS production settings", async () => {
    const compose = await readText("docker-compose.prod.yml");
    const example = await readText("deploy/.env.production.example");

    expect(example).toContain("SITE_ADDRESS=http://203.0.113.10");
    expect(example).toContain("NODE_ENV=staging");
    expect(example).toContain("PERSISTENCE_DRIVER=prisma");
    expect(example).toContain("LOCAL_AUTH_BYPASS=false");
    expect(example).toContain("SITE_ADDRESS=warehouse.example.com");
    expect(example).toContain("NODE_ENV=production");
    expect(example).toContain("API_BASE_URL=https://warehouse.example.com");
    expect(example).toContain("WE_COM_ADMIN_IDS=replace-with-production-admin-userid");
    expect(example).toContain("WE_COM_APPROVAL_TEMPLATE_ID=replace-with-approved-template-id");
    expect(compose).toContain("WE_COM_APPROVAL_TEMPLATE_ID: ${WE_COM_APPROVAL_TEMPLATE_ID:-}");
    expect(example).not.toMatch(/106\.14\.224\.213|i-uf6ig2xdl67rqerk67l1/);
  });

  it("backs up atomically and never removes the database volume during deploy or rollback", async () => {
    const backup = await readText("deploy/scripts/backup.sh");
    const deploy = await readText("deploy/scripts/deploy.sh");
    const rollback = await readText("deploy/scripts/rollback.sh");
    const restore = await readText("deploy/scripts/restore-database.sh");
    const common = await readText("deploy/scripts/common.sh");
    const scripts = `${backup}\n${deploy}\n${rollback}\n${restore}\n${common}`;

    expect(backup).toMatch(/umask 077/);
    expect(backup).toMatch(/pg_dump/);
    expect(backup).toMatch(/pg_dump .*--create/);
    expect(backup).toMatch(/gzip/);
    expect(backup).toMatch(/gzip -t/);
    expect(backup).toMatch(/mv .*\.tmp/);
    expect(backup).toMatch(/find .* -mtime/);
    expect(deploy).toContain("/opt/beikexiang-warehouse");
    expect(deploy).toMatch(/backup\.sh/);
    expect(deploy).toMatch(/previous-release/);
    expect(deploy).toMatch(/releases/);
    expect(deploy).toMatch(/chmod 600 .*\.env\.production/);
    expect(deploy).toMatch(/chmod 600 .*release\.meta/);
    expect(deploy).toMatch(/chmod 600 .*backup\.manifest/);
    expect(deploy).toMatch(/service_completed_successfully|compose run --rm migrate/);
    expect(rollback).toMatch(/previous-release/);
    expect(rollback).toMatch(/schema rollback.*separate|schema.*not.*rolled back/i);
    expect(restore).toMatch(/CONFIRM|confirm/);
    expect(restore).toMatch(/backup\.sh/);
    expect(restore).toMatch(/psql .* -d postgres/);
    expect(scripts).not.toMatch(/(?:^|\n)\s*(?:source|\.)\s+["']?\$ENV_FILE\b/);
    expect(scripts).not.toMatch(/\beval\b/);
    expect(scripts).not.toMatch(/down\s+(?:[^\n]*\s)?-v|volume\s+(?:rm|prune)|docker\s+system\s+prune/);
  });
});
