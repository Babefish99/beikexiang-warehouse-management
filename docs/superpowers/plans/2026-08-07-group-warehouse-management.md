# 集团轻量化仓库管理系统 Implementation Plan

> **For implementers:** Execute this plan task-by-task. Each task ends with its own test cycle and review checkpoint.

**Goal:** Build a lightweight web inventory backend that receives approved Enterprise WeChat requisitions, manages three warehouses with batch-level cost tracking, and produces monthly quantity-and-amount Excel reports.

**Architecture:** Initialize the independent repository directly at `D:\桌面\仓库`. Reuse the fixed-asset project's React/Vite visual language and selected components from `C:\Users\Administrator\Documents\Codex\2026-07-24\g-i\work\beikexiang-assets` in `apps/web`, while keeping the inventory API, database access, Enterprise WeChat integration, and ledger rules in `apps/api`. Enterprise WeChat remains the approval source; a callback plus detail-fetch adapter creates idempotent pending outbound orders. PostgreSQL stores immutable inventory ledger entries and batch balances.

**Tech Stack:** TypeScript, React 19, Vite, Fastify, PostgreSQL, Prisma, Zod, Vitest, Playwright, pnpm workspaces, Docker Compose. The web app starts from the fixed-asset project's Vite/React conventions; Excel export is isolated behind an API report-export adapter and must use the workspace-provided `@oai/artifact-tool` runtime when available.

## Global Constraints

- Three warehouses and one primary administrator are in scope.
- Enterprise WeChat is the employee request and leader-approval entry point.
- The approval detail table contains at most five item rows.
- The applicant selects standard items, but does not select a warehouse or view stock and amount.
- Approval results are imported into the backend; the backend never writes back to the original approval flow or sends an extra outbound notification.
- Outbound actual quantity may be less than or equal to approved quantity, never greater; less-than-approved and zero-quantity outcomes require a reason.
- One approval can be split across warehouses and procurement batches, but completes only once; later additional issue requires a new approval.
- Outbound amount is calculated from administrator-selected procurement batch cost, not weighted average cost.
- Inbound is administrator-entered in phase one; transfer is one-click and unapproved; return is unapproved but linked to the original approval and outbound record.
- Confirmed records are never deleted; corrections use return, void, or adjustment records.
- Month-end stocktake and period close are required; closed periods reject direct edits.
- Minimum stock is configured per item and alerts when the combined stock of all three warehouses is below the threshold.
- Historical Excel files remain archived; only physically verified opening batch stock is loaded.
- The fixed-asset reference is `C:\Users\Administrator\Documents\Codex\2026-07-24\g-i\work\beikexiang-assets`; copy only reusable UI patterns/assets into the new warehouse project and do not modify the reference project while implementing warehouse behavior.
- The new target repository is `D:\桌面\仓库`; it must be initialized in this directory before implementation. Do not create or write project files under the `g-i\work` directory.

---

## File and Module Map

The implementation should create the following focused boundaries:

```text
apps/
  web/
    src/main.tsx
    src/App.tsx
    src/components/
    src/layouts/
    src/pages/LoginPage.tsx
    src/pages/DashboardPage.tsx
    src/pages/ItemsPage.tsx
    src/pages/WarehousesPage.tsx
    src/pages/InboundPage.tsx
    src/pages/OpeningStockPage.tsx
    src/pages/OutboundPage.tsx
    src/pages/TransfersPage.tsx
    src/pages/ReturnsPage.tsx
    src/pages/StocktakePage.tsx
    src/pages/PeriodClosePage.tsx
    src/pages/ReportsPage.tsx
    package.json
    vite.config.ts
  api/
    src/server.ts
    src/domain/items/
    src/domain/warehouses/
    src/domain/approvals/
    src/domain/inventory/
    src/domain/periods/
    src/application/wecom/
    src/application/inventory/
    src/application/reports/
    src/application/auth/
    src/application/items/
    src/application/warehouses/
    src/application/periods/
    src/infrastructure/db/
    src/infrastructure/wecom/
    src/infrastructure/export/
    src/infrastructure/audit/
    src/shared/validation/
    src/routes/wecom/
    src/routes/admin/
    package.json
    tsconfig.json
prisma/schema.prisma
prisma/seed.ts
tests/unit/
tests/integration/
tests/e2e/
docker-compose.yml
.env.example
README.md
vitest.config.ts
playwright.config.ts
```

The domain modules own business rules. Route handlers only authenticate, validate input, call an application service, and translate the result into an HTTP response. No page or route may update stock balances directly.

