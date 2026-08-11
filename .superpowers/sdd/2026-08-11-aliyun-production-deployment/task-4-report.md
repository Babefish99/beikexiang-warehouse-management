# Task 4 report: production Prisma runtime wiring and restart acceptance

## Status

DONE. The API now supports one shared Prisma runtime for every core business, query, notification, and report path. Prisma mode has no inventory memory-state source of truth, `/health` performs a live database probe, production configuration fails closed, memory mode remains supported, and no Task 5+ Docker or deployment files were added.

Base commit: `eac279d`

## Changed files

Created:

- `tests/integration/db/prisma-restart-persistence.test.ts`
- `.superpowers/sdd/2026-08-11-aliyun-production-deployment/task-4-report.md`

Modified:

- `.env.example`
- `README.md`
- `apps/api/src/application/inventory/inventory-query-service.ts`
- `apps/api/src/application/items/item-service.ts`
- `apps/api/src/application/wecom/approval-sync-service.ts`
- `apps/api/src/infrastructure/db/prisma-report-source.ts`
- `apps/api/src/infrastructure/db/runtime.ts`
- `apps/api/src/server.ts`
- `tests/unit/infrastructure/persistence-runtime.test.ts`

## TDD RED evidence

All behavior changes began with a focused failing test and the expected failure was inspected before implementation.

### Production configuration RED

Command:

```powershell
corepack pnpm vitest run tests/unit/infrastructure/persistence-runtime.test.ts
```

Initial output (exit 1):

```text
Test Files  1 failed (1)
Tests       8 failed | 6 passed (14)
```

The failures showed the old Prisma runtime block masking the required production checks for database URL, complete WeCom credentials, HTTPS URLs, session-secret strength/defaults, and local-auth safety. After adding the validators while retaining the block, the configuration suite passed 14/14.

### Narrow runtime health RED

Command:

```powershell
corepack pnpm vitest run tests/unit/infrastructure/persistence-runtime.test.ts -t "reports that PostgreSQL is not required"
```

Initial output (exit 1):

```text
expected the memory health response to contain database: { status: "not_required" }
received the previous health response without database state
```

The minimum health-contract change made this focused test pass.

### Full Prisma reconstruction RED

Command:

```powershell
$env:TEST_DATABASE_URL='postgresql://warehouse:warehouse@127.0.0.1:5432/warehouse'
corepack pnpm vitest run tests/integration/db/prisma-restart-persistence.test.ts
```

Initial output (exit 1), after migrations and seed succeeded in an isolated schema:

```text
Error: PERSISTENCE_DRIVER=prisma is disabled until all core inventory flows use durable persistence
```

This was the intended acceptance-level RED: a real Fastify application could not be constructed in Prisma mode.

### Live database probe RED

Command:

```powershell
corepack pnpm vitest run tests/unit/infrastructure/persistence-runtime.test.ts -t "runs a live Prisma database probe"
```

Initial output (exit 1):

```text
expected 503, received 200
```

The runtime was then changed to issue `SELECT 1` through the shared Prisma client for every Prisma health request and return 503 with `database.status=unavailable` on failure.

### Approval parser reconstruction RED

The reconstruction test next reached the second real API instance but failed approval resynchronization:

```text
expected 200, received 400
unknown item option key: task4-option
```

The item option index was process-local. The minimum fix reloads the index from the durable item repository at approval-sync time before parsing. Loading at server startup was deliberately avoided because it would prevent an unavailable database from being represented by the `/health` 503 contract.

### Placeholder rejection RED

Command:

```powershell
corepack pnpm vitest run tests/unit/infrastructure/persistence-runtime.test.ts -t "rejects Enterprise WeChat placeholder values"
```

Initial output (exit 1): production placeholder values were accepted. Production validation now rejects missing values and `replace-with-*` placeholders.

## Focused GREEN evidence

Command:

```powershell
$env:TEST_DATABASE_URL='postgresql://warehouse:warehouse@127.0.0.1:5432/warehouse'
corepack pnpm vitest run tests/unit/infrastructure/persistence-runtime.test.ts tests/unit/items/item-service.test.ts tests/integration/inventory/shared-memory-state.test.ts tests/integration/inventory/prisma-business-stores.test.ts tests/integration/db/prisma-restart-persistence.test.ts --reporter=dot
```

Output (exit 0):

```text
Test Files  5 passed (5)
Tests       35 passed (35)
```

The acceptance test applies all three migrations and seed data in an isolated schema, exercises a real Fastify API through opening stock, outbound, transfer, return, stocktake, reporting and period close, closes the first application, creates a second application/runtime/client, and verifies durable item reconstruction, approval parsing, stock/search/transaction/summary reads, pending approvals, notifications, operation options, period closure, ledger count, and final quantity.

## Actual PostgreSQL container restart evidence

Container: `production-deployment-postgres-1` (`PostgreSQL 16`). The same full API acceptance test created and preserved the guarded schema `warehouse_task4_20260811_1800` for this check.

Verified state immediately before restart:

