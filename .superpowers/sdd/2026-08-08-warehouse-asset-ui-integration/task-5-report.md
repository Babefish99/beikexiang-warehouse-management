# Task 5 Report — Warehouse asset UI integration

## Summary

Implemented Task 5 on `feat/warehouse-system` in `D:\桌面\仓库`, preserving the unrelated existing WIP in `apps/web/src/pages/ReportsPage.tsx`, `tests/e2e/admin/reports.spec.ts`, and the untracked plan docs.

## Files changed

- `apps/web/src/App.tsx`
- `apps/web/src/pages/ReportsPage.tsx`
- `apps/web/src/styles.css`
- `tests/e2e/admin/reports.spec.ts`
- `tests/e2e/navigation/dashboard.spec.ts`

## TDD log

### RED

Command:

```bash
corepack pnpm exec playwright test tests/e2e/admin/reports.spec.ts tests/e2e/navigation/dashboard.spec.ts --reporter=line
```

Output:

```text
Running 5 tests using 2 workers

1) tests\e2e\navigation\dashboard.spec.ts:3:1 › dashboard quick actions open the corresponding operation pages
   Expected: "all"
   Received: null
   expect(url.searchParams.get("warehouseId")).toBe("all");

   Expected: 4
   Received: 0
   locator('.metric .metric__label')

2) tests\e2e\admin\reports.spec.ts:9:1 › reports page filters transaction details and keeps filters after a server error
   Expected: "all"
   Received: null
   expect(url.searchParams.get("warehouseId")).toBe("all");

   Expected: 2
   Received: 0
   locator('.report-section .panel__header h2')

3) tests\e2e\admin\reports.spec.ts:82:1 › reports page enables export when queries are available
   Expected: "all"
   Received: null
   expect(url.searchParams.get("warehouseId")).toBe("all");

   Expected: enabled
   Received: disabled
   locator('.report-actions .button--primary')

4) tests\e2e\admin\reports.spec.ts:138:1 › reports page keeps export enabled after export failure
   Expected: "all"
   Received: null
   expect(url.searchParams.get("warehouseId")).toBe("all");

   Expected: enabled
   Received: disabled
   locator('.report-actions .button--primary')

4 failed
1 passed
```

Why RED was correct:

- dashboard requests were missing `warehouseId=all`
- reports summary/transaction/export requests were missing `warehouseId=all`
- dashboard metric markup was still value-first and lacked `.metric__label` / `.metric__value`
- report sections/actions/layout from the existing WIP were not fully wired to the new warehouse-scoped data flow

### GREEN

Command:

```bash
corepack pnpm exec playwright test tests/e2e/admin/reports.spec.ts tests/e2e/navigation/dashboard.spec.ts --reporter=line
```

Output:

```text
Running 5 tests using 2 workers
5 passed (3.3s)
```

### Typecheck

Command:

```bash
corepack pnpm --filter @warehouse/web typecheck
```

Output:

```text
$ tsc -b --pretty false
```

## Implementation notes

- App dashboard requests now reload on `selectedWarehouseId` changes and append `warehouseId` to the dashboard fetch URLs.
- `ReportsPage` now accepts `warehouseId`, URL-encodes it, and sends it on summary, transactions, and export requests.
- Report filter copy/layout now uses `统计期间` / `交易类型`, keeps both labels on one line, and keeps the topbar warehouse selector visible.
- Dashboard metric cards now render label before value, preserve tone modifiers, and use the visual hierarchy classes required by the spec.
- Standard item forms keep two desktop columns; the outer `.master-data-form-panel` padding moved to direct header/form children so both columns start on the same left edge.

## Self-review

- Preserved the existing report-page/report-spec WIP and extended it instead of discarding it.
- Left `ItemsPage` unfiltered; only the dashboard/report flows were wired to warehouse context.
- Verified the item-page search hydration still works with `?search=TEA-001`.
- Verified only the task files changed; the untracked plan docs remained untouched.

## Concerns

- The dashboard now appends `warehouseId` to `/admin/items` and `/admin/outbound/pending` per the task brief, but current backend routes do not use that parameter yet. This is harmless today and keeps the UI contract ready if backend filtering is added later.
- The focused dashboard E2E intentionally allows both scoped and unscoped `/admin/outbound/pending` callers because the dashboard and outbound page currently share that endpoint while only the dashboard behavior was in scope for this task.

## Fix round 1

The review identified that the standard item master and pending outbound approval list are group-wide endpoints. The dashboard now leaves `warehouseId` off both requests and keeps it only on the warehouse-scoped transaction queries. The dashboard E2E now asserts this boundary, verifies report transactions change with the warehouse selector, and uses a contract-complete pending approval fixture so the quick-action navigation test also exercises the outbound page safely.

Verification:

```text
corepack pnpm exec playwright test tests/e2e/admin/reports.spec.ts tests/e2e/navigation/dashboard.spec.ts --reporter=line
5 passed (3.2s)

corepack pnpm --filter @warehouse/web typecheck
$ tsc -b --pretty false
```
