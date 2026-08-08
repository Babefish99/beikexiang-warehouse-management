# Task 2 Implementer Report

Date: 2026-08-08
Branch: `feat/warehouse-system`
Base task reference: `.superpowers/sdd/2026-08-08-warehouse-asset-ui-integration/task-2-brief.md`

## Scope completed

- Added read-only `InventoryQueryService` for warehouse-aware inventory lookup.
- Added report endpoints:
  - `GET /admin/reports/inventory-search`
  - `GET /admin/reports/warehouses`
- Wired the service in `buildServer()` with existing item, warehouse, batch, and balance sources.
- Added unit and integration coverage for service behavior and report-route permissions.

## RED

Command:

```bash
corepack pnpm vitest run tests/unit/inventory/inventory-query-service.test.ts
```

Output:

```text
RUN  v3.2.7 D:/桌面/仓库

Test Files  1 failed (1)
Tests  no tests

FAIL  tests/unit/inventory/inventory-query-service.test.ts
Error: Cannot find module '../../../apps/api/src/application/inventory/inventory-query-service.js'
Caused by: Failed to load url ../../../apps/api/src/application/inventory/inventory-query-service.js
```

Why this was the expected RED:

- The new unit test was in place first.
- The service module did not exist yet, so the test suite failed before production code was added.

## GREEN

Focused task command:

```bash
corepack pnpm vitest run tests/unit/inventory/inventory-query-service.test.ts tests/integration/inventory/inventory-query-routes.test.ts
```

Output:

```text
RUN  v3.2.7 D:/桌面/仓库

✓ tests/unit/inventory/inventory-query-service.test.ts (3 tests)
✓ tests/integration/inventory/inventory-query-routes.test.ts (2 tests)

Test Files  2 passed (2)
Tests  5 passed (5)
```

Required existing report regression command:

```bash
corepack pnpm vitest run tests/unit/reports/report-query.test.ts tests/integration/reports/excel-export.test.ts
```

Output:

```text
RUN  v3.2.7 D:/桌面/仓库

✓ tests/unit/reports/report-query.test.ts (6 tests)
✓ tests/integration/reports/excel-export.test.ts (3 tests)

Test Files  2 passed (2)
Tests  9 passed (9)
```

## Files changed

- `apps/api/src/application/inventory/inventory-query-service.ts`
- `apps/api/src/routes/admin/reports.ts`
- `apps/api/src/server.ts`
- `tests/unit/inventory/inventory-query-service.test.ts`
- `tests/integration/inventory/inventory-query-routes.test.ts`
- `.superpowers/sdd/2026-08-08-warehouse-asset-ui-integration/task-2-report.md`

## Implementation notes

- Query normalization trims and lowercases input; empty queries return `[]`.
- Matches include item code/name/specification/categoryId/weComOptionKey, batch number, and warehouse code/name.
- Inactive items and inactive warehouses are excluded.
- Balances are joined to batches by `batchId`.
- `warehouseId` filtering ignores empty values and `"all"`.
- Quantity and amount aggregation use `Decimal`, preserving string outputs.
- Item results sort by item code; nested locations sort by warehouse code then batch number.
- Report endpoints remain under the existing `/admin/reports` permission hook, so access stays read-only for `VIEW_REPORTS`.

## Self-review

- Checked that the new report endpoints were added only in `reports.ts`, not in writable admin routes.
- Verified server wiring uses the exact dependencies required by the brief:
  - `itemService.list(true)`
  - `warehouseService.listActive()`
  - `inventoryEntryStore.batches()`
  - `inventoryEntryStore.balances()`
- Confirmed unrelated uncommitted web/e2e/doc changes were left untouched.
- Confirmed focused inventory tests and existing report tests both pass after the implementation.

## Concerns

- `GET /admin/reports/warehouses` currently returns full active warehouse definitions, including `isPlaceholder`, because it reuses `warehouseService.listActive()`. This matches the current service contract and tests, but if the UI later wants a narrower selector payload, that should be introduced as an explicit endpoint contract change.
