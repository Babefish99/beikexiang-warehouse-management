# 出库确认闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在库存后台完成待出库审批单的批次分配、实际数量校验、少出结案和库存扣减确认。

**Architecture:** API 在现有 `OutboundService` 上增加按审批单查询可用批次的能力，继续由 `OutboundAllocator` 负责所有业务校验；前端 `OutboundPage` 使用展开编辑区管理多行、多仓库、多批次分配，确认时调用现有 `/admin/outbound/confirm`。不预占库存，只有确认请求成功后才改变库存。

**Tech Stack:** Fastify、TypeScript、React、Vite、Vitest、Playwright、Decimal.js。

## Global Constraints

- 审批入口继续使用企业微信，库存后台只处理已通过且待出库的审批单。
- 实际出库数量不能超过审批数量，可以少出，但少出或零出必须填写原因。
- 同一物品可以拆分到多个仓库或入库批次。
- 出库金额按所选入库批次采购单价计算，不允许管理员另填出库单价。
- 一张审批单只允许确认一次；部分出库或零出库后不得补出。
- 不预占库存；确认失败不写入库存流水。
- 当前阶段不引入新的 UI 组件库或 Excel 依赖。

---

### Task 1: 增加审批单可用批次查询 API

**Files:**
- Modify: `apps/api/src/application/inventory/outbound-service.ts`
- Modify: `apps/api/src/routes/admin/outbound.ts`
- Test: `tests/integration/inventory/outbound-service.test.ts`

**Interfaces:**
- Produces `OutboundService.listOptions(approvalId): Promise<{ approvalId: string; batches: AllocationBatch[] }>`.
- Produces `GET /admin/outbound/:approvalId/options` with the same response shape.
- Reuses `OutboundStore.getApproval()` and `OutboundStore.listBatches()`.

- [ ] **Step 1: Write the failing service test**

Seed one approval with one item and two batches. Assert that `service.listOptions("approval-1")` returns both matching batches and that an unknown approval rejects with `approval not found`.

```ts
it("lists available batches for a pending approval", async () => {
  const { store, service } = makeService();
  store.seedBatch({ id: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "3", unitCost: "25" });
  await expect(service.listOptions("approval-1")).resolves.toEqual({
    approvalId: "approval-1",
    batches: [
      { id: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" },
      { id: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "3", unitCost: "25" },
    ],
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm exec vitest run tests/integration/inventory/outbound-service.test.ts`

Expected: FAIL because `OutboundService.listOptions` does not exist.

- [ ] **Step 3: Implement the service and route**

Add `listOptions` after `listPending`:

```ts
async listOptions(approvalId: string): Promise<{ approvalId: string; batches: AllocationBatch[] }> {
  const approval = await this.store.getApproval(approvalId);
  if (!approval) throw new Error(`approval not found: ${approvalId}`);
  return { approvalId, batches: await this.store.listBatches(approval.lines.map((line) => line.itemId)) };
}
```

Register `GET /admin/outbound/:approvalId/options` before the existing cancel route. The existing admin authentication hook remains the authorization boundary.

- [ ] **Step 4: Run focused tests**

Run the same Vitest command. Expected: all outbound service tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/application/inventory/outbound-service.ts apps/api/src/routes/admin/outbound.ts tests/integration/inventory/outbound-service.test.ts
git commit -m "feat: expose outbound batch options"
```

### Task 2: Build the expandable outbound allocation editor

**Files:**
- Modify: `apps/web/src/pages/OutboundPage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `tests/e2e/admin/outbound-confirmation.spec.ts`

**Interfaces:**
- Consumes `GET /admin/outbound/pending`, `GET /admin/outbound/:approvalId/options`, and `GET /admin/warehouses`.
- Produces allocation rows `{ approvalLineId, warehouseId, batchId, quantity }`.
- Submits through `POST /admin/outbound/confirm`.

- [ ] **Step 1: Write the failing browser test**

Create an E2E test that intercepts the read requests with one approval, one warehouse, and one batch. Log in through the local development endpoint, click “办理出库”, and assert that “确认出库”, “实际出库数量”, and “少出原因” are visible.

