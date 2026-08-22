# 紧凑侧栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 821px 至 1180px 的桌面窗口提供可悬停、可固定展开的 64px 紧凑侧栏，同时保持完整桌面与手机导航行为不变。

**Architecture:** 新增一个仅负责紧凑桌面媒体查询和壳层状态类的前端模块。`AppShell` 使用该模块判断紧凑范围，并只保存用户本页的固定展开状态；CSS 负责侧栏宽度、悬停临时展开和工作区留白。Playwright 验证真实窗口宽度下的交互，Vitest 验证断点与状态类契约。

**Tech Stack:** React 19、TypeScript、Vite、Vitest 3、Playwright、CSS 媒体查询、lucide-react。

## Global Constraints

- 紧凑桌面媒体查询必须精确为 `821px–1180px`，与既有 `max-width: 820px` 手机边界不重叠。
- 宽度大于等于 1181px 时必须保留现有完整 232px 侧栏。
- 宽度小于等于 820px 时必须保留现有移动底部导航和更多面板。
- 紧凑状态默认 64px；悬停仅临时展开，点击切换按钮后才固定为 232px。
- 固定展开状态仅存于当前 React 页面状态；不得使用 localStorage、sessionStorage、API 或服务端状态。
- 不修改认证、库存业务、企业微信配置、部署文件或生产环境。
- 新行为必须先以失败测试覆盖；完成后运行类型检查、完整测试和生产构建。

---

## File Structure

- `apps/web/src/features/layout/compact-sidebar.ts` — 紧凑桌面媒体查询、可订阅视口存储和壳层状态类的唯一来源。
- `apps/web/src/components/AppShell.tsx` — 使用紧凑视口状态，维护点击固定展开状态，渲染无障碍切换按钮和导航提示。
- `apps/web/src/styles.css` — 紧凑桌面下的 64px/232px 尺寸、悬停覆盖、文字隐藏与工作区留白规则。
- `tests/unit/web/compact-sidebar.test.ts` — 断点、媒体查询更新和壳层状态类的 Vitest 契约测试。
- `tests/e2e/navigation/sidebar.spec.ts` — 真实浏览器下的 1180px 紧凑交互、1181px 完整侧栏和 820px 手机边界测试。

### Task 1: 紧凑桌面状态契约

**Files:**

- Create: `apps/web/src/features/layout/compact-sidebar.ts`
- Create: `tests/unit/web/compact-sidebar.test.ts`

**Interfaces:**

- Produces: `COMPACT_SIDEBAR_MEDIA_QUERY`，值为 `"(min-width: 821px) and (max-width: 1180px)"`。
- Produces: `CompactSidebarViewportStore`，具有 `getSnapshot(): boolean` 与 `subscribe(listener: () => void): () => void`。
- Produces: `createCompactSidebarViewportStore(target)`，其中 `target` 只需提供 `matchMedia`。
- Produces: `getCompactSidebarShellClasses(isCompact: boolean, isPinned: boolean): string[]`，仅在紧凑状态返回 `app-shell--compact-sidebar`，仅在紧凑且固定展开时额外返回 `app-shell--compact-sidebar-pinned`。
- Produces: `useCompactSidebarViewport(): boolean`，供 `AppShell` 订阅浏览器媒体查询。

- [ ] **Step 1: 写入失败的状态契约测试**

创建 `tests/unit/web/compact-sidebar.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPACT_SIDEBAR_MEDIA_QUERY,
  createCompactSidebarViewportStore,
  getCompactSidebarShellClasses,
} from "../../../apps/web/src/features/layout/compact-sidebar";

function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: initialMatches,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
    emit(matches: boolean) {
      media.matches = matches;
      for (const listener of listeners) listener();
    },
  };
  return { matchMedia: vi.fn(() => media), media };
}

afterEach(() => vi.restoreAllMocks());

describe("compact sidebar", () => {
  it("uses the desktop-only range between mobile and full navigation", () => {
    expect(COMPACT_SIDEBAR_MEDIA_QUERY).toBe("(min-width: 821px) and (max-width: 1180px)");
  });

  it("updates the compact state when the media query changes", () => {
    const target = stubMatchMedia(true);
    const store = createCompactSidebarViewportStore(target);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot()).toBe(true);
    expect(target.matchMedia).toHaveBeenCalledWith(COMPACT_SIDEBAR_MEDIA_QUERY);
    target.media.emit(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toBe(false);

    unsubscribe();
  });

  it("adds the pinned workspace class only for a pinned compact sidebar", () => {
    expect(getCompactSidebarShellClasses(false, true)).toEqual([]);
    expect(getCompactSidebarShellClasses(true, false)).toEqual(["app-shell--compact-sidebar"]);
    expect(getCompactSidebarShellClasses(true, true)).toEqual([
      "app-shell--compact-sidebar",
      "app-shell--compact-sidebar-pinned",
    ]);
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

运行：

```powershell
corepack pnpm exec vitest run tests/unit/web/compact-sidebar.test.ts
```

预期：测试因 `apps/web/src/features/layout/compact-sidebar.ts` 尚不存在而失败。

- [ ] **Step 3: 实现最小的视口模块**

创建 `apps/web/src/features/layout/compact-sidebar.ts`，使用与 `features/mobile/use-mobile-viewport.ts` 相同的 `useSyncExternalStore` 模式：

```ts
import { useSyncExternalStore } from "react";