```json
{"item_count":1,"opening_count":1,"outbound_count":1,"transfer_count":1,"return_count":1,"stocktake_count":1,"closed_period_count":1,"ledger_count":6,"balance_quantity":"16.0000"}
```

Restart and container evidence:

```powershell
docker restart production-deployment-postgres-1
docker inspect production-deployment-postgres-1
```

```text
/production-deployment-postgres-1 status=running started=2026-08-11T10:00:41.372649932Z restartCount=0
```

Verified state after the actual container restart:

```json
{"item_count":1,"opening_count":1,"outbound_count":1,"transfer_count":1,"return_count":1,"stocktake_count":1,"closed_period_count":1,"ledger_count":6,"balance_quantity":"16.0000"}
```

The pre/post JSON is identical. The temporary schema was then dropped explicitly; a follow-up schema query returned count `0`. An earlier quoting-invalid verification attempt was not counted as evidence even though it restarted the container; the successful evidence above came from a complete second pre-query/restart/post-query cycle.

## Full verification

PostgreSQL-enabled full suite with bounded workers:

```powershell
$env:TEST_DATABASE_URL='postgresql://warehouse:warehouse@127.0.0.1:5432/warehouse'
corepack pnpm vitest run --maxWorkers=4 --reporter=dot
```

Output (exit 0):

```text
Test Files  43 passed (43)
Tests       194 passed (194)
Duration    11.94s
```

An initial unbounded `corepack pnpm test` run produced one timing-only failure while all database files ran concurrently:

```text
Test Files  1 failed | 42 passed (43)
Tests       1 failed | 193 passed (194)
tests/integration/db/prisma-master-data.test.ts timed out at 5523ms
```

The exact failing file passed alone in `779ms`, and the complete PostgreSQL-enabled suite passed with four workers as shown above. No production behavior was changed to hide the timeout.

Typecheck, build, and diff verification are recorded from the final pre-commit run below:

```powershell
corepack pnpm typecheck
corepack pnpm build
git diff --check
```

Output (exit 0):

```text
apps/api typecheck: Done
apps/web typecheck: Done
apps/api build: Done
apps/web build: 1595 modules transformed
apps/web build: built in 4.17s
apps/web build: Done
git diff --check: no whitespace errors (Windows LF/CRLF conversion notices only)
TASK4_SCOPE_CHECK=PASS
```

## Self-review

- `createPersistenceAdapters` creates one `PrismaClient` in the Prisma branch and injects that same instance into identity, audit, item/warehouse, entry, outbound, movement, stocktake, period, approval-sync, report/query, notification, and health adapters. Application close disconnects it once.
- The shared in-memory inventory state and every in-memory inventory store are constructed only inside the memory branch. `server.ts` no longer imports or creates inventory memory state and therefore cannot use it as truth in Prisma mode.
- Inventory search now awaits the selected runtime's batches and balances. Reports, close prechecks, notifications, and operation-option routes all read from `PrismaReportSource` in Prisma mode.
- WeCom item-option reconstruction uses persisted item rows on every sync, so a newly constructed API instance can parse callbacks without stale process memory.
- Prisma health is a live query, not a startup flag. Memory mode remains healthy without requiring PostgreSQL.
- Production rejects memory persistence, absent database URL, local-auth bypass, weak/default session secrets, incomplete/placeholder WeCom values, and non-HTTPS API or web base URLs. Existing HTTPS and local-auth safety were strengthened, not weakened.
- The restart test reconstructs the real API and adapters; it is not a repository-only test. Its default schema is unique and automatically removed. Preservation is opt-in only for the separately documented container restart check.
- Existing memory-mode behavior remains covered. The complete PostgreSQL-enabled suite passes 194/194.
- Scope inspection found no Dockerfile, Compose, deployment, reverse-proxy, CI deployment, or other Task 5+ artifact.
- Independent review-agent dispatch was unavailable in this runtime. A requirement-by-requirement local review of the complete patch found no Critical or Important issues.

## Concerns

- The unbounded all-database parallel run can exceed the legacy `prisma-master-data` test's five-second timeout under local PostgreSQL contention. The test passes alone and the full suite is stable with `--maxWorkers=4`; this is recorded rather than silently omitted.
- Real public HTTPS, production secrets, production migrations, and live Enterprise WeChat connectivity remain deployment/operator work for later tasks. Task 4 does not claim those external systems are configured.

## Fix round 1: production WeCom key and administrator validation

Status: DONE. Fix base: `5c76e5e`. Production startup now rejects malformed or incorrectly sized EncodingAESKey values and requires at least one usable Enterprise WeChat administrator UserID. The exact same key decoder is used by startup configuration and callback decryption, and the exact same UserID parser is used by startup validation and OAuth role assignment.

### Changed files

- `.env.example`
- `README.md`
- `apps/api/src/application/auth/role-service.ts`
- `apps/api/src/infrastructure/db/runtime.ts`
- `apps/api/src/infrastructure/wecom/signature-verifier.ts`
- `apps/api/src/server.ts`
- `tests/unit/infrastructure/persistence-runtime.test.ts`
- `.superpowers/sdd/2026-08-11-aliyun-production-deployment/task-4-report.md`

