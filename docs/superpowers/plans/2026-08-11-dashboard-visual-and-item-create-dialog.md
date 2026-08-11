# Dashboard Visual and Item Create Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved visual direction to the dashboard, localize notification content, enlarge the sidebar information card, and move item creation into a modal.

**Architecture:** Add a small code-native SVG icon module for the dashboard marks, keeping the generated image as a visual reference only. Keep notification data flow and item APIs unchanged; localize notification strings at the service boundary and move the existing item-create form into a modal state in `ItemsPage`.

**Tech Stack:** React, TypeScript, lucide-react, Playwright, Vitest, pnpm, Vite.

## Global Constraints

- Use the first generated icon direction: clear heavy silhouettes and block shapes, not thin-outline illustration style.
- Match the existing UI with current navy, blue, green, orange tones and 18–22px icon sizing.
- Do not change notification kinds, priorities, links, item API payloads, or persistence behavior.
- Do not remove the existing item-create fields or WeCom mapping field.
- Preserve unrelated working-tree changes.
- Follow red-green verification before editing production behavior.

---

### Task 1: Add regression tests for the approved behavior

**Files:**
- Modify: `tests/unit/inventory/notification-service.test.ts`
- Modify: `tests/e2e/admin/master-data.spec.ts`
- Modify: `tests/e2e/navigation/dashboard.spec.ts`
- Modify: `tests/e2e/navigation/workspace-tools.spec.ts`

**Interfaces:**
- Consumes: existing notification service dependencies, mocked item APIs, dashboard routes, and workspace shell fixtures.
- Produces: executable expectations for Chinese notifications, no persistent item-create form, working create modal, enlarged information card, and unchanged dashboard navigation.

- [ ] **Step 1: Write the failing tests**

1. Replace the notification service's English expected values with the final Chinese copy:

```ts
title: "待出库审批",
description: "2 条已通过的领用审批待管理员确认出库。",
title: "库存预警：Tea",
description: "Tea 当前库存 1，低于最低库存 3。",
title: "盘点差异待处理",
description: "1 条盘点差异需要处理。",
title: "盘点调整待复核",
description: "1 条盘点调整记录等待复核。",
title: "当前期间待结账",
description: "记账期间 2026-08 尚未结账，请核对报表后处理。",
```

2. Update the item admin e2e flow to assert `.master-data-form-panel` is absent, open the page-level `新增物品` button, fill the `新增物品` dialog, submit it, and then open the existing edit dialog.

3. Update the dashboard e2e flow to open and cancel the create dialog, then assert the edit form is inside `role=dialog` rather than a second inline form.

4. Extend workspace shell assertions with:

```ts
await expect(page.locator(".sidebar__footer strong")).toHaveCSS("font-size", "14px");
await expect(page.locator(".sidebar__footer small")).toHaveCSS("font-size", "12px");
await expect(page.getByText("Inventory Center", { exact: true })).toHaveCount(0);
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
corepack pnpm exec vitest run tests/unit/inventory/notification-service.test.ts
corepack pnpm exec playwright test tests/e2e/admin/master-data.spec.ts tests/e2e/navigation/dashboard.spec.ts tests/e2e/navigation/workspace-tools.spec.ts
```

Expected: failures identify the existing English notification copy, inline create form, missing create dialog, old sidebar font sizes, or remaining English brand subtitle.

### Task 2: Implement dashboard icon and shell visual updates

