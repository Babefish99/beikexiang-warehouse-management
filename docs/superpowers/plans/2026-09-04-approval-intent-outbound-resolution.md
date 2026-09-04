# Approval Intent and Standard-Item Outbound Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a passed Enterprise WeChat requisition to carry one to five immutable approximate item intents, then let a warehouse administrator resolve each positive issue to one unit-compatible standard item and one or more stock batches.

**Architecture:** Preserve the Enterprise WeChat payload as ApprovalLine intent facts, record the administrator's choice in a separate OutboundDecisionLine, and keep OutboundAllocation as the inventory-moving child. Approval parsing, candidate generation, and transactional confirmation remain behind the existing synchronization and outbound module interfaces, while desktop and mobile share a versioned decision draft contract.

**Tech Stack:** TypeScript 5.9, Node.js 24, Fastify 5, Prisma 7/PostgreSQL, React 19/Vite 6, Decimal.js, Vitest 3, Playwright 1.55, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-04-approval-intent-outbound-resolution-design.md`

## Global Constraints

- An Enterprise WeChat requisition contains one to five item intent rows.
- Each row contains required approximate item name, required positive integer quantity, required manually entered unit, and optional note.
- Approval quantity, allocation quantity, and actual outbound quantity never contain a fractional part.
- Approval text, approved quantity, and approved unit are immutable after synchronization.
- Intent text only ranks/searches candidates; it never binds a standard item automatically.
- Every positive decision selects exactly one active standard item whose normalized unit equals the approved unit.
- A selected item may be split across multiple warehouses and procurement batches; actual quantity must not exceed approved quantity.
- A short or zero issue requires a reason on that specific approval line.
- A zero decision has no selected item, no allocation, and no inventory movement.
- The entire approval closes once in one database transaction; any failed invariant leaves approval, balance, batch, order, decision, allocation, and ledger data unchanged.
- New and legacy template IDs coexist during rollout. Unknown, fixed-text, ambiguous, missing-unit, fractional, or integration-item legacy approvals require resubmission.
- Do not print, store, or commit Enterprise WeChat secrets, callback credentials, session tokens, production environment files, or browser cookies.
- Do not edit production approval rows or inventory balances by hand.
- Initial production acceptance validates synchronization and options only. Do not call the confirm endpoint or perform actual outbound without a separate user confirmation.
- Preserve the user-owned untracked `outputs/` directory.

## File Map

- Create `apps/api/src/domain/approvals/approval-intent.ts`: integer quantity rules, unit normalization, and legacy eligibility types.
- Modify `apps/api/src/infrastructure/wecom/approval-parser.ts`: parse new intent rows and classify legacy rows without automatic name binding.
- Modify `apps/api/src/application/wecom/approval-sync-service.ts`: allowed-template set, reapply/exception status transitions, and idempotency.
- Modify `apps/api/src/application/inventory/inventory-memory-state.ts`: in-memory approval intent, item candidate, decision, and exception state.
- Modify `prisma/schema.prisma` and create `prisma/migrations/20260904183000_approval_intent_outbound_decisions/migration.sql`: durable intent/decision relationships and safe history backfill.
- Modify `apps/api/src/infrastructure/db/prisma-approval-sync-store.ts`: persist immutable intent fields and source/eligibility metadata.
- Modify `apps/api/src/application/inventory/outbound-allocator.ts`: validate complete per-line decisions rather than pre-bound allocations.
- Modify `apps/api/src/application/inventory/outbound-service.ts`: candidate generation, reapply handling, and actor-aware confirmation.
- Modify `apps/api/src/infrastructure/db/prisma-outbound-store.ts`: candidate queries and atomic order/decision/allocation/ledger persistence.
- Modify `apps/api/src/routes/admin/outbound.ts`: new decision request contract and authenticated actor propagation.
- Create `apps/api/src/application/wecom/approval-sync-query-service.ts` and `apps/api/src/routes/admin/approval-sync-failures.ts`: administrator-visible synchronization failures.
- Modify `apps/api/src/infrastructure/db/prisma-report-source.ts`, `apps/api/src/application/inventory/notification-service.ts`, and `apps/api/src/server.ts`: pending/reapply counts and revocation alerts.
- Modify `apps/api/src/infrastructure/db/runtime.ts`, `.env.example`, and `README.md`: primary plus legacy template-ID configuration.
- Modify `apps/web/src/features/outbound/outbound-workflow.ts`: decision-oriented types, validation, summaries, reconciliation, and draft v2.
- Create `apps/web/src/features/outbound/OutboundDecisionEditor.tsx`: shared immutable intent and per-line decision editor.
- Modify `apps/web/src/features/outbound/DesktopOutboundTable.tsx`, `apps/web/src/features/outbound/MobileOutboundFlow.tsx`, `apps/web/src/pages/OutboundPage.tsx`, `apps/web/src/features/inventory/inventory-status-label.ts`, and `apps/web/src/styles.css`: desktop/mobile interaction and exception display.
- Modify focused unit, integration, database, deployment, and Playwright suites listed in each task.

---

### Task 1: Approval intent rules and Enterprise WeChat parsing

**Files:**
- Create: `apps/api/src/domain/approvals/approval-intent.ts`
- Modify: `apps/api/src/infrastructure/wecom/approval-parser.ts`
- Test: `tests/unit/wecom/approval-parser.test.ts`
- Test: `tests/unit/domain/approval-intent.test.ts`

**Interfaces:**
- Produces: `LegacyResolutionStatus = "NOT_APPLICABLE" | "EXACT_LOCKED" | "REAPPLY_REQUIRED"`.
- Produces: `normalizeApprovalUnit(value: string): string` and `parsePositiveIntegerQuantity(value: string): string`.
- Produces: `ParsedApprovalLine` with `requestedItemName`, `requestedQuantity`, `unit`, optional `note`, optional legacy `itemId`/`itemOptionKey`, and `legacyResolutionStatus`.
- Produces: `ParsedApproval.sourceTemplateId?: string`.

- [ ] **Step 1: Establish the execution worktree and baseline**

Invoke `superpowers:using-git-worktrees`. Use an isolated `codex/approval-intent-outbound-resolution` branch based on the latest `origin/feat/warehouse-system` while retaining commits `9e5f5bb` and its parent design history. Verify `git status --short` reports only the pre-existing `outputs/` entry, then run:

~~~powershell
corepack pnpm exec vitest run tests/unit/wecom/approval-parser.test.ts tests/unit/inventory/outbound-allocator.test.ts tests/integration/inventory/outbound-service.test.ts
~~~

Expected: the existing focused tests pass before behavior changes.

- [ ] **Step 2: Write failing approval-intent domain tests**

Create assertions equivalent to:

~~~ts
expect(parsePositiveIntegerQuantity("12")).toBe("12");
expect(() => parsePositiveIntegerQuantity("1.5")).toThrow("approval quantity must be a positive integer");
expect(() => parsePositiveIntegerQuantity("0")).toThrow("approval quantity must be a positive integer");
expect(normalizeApprovalUnit("　瓶　")).toBe("瓶");
expect(normalizeApprovalUnit("ＢＯＸ")).toBe("BOX");
expect(approvalUnitsMatch(" 瓶 ", "瓶")).toBe(true);
expect(approvalUnitsMatch("瓶", "箱")).toBe(false);
~~~

Run:

~~~powershell
corepack pnpm exec vitest run tests/unit/domain/approval-intent.test.ts
~~~

Expected: FAIL because the new module does not exist.

- [ ] **Step 3: Implement the narrow domain helpers**

Implement full-width ASCII and ideographic-space normalization without semantic unit conversion. Accept only `/^[1-9]\d{0,13}$/` and return a canonical base-10 string:

~~~ts
export type LegacyResolutionStatus = "NOT_APPLICABLE" | "EXACT_LOCKED" | "REAPPLY_REQUIRED";

export function normalizeApprovalUnit(value: string): string {
  return value.replace(/\u3000/g, " ").replace(/[\uFF01-\uFF5E]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)).trim();
}

export function parsePositiveIntegerQuantity(value: string): string {
  const normalized = value.trim();
  if (!/^[1-9]\d{0,13}$/.test(normalized)) throw new Error("approval quantity must be a positive integer");
  return new Decimal(normalized).toFixed(0);
}
~~~

Add `approvalUnitsMatch` using the normalized strings and no alias table.

- [ ] **Step 4: Write failing new-template and legacy-classification parser tests**

Use an intent table row with exact titles `意向物品名称`, `审批数量`, `单位`, and `补充要求`. Assert:

~~~ts
expect(parser.parse(intentDetail)).toMatchObject({
  sourceTemplateId: "tpl-intent-v2",
  lines: [{
    requestedItemName: "招待用白酒",
    requestedQuantity: "2",
    unit: "瓶",
    note: "用于接待",
    legacyResolutionStatus: "NOT_APPLICABLE",
  }],
});
~~~

Also assert a mapped selector row becomes `EXACT_LOCKED` only when item unit and integer quantity match, while fixed-text, unknown selector, unit mismatch, missing unit, and fractional legacy rows become `REAPPLY_REQUIRED` without a guessed item.

Run:

~~~powershell
corepack pnpm exec vitest run tests/unit/wecom/approval-parser.test.ts
~~~

Expected: FAIL against the current mandatory `itemId` parser contract.

- [ ] **Step 5: Refactor the parser by form shape**

Detect new intent rows by field titles, parse their unit from the separate text field, preserve note text, enforce one-to-five rows, and never call `resolveItem` for them. Keep a selector parser for exact legacy evidence. Keep fixed-text parsing only to preserve raw display facts and mark those rows `REAPPLY_REQUIRED`.

Do not derive a missing legacy unit from Item.unit, because that would change the approved fact.

- [ ] **Step 6: Run the task tests and commit**

~~~powershell
corepack pnpm exec vitest run tests/unit/domain/approval-intent.test.ts tests/unit/wecom/approval-parser.test.ts
git add apps/api/src/domain/approvals/approval-intent.ts apps/api/src/infrastructure/wecom/approval-parser.ts tests/unit/domain/approval-intent.test.ts tests/unit/wecom/approval-parser.test.ts
git commit -m "feat: parse immutable approval intents"
~~~

Expected: both test files pass and the commit contains no persistence or UI changes.

### Task 2: Durable intent and outbound decision schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260904183000_approval_intent_outbound_decisions/migration.sql`
- Modify: `tests/integration/db-schema.test.ts`
- Modify: `tests/integration/inventory/prisma-business-stores.test.ts`