## Task 0: Project Bootstrap and Runtime Preflight

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`
- Create: `.env.example`, `docker-compose.yml`, `README.md`
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`
- Create: `apps/api/package.json`, `apps/api/src/server.ts`
- Test: `tests/integration/bootstrap.test.ts`

**Interfaces:**

- Produces: a runnable React/Vite web shell, a Fastify API health endpoint, a PostgreSQL service, test commands, and documented environment variables.

- [ ] **Step 1: Write the bootstrap smoke test**

```ts
import { describe, expect, it } from "vitest";

describe("application bootstrap", () => {
  it("loads the API health contract", async () => {
    const response = await fetch(process.env.API_BASE_URL ?? "http://localhost:3001/health");
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the smoke test and record the expected failure**

Run: `pnpm vitest run tests/integration/bootstrap.test.ts`

Expected before implementation: FAIL because the application and test script do not exist.

- [ ] **Step 3: Create the application shell and scripts**

Define workspace scripts for `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `db:migrate`, and `db:seed`, with `apps/web` and `apps/api` filters where appropriate. Add PostgreSQL and the API service to `docker-compose.yml`. Add `.env.example` entries for `DATABASE_URL`, `WE_COM_CORP_ID`, `WE_COM_SECRET`, `WE_COM_CALLBACK_TOKEN`, `WE_COM_ENCODING_AES_KEY`, `WEB_BASE_URL`, `API_BASE_URL`, and session encryption.

Read the reference project at `C:\Users\Administrator\Documents\Codex\2026-07-24\g-i\work\beikexiang-assets` and copy only domain-neutral layout, navigation, table, modal, form, icon, and style patterns into `apps/web/src`. Do not import source files from the reference path at runtime and do not copy its asset-management data or Snipe-IT configuration.

- [ ] **Step 4: Verify the shell and artifact-tool availability**

Run: `pnpm install`, `pnpm typecheck`, `pnpm -r build`, `pnpm vitest run tests/integration/bootstrap.test.ts`.

Also run a one-line import check for `@oai/artifact-tool` using the workspace-provided Node runtime. If the bundled package is unavailable, stop the Excel-export task and report the dependency blocker rather than silently substituting another workbook authoring library.

- [ ] **Step 5: Commit the bootstrap checkpoint**

```bash
git add package.json pnpm-workspace.yaml tsconfig.json vitest.config.ts playwright.config.ts .env.example docker-compose.yml README.md apps tests/integration/bootstrap.test.ts
git commit -m "chore: bootstrap warehouse application"
```

## Task 1: Domain Model, Database Schema, and Immutable Ledger

**Files:**

- Create: `prisma/schema.prisma`, `prisma/seed.ts`
- Create: `apps/api/src/domain/items/item.ts`, `apps/api/src/domain/warehouses/warehouse.ts`
- Create: `apps/api/src/domain/approvals/approval.ts`
- Create: `apps/api/src/domain/inventory/ledger.ts`, `apps/api/src/domain/inventory/batch.ts`, `apps/api/src/domain/inventory/invariants.ts`
- Create: `apps/api/src/domain/periods/accounting-period.ts`
- Create: `apps/api/src/infrastructure/db/client.ts`, `apps/api/src/infrastructure/db/repositories.ts`
- Test: `tests/unit/domain/inventory-invariants.test.ts`, `tests/integration/db-schema.test.ts`

**Interfaces:**

- `InventoryLedgerEntry`: `{ id, warehouseId, itemId, batchId?, type, quantity, unitCost, amount, referenceType, referenceId, occurredAt }`
- `BatchBalance`: `{ batchId, warehouseId, itemId, remainingQuantity, unitCost }`
- `ApprovalLine`: `{ id, approvalId, itemId, requestedQuantity, unit }`
- `InventoryTransactionService`: `recordInbound`, `recordOutbound`, `recordTransfer`, `recordReturn`, `recordAdjustment`
- `AccountingPeriodService`: `isOpen(period)`, `close(period)`, `assertOpen(period)`

- [ ] **Step 1: Write invariant tests**

Cover: approved quantity cannot be exceeded; zero and partial issue require a reason; a batch cannot go negative; return cannot exceed original issue; transfer has equal source and destination quantities; closed periods reject new corrections; confirmed records cannot be deleted; duplicate `weComSpNo` is rejected.

- [ ] **Step 2: Run the domain tests to verify they fail**

