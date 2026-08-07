# Warehouse MVP Master Data Validation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Prevent inbound and opening-stock services from recording stock against nonexistent or inactive warehouses and items.

**Architecture:** Reuse the existing `WarehouseService` and `ItemService` as read-only master-data lookups injected into both inventory services. Validate every warehouse/item pair before writing to the shared inventory entry store; keep the existing service behavior and error messages otherwise unchanged.

**Tech Stack:** TypeScript, Fastify, Vitest, existing in-memory master-data services.

## Global Constraints

- Accept only warehouses and items that exist and are active.
- Keep the current three-warehouse maintenance scope; do not add new inventory business rules.
- Preserve existing unit-test construction through explicit lookup stubs.
- Add integration coverage for forged and inactive IDs.
- Run relevant integration/e2e tests, full typecheck, and `git diff --check` before committing.

---

### Task 1: Add failing service-level validation tests

**Files:**
- Modify: `tests/unit/inventory/inbound-service.test.ts`
- Modify: `tests/integration/inventory/opening-stock.test.ts`
- Modify: `tests/integration/master-data-routes.test.ts`

- [ ] Add lookup stubs/fixtures for active and inactive master data.
- [ ] Add tests proving forged and inactive warehouse/item IDs are rejected before stock is recorded.
- [ ] Run the focused tests and confirm they fail because services do not yet validate master data.

### Task 2: Inject and enforce master-data lookups

**Files:**
- Modify: `apps/api/src/application/inventory/inbound-service.ts`
- Modify: `apps/api/src/application/inventory/opening-stock-service.ts`
- Modify: `apps/api/src/server.ts`

- [ ] Inject existing `WarehouseService` and `ItemService` into both services.
- [ ] Reject any row whose warehouse or item is missing or inactive before calling `recordStockEntry`.
- [ ] Wire the already-created master-data services into both inventory services in `buildServer()`.
- [ ] Run focused integration/unit tests and confirm they pass.

### Task 3: Regression verification and report

**Files:**
- Modify: `.superpowers/sdd/2026-08-08-warehouse-mvp-completion/task-3-report.md`

- [ ] Run relevant inventory/master-data integration and admin e2e tests.
- [ ] Run full typecheck and `git diff --check`.
- [ ] Update the report with the additional opening-stock-service, server, and test changes and the repair commit.
- [ ] Commit the repair as one focused commit.
