# 物品编辑弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将标准物品库的编辑表单改为居中弹窗，隐藏编辑场景中的分类字段，并保持停用/启用按钮按物品状态条件显示。

**Architecture:** 复用 `ItemsPage` 现有编辑状态、PATCH 提交流程和状态切换 API，只替换编辑表单的渲染容器；编辑表单继续在状态中保留原分类值，并在提交时原样发送。新增弹窗样式使用现有 CSS 变量和按钮/表单视觉规范，不引入组件库或后端接口变化。

**Tech Stack:** React 19、TypeScript、Vite、Playwright、现有 CSS。

## Global Constraints

- 编辑弹窗不显示“分类前缀”和“分类”字段。
- 新增物品表单保留“分类前缀”和“分类”字段。
- 启用物品只显示“停用”，停用物品只显示“启用”。
- 编辑保存失败时弹窗保持打开并保留输入内容。
- 不修改后端 PATCH 请求格式、权限或审计行为。

---

### Task 1: Add the modal regression test

**Files:**
- Modify: `tests/e2e/admin/master-data.spec.ts`
- Test: `tests/e2e/admin/master-data.spec.ts`

**Interfaces:**
- Consumes: `ItemsPage` rendered through the local-auth browser route and mocked item APIs.
- Produces: A browser regression test requiring a dialog with the edit fields, no visible classification fields, and preserved values after an API error.

- [ ] **Step 1: Write the failing test**

Add a focused test with one active item and a mocked PATCH failure. Open the exact “编辑” button and assert:

```ts
const dialog = page.getByRole("dialog", { name: "编辑物品" });
await expect(dialog).toBeVisible();
await expect(dialog.getByLabel("分类前缀", { exact: true })).toHaveCount(0);
await expect(dialog.getByLabel("分类", { exact: true })).toHaveCount(0);
await expect(page.locator(".master-data-form-panel")).toHaveCount(1);
```

Fill the visible edit fields, submit the mocked failing PATCH request, and assert that the dialog remains visible with the edited values and the API error. Also assert the inactive-row test continues to show only “启用”.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
corepack pnpm exec playwright test tests/e2e/admin/master-data.spec.ts -g "modal"
```

Expected: FAIL because the current editor is an inline panel, has no dialog role, and still renders the two classification fields.

- [ ] **Step 3: Commit the test change**

```powershell
git add -- tests/e2e/admin/master-data.spec.ts
git commit -m "test: specify item edit modal behavior"
```

### Task 2: Implement the item edit modal

**Files:**
- Modify: `apps/web/src/pages/ItemsPage.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Existing `editingItemId`, `editForm`, `submitEdit`, `activateItem`, and `deactivateItem` behavior.
- Produces: A modal dialog opened by the item “编辑” action; unchanged PATCH payload classification values; conditional “停用” / “启用” action labels.

- [ ] **Step 1: Replace the inline editor with a dialog**

Render the editor only when `editingItemId` is set, using a fixed overlay and a dialog panel. Add a visible title, close button, and `aria-labelledby`; route both the close button and “取消” to `setEditingItemId(null)`.

- [ ] **Step 2: Remove classification controls from the edit form**

Keep `categoryPrefix` and `categoryId` in `ItemFormState` so `toPayload(editForm)` sends the existing values, but render only 编码、名称、规格、单位、企业微信选项 key、最低库存 in the edit dialog.

- [ ] **Step 3: Add focused modal styles**

Add styles for the fixed backdrop, centered dialog, dialog header/close action, and mobile width using existing `--border`, `--surface`, `--navy`, and `--orange` variables. Keep the create form and table layout unchanged.

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```powershell
corepack pnpm exec playwright test tests/e2e/admin/master-data.spec.ts -g "modal"
```

Expected: PASS, including visible dialog, hidden classification controls, retained inputs after failure, and no inline editor panel.

- [ ] **Step 5: Commit the implementation**

```powershell
git add -- apps/web/src/pages/ItemsPage.tsx apps/web/src/styles.css tests/e2e/admin/master-data.spec.ts
git commit -m "feat: edit items in modal dialog"
```

### Task 3: Run the complete verification suite

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: The completed modal UI and existing item/report test suites.
- Produces: Fresh evidence that the UI change does not regress master-data, report mapping, type checking, or production build behavior.

- [ ] **Step 1: Run the relevant end-to-end suites**

```powershell
corepack pnpm exec playwright test tests/e2e/admin/master-data.spec.ts tests/e2e/admin/reports.spec.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run type checking and production build**

```powershell
corepack pnpm typecheck
corepack pnpm build
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Run the full unit and integration suite**

```powershell
corepack pnpm test
```

Expected: 0 failed tests.

- [ ] **Step 4: Check the final diff**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intended source/test changes remain uncommitted or committed according to the task workflow.
