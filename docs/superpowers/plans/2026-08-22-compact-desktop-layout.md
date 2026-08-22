# 紧凑桌面布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在企业微信中等宽度窗口中为仓库系统提供可固定展开的 64px 紧凑侧栏，并稳定顶部栏和首页网格，同时不影响现有手机导航。

**Architecture:** `AppShell` 仅保存本次页面生命周期内的“固定展开”布尔状态，并将该状态映射为根节点 CSS 类和切换按钮的 `aria-expanded`。CSS 媒体查询负责 `821px–1180px` 的紧凑呈现、悬停/焦点临时展开、固定展开后的工作区留边、顶部栏收紧以及首页网格重排；`<=820px` 仍由现有 `useMobileViewport` 和手机组件树处理。

**Tech Stack:** React 19、TypeScript、Vite 6、CSS 媒体查询、Playwright、Vitest、pnpm 11、PowerShell。

## Global Constraints

- `>=1181px` 保持完整 `232px` 侧栏；`821px–1180px` 默认 `64px` 紧凑侧栏；`<=820px` 保持手机底部导航。
- 悬停或键盘焦点仅临时把紧凑侧栏以浮层展开到 `232px`，工作区仍保持 `64px` 留边。
- 点击顶部按钮固定展开；固定后工作区切换为 `232px` 留边，直到再次点击该按钮收起。
- 固定展开状态只保存在 React 内存中；不得写入 `localStorage`、`sessionStorage`、URL 或服务端。
- 导航 URL、角色权限、API、数据库、企业微信配置和固定资产项目均不得改变。
- 不执行 Push、部署、生产数据库、生产 Secret 或企业微信后台操作。
- 不恢复、删除、清理或提交 `stash@{0}`、`.tmp_ppt/`、既有未跟踪计划文档或演示资料。

---

## File Structure

- `apps/web/src/components/AppShell.tsx` — 紧凑侧栏固定展开 React 状态、切换按钮、根节点状态类和导航标签。
- `apps/web/src/styles.css` — 紧凑桌面断点、侧栏临时/固定展开、工作区留边、顶部栏收紧和首页网格规则。
- `tests/e2e/navigation/sidebar.spec.ts` — Playwright 回归测试，覆盖 `1180px` 断点、固定展开/收起、刷新默认收起、`1181px` 完整侧栏与 `820px` 手机树。
- `PROJECT_STATUS.md` — 本地实现范围、验证证据和“尚未部署”状态。
- `docs/项目状态与发布交接.md` — 简明的本地交接记录和线上未变更边界。

### Task 1: 紧凑侧栏的固定展开行为

**Files:**

- Modify: `tests/e2e/navigation/sidebar.spec.ts`
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**

- Consumes: 现有 `AppShell` 导航项、`useMobileViewport()` 的 `<=820px` 挂载边界和本地登录帮助函数 `loginAs(page, returnTo, role)`。
- Produces: `.sidebar__toggle` 按钮、`.app-shell--sidebar-pinned` 根状态类、`aria-expanded` 状态，以及在中等宽度可验证的 `64px` / `232px` 侧栏和工作区留边。

- [ ] **Step 1: 先写会失败的 Playwright 行为测试**

  在 `tests/e2e/navigation/sidebar.spec.ts` 导入 `loginAs`，并新增以下测试与局部布局读取函数：

  ```ts
  import { apiUrl, loginAs } from "../mobile/mobile-test-helpers";

  async function compactLayout(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>(".sidebar");
      const workspace = document.querySelector<HTMLElement>(".workspace");
      if (!sidebar || !workspace) throw new Error("workspace shell is missing");
      return {
        sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
        workspaceLeft: Math.round(workspace.getBoundingClientRect().left),
      };
    });
  }

  test("1180px compact sidebar hovers temporarily and pins only after a click", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await loginAs(page, "/", "ADMIN");

    const sidebar = page.locator(".sidebar");
    const toggle = page.locator(".sidebar__toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 64, workspaceLeft: 64 });

    await sidebar.hover();
    await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 64 });
    await page.mouse.move(1100, 820);
    await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 64, workspaceLeft: 64 });

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 232 });
    await page.mouse.move(1100, 820);
    await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 232 });

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 64, workspaceLeft: 64 });

    await toggle.click();
    await page.reload();
    await expect(page.locator(".sidebar__toggle")).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 64, workspaceLeft: 64 });
  });

  test("desktop and mobile navigation remain on their existing boundaries", async ({ page }) => {
    await page.setViewportSize({ width: 1181, height: 900 });
    await loginAs(page, "/", "ADMIN");
    await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 232 });
    await expect(page.locator(".sidebar__toggle")).toBeHidden();

    await page.setViewportSize({ width: 820, height: 900 });
    await expect(page.getByRole("navigation", { name: "手机任务导航" })).toBeVisible();
    await expect(page.locator(".sidebar")).toHaveCount(0);
  });
  ```

