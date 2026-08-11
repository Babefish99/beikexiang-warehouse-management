# Warehouse Topbar Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the warehouse search field sit next to the warehouse selector and align the topbar typography with the approved visual hierarchy.

**Architecture:** Keep the existing `AppShell` DOM and behavior intact. Change only the late workspace-shell CSS overrides so desktop uses a flex row and existing responsive breakpoints continue to stack the search field below the leading controls.

**Tech Stack:** React 19, TypeScript, CSS, Playwright

## Global Constraints

- Do not change warehouse selection, search, notification, or authentication behavior.
- Use 16px for the current section title and 14px for the warehouse selector.
- Keep the desktop selector-to-search horizontal gap between 12px and 28px.
- Preserve all unrelated working-tree changes.
- Do not modify the fixed-assets project because its company logo is already present and rendered correctly.

---

### Task 1: Align warehouse topbar controls

**Files:**
- Modify: `apps/web/src/styles.css`
- Test: `tests/e2e/navigation/workspace-tools.spec.ts`

**Interfaces:**
- Consumes: existing `.topbar`, `.topbar__leading`, `.topbar__center`, `.topbar__actions`, `.topbar__crumb`, `.topbar-selector`, and `.workspace-search` elements from `AppShell`.
- Produces: a desktop flex layout with a 12–28px selector-to-search gap and the approved 16px/14px typography.

- [ ] **Step 1: Write the failing browser layout assertion**

Add a Playwright assertion that reads the real element rectangles and computed font sizes:

```ts
const layout = await page.locator('.topbar').evaluate((topbar) => {
  const selector = topbar.querySelector<HTMLElement>('.topbar-selector')!;
  const search = topbar.querySelector<HTMLElement>('.workspace-search')!;
  const section = topbar.querySelector<HTMLElement>('.topbar__crumb strong')!;
  const gap = search.getBoundingClientRect().left - selector.getBoundingClientRect().right;
  return {
    gap,
    sectionFontSize: Number.parseFloat(getComputedStyle(section).fontSize),
    selectorFontSize: Number.parseFloat(getComputedStyle(selector).fontSize),
  };
});
expect(layout.gap).toBeGreaterThanOrEqual(12);
expect(layout.gap).toBeLessThanOrEqual(28);
expect(layout.sectionFontSize).toBe(16);
expect(layout.selectorFontSize).toBe(14);
```

- [ ] **Step 2: Run the focused test and verify the old layout fails**

Run:

```powershell
corepack pnpm exec playwright test tests/e2e/navigation/workspace-tools.spec.ts -g "saved warehouse selection" --workers=1
```

Expected: FAIL because the current search field is centered far from the warehouse selector and the computed font sizes are 15px/16px.

- [ ] **Step 3: Implement the minimal CSS change**

Update the late workspace-shell rules:

```css
.topbar { display: flex; }
.topbar__leading { flex: 0 0 auto; }
.topbar__center { flex: 0 1 420px; justify-content: flex-start; }
.topbar__actions { margin-left: auto; }
.topbar__crumb strong { font-size: 16px; }
.topbar-selector { font-size: 14px; }

@media (max-width: 1080px) {
  .topbar { min-height: auto; flex-wrap: wrap; }
  .topbar__leading { flex: 1 1 auto; }
  .topbar__center { order: 3; flex: 1 1 100%; justify-content: stretch; }
}
```

- [ ] **Step 4: Verify focused and full behavior**

Run:

```powershell
corepack pnpm exec playwright test tests/e2e/navigation/workspace-tools.spec.ts --workers=1
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 5: Visually verify both local systems**

Open `http://127.0.0.1:5174/` and confirm the warehouse topbar. Open `http://127.0.0.1:5173/` and confirm the fixed-assets logo remains visible and uncropped.

- [ ] **Step 6: Commit only task-owned files**

```powershell
git add -- apps/web/src/styles.css tests/e2e/navigation/workspace-tools.spec.ts docs/superpowers/specs/2026-08-11-topbar-alignment-design.md docs/superpowers/plans/2026-08-11-topbar-alignment.md
git commit -m "fix: align warehouse topbar controls"
```