### EncodingAESKey RED evidence

Command:

```powershell
corepack pnpm vitest run tests/unit/infrastructure/persistence-runtime.test.ts -t EncodingAESKey --reporter=verbose
```

Output (exit 1):

```text
Test Files  1 failed (1)
Tests       4 failed | 1 passed | 17 skipped (22)
```

The canonical unpadded 43-character value passed. All four invalid cases were incorrectly accepted: nonempty one-character `A`, a canonical Base64 value decoding to 31 bytes, a 43-character value containing `*`, and a padded 44-character value.

### EncodingAESKey GREEN evidence

Commands:

```powershell
corepack pnpm vitest run tests/unit/infrastructure/persistence-runtime.test.ts -t EncodingAESKey --reporter=verbose
corepack pnpm vitest run tests/unit/wecom/signature-verifier.test.ts --reporter=verbose
```

Output (exit 0):

```text
runtime EncodingAESKey cases: 5 passed | 17 skipped
signature verifier: 2 passed
```

`decodeWeComEncodingAesKey` requires exactly 43 standard Base64 characters, decodes with the WeCom-required padding, checks for exactly 32 bytes, and round-trips to the identical canonical unpadded value. `WeComSignatureVerifier.decrypt` now uses this same decoder.

### Production administrator RED evidence

Command:

```powershell
corepack pnpm vitest run tests/unit/infrastructure/persistence-runtime.test.ts -t administrator --reporter=verbose
```

Output (exit 1):

```text
Test Files  1 failed (1)
Tests       5 failed | 1 passed | 22 skipped (28)
```

Missing, empty, comma/whitespace-only, lowercase placeholder-only, and uppercase placeholder-only values were all incorrectly accepted. A trimmed comma-separated list containing a real UserID passed.

### Production administrator GREEN evidence

Commands:

```powershell
corepack pnpm vitest run tests/unit/infrastructure/persistence-runtime.test.ts -t administrator --reporter=verbose
corepack pnpm vitest run tests/unit/infrastructure/persistence-runtime.test.ts --reporter=dot
```

Output (exit 0):

```text
administrator cases: 6 passed | 22 skipped
runtime configuration file: 28 passed
```

The shared parser trims comma-separated values, drops blanks and case-insensitive `replace-with-*` placeholders, and requires at least one remaining production administrator. `server.ts` uses the same parser for administrator and optional finance role assignment.

### PostgreSQL reconstruction acceptance

Command:

```powershell
$env:TEST_DATABASE_URL='postgresql://warehouse:warehouse@127.0.0.1:5432/warehouse'
corepack pnpm vitest run tests/integration/db/prisma-restart-persistence.test.ts --reporter=verbose
```

Output (exit 0):

```text
Test Files  1 passed (1)
Tests       1 passed (1)
Duration    3.45s
```

The real two-instance Fastify/Prisma reconstruction and durable inventory/read-model acceptance remains green.

### Full fix-round verification

PostgreSQL-enabled bounded suite:

```powershell
$env:TEST_DATABASE_URL='postgresql://warehouse:warehouse@127.0.0.1:5432/warehouse'
corepack pnpm vitest run --maxWorkers=4 --reporter=dot
```

```text
Test Files  43 passed (43)
Tests       205 passed (205)
Duration    11.66s
```

Typecheck, build, diff, and scope command/output (exit 0):

```powershell
corepack pnpm typecheck
corepack pnpm build
git diff --check
```

```text
apps/api typecheck: Done
apps/web typecheck: Done
apps/api build: Done
apps/web build: 1595 modules transformed
apps/web build: built in 3.18s
apps/web build: Done
git diff --check: no whitespace errors (Windows LF/CRLF conversion notices only)
TASK4_FIX_SCOPE_CHECK=PASS
```

### Fix-round self-review

- Startup and callback cryptography cannot disagree about EncodingAESKey structure because both call one strict decoder.
- The decoder rejects Node's otherwise-lenient Base64 inputs, verifies exact decoded size, and preserves the standard WeCom unpadded representation.
- Production administrator validation is performed after required WeCom credential validation and before URL checks; a missing administrator fails startup even though finance IDs remain optional.
- Placeholder filtering is case-insensitive. A mixed list is accepted only when at least one trimmed non-placeholder UserID remains.
- OAuth role assignment consumes the same filtered parser, so ignored placeholders cannot accidentally receive administrator or finance permissions.
- `.env.example` contains no secret and now identifies its administrator value as a deliberate placeholder. Chinese guidance explains the first-production-administrator and EncodingAESKey requirements.
- Memory mode, non-production behavior, the full Prisma reconstruction acceptance, and all existing tests remain green.
- No Docker, Compose, deployment, reverse-proxy, migration, schema, or other Task 5+ file changed.
- Independent reviewer dispatch is unavailable in this runtime; the complete fix diff was reviewed requirement-by-requirement locally and no additional Critical or Important issue was found.

Fix-round concern: none beyond the previously documented local unbounded-test contention and external production-operator work.
