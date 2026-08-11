# Task 5 report — rollback-capable production deployment package

Status: **fix round 1/5 complete; focused/full/bounded-PostgreSQL checks and the isolated Docker acceptance matrix passed.** No ECS, DNS, firewall, or real-secret changes were made.

Base commit: `93f178c9d88d1bb2fee887cf8a11ca1d34055821`

## Delivered files

- `Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`
- `deploy/Caddyfile`, `deploy/.env.production.example`
- `deploy/scripts/backup.sh`, `deploy/scripts/deploy.sh`, `deploy/scripts/rollback.sh`
- `tests/deployment/production-config.test.ts`
- Runtime dependency corrections in `apps/api/package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`
- Deployment runtime ignores in `.gitignore`

## TDD evidence

RED was observed before each production change:

1. API runtime ownership: 1 failed test; received only `fastify`, expected the seven compiled runtime dependencies.
2. Missing deployment package: 5 failed tests for absent Dockerfile/Compose/Caddy/env/scripts.
3. Network and health review regressions: 2 failed tests because API lacked non-internal egress and Web probed public `/health`.
4. Prisma generation: Docker build failed with `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`; a focused test then failed until a non-secret build-only URL was supplied.
5. Production dependency isolation: focused tests failed until modern pnpm isolated deployment was enabled and optional peer tooling was excluded.
6. Generated Prisma runtime: local closure import failed with `Cannot find module '.prisma/client/default'`; a focused test failed until Docker packaging explicitly copied the generated `.prisma` client into the production dependency tree.

Final focused GREEN:

```text
corepack pnpm vitest run tests/deployment/production-config.test.ts
Test Files  1 passed (1)
Tests       7 passed (7)
```

## Configuration and routing evidence

- `docker compose --project-directory . --env-file deploy/.env.production.example -f docker-compose.prod.yml config` exited 0.
- Rendered Compose publishes only Web `80/tcp`, `443/tcp`, and `443/udp`; API `3001` is `expose`-only and PostgreSQL has no host port.
- PostgreSQL and migration attach only to internal `backend`; API attaches to `backend + edge` so it retains outbound Enterprise WeChat access without a host mapping; Web attaches to both.
- API depends on successful one-shot migration; migration depends on healthy PostgreSQL; Web depends on healthy API.
- Caddy `validate` reported `Valid configuration` for `SITE_ADDRESS=http://localhost`.
- Browser document `GET /admin/*` with `Accept: *text/html*` is handled before the `/admin/*` API proxy. `/auth/*`, `/wecom/*`, and `/health` proxy to API.
- Web health uses the explicitly loopback-bound Caddy admin endpoint `127.0.0.1:2019/config/`, independent of domain/HTTPS redirects.

## Build and runtime inspection

An all-target Docker build completed for release tag `task5-smoke-a` after a transient registry retry:

| Image | Exact size | Approx. MiB |
|---|---:|---:|
| `warehouse-task5/api:task5-smoke-a` | 153,767,740 bytes | 146.64 |
| `warehouse-task5/migrate:task5-smoke-a` | 296,776,519 bytes | 283.03 |
| `warehouse-task5/web:task5-smoke-a` | 22,685,812 bytes | 21.63 |

That API image inspection correctly exposed a packaging defect: legacy deploy included Prisma CLI and unrelated workspace packages. A second pre-final API image was 153,787,730 bytes and still had the same optional-peer closure. The final Dockerfile therefore uses modern `pnpm deploy --prod --no-optional`.

Non-Docker final package-closure verification reduced the production lock from 201 to 74 entries (75 `.pnpm` directories), with no Prisma CLI, TypeScript, tsx, Vite, Vitest, Playwright, React/d3, or direct `.bin` tools. All seven required imports resolved before the missing generated-client check exposed the `.prisma` copy requirement. The final `.prisma` copy is covered by the focused test, but the controller stopped further Docker work before a final image rebuild, so no final post-fix API byte size is claimed.

## Final non-Docker verification

```text
corepack pnpm test
Test Files  41 passed | 3 skipped (44)
Tests       198 passed | 16 skipped (214)

corepack pnpm typecheck
exit 0

corepack pnpm build
exit 0; API and Web built successfully

docker compose ... config --quiet
exit 0

git diff --check
exit 0
```

The 16 skipped tests are the real-PostgreSQL suites because no isolated `TEST_DATABASE_URL` was provided after Docker work was stopped. Local `bash`/`shellcheck` were unavailable; shell-script safety is covered by the deployment test and manual review, not an executed shell parser.

## Smoke, restart, backup, and rollback evidence

Not completed. The intended isolated Compose smoke, API/PostgreSQL restart, real `pg_dump`, and image rollback checks were stopped by controller instruction after repeated Docker registry/runtime stalls. Exact environment evidence included:

```text
curl: (28) Connection timed out ... https://registry-1.docker.io/v2/
failed to fetch oauth token ... auth.docker.io ... connectex ... failed to respond
```

Three long-running Caddy validation invocations started by this task were terminated. A later stdin-based Caddy validation completed, and all three build targets completed once, but no claim is made for end-to-end Compose smoke, persistence restart, backup, or rollback execution.

Static safety evidence:

- backup uses `pg_dump`, non-empty uncompressed validation, gzip validation, mode `600`, atomic temp rename, and retention;
- deploy validates mode `600`, backs up before build, records previous release, uses unique tags, runs one-shot migration/seed, and waits for health;
- rollback requires recorded images, creates a pre-rollback backup, changes only API/Web images, and explicitly states schema/restore are separate operations;
- no script contains `down -v`, volume deletion/prune, or system prune.

## Historical concerns before fix round 1

These concerns described the state at `ca8a56d`; the fix-round evidence below supersedes them. This task still must not be described as deployed to ECS or formally production-live.

---

## Fix round 1/5 — 2026-08-11

Starting commit: `ca8a56d`

### Review findings resolved

- Successful deployments now create an atomic, mode-restricted `deploy/releases/<release>/` snapshot containing `.env.production`, `docker-compose.prod.yml`, `release.meta`, and `backup.manifest`. Metadata records source revision, Compose project name, pre-upgrade backup path, all three image references, and immutable local image IDs.
- Ordinary rollback reads the previous release snapshot rather than the live env file, verifies API/Web image IDs before recreation, creates a current-state backup, swaps current/previous release records atomically, and never changes the PostgreSQL volume or schema.
- Added `deploy/scripts/restore-database.sh`. It requires `--release` plus the exact `RESTORE_DATABASE:<project>:<release>` confirmation, validates gzip/size/SHA-256, creates a second safety backup before stopping writers, restores with `psql -v ON_ERROR_STOP=1`, leaves API/Web stopped for operator verification, and never deletes or replaces a volume.
- `deploy.sh` now implements planned-downtime, low-memory deployment: backup; stop API/Web; stop PostgreSQL during builds; build migrate, API, and Web sequentially; start PostgreSQL; migrate/seed; start API/Web. Runtime limits are PostgreSQL 384 MiB, migrate 384 MiB, API 384 MiB, and Web 96 MiB, leaving substantial host/Docker headroom on 2 GiB.
- `deploy.sh` and `rollback.sh` no longer source `.env.production` and contain no `eval`. `common.sh` reads only four literal values (`COMPOSE_PROJECT_NAME`, `IMAGE_PREFIX`, `PERSISTENCE_DRIVER`, `LOCAL_AUTH_BYPASS`) and validates them; Compose validates and consumes all other values.
- The production port test now inspects the complete PostgreSQL/API service blocks and rejects any `ports:` key, covering arbitrary published ports and Compose long syntax.

### TDD evidence

RED was observed before implementation:

```text
corepack pnpm vitest run tests/deployment/production-config.test.ts tests/deployment/deployment-scripts.test.ts
Test Files 2 failed
Tests 3 failed | 6 passed
```

The expected failures were the old 640/512 MiB limits, missing release snapshots/restore entry point, and the old script lifecycle. The initial behavior harness also exposed that Docker Desktop startup latency was contaminating the test; it was replaced with the available POSIX Git shell and a side-effect-recording fake Docker backend. A separate RED/GREEN cycle added the loopback-only smoke override.

Final focused GREEN:

```text
corepack pnpm vitest run tests/deployment/production-config.test.ts tests/deployment/deployment-scripts.test.ts
Test Files  2 passed (2)
Tests       10 passed (10)
Duration    20.46s
```

The lifecycle test executes two releases, mutates the live env before rollback, verifies rollback still uses the previous snapshot, rejects duplicate safety keys, rejects a wrong database-restore confirmation without creating a backup, accepts the exact confirmation, checks that `$`, backticks, and command-substitution text never execute, and asserts the low-memory command order from recorded effects. Two additional RED/GREEN checks found during final review require `pg_dump --create` and restoring through the `postgres` maintenance database so upgrade-added objects cannot survive a database restore.

### Final non-Docker verification