- [ ] **Step 2: 运行新测试并确认 RED**

  Run:

  ```powershell
  corepack pnpm exec playwright test tests/e2e/navigation/sidebar.spec.ts
  ```

  Expected: 新增的 `1180px` 测试失败，因为当前页面没有 `.sidebar__toggle`，且当前侧栏与工作区均为 `232px`；已有侧栏回归测试继续通过。

- [ ] **Step 3: 在壳层中加入最小固定展开状态和无障碍按钮**

  在 `apps/web/src/components/AppShell.tsx`：

  ```tsx
  import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

  const [compactSidebarPinned, setCompactSidebarPinned] = useState(false);

  <div className={`app-shell mobile-app-frame${compactSidebarPinned ? " app-shell--sidebar-pinned" : ""}`}>
    {!isMobileViewport ? <aside className="sidebar">
      <div className="sidebar__brand">
        <LogoMark />
        <button
          className="sidebar__toggle"
          type="button"
          aria-label={compactSidebarPinned ? "收起导航" : "展开导航"}
          aria-expanded={compactSidebarPinned}
          onClick={() => setCompactSidebarPinned((pinned) => !pinned)}
        >
          {compactSidebarPinned ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>
      {/* existing navigation */}
    </aside> : null}
  </div>
  ```

  保留现有导航文字作为链接的可访问名称，并为每个桌面端导航链接增加 `title={label}`，供仅图标状态的鼠标悬停提示使用。不要读取或写入任意 Web Storage；刷新自然重新初始化为 `false`。

- [ ] **Step 4: 添加实现该交互所需的最小 CSS**

  在 `apps/web/src/styles.css` 的现有桌面壳层规则之后、`@media (max-width: 820px)` 之前添加：

  ```css
  .sidebar__toggle { display: none; }

  @media (min-width: 821px) and (max-width: 1180px) {
    .sidebar { width: 64px; z-index: 20; transition: width .18s ease, box-shadow .18s ease; }
    .workspace { margin-left: 64px; transition: margin-left .18s ease; }
    .sidebar:hover, .sidebar:focus-within, .app-shell--sidebar-pinned .sidebar {
      width: 232px;
      box-shadow: 16px 0 32px rgba(24, 32, 56, .18);
    }
    .app-shell--sidebar-pinned .workspace { margin-left: 232px; }
    .sidebar__brand { padding: 5px 0; flex-direction: column; justify-content: center; gap: 3px; }
    .sidebar__brand .logo-mark { width: 34px; height: 30px; }
    .sidebar__toggle { display: inline-grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--navy); }
    .sidebar:hover .sidebar__brand, .sidebar:focus-within .sidebar__brand, .app-shell--sidebar-pinned .sidebar__brand { padding: 0 12px; flex-direction: row; justify-content: space-between; }
    .sidebar:hover .sidebar__brand .logo-mark, .sidebar:focus-within .sidebar__brand .logo-mark, .app-shell--sidebar-pinned .sidebar__brand .logo-mark { width: 190px; height: 60px; }
    .nav-item { justify-content: center; padding-inline: 0; }
    .nav-item > span, .sidebar__footer { opacity: 0; width: 0; overflow: hidden; pointer-events: none; }
    .sidebar:hover .nav-item, .sidebar:focus-within .nav-item, .app-shell--sidebar-pinned .nav-item { justify-content: flex-start; padding-inline: 13px; }
    .sidebar:hover .nav-item > span, .sidebar:focus-within .nav-item > span, .app-shell--sidebar-pinned .nav-item > span,
    .sidebar:hover .sidebar__footer, .sidebar:focus-within .sidebar__footer, .app-shell--sidebar-pinned .sidebar__footer { opacity: 1; width: auto; pointer-events: auto; }
  }
  ```

  Keep the existing `@media (max-width: 820px)` override after this block so the mobile component tree and zero workspace margin remain authoritative at the inclusive mobile boundary.

