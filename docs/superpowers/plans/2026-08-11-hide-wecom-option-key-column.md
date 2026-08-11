# Hide WeCom Option Key Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the technical “企业微信选项 key” column from the standard item list while preserving the field for mapping, editing, and search.

**Architecture:** Keep the existing `ItemRow` shape, API payload, form state, and client-side filtering unchanged. Adjust only the rendered table header/cell and add an end-to-end assertion that a key can still be used to filter an item without being displayed as a table column.

**Tech Stack:** React, TypeScript, Playwright, pnpm, Vite.

## Global Constraints

- Do not change the database schema, API response, approval parser, or `weComOptionKey` form field.
- Do not remove key-based search.
- Preserve unrelated working-tree changes.
- Follow red-green verification before editing production code.

---

### Task 1: Protect the list presentation contract

**Files:**
- Modify: `tests/e2e/admin/master-data.spec.ts`
- Test: `tests/e2e/admin/master-data.spec.ts`

**Interfaces:**
- Consumes: the existing mocked item list and `/auth/local?returnTo=/admin/items` route.
- Produces: an end-to-end assertion that the key remains searchable but is absent from the rendered list columns.

- [ ] **Step 1: Write the failing test**

Extend the existing item-page test data with `weComOptionKey: "opt-tea"`, then after page load assert the table has no header named `企业微信选项 key`, the first row has no cell containing `opt-tea`, and searching for `opt-tea` still leaves the item row visible:

```ts
await expect(page.getByRole("columnheader", { name: "企业微信选项 key", exact: true })).toHaveCount(0);
await expect(row.getByText("opt-tea", { exact: true })).toHaveCount(0);
await page.getByLabel("物品搜索").fill("opt-tea");
await expect(page.locator("tbody tr")).toHaveCount(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec playwright test tests/e2e/admin/master-data.spec.ts -g "edit modal"`

Expected: FAIL because the current table still renders the `企业微信选项 key` column and its `opt-tea` cell.

### Task 2: Remove only the visible key column

**Files:**
- Modify: `apps/web/src/pages/ItemsPage.tsx:270-286`

**Interfaces:**
- Consumes: the existing `ItemRow` data and unchanged `filteredItems` search logic.
- Produces: a table with columns 编码、物品名称、规格、单位、状态、操作; key mapping remains available to forms and filtering.

- [ ] **Step 1: Write minimal implementation**

Remove only the `<th>` and matching `<td>` for `企业微信选项 key` from the list table. Do not remove `weComOptionKey` from `ItemRow`, `ItemFormState`, `toFormState`, `toPayload`, the create/edit forms, or `filteredItems`.

- [ ] **Step 2: Run the focused test to verify it passes**

Run: `corepack pnpm exec playwright test tests/e2e/admin/master-data.spec.ts -g "edit modal"`

Expected: PASS, including the key-based search assertion and the absence of the key column/cell.

### Task 3: Run regression verification

**Files:**
- No additional files.

**Interfaces:**
- Consumes: the updated item list and existing API/test suite.
- Produces: fresh evidence that the UI build, type checking, and tests remain green.

- [ ] **Step 1: Run the relevant browser suites**

Run: `corepack pnpm exec playwright test tests/e2e/admin/master-data.spec.ts tests/e2e/admin/reports.spec.ts`

Expected: all tests pass.

- [ ] **Step 2: Run type checking and build**

Run: `corepack pnpm typecheck` and `corepack pnpm build`

Expected: both commands exit with code 0.

- [ ] **Step 3: Run the full test suite**

Run: `corepack pnpm test`

Expected: all test files and tests pass.

- [ ] **Step 4: Check the diff**

Run: `git diff --check`

Expected: exit code 0 with no whitespace errors.

- [ ] **Step 5: Commit the implementation**

```bash
git add tests/e2e/admin/master-data.spec.ts apps/web/src/pages/ItemsPage.tsx
git commit -m "fix: hide WeCom option key from item list"
```