**Interfaces:**
- Produces: nullable `ApprovalLine.itemId`, immutable intent fields, `sourceTemplateId`, and `legacyResolutionStatus`.
- Produces: one `OutboundDecisionLine` per processed `ApprovalLine`.
- Produces: required `OutboundAllocation.outboundDecisionLineId` after backfill.

- [ ] **Step 1: Write failing schema contract assertions**

Add `OutboundDecisionLine` to the required model list and assert model bodies contain:

~~~ts
expect(modelBody("ApprovalRequest")).toMatch(/sourceTemplateId\s+String\?/);
expect(modelBody("ApprovalLine")).toMatch(/requestedItemName\s+String/);
expect(modelBody("ApprovalLine")).toMatch(/itemId\s+String\?/);
expect(modelBody("ApprovalLine")).toMatch(/legacyResolutionStatus\s+String/);
expect(modelBody("OutboundDecisionLine")).toMatch(/approvalLineId\s+String\s+@unique/);
expect(modelBody("OutboundAllocation")).toMatch(/outboundDecisionLineId\s+String/);
~~~

Run:

~~~powershell
corepack pnpm exec vitest run tests/integration/db-schema.test.ts
~~~

Expected: FAIL because the schema lacks the decision model.

- [ ] **Step 2: Update the Prisma relations**

Define fields equivalent to:

~~~prisma
model OutboundDecisionLine {
  id               String   @id @default(cuid())
  outboundOrderId  String
  approvalLineId   String   @unique
  selectedItemId   String?
  actualQuantity   Decimal  @db.Decimal(18, 4)
  varianceReason   String?
  decidedBy        String
  decidedAt        DateTime
  outboundOrder    OutboundOrder @relation(fields: [outboundOrderId], references: [id], onDelete: Restrict)
  approvalLine     ApprovalLine  @relation(fields: [approvalLineId], references: [id], onDelete: Restrict)
  selectedItem     Item?         @relation(fields: [selectedItemId], references: [id], onDelete: Restrict)
  allocations      OutboundAllocation[]
}
~~~

Give `ApprovalRequest` a nullable `sourceTemplateId`. Give `ApprovalLine` required `requestedItemName`, optional `note`, required `legacyResolutionStatus`, and nullable item relation. Replace the allocation-to-approval-line relation with a required allocation-to-decision relation.

- [ ] **Step 3: Write a forward-only migration with history backfill**

The SQL must:

1. Add nullable source/intent/decision-link columns.
2. Backfill `requestedItemName` from the linked Item name where available.
3. Mark all pre-migration unclosed rows `REAPPLY_REQUIRED` until a successful resync proves `EXACT_LOCKED`.
4. Insert one decision for every historical outbound-order/approval-line pair, taking actor/time from OutboundOrder, summing actual allocations, and copying the old order reason only for short historical decisions.
5. Populate each allocation's decision ID through its old approval-line/order pair.
6. Apply NOT NULL and unique constraints only after backfill succeeds.
7. Drop the old allocation-to-approval-line foreign key and column only after the new relation is complete.

Include guarded SQL checks that raise if one historical approval line maps to multiple item IDs or any allocation remains without a decision. Do not update StockBalance, ProcurementBatch, InventoryLedgerEntry quantity/amount columns, or OutboundOrder totals.

- [ ] **Step 4: Add a migration preservation integration test**

Seed a historical outbound with two allocations for one approval line, apply the migration, and assert:

~~~ts
expect(decisions).toMatchObject([{
  selectedItemId: itemId,
  actualQuantity: new Prisma.Decimal("5"),
  decidedBy: "task3-operator",
}]);
expect(migratedAllocations.every((row) => row.outboundDecisionLineId === decisions[0]!.id)).toBe(true);
expect(afterBalances).toEqual(beforeBalances);
expect(afterLedger).toEqual(beforeLedger);
~~~

- [ ] **Step 5: Validate schema, migration, and generated client**

~~~powershell
corepack pnpm exec prisma format
corepack pnpm exec prisma validate
corepack pnpm exec prisma generate
corepack pnpm exec vitest run tests/integration/db-schema.test.ts tests/integration/inventory/prisma-business-stores.test.ts
~~~

Expected: static schema tests pass; PostgreSQL tests pass when `TEST_DATABASE_URL` is set and otherwise report only their existing environment skip.

- [ ] **Step 6: Commit the schema slice**

~~~powershell
git add prisma/schema.prisma prisma/migrations/20260904183000_approval_intent_outbound_decisions/migration.sql tests/integration/db-schema.test.ts tests/integration/inventory/prisma-business-stores.test.ts
git commit -m "feat: persist outbound decisions separately"
~~~

### Task 3: Idempotent new/legacy approval synchronization