Run: `pnpm vitest run tests/unit/domain/inventory-invariants.test.ts`

Expected before implementation: FAIL because the domain types and services do not exist.

- [ ] **Step 3: Create Prisma models and constraints**

Create models for `User`, `Role`, `Warehouse`, `ItemCategory`, `Item`, `ApprovalRequest`, `ApprovalLine`, `InboundOrder`, `InboundLine`, `ProcurementBatch`, `StockBalance`, `OutboundOrder`, `OutboundAllocation`, `TransferOrder`, `TransferLine`, `ReturnOrder`, `ReturnLine`, `Stocktake`, `StockAdjustment`, `InventoryLedgerEntry`, `AccountingPeriod`, `SyncAttempt`, and `AuditLog`. Store the Enterprise WeChat selector option key on `Item` as a unique nullable `weComOptionKey` so the approval parser can resolve selected options without matching free-text names.

Enforce unique constraints on item code, warehouse code, approval number, and period. Enforce one outbound order per approval. Store amounts as decimal values and quantities as decimal values so units such as kilograms remain valid.

- [ ] **Step 4: Implement ledger and period invariants**

Make ledger entries append-only. All balance changes must be derived from transaction services. `recordOutbound` must lock or atomically update `StockBalance` rows before writing allocations and ledger entries. `recordTransfer` must preserve batch cost while moving the batch balance between warehouses.

- [ ] **Step 5: Seed only structural reference data**

Seed the three warehouse placeholders and category prefixes `BJ`, `CY`, and `WP` only after their final names and codes are supplied. Do not seed historical stock or historical Excel rows.

- [ ] **Step 6: Run database and domain tests**

Run: `pnpm prisma migrate dev`, `pnpm prisma db seed`, `pnpm vitest run tests/unit/domain/inventory-invariants.test.ts tests/integration/db-schema.test.ts`.

- [ ] **Step 7: Commit the domain checkpoint**

```bash
git add prisma apps/api/src/domain apps/api/src/infrastructure/db tests/unit/domain tests/integration/db-schema.test.ts
git commit -m "feat: add inventory domain and ledger schema"
```

## Task 2: Enterprise WeChat Login, Roles, and Audit Context

**Files:**

- Create: `apps/api/src/application/auth/session-service.ts`, `apps/api/src/application/auth/role-service.ts`
- Create: `apps/api/src/infrastructure/wecom/oauth-client.ts`
- Create: `apps/api/src/infrastructure/audit/audit-service.ts`
- Modify: `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/layouts/AdminLayout.tsx`
- Test: `tests/unit/auth/role-policy.test.ts`, `tests/e2e/auth/roles.spec.ts`

**Interfaces:**

- `WeComOAuthClient.getAuthorizeUrl(returnTo): string`
- `WeComOAuthClient.exchangeCode(code): Promise<{ weComUserId: string; name: string }>`
- `RolePolicy.can(user, action): boolean`
- `AuditService.record(event): Promise<void>`

- [ ] **Step 1: Write role-policy tests**

Assert that applicants cannot access admin routes, administrators can operate inventory, and finance can query/export but cannot mutate items, stock, periods, or ledger records.

- [ ] **Step 2: Run the role tests and verify failure**

Run: `pnpm vitest run tests/unit/auth/role-policy.test.ts`

Expected before implementation: FAIL because session and role policies do not exist.

- [ ] **Step 3: Implement WeCom login and session storage**

Use the enterprise application authorization flow. Map the returned WeCom user ID to a local user and role. Store an encrypted HTTP-only session cookie; never expose the WeCom secret to browser code.

- [ ] **Step 4: Add route guards and audit context**

Protect all `/admin` pages and mutation routes. Add the authenticated user ID, role, request ID, and timestamp to every audit event. Audit item edits, inbound, outbound, transfer, return, stocktake, adjustment, period close, void, and manual resync.

- [ ] **Step 5: Run browser role tests**

Run: `pnpm test:e2e tests/e2e/auth/roles.spec.ts`.

Expected: applicant is redirected away from admin, administrator can open dashboard, finance can open reports but receives 403 on mutation routes.

- [ ] **Step 6: Commit the auth checkpoint**

```bash
git add apps/api/src/application/auth apps/api/src/infrastructure/wecom/oauth-client.ts apps/api/src/infrastructure/audit apps/web/src/pages/LoginPage.tsx apps/web/src/layouts/AdminLayout.tsx tests/unit/auth tests/e2e/auth
git commit -m "feat: add wecom login and role permissions"
```

