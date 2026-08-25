# UI Consistency Focused Fix Implementation Plan

> **For Codex:** Execute this plan inline with strict red-green-refactor cycles and fresh verification evidence.

**Goal:** Remove the remaining high-value, low-risk inconsistencies in user-visible Chinese status text, business labels, shared button hierarchy, typography, and form feedback semantics.

**Architecture:** Keep API contracts and page workflows unchanged. Add one pure display-boundary status formatter, apply it only where raw inventory statuses are rendered, then make narrow JSX/CSS corrections using existing shared classes. Protect behavior with a small unit contract plus focused Playwright checks against real rendered pages.

**Tech Stack:** React 19, TypeScript, Vitest, Playwright, shared CSS.

---

### Task 1: Specify the Chinese inventory status boundary

**Files:**

- Create: `tests/unit/web/inventory-status-label.test.ts`
- Create: `apps/web/src/features/inventory/inventory-status-label.ts`

1. Add a table-driven unit test with literal expectations for known statuses and an unknown English status.
2. Run `corepack pnpm exec vitest run tests/unit/web/inventory-status-label.test.ts` and confirm RED because the formatter does not exist.
3. Implement the smallest status map and Chinese fallback.
4. Re-run the unit test and confirm GREEN.

### Task 2: Specify and localize every current status rendering surface

**Files:**

- Modify: `tests/e2e/admin/inventory-operations.spec.ts`
- Modify: `tests/e2e/admin/outbound.spec.ts`
- Modify: `tests/e2e/mobile/outbound.spec.ts`
- Modify: `apps/web/src/pages/TransfersPage.tsx`
- Modify: `apps/web/src/pages/ReturnsPage.tsx`
- Modify: `apps/web/src/features/outbound/DesktopOutboundTable.tsx`
- Modify: `apps/web/src/features/outbound/MobileOutboundFlow.tsx`

1. Add focused E2E expectations proving English status enums are not visible and literal Chinese labels are visible in transfer, return, desktop outbound, and mobile outbound results.
2. Add an expectation that the mobile result label is “业务编号”.
3. Run only the new expectations and confirm RED against the current raw enum/ID output.
4. Import and apply the status formatter at display boundaries; update “服务端 ID” to “业务编号”.
5. Re-run the focused E2E tests and confirm GREEN.

### Task 3: Specify business wording, button hierarchy, typography, and feedback semantics

**Files:**

- Modify: `tests/e2e/admin/master-data.spec.ts`
- Modify: `tests/e2e/admin/opening-stock-import.spec.ts`
- Modify: `tests/e2e/admin/inventory-operations.spec.ts`
- Modify: `tests/e2e/admin/reports.spec.ts`
- Modify: `apps/web/src/pages/ItemsPage.tsx`
- Modify: `apps/web/src/pages/OpeningStockPage.tsx`
- Modify: `apps/web/src/pages/WarehousesPage.tsx`
- Modify: `apps/web/src/pages/TransfersPage.tsx`
- Modify: `apps/web/src/pages/ReturnsPage.tsx`
- Modify: `apps/web/src/pages/StocktakePage.tsx`
- Modify: `apps/web/src/pages/ReportsPage.tsx`
- Modify: `apps/web/src/features/outbound/DesktopOutboundTable.tsx`
- Modify: `apps/web/src/styles.css`

1. Add E2E expectations for “企业微信选项标识”, retry button secondary styling, 13px success/modal helper text, 18px/13px opening-stock section typography, and `alert`/`status` roles on representative feedback.
2. Run the focused tests and confirm RED for each missing behavior.
3. Apply the narrow copy, class, role, and final CSS override changes. Keep the item-specific wide modal structure unchanged.
4. Re-run focused tests and confirm GREEN.

### Task 4: Regression verification and handoff

**Files:**

- Modify: `PROJECT_STATUS.md`
- Modify: `docs/项目状态与发布交接.md`

1. Run the formatter unit test plus all changed E2E files.
2. Run the full web/admin/mobile E2E selection needed to cover the affected surfaces.
3. Run `corepack pnpm typecheck`.
4. Run `corepack pnpm build`.
5. Run `git diff --check` and review `git diff --stat` plus the final patch.
6. Record actual changes, exact verification results, and deferred items in both handoff documents.
7. Use `verification-before-completion`, then request code review because this batch spans several UI surfaces.

## Explicit exclusions

- No full CSS token rewrite or duplicate-rule cleanup.
- No migration of the item-specific wide modal to `ModalDialog`.
- No bulk translation of historic backend English errors.
- No push, PR, deployment, production database, Secret, or enterprise WeChat changes.