**Files:**
- Modify: `apps/api/src/application/wecom/approval-sync-service.ts`
- Modify: `apps/api/src/application/inventory/inventory-memory-state.ts`
- Modify: `apps/api/src/infrastructure/db/prisma-approval-sync-store.ts`
- Modify: `apps/api/src/infrastructure/db/runtime.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `.env.example`
- Test: `tests/unit/wecom/approval-sync-service.test.ts`
- Test: `tests/integration/wecom/approval-resync.test.ts`
- Test: `tests/integration/inventory/shared-memory-state.test.ts`
- Test: `tests/integration/inventory/prisma-business-stores.test.ts`
- Test: `tests/deployment/production-config.test.ts`

**Interfaces:**
- Consumes: Task 1 `ParsedApproval` and Task 2 schema.
- Produces: `ServerConfig.approvalTemplateIds: string[]`, containing primary plus legacy IDs.
- Produces: outbound statuses `REAPPLY_REQUIRED` and `REVOCATION_EXCEPTION`.
- Produces: immutable persisted intent lines and a stable source template ID.

- [ ] **Step 1: Write failing configuration and transition tests**

Assert:

~~~ts
expect(readServerConfig({
  ...validProductionEnv,
  WE_COM_APPROVAL_TEMPLATE_ID: "tpl-intent-v2",
  WE_COM_LEGACY_APPROVAL_TEMPLATE_IDS: "tpl-selector-v1,tpl-fixed-v1",
}).approvalTemplateIds).toEqual(["tpl-intent-v2", "tpl-selector-v1", "tpl-fixed-v1"]);
~~~

In sync tests, verify:

- any unlisted template is rejected before persistence;
- an approved all-intent or all-`EXACT_LOCKED` approval becomes `PENDING_OUTBOUND`;
- an approved approval containing any `REAPPLY_REQUIRED` line becomes `REAPPLY_REQUIRED`;
- a revoked approval closes an unissued pending record;
- a revoked approval after `COMPLETED` becomes `REVOCATION_EXCEPTION` without deleting its order;
- duplicate sync preserves line IDs and never reopens a closed approval.

Run the five focused files. Expected: FAIL on the single-template and current status logic.

- [ ] **Step 2: Parse and validate the allowed template set**

Keep `WE_COM_APPROVAL_TEMPLATE_ID` required in production. Parse `WE_COM_LEGACY_APPROVAL_TEMPLATE_IDS` as comma-separated, trim, remove blanks, deduplicate, and expose one array. Never log the environment values.

- [ ] **Step 3: Extend memory state and synchronization records**

Add source template ID and all intent fields to `InventoryApprovalState`/`InventoryApprovalLineState`. Add the two new outbound statuses. Update in-memory save/read conversion without positional data loss: reuse existing line IDs by index only while the approval remains unprocessed, and never rewrite lines after any closed status or decision exists.

- [ ] **Step 4: Persist intent facts and compatibility classification**

Update Prisma includes for optional Item. Upsert `sourceTemplateId`, `requestedItemName`, `note`, optional `itemId`, and `legacyResolutionStatus`. A successful exact-selector resync may promote a pre-migration row from `REAPPLY_REQUIRED` to `EXACT_LOCKED` only when the parser supplies all evidence. New intent rows use `NOT_APPLICABLE`.

- [ ] **Step 5: Implement status transitions and run tests**

Centralize transition logic in a pure function:

~~~ts
deriveOutboundStatus({
  approvalStatus,
  existingOutboundStatus,
  lines,
}): InventoryApprovalOutboundStatus
~~~

Treat `COMPLETED`, `PARTIALLY_ISSUED`, `UNAVAILABLE`, `VOIDED`, and `REVOCATION_EXCEPTION` as closed. A post-issue revocation changes the approval status to `REVOCATION_EXCEPTION` but does not alter outbound rows or inventory.

~~~powershell
corepack pnpm exec vitest run tests/unit/wecom/approval-sync-service.test.ts tests/integration/wecom/approval-resync.test.ts tests/integration/inventory/shared-memory-state.test.ts tests/integration/inventory/prisma-business-stores.test.ts tests/deployment/production-config.test.ts
~~~

Expected: all non-environment-gated cases pass.

- [ ] **Step 6: Commit synchronization compatibility**

~~~powershell
git add .env.example apps/api/src/application/wecom/approval-sync-service.ts apps/api/src/application/inventory/inventory-memory-state.ts apps/api/src/infrastructure/db/prisma-approval-sync-store.ts apps/api/src/infrastructure/db/runtime.ts apps/api/src/server.ts tests/unit/wecom/approval-sync-service.test.ts tests/integration/wecom/approval-resync.test.ts tests/integration/inventory/shared-memory-state.test.ts tests/integration/inventory/prisma-business-stores.test.ts tests/deployment/production-config.test.ts
git commit -m "feat: synchronize intent and legacy approvals"
~~~

### Task 4: Per-line outbound decision validation

**Files:**
- Modify: `apps/api/src/application/inventory/outbound-allocator.ts`
- Test: `tests/unit/inventory/outbound-allocator.test.ts`
- Test: `tests/unit/domain/inventory-invariants.test.ts`

**Interfaces:**
- Consumes: normalized unit and integer helpers from Task 1.
- Produces: `OutboundDecisionInput` and `ValidatedOutboundDecision`.
- Produces: `OutboundAllocator.validate({ lines, items, batches, decisions })` with status, totals, decisions, and validated allocations.

- [ ] **Step 1: Replace allocation-only fixtures with failing decision fixtures**

Define a two-line case and assertions equivalent to:

~~~ts
const decisions = [
  {
    approvalLineId: "line-wine",
    selectedItemId: "item-maotai",
    allocations: [
      { warehouseId: "wh-1", batchId: "batch-a", quantity: "1" },
      { warehouseId: "wh-2", batchId: "batch-b", quantity: "1" },
    ],
  },
  {
    approvalLineId: "line-tea",
    allocations: [],
    varianceReason: "本项不再领用",
  },
];
expect(allocator.validate({ lines, items, batches, decisions })).toMatchObject({
  status: "PARTIAL",
  totalQuantity: "2",
});
~~~

Add failing cases for missing/duplicate/foreign line, fractional quantity, missing selected item, two item IDs across batches, unit mismatch, over-issue, short issue without line reason, zero issue with selected item, zero issue without reason, locked legacy substitution, missing batch, wrong warehouse, and aggregated batch exhaustion.

- [ ] **Step 2: Run RED**

~~~powershell
corepack pnpm exec vitest run tests/unit/inventory/outbound-allocator.test.ts tests/unit/domain/inventory-invariants.test.ts
~~~

Expected: FAIL because the allocator still accepts flat allocations and one global reason.

- [ ] **Step 3: Implement complete decision validation**

Use these concrete shapes:

~~~ts
export interface OutboundDecisionInput {
  approvalLineId: string;
  selectedItemId?: string;
  allocations: Array<{ warehouseId: string; batchId: string; quantity: string }>;
  varianceReason?: string;
}

export interface SelectableOutboundItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  isActive: boolean;
}
~~~

Validate the exact set of approval line IDs before validating individual decisions. Parse every requested/allocation quantity through `parsePositiveIntegerQuantity`. Sum with Decimal.js, derive actual totals only from allocations, require all positive allocations to match `selectedItemId`, and compare normalized item/approval units. Produce no validated allocation for zero decisions.

- [ ] **Step 4: Verify GREEN and commit**

~~~powershell
corepack pnpm exec vitest run tests/unit/inventory/outbound-allocator.test.ts tests/unit/domain/inventory-invariants.test.ts
git add apps/api/src/application/inventory/outbound-allocator.ts tests/unit/inventory/outbound-allocator.test.ts tests/unit/domain/inventory-invariants.test.ts
git commit -m "feat: validate per-line outbound decisions"
~~~

### Task 5: Candidate generation and in-memory outbound workflow

**Files:**
- Modify: `apps/api/src/application/inventory/outbound-service.ts`
- Modify: `apps/api/src/application/inventory/inventory-memory-state.ts`
- Modify: `apps/api/src/infrastructure/db/runtime.ts`
- Test: `tests/integration/inventory/outbound-service.test.ts`
- Test: `tests/integration/inventory/shared-memory-state.test.ts`

**Interfaces:**
- Consumes: Task 4 decision validator.
- Produces: `PendingApprovalLine` with immutable intent facts, eligibility, and optional locked item.
- Produces: `OutboundOptions = { approvalId, lines: Array<{ approvalLineId, items }>, batches }`.
- Produces: `OutboundService.confirm({ approvalId, operatorId, decisions })`.

- [ ] **Step 1: Write the current-failure regression and candidate tests**

Create a new intent line with no item ID, unit `瓶`, and requested name `白酒`. Seed active items `BJ0002/飞天茅台/瓶` and `CY0001/茶叶/盒` plus positive and zero balances. Assert options contain only the positive `瓶` item and its batches.

Also assert:

~~~ts
await expect(service.listOptions("reapply-approval"))
  .rejects.toThrow("旧审批信息不完整，需重新申请");
~~~

Cover exact locked legacy options, inactive items, no-stock items, name/code candidate ordering, and listPending visibility for `REAPPLY_REQUIRED`.

- [ ] **Step 2: Run RED**

~~~powershell
corepack pnpm exec vitest run tests/integration/inventory/outbound-service.test.ts tests/integration/inventory/shared-memory-state.test.ts
~~~

Expected: FAIL because options are still restricted to ApprovalLine.itemId.

- [ ] **Step 3: Extend the store interface and memory adapter**

Add narrow store methods:

~~~ts
listCandidateItems(): Promise<SelectableOutboundItem[]>;
listBatches(itemIds: string[]): Promise<AllocationBatch[]>;
commitOutbound(approval: PendingApproval, validation: AllocationValidationResult, operatorId: string): Promise<OutboundOrderResult>;
~~~

Seed item definitions explicitly in tests. `listOptions` filters active items by normalized unit and aggregated positive balance, then sorts exact/substring name matches first, code/name matches second, and remaining same-unit items by code. Sorting never writes a selected item.

- [ ] **Step 4: Store decisions and ledger effects in memory**

For each validation result, store one decision row, zero or more allocations, and negative ledger entries. Set `COMPLETED` only when every line is full, `UNAVAILABLE` only when every line is zero, otherwise `PARTIALLY_ISSUED`. Preserve actor ID and per-line reasons.

- [ ] **Step 5: Verify and commit**

~~~powershell
corepack pnpm exec vitest run tests/integration/inventory/outbound-service.test.ts tests/integration/inventory/shared-memory-state.test.ts tests/unit/inventory/outbound-allocator.test.ts
git add apps/api/src/application/inventory/outbound-service.ts apps/api/src/application/inventory/inventory-memory-state.ts apps/api/src/infrastructure/db/runtime.ts tests/integration/inventory/outbound-service.test.ts tests/integration/inventory/shared-memory-state.test.ts
git commit -m "feat: resolve approval intents to stock items"
~~~

### Task 6: Prisma candidate queries and atomic persistence

**Files:**
- Modify: `apps/api/src/infrastructure/db/prisma-outbound-store.ts`
- Modify: `tests/integration/inventory/prisma-business-stores.test.ts`
- Modify: `tests/integration/db/prisma-restart-persistence.test.ts`
- Modify: `tests/unit/domain/stock-balance-store.test.ts`

**Interfaces:**
- Consumes: Task 2 schema and Task 5 OutboundStore.
- Produces: Prisma-backed candidates and one-transaction persistence of order, decisions, allocations, balance/batch decrements, and ledger.

- [ ] **Step 1: Write failing Prisma integration cases**

Add tests for:

- an intent line receiving same-unit candidates across two warehouses;
- a complete two-line decision with one split item and one zero item;
- stored OutboundDecisionLine actor, selected item, actual quantity, and per-line reason;
- no inventory rows for the zero decision;
- unit mismatch and fractional quantity rolling back the whole transaction;
- simultaneous confirmation allowing exactly one successful order;
- restart reads the same intent/decision/allocation structure;
- legacy allocation history remains returnable after migration.

Run:

~~~powershell
corepack pnpm exec vitest run tests/integration/inventory/prisma-business-stores.test.ts tests/integration/db/prisma-restart-persistence.test.ts
~~~

Expected: FAIL when a test database is configured; otherwise retain environment skips and use CI for the mandatory PostgreSQL result.

- [ ] **Step 2: Implement candidate reads**

Read active Item rows and aggregate StockBalance where remainingQuantity is greater than zero. Return item code/name/unit and total available quantity. Fetch batches only for the candidate/selected item IDs; never query by approximate name and never include unit-mismatched items.

- [ ] **Step 3: Revalidate inside the transaction**

Inside `runInventoryTransaction`:

1. lock/re-read the approval, intent lines, selected items, and current balances;
2. reject non-`PENDING_OUTBOUND` status;
3. rebuild the Task 4 validator input from current rows;
4. atomically change approval status using `updateMany` with the pending predicate;
5. conditionally decrement grouped StockBalance and ProcurementBatch quantities;
6. create OutboundOrder, one OutboundDecisionLine per intent, positive allocations, and ledger rows;
7. return the persisted totals.

Use `operatorId` for both OutboundOrder.operatorId and OutboundDecisionLine.decidedBy. Do not hard-code `system`.

- [ ] **Step 4: Verify rollback and persistence**

~~~powershell
corepack pnpm exec vitest run tests/integration/inventory/prisma-business-stores.test.ts tests/integration/db/prisma-restart-persistence.test.ts tests/unit/domain/stock-balance-store.test.ts
~~~

Expected: configured PostgreSQL tests pass; stale or concurrent failures leave no order, decision, allocation, ledger, or partial closure.

- [ ] **Step 5: Commit**

~~~powershell
git add apps/api/src/infrastructure/db/prisma-outbound-store.ts tests/integration/inventory/prisma-business-stores.test.ts tests/integration/db/prisma-restart-persistence.test.ts tests/unit/domain/stock-balance-store.test.ts
git commit -m "feat: commit outbound decisions atomically"
~~~

### Task 7: Administrator routes and operational exception visibility

**Files:**
- Modify: `apps/api/src/routes/admin/outbound.ts`
- Create: `apps/api/src/application/wecom/approval-sync-query-service.ts`
- Create: `apps/api/src/routes/admin/approval-sync-failures.ts`
- Modify: `apps/api/src/application/wecom/approval-sync-service.ts`
- Modify: `apps/api/src/infrastructure/db/prisma-approval-sync-store.ts`
- Modify: `apps/api/src/infrastructure/db/runtime.ts`
- Modify: `apps/api/src/infrastructure/db/prisma-report-source.ts`
- Modify: `apps/api/src/application/inventory/notification-service.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/src/features/inventory/inventory-status-label.ts`
- Modify: `apps/web/src/features/notifications/notification-tasks.ts`
- Modify: `apps/web/src/features/notifications/NotificationCenter.tsx`
- Test: `tests/integration/inventory/outbound-service.test.ts`
- Test: `tests/integration/inventory/prisma-business-stores.test.ts`
- Test: `tests/e2e/admin/approval-sync.spec.ts`
- Test: `tests/unit/inventory/notification-service.test.ts`

**Interfaces:**
- Produces: POST `/admin/outbound/confirm` with `{ approvalId, decisions }`; actor comes from authenticated request context.
- Produces: GET `/admin/approvals/sync-failures` returning sanitized `{ weComSpNo, attemptedAt, error }[]`.
- Produces: user-visible labels for `REAPPLY_REQUIRED` and `REVOCATION_EXCEPTION`.

- [ ] **Step 1: Write failing route and actor tests**

Assert a successful route forwards:

~~~ts
{
  approvalId: "approval-1",
  operatorId: "local-admin",
  decisions: [{
    approvalLineId: "line-1",
    selectedItemId: "item-1",
    allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1" }],
  }],
}
~~~

Keep 401/403 coverage. Add 400/409 mappings for invalid integer/unit/line input and changed stock.

- [ ] **Step 2: Update the outbound route contract**

Read the actor with `getAdminRequestActor(request)` after the admin hook, reject a missing actor defensively, and pass its ID to the service. Audit only sanitized request/result fields through the existing mutation wrapper.

- [ ] **Step 3: Add sanitized synchronization failure reads**

Add `ApprovalSyncFailureSource.listRecentFailures(limit)`. Implement it in both InMemoryApprovalSyncStore and PrismaApprovalSyncStore, then inject it into ApprovalSyncQueryService. Return recent failed SyncAttempt rows in descending attempt time/order. Expose only approval number, timestamp, and business error text. Never expose callback payload, access token, headers, Secret, Token, EncodingAESKey, or cookie data.

- [ ] **Step 4: Add reapply and revocation operational counts**

Count both `PENDING_OUTBOUND` and `REAPPLY_REQUIRED` as unresolved for month-close/pending-work purposes in PrismaReportSource and the memory read source. Add `APPROVAL_EXCEPTION` to the server/client notification union and make it actionable in NotificationCenter. Emit that distinct notification for `REVOCATION_EXCEPTION` rather than labeling it as a stocktake anomaly. Link both notifications to `/admin/outbound`.

- [ ] **Step 5: Verify and commit**

~~~powershell
corepack pnpm exec vitest run tests/integration/inventory/outbound-service.test.ts tests/integration/inventory/prisma-business-stores.test.ts tests/e2e/admin/approval-sync.spec.ts tests/unit/inventory/notification-service.test.ts
git add apps/api/src/routes/admin/outbound.ts apps/api/src/application/wecom/approval-sync-query-service.ts apps/api/src/routes/admin/approval-sync-failures.ts apps/api/src/application/wecom/approval-sync-service.ts apps/api/src/infrastructure/db/prisma-approval-sync-store.ts apps/api/src/infrastructure/db/runtime.ts apps/api/src/infrastructure/db/prisma-report-source.ts apps/api/src/application/inventory/notification-service.ts apps/api/src/server.ts apps/web/src/features/inventory/inventory-status-label.ts apps/web/src/features/notifications/notification-tasks.ts apps/web/src/features/notifications/NotificationCenter.tsx tests/integration/inventory/outbound-service.test.ts tests/integration/inventory/prisma-business-stores.test.ts tests/e2e/admin/approval-sync.spec.ts tests/unit/inventory/notification-service.test.ts
git commit -m "feat: expose outbound approval exceptions"
~~~

### Task 8: Decision-oriented web workflow and draft v2

**Files:**
- Modify: `apps/web/src/features/outbound/outbound-workflow.ts`
- Test: `tests/unit/web/outbound-workflow.test.ts`

**Interfaces:**
- Consumes: Task 5 pending/options shapes and Task 7 confirm shape.
- Produces: `DecisionDraft`, `OutboundDraft.decisions`, `summarizeOutbound`, `validateDecisionStep`, `normalizeDecisions`, and `reconcileOutboundOptions`.
- Produces: draft version/key `warehouse.outbound.v2`.

- [ ] **Step 1: Write failing pure workflow tests**

Use:

~~~ts
const draft = {
  approvalId: "approval-1",
  step: "allocate",
  decisions: [{
    approvalLineId: "line-wine",
    selectedItemId: "item-maotai",
    zeroIssue: false,
    varianceReason: "",
    allocations: [
      { id: "a1", warehouseId: "wh-1", batchId: "b1", quantity: "1" },
      { id: "a2", warehouseId: "wh-2", batchId: "b2", quantity: "1" },
    ],
  }],
};
~~~

Assert integer-only validation, one item per line, per-line short reason, zero decision shape, item-change allocation clearing, stale selected item/batch marking, candidate search ordering, amount summary, and immutable approved unit display data.

- [ ] **Step 2: Run RED**

~~~powershell
corepack pnpm exec vitest run tests/unit/web/outbound-workflow.test.ts
~~~

Expected: FAIL because draft v1 contains flat allocations and a global reason.

- [ ] **Step 3: Implement draft v2 and pure helpers**

Use one DecisionDraft per approval line. `normalizeDecisions` omits client-only IDs/`zeroIssue` and emits empty selected item/allocations only for a zero decision. Quantity parsing accepts only positive 1-to-14-digit integer strings. `reconcileOutboundOptions` preserves user text but marks stale item and allocation IDs.

Bump both the serialized version and storage key to v2 so v1 drafts cannot be mistaken for the new contract.

- [ ] **Step 4: Verify and commit**

~~~powershell
corepack pnpm exec vitest run tests/unit/web/outbound-workflow.test.ts
git add apps/web/src/features/outbound/outbound-workflow.ts tests/unit/web/outbound-workflow.test.ts
git commit -m "feat: model outbound decision drafts"
~~~

### Task 9: Shared editor and desktop outbound UI

**Files:**
- Create: `apps/web/src/features/outbound/OutboundDecisionEditor.tsx`
- Modify: `apps/web/src/features/outbound/DesktopOutboundTable.tsx`
- Modify: `apps/web/src/pages/OutboundPage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `tests/e2e/admin/outbound.spec.ts`