```ts
test("expands a pending approval into an allocation editor", async ({ page }) => {
  await page.route("**/admin/outbound/pending", (route) => route.fulfill({ json: [{ id: "approval-1", weComSpNo: "202607230021", status: "PENDING_OUTBOUND", lines: [{ id: "line-1", itemId: "item-1", requestedQuantity: "10" }] }] }));
  await page.route("**/admin/outbound/approval-1/options", (route) => route.fulfill({ json: { approvalId: "approval-1", batches: [{ id: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" }] } }));
  await page.route("**/admin/warehouses", (route) => route.fulfill({ json: [{ id: "wh-1", code: "WH1", name: "招待仓", isActive: true }] }));
  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Foutbound");
  await page.getByRole("button", { name: "办理出库" }).click();
  await expect(page.getByRole("button", { name: "确认出库" })).toBeVisible();
  await expect(page.getByLabel("实际出库数量")).toBeVisible();
});
```

- [ ] **Step 2: Run and verify the test fails**

Run: `corepack pnpm exec playwright test tests/e2e/admin/outbound-confirmation.spec.ts --reporter=line`. Expected: FAIL because the current page has no editor controls.

- [ ] **Step 3: Implement typed editor state**

Add `Warehouse`, `AllocationBatch`, and `AllocationDraft` types. Track `expandedApprovalId`, `optionsByApproval`, `warehouses`, `drafts`, `reason`, `saving`, `error`, and `message`. On expansion fetch options and warehouses once, then initialize one blank allocation row per approval line.

- [ ] **Step 4: Render the editor**

For each approval line render the item, approved quantity, allocation rows, warehouse select, filtered batch select, quantity input, read-only unit cost and amount, plus add/remove allocation actions. Show approval total, actual total, total amount, reason, and confirm action. Keep one allocation row per line so the final row cannot be deleted.

- [ ] **Step 5: Implement client validation and submit**

Reject empty batch, non-positive quantity, quantity above approval, and partial/zero issue without reason. Send only non-empty allocations to `/admin/outbound/confirm`. On success show the server result and reload pending approvals; on failure preserve drafts and reason.

- [ ] **Step 6: Add focused styles**

Add styles for `.outbound-editor`, `.outbound-line`, `.allocation-row`, and `.allocation-summary` without changing the existing sidebar layout.

- [ ] **Step 7: Run the focused browser test**

Run the E2E test again. Expected: PASS with the editor visible and no console errors.

### Task 3: Verify confirmation payloads and business errors

**Files:**
- Modify: `tests/e2e/admin/outbound-confirmation.spec.ts`
- Modify: `tests/integration/inventory/outbound-service.test.ts` only if a missing edge case is found

- [ ] **Step 1: Add the payload and validation scenarios**

Mock `POST /admin/outbound/confirm`, fill quantity `4) and reason `实际需求减少`, then assert the request body:

```ts
{
  approvalId: "approval-1",
  allocations: [{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-1", quantity: "4" }],
  reason: "实际需求减少",
}
```

Add a scenario that fills quantity `11` for an approval of `10`, asserts the error message, and verifies the confirm route was not called.

- [ ] **Step 2: Run and verify the scenarios**

Run: `corepack pnpm exec playwright test tests/e2e/admin/outbound-confirmation.spec.ts --reporter=line`. Fix the implementation until both scenarios pass.

- [ ] **Step 3: Run API and browser tests**

Run: `corepack pnpm test` and the focused E2E command. Expected: all existing tests and new confirmation tests pass.

- [ ] **Step 4: Commit**

```powershell
git add apps/web/src/pages/OutboundPage.tsx apps/web/src/styles.css tests/e2e/admin/outbound-confirmation.spec.ts
git commit -m "feat: add outbound confirmation editor"
```

### Task 4: Final verification and review

**Files:** No production changes expected unless verification exposes a defect.

- [ ] **Step 1: Run full verification**

```powershell
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
$env:WEB_BASE_URL='http://127.0.0.1:5174'
corepack pnpm test:e2e --reporter=line
git diff --check
```

- [ ] **Step 2: Review the final diff**

Confirm that the editor sends only allocation rows, does not expose a unit-cost input, preserves error state after failed confirmation, and does not change local-auth or Enterprise WeChat flows.

- [ ] **Step 3: Request code review**

Dispatch a reviewer against the feature commits and fix Critical or Important findings before declaring the outbound confirmation feature complete.