```text
corepack pnpm test
Test Files  42 passed | 3 skipped (45)
Tests       201 passed | 16 skipped (217)

TEST_DATABASE_URL=postgresql://...@127.0.0.1:15432/warehouse \
  corepack pnpm vitest run \
  tests/integration/db/prisma-master-data.test.ts \
  tests/integration/inventory/prisma-business-stores.test.ts \
  tests/integration/db/prisma-restart-persistence.test.ts \
  --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
Test Files  3 passed (3)
Tests       16 passed (16)

corepack pnpm typecheck
exit 0

corepack pnpm build
exit 0; API and Web built

docker compose --project-directory . --project-name warehouse-task5-config-final \
  --env-file deploy/.env.production.example -f docker-compose.prod.yml config --quiet
exit 0

docker compose --project-directory . --project-name warehouse-task5-smoke-config-final \
  --env-file deploy/.env.production.example -f docker-compose.prod.yml \
  -f tests/deployment/docker-compose.smoke.yml config --quiet
exit 0

sh -n deploy/scripts/common.sh deploy/scripts/backup.sh deploy/scripts/deploy.sh \
  deploy/scripts/rollback.sh deploy/scripts/restore-database.sh
exit 0

git diff --check
exit 0
```

The default full run intentionally skips the three opt-in PostgreSQL files; the immediately preceding bounded single-worker run executed all 16 tests in those files against the isolated PostgreSQL 16 container.

### Clean image build and runtime inspection

Each target was rebuilt with `docker build --no-cache --pull=false` and a 10-minute command timeout. Registry metadata/npm access was slow but completed inside the bound.

| Image | Exact size | Approx. MiB |
|---|---:|---:|
| `warehouse-task5-r1/api:clean-a` | 91,652,457 bytes | 87.41 |
| `warehouse-task5-r1/migrate:clean-a` | 296,795,986 bytes | 283.05 |
| `warehouse-task5-r1/web:clean-a` | 22,685,689 bytes | 21.63 |

The API image contains `/app/dist` but no `/app/src` or app tsconfig. `typescript`, `tsx`, `vitest`, `vite`, `prisma`, and `@playwright/test` do not resolve. `dotenv`, `@prisma/adapter-pg`, `@prisma/client`, `@fastify/cors`, `fastify`, `decimal.js`, and `pg` all resolve, and importing `@prisma/client` exposes `PrismaClient` successfully.

### Isolated Compose acceptance

Project: `warehouse-task5-smoke-r1`; only Web was published, at `127.0.0.1:18080`. PostgreSQL was temporarily published at `127.0.0.1:15432` only while running the bounded host-side PostgreSQL suites, through an uncommitted override, then recreated/removed during cleanup.

- PostgreSQL 16 became healthy; all 3 migrations applied; structured seed completed; 24 application/migration relations were present.
- Caddy `/health` returned `status=ok`, `persistenceDriver=prisma`, and database `status=ok`.
- `/` returned the built SPA; `/admin/items` with `Accept: text/html` returned `index.html`; the same path with `Accept: application/json` returned API JSON `401 unauthorized` through Caddy.
- A built JS asset returned `Content-Encoding: gzip`; the API container completed bounded outbound HTTPS to `https://example.com` with status 200.
- A `task5-smoke-persist` warehouse row survived an API restart and a PostgreSQL restart; API/database health recovered after each restart.
- Real `backup.sh` first produced a valid 5,549-byte gzip SQL dump and matching manifest. After final restore hardening, a fresh 4,833-byte `--create` gzip passed `gzip -t`, contained explicit `DROP DATABASE IF EXISTS warehouse` and `CREATE DATABASE warehouse`, and passed manifest size/SHA-256 validation inside the real restore command.
- A second isolated project, `warehouse-task5-restore-r1`, ran migrations/seed, created the final-format backup, inserted a post-backup marker, and executed the real `restore-database.sh`. The script created a second 4,888-byte safety backup, dropped/recreated/restored the target database through `postgres`, removed the marker, restored all three seed warehouses, and retained volume `warehouse-task5-restore-r1_warehouse-postgres` throughout.
- API/Web were switched to `clean-b` and back to `clean-a`; both were healthy after rollback, the PostgreSQL mount remained `warehouse-task5-smoke-r1_warehouse-postgres`, and the persisted row remained present.
- Cleanup used the exact Compose project only. Afterwards no containers, volumes, or networks with project label `warehouse-task5-smoke-r1` remained; the unrelated `production-deployment-postgres-1` container remained running.

One initial smoke attempt failed with Prisma P1000 because the documentation example intentionally uses different placeholder text for `POSTGRES_PASSWORD` and the URL-encoded password inside `DATABASE_URL`. The failed isolated project/volumes were removed, and the successful run used consistent temporary smoke credentials.

### Limitations

- This is local Task 5 acceptance, not an ECS production deployment. ECS, firewall, DNS, public certificate issuance, and real Enterprise WeChat credentials remain Tasks 6–7.
- The destructive database restore path was exercised against a disposable isolated PostgreSQL volume; no production or development database was used.
- No independent review subagent was available in this runtime; the fix was checked against every listed finding through focused behavior tests, the full diff, and the acceptance matrix above.