**Interfaces:**
- Consumes: Task 8 draft helpers.
- Produces: shared editor props `{ approval, options, draft, errors, onChange }`.
- Produces: desktop intent cards, standard-item selector, per-line allocations/reasons, and review summary.

- [ ] **Step 1: Replace desktop E2E fixtures and write failing behavior**

Mock an intent approval with `招待用白酒 / 2 / 瓶` and candidates including `BJ0002 飞天茅台`. Assert the page:

- shows immutable intent/name/quantity/unit;
- has a distinct `标准物品` selector before warehouse/batch;
- does not show item-0001 as the selector value;
- enables warehouse/batch only after item selection;
- clears allocations after confirmed item change;
- uses `min="1"` and `step="1"`;
- requires a reason only on each short/zero line;
- posts the new `decisions` payload;
- shows a non-actionable reapply card instead of empty warehouse options.

Run the single Chromium spec and observe RED.

- [ ] **Step 2: Build the shared decision editor**

Render each intent in a fieldset/card. The item option text must include code, name, unit, and available quantity. A locked legacy item is read-only. `本项不出库` clears selected item and allocations and reveals a required reason. Positive decisions may add/remove allocation rows.

Use a confirmation dialog before changing a selected item with existing allocations. Do not mutate the approved unit anywhere in component state.