## Task 3: Enterprise WeChat Approval Ingestion and Resynchronization

**Files:**

- Create: `apps/api/src/application/wecom/approval-sync-service.ts`
- Create: `apps/api/src/infrastructure/wecom/approval-gateway.ts`, `apps/api/src/infrastructure/wecom/approval-parser.ts`, `apps/api/src/infrastructure/wecom/signature-verifier.ts`
- Create: `apps/api/src/routes/wecom/approval-callback.ts`
- Create: `apps/api/src/routes/admin/approvals-resync.ts`
- Test: `tests/unit/wecom/approval-parser.test.ts`, `tests/integration/wecom/approval-callback.test.ts`, `tests/e2e/admin/approval-sync.spec.ts`

**Interfaces:**

- `ApprovalGateway.fetchDetail(spNo): Promise<WeComApprovalDetail>`
- `ApprovalParser.parse(detail): ParsedApproval`
- `ApprovalSyncService.sync(spNo): Promise<{ approvalId: string; created: boolean; status: string }>`
- `ApprovalSyncService.handleCallback(event): Promise<void>`

- [ ] **Step 1: Create fixtures and parser tests**

Include approved, rejected, revoked, canceled, duplicate callback, missing item, and five-row table fixtures. Assert that the parser extracts approval number, applicant, department, purpose, selected item option keys, quantities, and units, then resolves each option key through `Item.weComOptionKey` without using item names as the primary key.

- [ ] **Step 2: Run parser tests and verify failure**

Run: `pnpm vitest run tests/unit/wecom/approval-parser.test.ts`

Expected before implementation: FAIL because the gateway and parser do not exist.

- [ ] **Step 3: Implement signature verification and detail gateway**

Validate the callback signature using the configured token and AES key. Use the server-side access token to fetch the full approval detail. Keep raw callback and detail payloads in `SyncAttempt` for diagnostics without exposing secrets in logs.

- [ ] **Step 4: Implement idempotent approval synchronization**

For approval status `approved`, create or update one `ApprovalRequest` and its `ApprovalLine` rows. For rejected, revoked, canceled, or deleted states, update the approval record without creating inventory entries. Enforce the unique approval number constraint and write a sync attempt for each result.

- [ ] **Step 5: Add callback and manual resync routes**

The callback route must acknowledge valid events quickly and enqueue or perform the sync. The manual route must require administrator role, validate the approval number format, and return whether a new pending outbound order was created or an existing record was reused.

- [ ] **Step 6: Test callback, retry, and duplicate behavior**

Run: `pnpm vitest run tests/unit/wecom/approval-parser.test.ts tests/integration/wecom/approval-callback.test.ts`.

Run: `pnpm test:e2e tests/e2e/admin/approval-sync.spec.ts`.

Expected: one approved callback creates exactly one pending outbound order; duplicate callback creates no second order; manual resync repairs a missing record.

- [ ] **Step 7: Commit the integration checkpoint**

```bash
git add apps/api/src/application/wecom apps/api/src/infrastructure/wecom apps/api/src/routes/wecom/approval-callback.ts apps/api/src/routes/admin/approvals-resync.ts tests/unit/wecom tests/integration/wecom tests/e2e/admin/approval-sync.spec.ts
git commit -m "feat: ingest wecom approvals idempotently"
```

## Task 4: Item, Category, and Warehouse Administration

**Files:**

- Create: `apps/api/src/application/items/item-service.ts`, `apps/api/src/application/warehouses/warehouse-service.ts`
- Create: `apps/api/src/routes/admin/items.ts`, `apps/api/src/routes/admin/warehouses.ts`
- Create: `apps/web/src/pages/ItemsPage.tsx`, `apps/web/src/pages/WarehousesPage.tsx`
- Test: `tests/unit/items/item-code-policy.test.ts`, `tests/e2e/admin/master-data.spec.ts`

**Interfaces:**

- `ItemService.create(input): Promise<Item>`
- `ItemService.update(itemId, input): Promise<Item>`
- `ItemService.deactivate(itemId): Promise<void>`
- `WarehouseService.listActive(): Promise<Warehouse[]>`

- [ ] **Step 1: Write master-data validation tests**

Assert uppercase code normalization, category-prefix generation, unique code enforcement, required name/spec/unit fields, optional expiry fields, and prohibition on changing a code after it has ledger activity.

- [ ] **Step 2: Implement item and warehouse application services**

