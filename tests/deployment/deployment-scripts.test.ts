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
[ "$last_arg" != "prebuilt/missing:fixture" ] || exit 1
case " $all_args " in
  *" compose "*" ps -q "*) printf 'fake-%s\n' "$last_arg" ;;
  *" compose "*" exec -T postgres "*" pg_dump "*) printf '%s\n' 'CREATE TABLE restored (id integer);' ;;
  *" compose "*" exec -T postgres "*" psql "*) cat >/dev/null ;;
  *" image inspect --format "*)
    case "$last_arg" in
      *migrate*) printf '%s\n' 'sha256:fixture-migrate-id' ;;
      *api*) printf '%s\n' 'sha256:fixture-api-id' ;;
      *web*) printf '%s\n' 'sha256:fixture-web-id' ;;
      *) exit 1 ;;
    esac
    ;;
  *" inspect --format "*) printf '%s\n' 'healthy' ;;
esac
FAKE_DOCKER
chmod +x "$fixture_root/bin/docker"
: > "$fixture_root/docker.log"

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

preflight_start=$(wc -l < "$fixture_root/docker.log" 2>/dev/null || printf 0)
if PREBUILT_MIGRATE_IMAGE=prebuilt/migrate:fixture SOURCE_REVISION=partial-migrate "$PROJECT_DIR/deploy/scripts/deploy.sh" >/dev/null 2>&1; then echo partial-migrate-accepted >&2; exit 1; fi
if PREBUILT_API_IMAGE=prebuilt/api:fixture SOURCE_REVISION=partial-api "$PROJECT_DIR/deploy/scripts/deploy.sh" >/dev/null 2>&1; then echo partial-api-accepted >&2; exit 1; fi
if PREBUILT_WEB_IMAGE=prebuilt/web:fixture SOURCE_REVISION=partial-web "$PROJECT_DIR/deploy/scripts/deploy.sh" >/dev/null 2>&1; then echo partial-web-accepted >&2; exit 1; fi
if PREBUILT_MIGRATE_IMAGE=prebuilt/migrate:fixture PREBUILT_API_IMAGE=prebuilt/api:fixture SOURCE_REVISION=partial-no-web "$PROJECT_DIR/deploy/scripts/deploy.sh" >/dev/null 2>&1; then echo partial-no-web-accepted >&2; exit 1; fi
if PREBUILT_MIGRATE_IMAGE=prebuilt/migrate:fixture PREBUILT_WEB_IMAGE=prebuilt/web:fixture SOURCE_REVISION=partial-no-api "$PROJECT_DIR/deploy/scripts/deploy.sh" >/dev/null 2>&1; then echo partial-no-api-accepted >&2; exit 1; fi
if PREBUILT_API_IMAGE=prebuilt/api:fixture PREBUILT_WEB_IMAGE=prebuilt/web:fixture SOURCE_REVISION=partial-no-migrate "$PROJECT_DIR/deploy/scripts/deploy.sh" >/dev/null 2>&1; then echo partial-no-migrate-accepted >&2; exit 1; fi
if PREBUILT_MIGRATE_IMAGE=prebuilt/migrate:fixture PREBUILT_API_IMAGE=prebuilt/missing:fixture PREBUILT_WEB_IMAGE=prebuilt/web:fixture SOURCE_REVISION=missing-api "$PROJECT_DIR/deploy/scripts/deploy.sh" >/dev/null 2>&1; then echo missing-api-accepted >&2; exit 1; fi
preflight_first=$((preflight_start + 1))
tail -n +"$preflight_first" "$fixture_root/docker.log" > "$fixture_root/preflight-failures.log"
! grep -Eq ' up -d postgres$| stop api web$| stop postgres$| build (migrate|api|web)$|^image tag ' "$fixture_root/preflight-failures.log"

"$PROJECT_DIR/deploy/scripts/deploy.sh"
first_release=$(sed -n '1p' "$PROJECT_DIR/deploy/state/current-release")
test -d "$PROJECT_DIR/deploy/releases/$first_release"
test -s "$PROJECT_DIR/deploy/releases/$first_release/release.meta"
test -s "$PROJECT_DIR/deploy/releases/$first_release/backup.manifest"

export SOURCE_REVISION=secondrevision
export PREBUILT_MIGRATE_IMAGE=prebuilt/migrate:fixture
export PREBUILT_API_IMAGE=prebuilt/api:fixture
export PREBUILT_WEB_IMAGE=prebuilt/web:fixture
prebuilt_start=$(wc -l < "$fixture_root/docker.log")
"$PROJECT_DIR/deploy/scripts/deploy.sh"
prebuilt_first=$((prebuilt_start + 1))
tail -n +"$prebuilt_first" "$fixture_root/docker.log" > "$fixture_root/prebuilt-release.log"
second_release=$(sed -n '1p' "$PROJECT_DIR/deploy/state/current-release")
test "$second_release" != "$first_release"
test "$(sed -n '1p' "$PROJECT_DIR/deploy/state/previous-release")" = "$first_release"
second_meta="$PROJECT_DIR/deploy/releases/$second_release/release.meta"
grep -Fxq 'image_source=prebuilt' "$second_meta"
grep -Fxq 'prebuilt_migrate_source=prebuilt/migrate:fixture' "$second_meta"
grep -Fxq 'prebuilt_api_source=prebuilt/api:fixture' "$second_meta"
grep -Fxq 'prebuilt_web_source=prebuilt/web:fixture' "$second_meta"
grep -Fxq 'prebuilt_migrate_source_id=sha256:fixture-migrate-id' "$second_meta"
grep -Fxq 'prebuilt_api_source_id=sha256:fixture-api-id' "$second_meta"
grep -Fxq 'prebuilt_web_source_id=sha256:fixture-web-id' "$second_meta"

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
prebuilt_first_service_action=$(grep -En -m1 ' up -d postgres$| stop api web$| stop postgres$' "$fixture_root/prebuilt-release.log" | cut -d: -f1)
for source_image in prebuilt/migrate:fixture prebuilt/api:fixture prebuilt/web:fixture; do
  inspect_line=$(grep -n -m1 "^image inspect --format {{.Id}} $source_image$" "$fixture_root/prebuilt-release.log" | cut -d: -f1)
  test "$inspect_line" -lt "$prebuilt_first_service_action"
done
for target_mapping in migrate:sha256:fixture-migrate-id api:sha256:fixture-api-id web:sha256:fixture-web-id; do
  target_service=$(printf '%s\n' "$target_mapping" | cut -d: -f1)
  source_id=$(printf '%s\n' "$target_mapping" | cut -d: -f2-)
  tag_line=$(grep -n -m1 "^image tag $source_id warehouse-test/$target_service:" "$fixture_root/prebuilt-release.log" | cut -d: -f1)
  test "$tag_line" -lt "$prebuilt_first_service_action"
done

printf 'first=%s\nsecond=%s\n' "$first_release" "$second_release"
`;

  const windowsShell = "C:\\Program Files\\Git\\bin\\sh.exe";
  const shell = process.platform === "win32" && existsSync(windowsShell) ? windowsShell : "sh";
  const result = spawnSync(
    shell,
    ["-s"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, ENV_FILE_BASE64: envFile },
      input: fixture,
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
  archivePath: string,
): ReturnType<typeof spawnSync> {
  const fixture = String.raw`
set -eu
mkdir -p /workspace /tmp/bin
tar -xzf - -C /workspace
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
      "node:24-alpine",
      "/bin/sh",
      "-c",
      fixture,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      input: readFileSync(archivePath),
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

      const result = runPackagedValidationWithLinuxSh(archivePath);

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