- [ ] **Step 5: 运行新旧侧栏测试并确认 GREEN**

  Run:

  ```powershell
  corepack pnpm exec playwright test tests/e2e/navigation/sidebar.spec.ts
  ```

  Expected: 侧栏测试全部通过；`1180px` 默认 64px、悬停展开不改变工作区、点击固定 232px、再次点击收起、刷新默认收起、`1181px` 完整侧栏和 `820px` 手机导航均符合断言。

- [ ] **Step 6: 提交自包含的交互实现**

  ```powershell
  git add apps/web/src/components/AppShell.tsx apps/web/src/styles.css tests/e2e/navigation/sidebar.spec.ts
  git commit -m "feat(web): add compact sidebar state"
  ```

  Expected: 只提交壳层、样式和侧栏回归测试；不暂存既有未跟踪资料。

### Task 2: 收紧中等桌面顶部栏和首页网格

**Files:**

- Modify: `tests/e2e/navigation/sidebar.spec.ts`
- Modify: `apps/web/src/styles.css`

**Interfaces:**

- Consumes: Task 1 的 `.app-shell--sidebar-pinned`、`.sidebar__toggle`、`64px` / `232px` 工作区留边和现有 `.topbar`、`.metric-strip`、`.dashboard-grid`。
- Produces: 在 `980px` 和 `1180px` 可计算验证的无横向溢出顶部栏与首页网格；不新增 JavaScript 断点或业务状态。

- [ ] **Step 1: 为中等窗口网格和溢出写失败测试**

  在同一测试文件新增：

  ```ts
  test("compact desktop keeps the topbar and dashboard readable without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 980, height: 900 });
    await loginAs(page, "/", "ADMIN");

    const narrow = await page.evaluate(() => {
      const metricStrip = document.querySelector<HTMLElement>(".metric-strip");
      const dashboard = document.querySelector<HTMLElement>(".dashboard-grid");
      const topbar = document.querySelector<HTMLElement>(".topbar");
      if (!metricStrip || !dashboard || !topbar) throw new Error("dashboard layout is missing");
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        topbarHeight: Math.round(topbar.getBoundingClientRect().height),
        metricColumns: getComputedStyle(metricStrip).gridTemplateColumns.split(" ").length,
        dashboardColumns: getComputedStyle(dashboard).gridTemplateColumns.split(" ").length,
      };
    });

    expect(narrow).toEqual({ overflow: false, topbarHeight: 74, metricColumns: 2, dashboardColumns: 1 });

    await page.setViewportSize({ width: 1180, height: 900 });
    const wide = await page.evaluate(() => {
      const metricStrip = document.querySelector<HTMLElement>(".metric-strip");
      const dashboard = document.querySelector<HTMLElement>(".dashboard-grid");
      if (!metricStrip || !dashboard) throw new Error("dashboard layout is missing");
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        metricColumns: getComputedStyle(metricStrip).gridTemplateColumns.split(" ").length,
        dashboardColumns: getComputedStyle(dashboard).gridTemplateColumns.split(" ").length,
      };
    });

    expect(wide).toEqual({ overflow: false, metricColumns: 4, dashboardColumns: 1 });
  });
  ```

- [ ] **Step 2: 运行新测试并确认 RED**

  Run:

  ```powershell
  corepack pnpm exec playwright test tests/e2e/navigation/sidebar.spec.ts
  ```

  Expected: 新的 `980px` 断言失败，因为当前中等宽度仍使用四列指标与双列首页面板，且当前 `max-width: 1080px` 顶部栏会换行。

