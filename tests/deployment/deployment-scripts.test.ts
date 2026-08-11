import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function runLifecycleFixture(): string {
  const envFile = Buffer.from(
    [
      "COMPOSE_PROJECT_NAME=warehouse-safe",
      "IMAGE_PREFIX=warehouse-test",
      "RELEASE_TAG=latest",
      "SITE_ADDRESS=http://127.0.0.1",
      "NODE_ENV=staging",
      "PERSISTENCE_DRIVER=prisma",
      "LOCAL_AUTH_BYPASS=false",
      "API_BASE_URL=http://127.0.0.1",
      "WEB_BASE_URL=http://127.0.0.1",
      'SESSION_SECRET=literal-$-`touch "$FIXTURE_ROOT/backtick-owned"`-$(touch "$FIXTURE_ROOT/substitution-owned")',
      "POSTGRES_DB=warehouse",
      "POSTGRES_USER=warehouse",
      "POSTGRES_PASSWORD=literal-$-password",
      "DATABASE_URL=postgresql://warehouse:password@postgres:5432/warehouse",
      "",
    ].join("\n"),
  ).toString("base64");

  const fixture = String.raw`
set -eu
fixture_root=$(mktemp -d)
trap 'rm -rf "$fixture_root"' EXIT HUP INT TERM
mkdir -p "$fixture_root/project/deploy/scripts" "$fixture_root/bin"
cp "$PWD/docker-compose.prod.yml" "$fixture_root/project/docker-compose.prod.yml"
cp "$PWD"/deploy/scripts/*.sh "$fixture_root/project/deploy/scripts/"
printf '%s' "$ENV_FILE_BASE64" | base64 -d > "$fixture_root/project/deploy/.env.production"
chmod 600 "$fixture_root/project/deploy/.env.production"
chmod +x "$fixture_root/project/deploy/scripts"/*.sh

cat > "$fixture_root/bin/docker" <<'FAKE_DOCKER'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FIXTURE_ROOT/docker.log"
all_args=$*
last_arg=
for argument in "$@"; do last_arg=$argument; done
case " $all_args " in
  *" compose "*" ps -q "*) printf 'fake-%s\n' "$last_arg" ;;
  *" compose "*" exec -T postgres "*" pg_dump "*) printf '%s\n' 'CREATE TABLE restored (id integer);' ;;
  *" compose "*" exec -T postgres "*" psql "*) cat >/dev/null ;;
  *" image inspect "*" --format "*) printf '%s\n' 'sha256:fixture-image-id' ;;
  *" inspect --format "*) printf '%s\n' 'healthy' ;;
esac
FAKE_DOCKER
chmod +x "$fixture_root/bin/docker"

cat > "$fixture_root/bin/stat" <<'FAKE_STAT'
#!/bin/sh
if [ "$1" = "-c" ] && [ "$2" = "%a" ]; then
  printf '%s\n' 600
  exit 0
fi
exec /usr/bin/stat "$@"
FAKE_STAT
chmod +x "$fixture_root/bin/stat"

export FIXTURE_ROOT=$fixture_root
export PATH=$fixture_root/bin:$PATH
export PROJECT_DIR=$fixture_root/project
export COMPOSE_FILE=$fixture_root/project/docker-compose.prod.yml
export ENV_FILE=$fixture_root/project/deploy/.env.production
export SOURCE_REVISION=firstrevision

cp "$ENV_FILE" "$fixture_root/duplicate.env"
printf '%s\n' 'LOCAL_AUTH_BYPASS=true' >> "$fixture_root/duplicate.env"
chmod 600 "$fixture_root/duplicate.env"
if ENV_FILE="$fixture_root/duplicate.env" VALIDATE_ONLY=1 "$PROJECT_DIR/deploy/scripts/deploy.sh" >/dev/null 2>&1; then
  printf '%s\n' 'deploy accepted duplicate LOCAL_AUTH_BYPASS values' >&2
  exit 1
fi

"$PROJECT_DIR/deploy/scripts/deploy.sh"
first_release=$(sed -n '1p' "$PROJECT_DIR/deploy/state/current-release")
test -d "$PROJECT_DIR/deploy/releases/$first_release"
test -s "$PROJECT_DIR/deploy/releases/$first_release/release.meta"
test -s "$PROJECT_DIR/deploy/releases/$first_release/backup.manifest"

export SOURCE_REVISION=secondrevision
export PREBUILT_MIGRATE_IMAGE=prebuilt/migrate:fixture
export PREBUILT_API_IMAGE=prebuilt/api:fixture
export PREBUILT_WEB_IMAGE=prebuilt/web:fixture
"$PROJECT_DIR/deploy/scripts/deploy.sh"
second_release=$(sed -n '1p' "$PROJECT_DIR/deploy/state/current-release")
test "$second_release" != "$first_release"
test "$(sed -n '1p' "$PROJECT_DIR/deploy/state/previous-release")" = "$first_release"

sed -i 's/COMPOSE_PROJECT_NAME=warehouse-safe/COMPOSE_PROJECT_NAME=warehouse-mutated/' "$ENV_FILE"
"$PROJECT_DIR/deploy/scripts/rollback.sh"
test "$(sed -n '1p' "$PROJECT_DIR/deploy/state/current-release")" = "$first_release"

confirmation="RESTORE_DATABASE:warehouse-safe:$second_release"
backup_count_before=$(find "$PROJECT_DIR/deploy/backups" -type f -name '*.sql.gz' | wc -l)
if "$PROJECT_DIR/deploy/scripts/restore-database.sh" --release "$second_release" --confirm "WRONG" >/dev/null 2>&1; then
  printf '%s\n' 'restore accepted an invalid confirmation' >&2
  exit 1
fi
test "$(find "$PROJECT_DIR/deploy/backups" -type f -name '*.sql.gz' | wc -l)" = "$backup_count_before"
"$PROJECT_DIR/deploy/scripts/restore-database.sh" --release "$second_release" --confirm "$confirmation"

test ! -e "$fixture_root/backtick-owned"
test ! -e "$fixture_root/substitution-owned"
test "$(find "$PROJECT_DIR/deploy/backups" -type f -name '*.sql.gz' | wc -l)" -ge 4
test "$(grep -c ' pg_dump ' "$fixture_root/docker.log")" -ge 4
grep -q ' psql ' "$fixture_root/docker.log"
grep -Eq 'pg_dump .*--create' "$fixture_root/docker.log"
grep -Eq 'psql .* -d postgres' "$fixture_root/docker.log"
! grep -Eq 'down[[:space:]].*-v|volume[[:space:]]+(rm|prune)|system[[:space:]]+prune' "$fixture_root/docker.log"

stop_apps=$(grep -n -m1 ' stop api web$' "$fixture_root/docker.log" | cut -d: -f1)
stop_postgres=$(grep -n -m1 ' stop postgres$' "$fixture_root/docker.log" | cut -d: -f1)
build_migrate=$(grep -n -m1 ' build migrate$' "$fixture_root/docker.log" | cut -d: -f1)
build_api=$(grep -n -m1 ' build api$' "$fixture_root/docker.log" | cut -d: -f1)
build_web=$(grep -n -m1 ' build web$' "$fixture_root/docker.log" | cut -d: -f1)
start_postgres=$(grep -n ' up -d postgres$' "$fixture_root/docker.log" | sed -n '2p' | cut -d: -f1)
run_migrate=$(grep -n -m1 ' run --rm migrate$' "$fixture_root/docker.log" | cut -d: -f1)
test "$stop_apps" -lt "$stop_postgres"
test "$stop_postgres" -lt "$build_migrate"
test "$build_migrate" -lt "$build_api"
test "$build_api" -lt "$build_web"
test "$build_web" -lt "$start_postgres"
test "$start_postgres" -lt "$run_migrate"
test "$(grep -c ' build migrate$' "$fixture_root/docker.log")" = 1
test "$(grep -c ' build api$' "$fixture_root/docker.log")" = 1
test "$(grep -c ' build web$' "$fixture_root/docker.log")" = 1
grep -Eq '^image tag prebuilt/migrate:fixture warehouse-test/migrate:' "$fixture_root/docker.log"
grep -Eq '^image tag prebuilt/api:fixture warehouse-test/api:' "$fixture_root/docker.log"
grep -Eq '^image tag prebuilt/web:fixture warehouse-test/web:' "$fixture_root/docker.log"

printf 'first=%s\nsecond=%s\n' "$first_release" "$second_release"
`;

  const windowsShell = "C:\\Program Files\\Git\\bin\\sh.exe";
  const shell = process.platform === "win32" && existsSync(windowsShell) ? windowsShell : "sh";
  const result = spawnSync(
    shell,
    ["-c", fixture],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, ENV_FILE_BASE64: envFile },
      timeout: 60_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `fixture exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function runPackagedValidationWithLinuxSh(
  archiveDirectory: string,
): ReturnType<typeof spawnSync> {
  const fixture = String.raw`
set -eu
mkdir -p /workspace /tmp/bin
tar -xzf /bundle/warehouse-release.tar.gz -C /workspace
cat > /workspace/deploy/.env.production <<'ENV'
COMPOSE_PROJECT_NAME=warehouse-linux
IMAGE_PREFIX=warehouse-test
PERSISTENCE_DRIVER=prisma
LOCAL_AUTH_BYPASS=false
ENV
chmod 600 /workspace/deploy/.env.production
cat > /tmp/bin/docker <<'DOCKER'
#!/bin/sh
exit 0
DOCKER
chmod +x /tmp/bin/docker
PATH="/tmp/bin:$PATH" \
PROJECT_DIR=/workspace \
COMPOSE_FILE=/workspace/docker-compose.prod.yml \
ENV_FILE=/workspace/deploy/.env.production \
VALIDATE_ONLY=1 \
  /bin/sh /workspace/deploy/scripts/deploy.sh
`;

  return spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "-v",
      `${archiveDirectory}:/bundle:ro`,
      "node:24-alpine",
      "/bin/sh",
      "-s",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      input: fixture,
      timeout: 30_000,
    },
  );
}

function runPackageProcess(
  revision: string,
  archivePath: string,
): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["deploy/scripts/package-release.mjs", revision, archivePath],
      { cwd: repositoryRoot, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

describe("production deployment scripts", () => {
  it("packages a release that validates with Linux /bin/sh", () => {
    const archiveDirectory = mkdtempSync(
      path.join(repositoryRoot, ".superpowers", "release-test-"),
    );
    const archivePath = path.join(archiveDirectory, "warehouse-release.tar.gz");
    try {
      const packageResult = spawnSync(
        process.execPath,
        ["deploy/scripts/package-release.mjs", "HEAD", archivePath],
        { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
      );
      expect(
        packageResult.status,
        `stdout:\n${packageResult.stdout}\nstderr:\n${packageResult.stderr}`,
      ).toBe(0);

      const result = runPackagedValidationWithLinuxSh(archiveDirectory);

      expect(result.error).toBeUndefined();
      expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    } finally {
      rmSync(archiveDirectory, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects option-like revisions without publishing an archive", () => {
    const archiveDirectory = mkdtempSync(
      path.join(repositoryRoot, ".superpowers", "release-options-test-"),
    );
    const archivePath = path.join(archiveDirectory, "invalid.tar.gz");
    try {
      const result = spawnSync(
        process.execPath,
        ["deploy/scripts/package-release.mjs", "--list", archivePath],
        { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
      );

      expect(result.status).not.toBe(0);
      expect(existsSync(archivePath)).toBe(false);
    } finally {
      rmSync(archiveDirectory, { recursive: true, force: true });
    }
  });

  it("publishes exactly one archive when packagers race for the same path", async () => {
    const archiveDirectory = mkdtempSync(
      path.join(repositoryRoot, ".superpowers", "release-race-test-"),
    );
    const archivePath = path.join(archiveDirectory, "race.tar.gz");
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => runPackageProcess("HEAD", archivePath)),
      );
      const successes = results.filter((result) => result.status === 0);

      expect(successes, results.map((result) => result.stderr).join("\n")).toHaveLength(1);
      expect(existsSync(archivePath)).toBe(true);
      expect(gunzipSync(readFileSync(archivePath)).byteLength).toBeGreaterThan(0);
    } finally {
      rmSync(archiveDirectory, { recursive: true, force: true });
    }
  }, 30_000);

  it("preserves inert env values, snapshots releases, rolls back configuration, and restores explicitly", () => {
    expect(runLifecycleFixture()).toMatch(/first=.*\nsecond=.*/);
  }, 60_000);
});