- [ ] **Step 3: Integrate desktop state and review**

Replace DesktopOutboundTable's approval-line selector/global reason with Task 8 decisions. Reload options before final confirmation, preserve the draft on failures, and render:

~~~text
申请：招待用白酒 2 瓶
实际：BJ0002 飞天茅台 1 瓶
分配：一号仓 / 期初-260827 / 1
差额：1；原因：库存不足
~~~

Fetch sanitized sync failures in OutboundPage and show them in a collapsed administrator notice.

- [ ] **Step 4: Verify desktop behavior and commit**

~~~powershell
corepack pnpm exec playwright test tests/e2e/admin/outbound.spec.ts --project=chromium
corepack pnpm --filter @warehouse/web typecheck
git add apps/web/src/features/outbound/OutboundDecisionEditor.tsx apps/web/src/features/outbound/DesktopOutboundTable.tsx apps/web/src/pages/OutboundPage.tsx apps/web/src/styles.css tests/e2e/admin/outbound.spec.ts
git commit -m "feat: select standard items during outbound"
~~~

### Task 10: Mobile outbound UI and resilient drafts

**Files:**
- Modify: `apps/web/src/features/outbound/MobileOutboundFlow.tsx`
- Modify: `apps/web/src/features/outbound/OutboundDecisionEditor.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `tests/e2e/mobile/outbound.spec.ts`

**Interfaces:**
- Consumes: Task 8 draft v2 and Task 9 shared editor.
- Produces: mobile select/allocate/review/complete flow with the same invariants and no horizontal overflow.

- [ ] **Step 1: Write failing mobile journey cases**

Replace old fixtures with two intent lines. Cover:

- selecting one standard item and two batches for line one;
- marking line two zero with its own reason;
- reload restoring the v2 draft;
- stale item/batch response preserving text and marking the affected controls;
- double confirmation producing one POST;
- pending refresh moving stale drafts out of the active editor;
- `REAPPLY_REQUIRED` showing resubmission guidance and no allocation controls;
- widths 320, 390, 430, and 820 pixels with no horizontal overflow.

Run the mobile spec and observe RED.

- [ ] **Step 2: Adapt the mobile state machine**

Create one decision draft per intent on start. Load options, reconcile draft v2, and use the shared editor in allocate mode. In review mode show every intent, selected item, allocations, actual/approved integers, per-line variance reason, and total amount.

Before opening the final confirmation, reload options and return to allocation if any selected item or batch became invalid.

- [ ] **Step 3: Verify mobile behavior and commit**

~~~powershell
corepack pnpm exec playwright test tests/e2e/mobile/outbound.spec.ts --project=chromium
corepack pnpm --filter @warehouse/web typecheck
git add apps/web/src/features/outbound/MobileOutboundFlow.tsx apps/web/src/features/outbound/OutboundDecisionEditor.tsx apps/web/src/styles.css tests/e2e/mobile/outbound.spec.ts
git commit -m "feat: support intent outbound on mobile"
~~~

### Task 11: Documentation, full verification, review, and CI-only integration

**Files:**
- Modify: `README.md`
- Modify: `docs/项目状态与发布交接.md`
- Modify only if required by verified config behavior: `tests/deployment/production-config.test.ts`
- No product-code changes unless a failing gate exposes a defect.

**Interfaces:**
- Consumes: Tasks 1–10.
- Produces: locally verified branch, accurate operator configuration, code-review findings resolved, and a CI-only PR targeting `feat/warehouse-system`.

- [ ] **Step 1: Update operator documentation**

Document:

- `WE_COM_APPROVAL_TEMPLATE_ID` is the primary/new template.
- `WE_COM_LEGACY_APPROVAL_TEMPLATE_IDS` is optional comma-separated compatibility input.
- deployment order is compatible code first, template switch second;
- legacy reapply and revocation-exception meanings;
- no secret values belong in Git;
- local readiness does not equal production/template acceptance;
- actual outbound remains unperformed.

- [ ] **Step 2: Run focused and complete verification**

~~~powershell
corepack pnpm exec prisma validate
corepack pnpm exec prisma generate
corepack pnpm exec vitest run tests/unit/domain/approval-intent.test.ts tests/unit/wecom/approval-parser.test.ts tests/unit/wecom/approval-sync-service.test.ts tests/unit/inventory/outbound-allocator.test.ts tests/integration/inventory/outbound-service.test.ts tests/integration/inventory/shared-memory-state.test.ts tests/integration/db-schema.test.ts tests/deployment/production-config.test.ts
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm exec playwright test
git diff --check origin/feat/warehouse-system...HEAD
~~~

Expected: every available non-environment-gated test passes, type checking/build exit zero, Playwright passes all configured projects, and diff check prints nothing. PostgreSQL migration tests must pass in CI even if the local database suite is skipped.

- [ ] **Step 3: Run verification-before-completion and request code review**

Invoke `superpowers:verification-before-completion` using the fresh Step 2 output. Then invoke `superpowers:requesting-code-review` and the repository `code-review` skill against the merge base with `origin/feat/warehouse-system`. Resolve all valid P1/P2 findings with a new red/green cycle and rerun affected gates.

- [ ] **Step 4: Commit documentation and final fixes**

~~~powershell
git add README.md docs/项目状态与发布交接.md tests/deployment/production-config.test.ts
git commit -m "docs: document intent approval rollout"
~~~

If the deployment test file is unchanged, omit it from `git add`. Do not stage `outputs/`.

- [ ] **Step 5: Push and integrate through CI-only PR**

~~~powershell
git push -u origin codex/approval-intent-outbound-resolution
gh pr create --base feat/warehouse-system --head codex/approval-intent-outbound-resolution --title "feat: resolve approval intents during outbound" --body-file .github/pull_request_template.md
gh pr checks --watch
gh pr merge --merge
~~~

If no PR template exists, compose a concise body listing the spec, database migration, test evidence, production safety boundary, and “no actual outbound performed.” Merge only after every required CI check passes. Do not delete the feature branch.

### Task 12: Compatible production deployment and Enterprise WeChat cutover

**Files:**
- Modify after evidence is collected: `docs/项目状态与发布交接.md`
- Production environment and Enterprise WeChat configuration are external state and must never be committed.

**Interfaces:**
- Consumes: merged CI-passing revision from Task 11 and the existing production backup/deploy scripts.
- Produces: migrated healthy production application, new approved template configuration, verified callback/synchronization/options flow, and zero actual outbound transactions during acceptance.

- [ ] **Step 1: Take and verify a production backup**

Run the existing `deploy/scripts/backup.sh` through the authenticated ECS workbench. Verify the gzip stream, manifest/SHA-256, owner/mode, and a restore into an isolated disposable PostgreSQL container exactly as described by the existing production runbook. Do not expose database credentials or copy the production environment file into chat/logs.

- [ ] **Step 2: Deploy compatible code before changing the template**

Keep the current template ID as `WE_COM_APPROVAL_TEMPLATE_ID` and leave the legacy list empty for the first deployment. Deploy the merged release with `deploy/scripts/deploy.sh`, which runs `prisma migrate deploy`. Verify:

~~~text
API container healthy
Web container healthy
PostgreSQL healthy
GET /health returns 200
database migration recorded
existing ApprovalRequest, inventory balances, ledger totals, and OutboundOrder counts unchanged
~~~

Do not use a manual SQL update to classify approvals.

- [ ] **Step 3: Create and configure the new Enterprise WeChat template**

With the user logged in as an administrator able to edit approvals, create “仓库物品领用申请” with:

~~~text
用途：必填多行文本
物品明细：1–5 行
意向物品名称：必填文本
审批数量：必填数字，业务规则为正整数
单位：必填文本
补充要求：选填文本
流程：申请人 → 集团领导 → 仓库管理员 → 抄送赵婉婉
~~~

Configure the existing application callback without changing or revealing its Token/EncodingAESKey. Record only the non-secret new template ID in the controlled production configuration.

- [ ] **Step 4: Switch primary/legacy IDs safely**

Set the new template ID as `WE_COM_APPROVAL_TEMPLATE_ID` and the previous template ID as `WE_COM_LEGACY_APPROVAL_TEMPLATE_IDS` in the server's protected environment file. Restart only through the deployment mechanism, then verify health and that both IDs are accepted while an unrelated ID is rejected.

- [ ] **Step 5: Run no-stock-mutation acceptance**

Have humans submit and approve a dedicated requisition through both approval nodes, and verify Zhao Wanwan receives the Enterprise WeChat copy. Use at least:

~~~text
招待用白酒 / 2 / 瓶
茶叶 / 1 / 盒
~~~

Verify the callback or manual resync produces one approval with two immutable intent lines. In the warehouse UI, verify same-unit positive-stock candidates, item-name search, item selection, and batch options. Stop before the final confirmation dialog; do not POST `/admin/outbound/confirm`.

Also resync the current fixed-text/integration approval and verify it displays “旧审批信息不完整，需重新申请” rather than an empty warehouse selector.

- [ ] **Step 6: Activate the new template and record evidence**

Stop users from initiating the old template while retaining its ID in the legacy allow-list for historical reads. Record release ID, migration, backup, health, callback, approval number, copy recipient, intent-line count, candidate/options evidence, old-approval reapply behavior, and OutboundOrder/OUTBOUND-ledger counts remaining unchanged in `docs/项目状态与发布交接.md`.

Commit and push only the sanitized handoff update through the normal PR path. State explicitly that the new application flow is enabled but the first real stock-decrement/report acceptance remains pending separate confirmation.

## Plan Self-Review

- **Spec coverage:** Tasks 1–3 cover immutable form parsing, one-to-five rows, template coexistence, exact legacy proof, reapply status, revocation, and idempotency. Tasks 4–7 cover per-line decisions, integer/unit invariants, candidates, atomic persistence, actor audit, sync failures, and alerts. Tasks 8–10 cover shared desktop/mobile selection, per-line reasons, zero issue, review, stale options, and drafts. Tasks 11–12 cover full gates, CI-only integration, compatible deployment, template setup, no-mutation acceptance, and evidence.
- **Type consistency:** `ParsedApprovalLine` feeds sync records and ApprovalLine; `OutboundDecisionInput` is used by allocator, service, route, draft normalization, and both UIs; `OutboundOptions` is shared by server/page/editor; status names remain identical across persistence, service, labels, and notifications.
- **Scope:** All tasks contribute directly to one approval-to-outbound capability. Actual inventory issue authorization, unit alias conversion, automatic item binding, reservation, split closure, and Enterprise WeChat write-back remain outside the plan.
- **Placeholder scan:** The plan contains no unfinished markers or unspecified “handle errors” steps; every error class is named in its owning task and test.