Allow only administrators to create or update master data. Use inactive status instead of deletion once an item or warehouse has transactions. Store the item threshold as an optional global minimum quantity.

- [ ] **Step 3: Implement admin pages and APIs**

Provide searchable item list, category filter, active/inactive toggle, code/spec/unit/price fields, Enterprise WeChat option-key mapping, and three warehouse records. Do not expose stock or amount to applicants through the approval form integration.

- [ ] **Step 4: Run unit and browser tests**

Run: `pnpm vitest run tests/unit/items/item-code-policy.test.ts`.

Run: `pnpm test:e2e tests/e2e/admin/master-data.spec.ts`.

- [ ] **Step 5: Commit the master-data checkpoint**

```bash
git add apps/api/src/application/items apps/api/src/application/warehouses apps/api/src/routes/admin/items.ts apps/api/src/routes/admin/warehouses.ts apps/web/src/pages/ItemsPage.tsx apps/web/src/pages/WarehousesPage.tsx tests/unit/items tests/e2e/admin/master-data.spec.ts
git commit -m "feat: add item and warehouse administration"
```

## Task 5: Inbound and Opening Batch Stock

**Files:**

- Create: `apps/api/src/application/inventory/inbound-service.ts`, `apps/api/src/application/inventory/opening-stock-service.ts`
- Create: `apps/api/src/routes/admin/inbound.ts`, `apps/web/src/pages/InboundPage.tsx`
- Create: `apps/api/src/routes/admin/opening-stock.ts`, `apps/web/src/pages/OpeningStockPage.tsx`
- Test: `tests/unit/inventory/inbound-service.test.ts`, `tests/integration/inventory/opening-stock.test.ts`, `tests/e2e/admin/inbound.spec.ts`

**Interfaces:**

- `InboundService.create(input): Promise<{ inboundId: string; batchIds: string[] }>`
- `OpeningStockService.create(input): Promise<{ batchIds: string[] }>`
- `InboundInput`: `{ warehouseId, itemId, batchNo, quantity, unitCost, purchasedAt, productionDate?, expiryDate?, purchaser, remark? }`

- [ ] **Step 1: Write inbound and opening-stock tests**

Assert warehouse is required, quantity and unit cost are non-negative, a procurement batch is created, the stock balance increases, the inbound ledger is written, and the opening-stock route does not import historical transactions.

- [ ] **Step 2: Implement inbound transaction service**

Create an inbound order and procurement batch in one transaction. Update `StockBalance`, write the inbound ledger entry, and audit the administrator. Allow zero unit cost only when a remark is present.

- [ ] **Step 3: Implement opening-stock load**

Accept only administrator-entered physically verified rows containing warehouse, item, batch, quantity, and confirmed unit cost. Mark each row as `OPENING_BALANCE`; do not accept approval numbers or historical dates as a substitute for physical verification.

- [ ] **Step 4: Implement inbound and opening-stock pages**

