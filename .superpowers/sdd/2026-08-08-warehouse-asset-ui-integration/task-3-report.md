# Task 3 Report: Administrator Inventory Notifications

## Summary

Implemented a read-only administrator notifications service, exposed it at `GET /admin/notifications`, wired it into the in-memory server composition, and added focused unit/integration coverage for aggregation and access control.

## Files changed

- `apps/api/src/application/inventory/notification-service.ts`
- `apps/api/src/routes/admin/notifications.ts`
- `apps/api/src/server.ts`
- `tests/unit/inventory/notification-service.test.ts`
- `tests/integration/admin/admin-audit.test.ts`

## TDD log

### RED

Command:

```bash
corepack pnpm vitest run tests/unit/inventory/notification-service.test.ts
```

Output:

```text
FAIL tests/unit/inventory/notification-service.test.ts
Error: Cannot find module '../../../apps/api/src/application/inventory/notification-service.js'
```

Reason: the new notification service file did not exist yet.

### GREEN (targeted unit)

Command:

```bash
corepack pnpm vitest run tests/unit/inventory/notification-service.test.ts
```

Final output:

```text
✓ tests/unit/inventory/notification-service.test.ts (3 tests)
Test Files 1 passed (1)
Tests 3 passed (3)
```

## Required verification

### Unit command

Command:

```bash
corepack pnpm vitest run tests/unit/inventory/notification-service.test.ts tests/unit/inventory/alert-service.test.ts
```

Output:

```text
✓ tests/unit/inventory/alert-service.test.ts (1 test)
✓ tests/unit/inventory/notification-service.test.ts (3 tests)
Test Files 2 passed (2)
Tests 4 passed (4)
```

### Integration command

Command:

```bash
corepack pnpm vitest run tests/integration/inventory/stocktake-close.test.ts tests/integration/admin/admin-audit.test.ts
```

Output:

```text
✓ tests/integration/inventory/stocktake-close.test.ts (6 tests)
✓ tests/integration/admin/admin-audit.test.ts (4 tests)
Test Files 2 passed (2)
Tests 10 passed (10)
```

## Implementation notes

- `NotificationService.list()` aggregates:
  - pending outbound approvals from in-memory approval state
  - low-stock items from the existing `AlertService`
  - stocktake adjustment count
  - anomaly count from non-zero `quantityDelta`
  - current period status from `periodStore.getOrCreate(...)`
- The service returns only actionable notices, sorted by `priority` then `title`.
- `GET /admin/notifications` is registered in its own route file and stays behind the existing `/admin` permission hook.
- The integration test verifies an `ADMIN` receives `200` and a `FINANCE` user receives `403`.

## Self-review

- Confirmed the route is read-only and does not mutate approval, balance, ledger, or period state.
- Reused the existing `AlertService` for low-stock logic instead of duplicating warehouse aggregation rules.
- Kept the new integration coverage in an existing required test file so the brief’s verification command remains sufficient.
- Staged only Task 3 files for commit, leaving unrelated uncommitted web/UI/doc work untouched.

## Concerns

- Low-stock notification `href` currently points to `/admin/items` because the brief requires notification shape and low-stock content but does not name a dedicated low-stock destination route.
- The in-memory server currently surfaces the open current period as a `PERIOD_CLOSE` notice by default, which is correct per the brief and influenced the integration assertion shape.

---

## Fix round 1: read-only notification period lookup

### Review item addressed

- Major: `GET /admin/notifications` must not create/save a missing accounting period while assembling notification payloads.
- Minor: add regression coverage for the read-only guarantee.

### Change summary

- Updated `apps/api/src/server.ts` notification wiring to read the current period with `periodStore.get(currentPeriodCode)` instead of `getOrCreate(...)`.
- Added a non-persisting fallback `{ code, status: "OPEN" }` only for notification payload generation when the current period is absent.
- Kept mutation semantics unchanged for period-close and other write paths; `assertCurrentPeriodOpen` still uses the persistent store behavior required by existing workflows.
- Added a focused integration regression in `tests/integration/admin/admin-audit.test.ts` proving notification reads call `get(...)` and do not call `getOrCreate(...)` or `save(...)` on a missing period.

### RED

Command:

```bash
corepack pnpm vitest run tests/integration/admin/admin-audit.test.ts -t "does not create or save a current period when notifications are read"
```

Output:

```text
FAIL tests/integration/admin/admin-audit.test.ts > admin mutation audit > does not create or save a current period when notifications are read
AssertionError: expected "spy" to be called with arguments: [ '2026-08' ]
Number of calls: 0
```

Reason: `buildServer()` ignored the injected store seam and notification period lookup still used internal mutating wiring.

### GREEN / focused verification

Command:

```bash
corepack pnpm vitest run tests/integration/admin/admin-audit.test.ts -t "does not create or save a current period when notifications are read"
```

Output:

```text
✓ tests/integration/admin/admin-audit.test.ts (5 tests | 4 skipped)
Test Files 1 passed (1)
Tests 1 passed | 4 skipped (5)
```

### Final verification

Command:

```bash
corepack pnpm vitest run tests/unit/inventory/notification-service.test.ts tests/integration/admin/admin-audit.test.ts tests/integration/inventory/stocktake-close.test.ts
```

Output:

```text
✓ tests/unit/inventory/notification-service.test.ts (3 tests)
✓ tests/integration/inventory/stocktake-close.test.ts (6 tests)
✓ tests/integration/admin/admin-audit.test.ts (5 tests)
Test Files 3 passed (3)
Tests 14 passed (14)
```

### Files changed in fix round 1

- `apps/api/src/server.ts`
- `tests/integration/admin/admin-audit.test.ts`

### Self-review

- The notification endpoint now remains read-only even when the current accounting period has not been created yet.
- The regression covers the actual server composition seam rather than only the pure notification service, so it protects the behavior the review flagged.
- No unrelated worktree changes were touched.