**Files:**
- Create: `apps/web/src/components/DashboardIcons.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: existing `DashboardCard` tones and quick-action links.
- Produces: `InventoryMark`, `ApprovalMark`, `InboundMark`, and `OutboundMark` code-native SVG components with `size` and `className` props; unchanged navigation and data loading.

- [ ] **Step 1: Add the minimal SVG icon components**

Create `DashboardIcons.tsx` with four `currentColor` SVG components. Use filled block shapes and simple white cutouts: a shelf with boxes, a clipboard/check, a box with a downward arrow, and a box with an upward arrow. Set `aria-hidden="true"` and default `focusable="false"`; expose `size?: number` and `className?: string`.

- [ ] **Step 2: Wire the components into the dashboard**

Replace the four `metricIcons` lucide entries in `App.tsx` with the new components. Use `InboundMark`, `OutboundMark`, and `InventoryMark` in the three shortcut links. Keep all hrefs and labels unchanged.

- [ ] **Step 3: Localize visible shell copy and enlarge the information card**

Replace both visible `Inventory Center` strings in `AppShell.tsx` with `库存管理后台`. Append scoped CSS overrides so `.sidebar__footer strong` is 14px, `.sidebar__footer small` is 12px, and the card has enough padding/min-height for the larger text.

- [ ] **Step 4: Run the dashboard and workspace tests**

Run: `corepack pnpm exec playwright test tests/e2e/navigation/dashboard.spec.ts tests/e2e/navigation/workspace-tools.spec.ts`

Expected: PASS after the icon and shell changes, with dashboard links still navigating to the same pages.

### Task 3: Localize notification content at the service boundary

**Files:**
- Modify: `apps/api/src/application/inventory/notification-service.ts`
- Test: `tests/unit/inventory/notification-service.test.ts`

**Interfaces:**
- Consumes: the same notification dependency values and types.
- Produces: the same `InventoryNotification[]` shape with Chinese `title` and `description` values.

- [ ] **Step 1: Replace only user-facing notification strings**

Use the exact Chinese copy from Task 1. Keep IDs, kinds, hrefs, priorities, counts, and sorting unchanged.

- [ ] **Step 2: Run the notification unit test**

Run: `corepack pnpm exec vitest run tests/unit/inventory/notification-service.test.ts`

Expected: PASS with all five notification cases localized.

### Task 4: Move item creation into a modal

**Files:**
- Modify: `apps/web/src/pages/ItemsPage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `tests/e2e/admin/master-data.spec.ts`

**Interfaces:**
- Consumes: existing `createForm`, `submitCreate`, `toPayload`, item list loading, and edit modal styling.
- Produces: a page-level `新增物品` button and an accessible `role="dialog"` named `新增物品`; existing create API behavior remains unchanged.

- [ ] **Step 1: Add create modal state and trigger**

Add `createModalOpen` state. Move the refresh button and `新增物品` primary button into `PageHeader.actions`; opening the button clears stale error/message state and shows the modal.

- [ ] **Step 2: Move the existing create form into the modal**

Remove the persistent `.master-data-form-panel` create section. Render the same fields inside a modal dialog with title, close button, cancel button, submit button, and the existing error area. On success reset `createForm`, close the modal, and reload items. On failure keep the dialog and input values.

- [ ] **Step 3: Add close behavior and responsive styling**

Close on the close button, cancel button, and Escape through the existing dialog key handling pattern. Reuse `.modal-dialog` and `.modal-dialog__form`; add only the create-modal-specific selectors needed for the header/action layout.

- [ ] **Step 4: Run the item admin tests**

Run: `corepack pnpm exec playwright test tests/e2e/admin/master-data.spec.ts`

Expected: PASS for create modal submission, edit modal behavior, item action labels, and administrator-only API checks.

### Task 5: Full verification and commit

**Files:**
- No additional files.

**Interfaces:**
- Consumes: all changes from Tasks 2–4.
- Produces: fresh verification evidence and a focused commit without staging prior user work.

- [ ] **Step 1: Run relevant browser suites**

Run: `corepack pnpm exec playwright test tests/e2e/admin/master-data.spec.ts tests/e2e/admin/reports.spec.ts tests/e2e/navigation/dashboard.spec.ts tests/e2e/navigation/workspace-tools.spec.ts`

Expected: all selected browser tests pass.

- [ ] **Step 2: Run type checking and build**

Run: `corepack pnpm typecheck` and `corepack pnpm build`

Expected: both commands exit with code 0.

- [ ] **Step 3: Run the full test suite**

Run: `corepack pnpm test`

Expected: all test files and tests pass.

- [ ] **Step 4: Check the diff**

Run: `git diff --check`

Expected: exit code 0 with no whitespace errors.

- [ ] **Step 5: Commit only this feature's files**

```bash
git add apps/web/src/components/DashboardIcons.tsx apps/web/src/App.tsx apps/web/src/components/AppShell.tsx apps/web/src/pages/ItemsPage.tsx apps/web/src/styles.css apps/api/src/application/inventory/notification-service.ts tests/unit/inventory/notification-service.test.ts tests/e2e/admin/master-data.spec.ts tests/e2e/navigation/dashboard.spec.ts tests/e2e/navigation/workspace-tools.spec.ts
git commit -m "feat: refine dashboard visual experience"
```