Provide item lookup, warehouse selection, batch fields, optional production/expiry dates, quantity, unit cost, purchaser, and remark. Display the resulting batch and remaining balance.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/unit/inventory/inbound-service.test.ts tests/integration/inventory/opening-stock.test.ts`.

Run: `pnpm test:e2e tests/e2e/admin/inbound.spec.ts`.

- [ ] **Step 6: Commit the inbound checkpoint**

```bash
git add apps/api/src/application/inventory/inbound-service.ts apps/api/src/application/inventory/opening-stock-service.ts apps/api/src/routes/admin/inbound.ts apps/api/src/routes/admin/opening-stock.ts apps/web/src/pages/InboundPage.tsx apps/web/src/pages/OpeningStockPage.tsx tests/unit/inventory/inbound-service.test.ts tests/integration/inventory/opening-stock.test.ts tests/e2e/admin/inbound.spec.ts
git commit -m "feat: add inbound and opening batch stock"
```

## Task 6: Outbound Execution with Warehouse and Batch Allocation

**Files:**

- Create: `apps/api/src/application/inventory/outbound-service.ts`, `apps/api/src/application/inventory/outbound-allocator.ts`
- Create: `apps/api/src/routes/admin/outbound.ts`, `apps/web/src/pages/OutboundPage.tsx`
- Test: `tests/unit/inventory/outbound-allocator.test.ts`, `tests/integration/inventory/outbound-service.test.ts`, `tests/e2e/admin/outbound.spec.ts`

**Interfaces:**

- `OutboundService.listPending(filters): Promise<PendingOutbound[]>`
- `OutboundService.confirm(input): Promise<CompletedOutbound>`
- `OutboundService.cancelBeforeIssue(input): Promise<VoidedApproval>`
- `OutboundInput`: `{ approvalId, allocations: Array<{ approvalLineId, warehouseId, batchId, quantity }>, reason? }`
- `OutboundAllocator.validate(input): AllocationValidationResult`

- [ ] **Step 1: Write allocator tests**

Cover one warehouse/one batch, multiple warehouses, multiple batches for one line, quantity equal to approval, partial quantity with reason, zero quantity with reason, quantity above approval, unavailable batch, item substitution, and closed-period rejection.

- [ ] **Step 2: Run allocator tests and verify failure**

Run: `pnpm vitest run tests/unit/inventory/outbound-allocator.test.ts`

Expected before implementation: FAIL because allocation rules do not exist.

- [ ] **Step 3: Implement allocation validation**

Validate that every allocation item matches an approved line, requested item cannot be replaced, total actual quantity per line is no greater than requested quantity, zero/partial outcomes have reasons, and selected batches belong to the selected warehouses and item.

- [ ] **Step 4: Implement transactional outbound confirmation**

Lock the selected `StockBalance` rows, re-check quantities, write `OutboundOrder` and `OutboundAllocation` rows, decrement balances, write batch-specific ledger entries, calculate amount from batch unit cost, and mark the approval as completed, partially issued, or unavailable. The transaction must fail as a whole if any selected allocation is stale.

- [ ] **Step 5: Implement pending-outbound and execution pages**

Show approval number, applicant, department, purpose, requested lines, available warehouse balances, batch unit costs, and remaining quantities. Let the administrator freely choose the order of work, split across warehouses and batches, enter actual quantities, and provide required reasons.

- [ ] **Step 6: Implement cancellation before issue**

Allow an approved but unissued request to be voided with a reason. Do not create stock entries. Prevent cancellation after any outbound, return, or adjustment has been recorded.

- [ ] **Step 7: Run integration and browser tests**

Run: `pnpm vitest run tests/integration/inventory/outbound-service.test.ts`.

Run: `pnpm test:e2e tests/e2e/admin/outbound.spec.ts`.

Expected: all successful allocations update balances and ledger entries exactly once; rejected allocations leave all balances unchanged.

- [ ] **Step 8: Commit the outbound checkpoint**

```bash
git add apps/api/src/application/inventory/outbound-service.ts apps/api/src/application/inventory/outbound-allocator.ts apps/api/src/routes/admin/outbound.ts apps/web/src/pages/OutboundPage.tsx tests/unit/inventory/outbound-allocator.test.ts tests/integration/inventory/outbound-service.test.ts tests/e2e/admin/outbound.spec.ts
git commit -m "feat: add batch-aware outbound execution"
```

## Task 7: Transfers, Returns, Stocktake, Alerts, and Period Close

**Files:**

- Create: `apps/api/src/application/inventory/transfer-service.ts`, `apps/api/src/application/inventory/return-service.ts`
- Create: `apps/api/src/application/inventory/stocktake-service.ts`, `apps/api/src/application/inventory/alert-service.ts`
- Create: `apps/api/src/application/periods/period-close-service.ts`
- Create: `apps/api/src/routes/admin/transfers.ts`, `apps/api/src/routes/admin/returns.ts`, `apps/api/src/routes/admin/stocktake.ts`, `apps/api/src/routes/admin/period-close.ts`
- Create: `apps/web/src/pages/TransfersPage.tsx`, `apps/web/src/pages/ReturnsPage.tsx`, `apps/web/src/pages/StocktakePage.tsx`, `apps/web/src/pages/PeriodClosePage.tsx`
- Test: `tests/integration/inventory/transfer-return.test.ts`, `tests/integration/inventory/stocktake-close.test.ts`, `tests/unit/inventory/alert-service.test.ts`, `tests/e2e/admin/period-close.spec.ts`

**Interfaces:**

- `TransferService.complete(input): Promise<TransferOrder>`
- `ReturnService.create(input): Promise<ReturnOrder>`
- `StocktakeService.record(input): Promise<Stocktake>`
- `AlertService.listLowStock(): Promise<LowStockItem[]>`
- `PeriodCloseService.close(period): Promise<ClosedPeriod>`

- [ ] **Step 1: Write transfer and return tests**

Assert one-click transfer moves the same batch cost from source to destination without changing group total; return requires original outbound reference, cannot exceed original issued quantity, and restores the original batch cost.

- [ ] **Step 2: Implement transfer and return services**

Use one transaction for each operation. Transfer writes separate source and destination entries linked by one transfer ID. Return writes a reverse entry linked to the original outbound allocation and updates the batch balance.

- [ ] **Step 3: Write stocktake, alert, and close tests**

Assert stocktake adjustment requires a reason, combined three-warehouse stock drives the item threshold, only administrators see alerts, and a closed period rejects inbound, outbound, transfer, return, and adjustment mutations.

- [ ] **Step 4: Implement stocktake and period-close services**

Record count snapshots, calculate differences, write adjustment entries, and lock the period. Do not overwrite previous ledger entries. Provide a controlled void/correction path that writes a new record in an open period.

- [ ] **Step 5: Implement pages and alert panel**

Add one-click transfer form, linked return form, three-warehouse stocktake grid, reason-required adjustment form, combined-stock low-stock panel, and period close confirmation showing unresolved pending items and unposted adjustments.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm vitest run tests/integration/inventory/transfer-return.test.ts tests/integration/inventory/stocktake-close.test.ts tests/unit/inventory/alert-service.test.ts`.

