# Task 5 report — rollback-capable production deployment package

Status: **implementation complete; real Compose acceptance BLOCKED/NOT RUN after controller-directed stop because local Docker registry/runtime operations repeatedly stalled.** No ECS, DNS, firewall, or real-secret changes were made.

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

## Concerns / required follow-up

Before Task 6 or any production claim, rerun a clean final Docker build and complete the isolated smoke/restart/backup/rollback matrix. Confirm the final API image imports Prisma successfully, contains no application source or dev tooling, record its final size, and verify outbound HTTPS from API on `edge`. This task must not be described as production-deployed or fully smoke-accepted yet.