- [ ] **Step 3: 添加流式间距、顶部栏收紧和首页重排 CSS**

  在 `styles.css` 的紧凑桌面媒体查询中加入以下规则，并让它们出现在既有 `@media (max-width: 1080px)` 规则之后，以覆盖该规则的换行行为：

  ```css
  @media (min-width: 821px) and (max-width: 1180px) {
    .topbar { height: 74px; min-height: 74px; padding-inline: clamp(16px, 2vw, 24px); flex-wrap: nowrap; gap: 12px; }
    .topbar__leading { min-width: 0; flex: 0 1 auto; gap: 8px; flex-wrap: nowrap; }
    .topbar__crumb span { display: none; }
    .topbar__center { min-width: 0; flex: 1 1 260px; }
    .topbar__actions { flex: 0 0 auto; gap: 6px; }
    .topbar-selector { min-width: 0; max-width: 190px; overflow: hidden; }
    .topbar-selector span, .workspace-user-button strong, .workspace-user-button small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .workspace-user-button { min-width: 0; padding-inline: 8px; }
    .main-content { padding: clamp(18px, 2.5vw, 26px) clamp(18px, 3vw, 30px) 44px; }
    .dashboard-grid { grid-template-columns: minmax(0, 1fr); }
  }

  @media (min-width: 821px) and (max-width: 980px) {
    .topbar__crumb { display: none; }
    .topbar-selector { max-width: 158px; }
    .workspace-user-button span { display: none; }
    .metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metric { padding: 16px; }
    .metric:nth-child(2n) { border-right: 0; }
    .metric:nth-child(n + 3) { border-top: 1px solid var(--border); }
  }
  ```

  Preserve the existing `max-width: 820px` metric card treatment and existing mobile bottom-navigation rules. Do not change table data, page routes or role conditionals.

- [ ] **Step 4: 运行侧栏测试并检查视觉断点**

  Run:

  ```powershell
  corepack pnpm exec playwright test tests/e2e/navigation/sidebar.spec.ts
  ```

  Expected: 新旧侧栏测试均通过；`980px` 为两列指标和单列面板，`1180px` 为四列指标和单列面板，两个宽度均没有页面级横向溢出。

  In a local browser, visually inspect `820px`、`980px`、`1180px` 和 `1440px`：确认紧凑状态、悬停浮层、点击固定、顶栏截断、卡片文字和常用表单均可读。

- [ ] **Step 5: 提交布局收敛**

  ```powershell
  git add apps/web/src/styles.css tests/e2e/navigation/sidebar.spec.ts
  git commit -m "fix(web): stabilize compact desktop layout"
  ```

  Expected: 只提交中等桌面布局 CSS 与对应 E2E 回归测试。

### Task 3: 完整本地验证与交接记录

**Files:**

- Modify: `PROJECT_STATUS.md`
- Modify: `docs/项目状态与发布交接.md`

**Interfaces:**

- Consumes: Task 1 和 Task 2 已提交的前端实现及新鲜验证输出。
- Produces: 对本地紧凑桌面布局范围、验证结果和未部署边界的准确交接记录。

- [ ] **Step 1: 运行针对性、完整和构建门禁**

  Run:

  ```powershell
  corepack pnpm exec playwright test tests/e2e/navigation/sidebar.spec.ts
  corepack pnpm test
  corepack pnpm typecheck
  corepack pnpm build
  git diff --check
  ```

  Expected: 每个命令退出码为 `0`。若出现失败，停止文档更新和提交，先按 `superpowers:systematic-debugging` 定位根因并新增或修正回归测试；不得把失败描述为通过。

- [ ] **Step 2: 在两份交接文档记录实际本地结果**

  在 `PROJECT_STATUS.md` 添加带日期的记录，说明：`821px–1180px` 默认 64px 图标侧栏、悬停临时覆盖、点击固定为 232px 并让内容同步留边、再次点击收起、刷新默认收起、`<=820px` 手机导航未改；同时记录 Step 1 的实际命令结果。明确写出未 Push、未部署、未修改生产数据库/Secret/企业微信配置。

  在 `docs/项目状态与发布交接.md` 添加简明对应条目：当前本地集成分支已包含该布局调整，服务器仍运行既有 `3f61393` 发布版本，任何线上发布仍需重新授权。

- [ ] **Step 3: 检查最终差异并提交交接记录**

  Run:

  ```powershell
  git diff --check
  git status --short --branch
  git add PROJECT_STATUS.md "docs/项目状态与发布交接.md"
  git diff --cached --check
  git commit -m "docs: record compact desktop layout"
  ```

  Expected: 所有 diff 检查无输出；提交只包含两份状态文档；`stash@{0}` 和既有未跟踪资料仍留在工作区且不在索引中。