Run: `pnpm test:e2e tests/e2e/admin/period-close.spec.ts`.

```bash
git add apps/api/src/application/inventory/transfer-service.ts apps/api/src/application/inventory/return-service.ts apps/api/src/application/inventory/stocktake-service.ts apps/api/src/application/inventory/alert-service.ts apps/api/src/application/periods apps/api/src/routes/admin/transfers.ts apps/api/src/routes/admin/returns.ts apps/api/src/routes/admin/stocktake.ts apps/api/src/routes/admin/period-close.ts apps/web/src/pages/TransfersPage.tsx apps/web/src/pages/ReturnsPage.tsx apps/web/src/pages/StocktakePage.tsx apps/web/src/pages/PeriodClosePage.tsx tests/integration/inventory tests/unit/inventory/alert-service.test.ts tests/e2e/admin/period-close.spec.ts
git commit -m "feat: add transfer return stocktake and period close"
```

## Task 8: Inventory Queries and Excel Reports

**Files:**

- Create: `apps/api/src/application/reports/inventory-report-service.ts`, `apps/api/src/application/reports/transaction-report-service.ts`
- Create: `apps/api/src/infrastructure/export/excel-exporter.ts`, `apps/api/src/infrastructure/export/report-workbook.ts`
- Create: `apps/api/src/routes/admin/reports.ts`, `apps/web/src/pages/ReportsPage.tsx`
- Test: `tests/unit/reports/report-query.test.ts`, `tests/integration/reports/excel-export.test.ts`, `tests/e2e/admin/reports.spec.ts`

**Interfaces:**

- `InventoryReportService.getSummary(period): Promise<InventorySummaryRow[]>`
- `TransactionReportService.getInbound(period): Promise<InboundReportRow[]>`
- `TransactionReportService.getOutbound(period): Promise<OutboundReportRow[]>`
- `TransactionReportService.getTransfers(period): Promise<TransferReportRow[]>`
- `TransactionReportService.getReturns(period): Promise<ReturnReportRow[]>`
- `TransactionReportService.getAdjustments(period): Promise<AdjustmentReportRow[]>`
- `ExcelExporter.exportMonthlyReport(input): Promise<Uint8Array>`

- [ ] **Step 1: Write report query tests**

Seed a period with opening stock, inbound, multi-batch outbound, transfer, return, and adjustment. Assert that the summary shows quantity and amount separately, transfers do not change group totals, returns reduce net outbound, and adjustments affect closing stock.

- [ ] **Step 2: Implement bounded report queries**

Query by accounting period, warehouse, category, item, department, and purpose. Keep transfer, return, and adjustment rows separate. Use decimal-safe arithmetic and return typed report rows rather than raw database records.

- [ ] **Step 3: Validate the workspace Excel runtime**

Create a minimal export test using the workspace-provided `@oai/artifact-tool` APIs. Verify that it can create sheets, write typed values, export `.xlsx`, and save in a writable output directory. If the runtime is unavailable, report the blocker before proceeding.

- [ ] **Step 4: Implement the workbook adapter**

Create one workbook with sheets `库存汇总`, `入库明细`, `出库明细`, `调拨明细`, `退库明细`, and `盘点调整`. Keep quantities and amounts typed as numbers, include period and warehouse filters in the exported title area, and avoid copying the old template's formula-error rows.

- [ ] **Step 5: Implement report page and download routes**

