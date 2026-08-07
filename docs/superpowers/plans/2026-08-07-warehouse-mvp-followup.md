# Warehouse MVP Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the in-memory inventory state used by inbound, outbound, transfer, return, stocktake, approval sync, and report flows so the broad review Critical/Important follow-ups behave consistently end-to-end.

**Architecture:** Introduce one shared `InventoryMemoryState` module that owns the in-memory batches, balances, approvals, issued allocations, returned quantities, stocktake adjustments, and ledger. Keep each in-memory store independently constructible by default, but let `server.ts` create one shared state and inject it into all inventory-facing stores plus approval sync so options, pending approvals, returns, and reports all read the same live data.

**Tech Stack:** TypeScript, Fastify, Decimal.js, Vitest, Playwright, existing in-memory services.

## Global Constraints

- Preserve the current Prisma runtime scope; do not expand durable persistence work.
- Keep each in-memory store's no-argument constructor behavior for isolated unit tests.
- Use TDD: add failing tests first, verify the expected failure, then implement the minimal fix.
- Share at least batches, balances, ledger, issued allocations, and returned quantities across memory stores.
- `server.ts` must create exactly one shared state for the in-memory inventory services.
- Approval sync must make approved requests visible in `/admin/outbound/pending` while preserving closed-status protection.
- Report summary must calculate month-end balances cumulatively through the end of the requested month; transaction detail filtering remains month-scoped.
- Finish with relevant unit/integration/e2e tests, root `typecheck`, root `build`, `git diff --check`, one focused commit, and `docs/superpowers/plans/2026-08-08-warehouse-mvp-followup-report.md`.

---

### Task 1: Add failing shared-state and report regression tests

**Files:**
- Modify: `tests/unit/reports/report-query.test.ts`
- Modify: `tests/unit/wecom/approval-sync-service.test.ts`
- Modify: `tests/integration/inventory/opening-stock.test.ts`
- Modify: `tests/integration/inventory/outbound-service.test.ts`
- Modify: `tests/integration/inventory/transfer-return.test.ts`
- Modify: `tests/integration/reports/excel-export.test.ts`

**Interfaces:**
- Consumes: existing `buildServer()`, `InventoryReportService`, `InMemoryApprovalSyncStore`, `InMemoryOutboundStore`, `InMemoryMovementStore`, `InMemoryStocktakeStore`
- Produces: failing coverage for shared balances/options, approval-to-pending bridging, issued-allocation sharing, and cumulative month-end summaries

- [ ] Write a failing report unit test showing `getSummary("2026-08")` includes prior-month opening and movement rows up to `2026-08-31T23:59:59.999Z`, while transaction detail stays filtered to August.
- [ ] Write a failing approval-sync test showing saving an approved approval into the sync store makes it visible as a pending outbound approval through a shared outbound store.
- [ ] Write failing integration tests for:
  - opening stock/inbound immediately surfacing in transfer, stocktake, and outbound options
  - outbound confirmation immediately surfacing in return options
  - server-backed report summary using the cumulative shared ledger
- [ ] Run the focused tests and confirm they fail for the expected reasons (isolated state, missing approval bridge, monthly-only summary).

### Task 2: Implement shared `InventoryMemoryState`

**Files:**
- Create: `apps/api/src/application/inventory/inventory-memory-state.ts`
- Modify: `apps/api/src/application/inventory/inbound-service.ts`
- Modify: `apps/api/src/application/inventory/outbound-service.ts`
- Modify: `apps/api/src/application/inventory/transfer-service.ts`
- Modify: `apps/api/src/application/inventory/stocktake-service.ts`
- Modify: `apps/api/src/application/inventory/outbound-allocator.ts`

**Interfaces:**
- Consumes: inventory service/store constructor calls with optional shared state injection
- Produces:
  - `createInventoryMemoryState(): InventoryMemoryState`
  - optional `state?: InventoryMemoryState` constructor parameters on all in-memory inventory stores

- [ ] Add a shared state module containing maps/arrays for batches, balances, approvals, issued allocations, returned quantities, stocktake adjustments, and ledger plus any required ID/sequence counters.
- [ ] Refactor `InMemoryInventoryEntryStore` to read/write shared batches, balances, and ledger while preserving no-arg isolated behavior.
- [ ] Refactor `InMemoryOutboundStore` to read/write shared approvals, balances, ledger, and issued allocations.
- [ ] Refactor `InMemoryMovementStore` to read/write shared balances, issued allocations, returned quantities, and ledger.
- [ ] Refactor `InMemoryStocktakeStore` to read/write shared balances, stocktake adjustments, and ledger.
- [ ] Tighten `OutboundAllocator` batch lookup to disambiguate by `warehouseId + batchId` so shared balances do not collide after transfers.
- [ ] Run the focused unit/integration tests and confirm they pass.

### Task 3: Wire one server state and bridge approval sync

**Files:**
- Modify: `apps/api/src/application/wecom/approval-sync-service.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `tests/integration/inventory/outbound-service.test.ts`

**Interfaces:**
- Consumes: shared `InventoryMemoryState`, parsed approval records, existing outbound pending route
- Produces:
  - `InMemoryApprovalSyncStore` optional shared approval state
  - one `inventoryState` instance created in `buildServer()`

- [ ] Let `InMemoryApprovalSyncStore` reuse the shared approval map so `save()` persists approved approvals in a shape the outbound store can list as pending.
- [ ] Preserve the current approved/non-approved mapping rules and closed-status protection when resyncing the same approval number.
- [ ] Update `buildServer()` so it creates exactly one shared memory state and passes it to inventory entry, outbound, movement, stocktake, and approval sync stores.
- [ ] Simplify server report entry collection to read the single shared ledger instead of stitching separate ledgers together.
- [ ] Run the focused approval/inventory integration tests and confirm they pass.

### Task 4: Final verification, commit, and follow-up report

**Files:**
- Create: `docs/superpowers/plans/2026-08-08-warehouse-mvp-followup-report.md`

**Interfaces:**
- Consumes: final code changes, git history, verification command output
- Produces: final report summarizing shared state, approval bridge, period-end report fix, tests, and commit SHA

- [ ] Run relevant inventory/report/wecom unit tests.
- [ ] Run relevant inventory/report integration tests.
- [ ] Run relevant admin e2e tests.
- [ ] Run `corepack pnpm typecheck`, `corepack pnpm build`, and `git diff --check`.
- [ ] Write the follow-up report with the shared-state design, approval bridge, cumulative summary fix, verification results, and final commit hash.
- [ ] Commit the changes in one focused commit.