export const COMPACT_SIDEBAR_MEDIA_QUERY = "(min-width: 821px) and (max-width: 1180px)";

export type CompactSidebarViewportStore = {
  getSnapshot(): boolean;
  subscribe(listener: () => void): () => void;
};

export function createCompactSidebarViewportStore(
  target: Pick<Window, "matchMedia">,
): CompactSidebarViewportStore {
  const media = target.matchMedia(COMPACT_SIDEBAR_MEDIA_QUERY);
  return {
    getSnapshot: () => media.matches,
    subscribe(listener) {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
  };
}

let browserStore: CompactSidebarViewportStore | undefined;

export function useCompactSidebarViewport(): boolean {
  browserStore ??= createCompactSidebarViewportStore(window);
  return useSyncExternalStore(browserStore.subscribe, browserStore.getSnapshot, browserStore.getSnapshot);
}

export function getCompactSidebarShellClasses(isCompact: boolean, isPinned: boolean): string[] {
  if (!isCompact) return [];
  return isPinned
    ? ["app-shell--compact-sidebar", "app-shell--compact-sidebar-pinned"]
    : ["app-shell--compact-sidebar"];
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

运行：

```powershell
corepack pnpm exec vitest run tests/unit/web/compact-sidebar.test.ts
```

预期：3 个测试全部通过。

- [ ] **Step 5: 提交状态模块**

```bash
git add apps/web/src/features/layout/compact-sidebar.ts tests/unit/web/compact-sidebar.test.ts
git commit -m "feat(web): add compact sidebar viewport state"
```

### Task 2: 可展开侧栏和跨断点交互

**Files:**

- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `tests/e2e/navigation/sidebar.spec.ts`

**Interfaces:**

- Consumes: `useCompactSidebarViewport` 与 `getCompactSidebarShellClasses`。
- Produces: 紧凑窗口中的 `button[aria-label="固定展开侧栏"]` 与 `button[aria-label="收起固定侧栏"]`；二者通过 `aria-expanded` 反映固定状态。
- Produces: `app-shell--compact-sidebar`、`app-shell--compact-sidebar-pinned` 和 `sidebar--pinned` CSS 类。
- Preserves: `.sidebar`、`nav[aria-label="主导航"]`、现有导航链接及 820px 以下移动导航。

- [ ] **Step 1: 写入失败的 Playwright 交互测试**

在 `tests/e2e/navigation/sidebar.spec.ts` 追加以下测试；复用已存在的 `apiUrl`：

```ts
test("1180px sidebar stays compact until it is pinned, then collapses on a second click", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto(apiUrl("/auth/local?returnTo=%2F"));

  const sidebar = page.locator(".sidebar");
  const workspace = page.locator(".workspace");
  const toggle = page.getByRole("button", { name: "固定展开侧栏" });

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(64);
  await expect.poll(() => workspace.evaluate((node) => Math.round(node.getBoundingClientRect().left))).toBe(64);

  await sidebar.hover();
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(232);
  await page.mouse.move(1179, 880);
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(64);

  await toggle.click();
  await expect(page.getByRole("button", { name: "收起固定侧栏" })).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(232);
  await expect.poll(() => workspace.evaluate((node) => Math.round(node.getBoundingClientRect().left))).toBe(232);

  await page.getByRole("button", { name: "收起固定侧栏" }).click();
  await expect(page.getByRole("button", { name: "固定展开侧栏" })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(64);
});

test("full desktop and mobile navigation stay outside the compact-sidebar range", async ({ page }) => {
  await page.setViewportSize({ width: 1181, height: 900 });
  await page.goto(apiUrl("/auth/local?returnTo=%2F"));
  await expect(page.getByRole("button", { name: "固定展开侧栏" })).toHaveCount(0);
  await expect.poll(() => page.locator(".sidebar").evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(232);

  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "手机任务导航" })).toBeVisible();
});
```

- [ ] **Step 2: 运行新增浏览器测试并确认 RED**

运行：

```powershell
corepack pnpm exec playwright test tests/e2e/navigation/sidebar.spec.ts
```

预期：1180px 测试失败，因为当前侧栏仍为 232px，且不存在固定展开按钮。

- [ ] **Step 3: 在 `AppShell` 接入状态和可访问切换**

1. 从 `lucide-react` 增加 `PanelLeftOpen`、`PanelLeftClose` 导入，并从 `../features/layout/compact-sidebar` 导入 `getCompactSidebarShellClasses`、`useCompactSidebarViewport`。
2. 在现有移动视口状态旁读取 `const isCompactSidebar = useCompactSidebarViewport()`，并新增 `const [isCompactSidebarPinned, setIsCompactSidebarPinned] = useState(false)`。
3. 用以下表达式替换根壳层固定类：

```tsx
const compactSidebarClasses = getCompactSidebarShellClasses(
  isCompactSidebar,
  isCompactSidebarPinned,
);

<div className={["app-shell", "mobile-app-frame", ...compactSidebarClasses].join(" ")}>
```

4. 给桌面 `aside` 在紧凑且固定展开时附加 `sidebar--pinned`：

```tsx
<aside className={`sidebar ${isCompactSidebar && isCompactSidebarPinned ? "sidebar--pinned" : ""}`}>
```

5. 在 `.sidebar__brand` 内、`<LogoMark />` 后仅于紧凑范围渲染以下按钮；点击只反转 `isCompactSidebarPinned`：

```tsx
{isCompactSidebar ? (
  <button
    className="sidebar__toggle"
    type="button"
    aria-label={isCompactSidebarPinned ? "收起固定侧栏" : "固定展开侧栏"}
    aria-expanded={isCompactSidebarPinned}
    onClick={() => setIsCompactSidebarPinned((pinned) => !pinned)}
  >
    {isCompactSidebarPinned ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
  </button>
) : null}
```

6. 为每个导航文字 `span` 添加 `className="nav-item__label"`，并向紧凑但未固定的链接添加 `title={label}`。不得改变链接的文本内容、`href` 或 `aria-current`。

- [ ] **Step 4: 添加紧凑侧栏 CSS**

在 `styles.css` 的桌面壳层规则之后、`@media (max-width: 820px)` 之前增加以下规则；保留现有宽侧栏和移动规则：

```css
.sidebar__toggle { display: none; }

@media (min-width: 821px) and (max-width: 1180px) {
  .app-shell--compact-sidebar .sidebar {
    width: 64px;
    overflow: hidden;
    transition: width .18s ease, box-shadow .18s ease;
  }
  .app-shell--compact-sidebar .sidebar:hover,
  .app-shell--compact-sidebar .sidebar--pinned {
    width: 232px;
    box-shadow: 10px 0 28px rgba(24, 32, 56, .18);
  }
  .app-shell--compact-sidebar .workspace { margin-left: 64px; transition: margin-left .18s ease; }
  .app-shell--compact-sidebar.app-shell--compact-sidebar-pinned .workspace { margin-left: 232px; }
  .app-shell--compact-sidebar .sidebar__brand { padding: 0 14px; justify-content: space-between; }
  .app-shell--compact-sidebar .sidebar__toggle {
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--navy);
  }
  .app-shell--compact-sidebar .sidebar:not(:hover):not(.sidebar--pinned) .logo-mark,
  .app-shell--compact-sidebar .sidebar:not(:hover):not(.sidebar--pinned) .sidebar__footer { display: none; }
  .app-shell--compact-sidebar .sidebar:not(:hover):not(.sidebar--pinned) .nav-item__label {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .app-shell--compact-sidebar .sidebar:hover .nav-item__label,
  .app-shell--compact-sidebar .sidebar--pinned .nav-item__label {
    position: static;
    width: auto;
    height: auto;
    margin: 0;
    overflow: visible;
    clip: auto;
  }
  .app-shell--compact-sidebar .sidebar:not(:hover):not(.sidebar--pinned) .sidebar__brand,
  .app-shell--compact-sidebar .sidebar:not(:hover):not(.sidebar--pinned) .nav-item { justify-content: center; }
  .app-shell--compact-sidebar .sidebar:not(:hover):not(.sidebar--pinned) .nav-item { padding-inline: 0; }
}
```

在该块后追加以下精确规则，确保键盘焦点可见：

```css
.sidebar__toggle:hover { background: #f1f4f8; }
.sidebar__toggle:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }
```

不要使用 `display: none` 隐藏导航链接或 `.nav-item__label`；收起时必须使用上述视觉隐藏规则，以保留链接的可访问名称。

- [ ] **Step 5: 运行新增浏览器测试并确认 GREEN**

运行：

```powershell
corepack pnpm exec playwright test tests/e2e/navigation/sidebar.spec.ts
```

预期：原有 logo 与导航测试，以及新增 1180px、1181px、820px 断点交互测试全部通过。

- [ ] **Step 6: 运行所有紧凑侧栏相关单元与浏览器测试**

运行：

```powershell
corepack pnpm exec vitest run tests/unit/web/compact-sidebar.test.ts tests/unit/web/mobile-navigation.test.ts
corepack pnpm exec playwright test tests/e2e/navigation/sidebar.spec.ts tests/e2e/mobile/mobile-viewport-matrix.spec.ts
```

预期：紧凑侧栏测试、移动导航契约和手机/821px 边界测试全部通过。

- [ ] **Step 7: 提交 UI 与回归测试**

```bash
git add apps/web/src/components/AppShell.tsx apps/web/src/styles.css tests/e2e/navigation/sidebar.spec.ts
git commit -m "feat(web): add compact desktop sidebar"
```

## Final Verification

- [ ] 运行 `corepack pnpm typecheck`。
- [ ] 运行 `corepack pnpm test`。
- [ ] 运行 `corepack pnpm build`。
- [ ] 运行 `corepack pnpm test:e2e`。
- [ ] 运行 `git diff --check`，并确认只包含本计划的产品代码、测试与规格/计划文档；保留用户已有的未跟踪文件。
