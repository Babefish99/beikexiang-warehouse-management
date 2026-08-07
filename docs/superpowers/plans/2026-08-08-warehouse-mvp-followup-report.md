# Warehouse MVP Follow-up Report

> The implementation work summarized here was completed on **August 8, 2026**.

## Scope completed

This follow-up closed the broad review Critical/Important 1-2 items around shared in-memory inventory state, approval-to-outbound visibility, and cumulative period-end report summaries.

## Shared in-memory inventory state

- Added a dedicated shared state module at `apps/api/src/application/inventory/inventory-memory-state.ts`.
- Centralized these in-memory structures:
  - `batches`
  - `balances`
  - `ledger`
  - `approvals`
  - `issuedAllocations`
  - `returnedQuantities`
  - `stocktakeAdjustments`
  - `approvalsBySpNo`
  - `stockEntrySequence`
- Updated `InMemoryInventoryEntryStore`, `InMemoryOutboundStore`, `InMemoryMovementStore`, and `InMemoryStocktakeStore` to accept an optional shared state while preserving isolated default state for unit tests.
- `server.ts` now creates exactly one shared inventory state and injects it into all in-memory inventory stores.

## Approval bridge

- `InMemoryApprovalSyncStore` now supports the shared approval state.
- Saving an approved approval sync record makes it immediately visible to `/admin/outbound/pending`.
- Closed-status protection is preserved when the same approval number is re-synchronized.
- `ApprovalOutboundStatus` now reuses the shared-state type and preserves `COMPLETED`, `PARTIALLY_ISSUED`, `UNAVAILABLE`, and `VOIDED` during approved re-synchronization.
- Approval lines are materialized into outbound line IDs so the same approval can flow directly into outbound confirmation.

## Pending/option synchronization results

- Opening stock and inbound-created balances are immediately visible in:
  - transfer options
  - stocktake options
  - outbound batch options
- Outbound confirmation now writes shared issued allocations, so return options immediately surface the returnable allocation.
- Stocktake adjustments now write into the same shared ledger used by reports.

## Period-end report summary fix

- `InventoryReportService.getSummary(period)` now computes balances cumulatively through the end of the requested month instead of only summing movements inside that month.
- Transaction detail queries remain month-filtered.
- `server.ts` report wiring now reads the single shared ledger instead of stitching multiple isolated ledgers together.

## Verification

Focused red/green verification:

- `corepack pnpm vitest run tests/unit/reports/report-query.test.ts tests/unit/wecom/approval-sync-service.test.ts tests/integration/inventory/shared-memory-state.test.ts tests/integration/reports/excel-export.test.ts`
  - Follow-up regression covers all four closed outbound statuses, including `VOIDED` and `PARTIALLY_ISSUED`.

Repository-wide unit/integration verification:

- `corepack pnpm test`
  - Result: `34` test files passed, `135` tests passed

Relevant admin e2e verification:

- `corepack pnpm exec playwright test tests/e2e/admin/inbound.spec.ts tests/e2e/admin/outbound.spec.ts tests/e2e/admin/inventory-operations.spec.ts tests/e2e/admin/reports.spec.ts`
  - Result: `13` tests passed

Build / type / diff gates:

- `corepack pnpm typecheck`
- `corepack pnpm build`
- `git diff --check`

All commands above completed successfully.

## Commits

- Code implementation commit: `6018d46` (`fix: unify in-memory inventory state`)
- Follow-up fix commit: `d5ab92f` (`fix: preserve closed approval outbound status`)

## Note

- An initial `corepack pnpm test:e2e -- ...` invocation widened to the full Playwright suite and exposed an unrelated existing failure in `tests/e2e/navigation/dashboard.spec.ts`. The required scoped admin e2e suite was then rerun with `corepack pnpm exec playwright test ...` and passed.