Let finance select a closed period and download the workbook. Let administrators preview the same data. Do not permit report pages to mutate inventory.

- [ ] **Step 6: Run report verification**

Run: `pnpm vitest run tests/unit/reports/report-query.test.ts tests/integration/reports/excel-export.test.ts`.

Run: `pnpm test:e2e tests/e2e/admin/reports.spec.ts`.

Inspect representative workbook ranges, scan for formula errors, and render each sheet once before treating the export as complete.

- [ ] **Step 7: Commit the reporting checkpoint**

```bash
git add apps/api/src/application/reports apps/api/src/infrastructure/export apps/api/src/routes/admin/reports.ts apps/web/src/pages/ReportsPage.tsx tests/unit/reports tests/integration/reports tests/e2e/admin/reports.spec.ts
git commit -m "feat: add inventory reports and excel export"
```

## Task 9: End-to-End Acceptance, Deployment, and Operating Runbook

**Files:**

- Create: `tests/e2e/workflows/requisition-to-close.spec.ts`
- Create: `tests/e2e/workflows/transfer-return-stocktake.spec.ts`
- Create: `Dockerfile`, `docker-compose.prod.yml`
- Modify: `README.md`, `.env.example`
- Create: `docs/operations/wecom-setup.md`, `docs/operations/month-end-close.md`, `docs/operations/opening-stock.md`

**Interfaces:**

- Produces: a reproducible deployment, a WeCom configuration runbook, an opening-stock runbook, and a month-end close runbook.

- [ ] **Step 1: Write the complete requisition-to-close scenario**

The scenario must create an item and two batches, receive an approved five-row request, issue across two warehouses and two batches with one partial line, verify ledger and amount totals, export the closed-period report, and assert finance cannot mutate data.

- [ ] **Step 2: Write the transfer/return/stocktake scenario**

The scenario must transfer a batch, return part of an outbound allocation, record a physical count difference with a reason, close the month, and assert direct mutation after close is rejected.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm lint`, `pnpm typecheck`, `pnpm vitest run`, `pnpm test:e2e`.

Expected: all unit, integration, and browser tests pass against a disposable PostgreSQL database.

- [ ] **Step 4: Add deployment configuration**

Build the application image, connect it to PostgreSQL, expose the HTTPS callback route through the chosen reverse proxy, and configure secrets only through environment variables or the deployment secret store.

- [ ] **Step 5: Write operating runbooks**

Document enterprise WeChat app permissions and callback verification, physical opening-stock entry, item-option maintenance, failed approval resync, monthly stocktake, report export, and period close.

- [ ] **Step 6: Perform a release-readiness review and commit**

Verify backups, audit logs, closed-period enforcement, duplicate callback handling, report rendering, and role restrictions. Then commit:

```bash
git add tests/e2e/workflows Dockerfile docker-compose.prod.yml README.md .env.example docs/operations
git commit -m "chore: add deployment and operating runbooks"
```

## Verification Matrix

Before declaring the system ready, verify each approved requirement:

| Requirement | Primary verification |
|---|---|
| Enterprise WeChat approval ingestion | Callback fixture, detail fetch, duplicate callback test |
| Five-row standard item detail | Parser and browser form test |
| No warehouse/stock/amount exposure to applicants | Approval fixture and role test |
| Admin chooses warehouse and batch | Outbound browser test |
| Actual quantity never exceeds approval | Allocator unit test and database transaction test |
| Partial/zero issue requires reason | Allocator and UI validation tests |
| Exact procurement-batch amount | Multi-batch ledger and report tests |
| One-click transfer | Transfer integration test |
| Linked return | Return integration test |
| Monthly stocktake and close | Stocktake/close integration test |
| Combined three-warehouse low-stock alert | Alert unit test |
| Finance read-only | Role and end-to-end test |
| Excel report correctness | Workbook inspection, formula scan, and render verification |

## Plan Self-Review

- Spec coverage: all confirmed business rules are mapped to Tasks 1–9 or the global constraints.
- Integration boundary: the plan imports Enterprise WeChat approvals but deliberately excludes approval-node writeback and extra notifications.
- Amount consistency: every outbound allocation references a procurement batch; transfers preserve batch cost; returns reference original outbound allocations.
- Data integrity: all stock changes go through transaction services and append-only ledger entries; closed periods reject mutations.
- No unresolved placeholders remain. The only implementation prerequisite is runtime/environment setup, explicitly represented in Task 0 and Task 9.
