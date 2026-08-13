# 集团仓库管理系统手机端响应式适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不建立独立 App、不中断电脑端完整操作的前提下，让管理员能在企业微信内置浏览器完成库存查询、单物品单批次入库及四步式完整出库，并让财务获得只读移动查询与报表入口。

**Architecture:** 保留现有 React 应用、pathname 分发、Fastify API 和权限模型；将响应式判定、导航配置、库存检索、入库草稿、出库工作流及通知刷新拆为可单测的 TypeScript 接缝，再由桌面/移动呈现组件复用。`820px` 及以下只挂载移动交互树，以上只挂载桌面交互树；业务权威仍在服务端，手机草稿仅保存在按用户与业务隔离的 `sessionStorage`。

**Tech Stack:** React 19、TypeScript 5.9、Vite 6、Fastify 5、Prisma 7、Decimal.js、Lucide React、Vitest 3、Playwright 1.55、pnpm 11.20。

## Global Constraints

- 只在 `D:\桌面\仓库\.worktrees\mobile-responsive` 的 `codex/mobile-responsive` 分支实现；基线父提交必须是 `5f17963`。
- 原始 `feat/warehouse-system@270d7f8` 工作树及其 13 个未提交文件保持原样，不清理、不覆盖。
- 不建立独立原生 App、小程序、`/mobile` 路由或另一套 API；桌面端完整操作不退化。
- 视口宽度小于或等于 `820px` 使用移动呈现，大于 `820px` 使用桌面呈现；主要触控目标不小于 `44px × 44px`。
- 底部导航图标基准约 `18px`、标签约 `12px`，正文操作图标约 `18px`、标签约 `13px`，视觉重量保持接近。
- 管理员移动导航为“首页、查询、入库、出库、更多”；财务为“首页、查询、报表、更多”；申请人不进入仓库后台。
- 入库一次只登记一个物品和一个批次；出库支持多物品、多仓库、多批次、少出/零出与待办取消。
- 草稿只使用 `sessionStorage`，键包含版本、用户和业务标识；不保存凭证或生产 Secret，不做服务端/跨设备草稿。
- 不修改或输出生产 Secret，不连接生产数据库，不直接部署服务器。
- 不新增运行时依赖；精确金额统一复用现有 `decimal.js`。
- 正式验证使用 Node 24+。本地 Prisma Client 先用无真实数据库的构建占位 URL执行 `prisma generate`。
- Docker 恢复前，不把 Docker 相关测试描述为已通过；恢复后必须先验证 VM、镜像访问与新 worktree 只读挂载。
- Task 1–7 每个行为变更都必须使用 `superpowers:test-driven-development`，先观察目标测试 RED，再写最小实现得到 GREEN，之后才能重构与提交。
- Task 8 在任何“完成、通过、可验收”声明前必须使用 `superpowers:verification-before-completion`，依据本轮新鲜完整输出陈述结果。
- Task 8 合并决策前必须使用 `superpowers:requesting-code-review`；收到意见后先使用 `superpowers:receiving-code-review` 验证意见再修改。

---

## File Structure

### 移动基础设施

- `apps/web/src/features/mobile/mobile-navigation.ts`：角色导航、活动项和电脑端能力提示的纯配置。
- `apps/web/src/features/mobile/use-mobile-viewport.ts`：唯一的 `matchMedia('(max-width: 820px)')` 订阅接缝。
- `apps/web/src/features/mobile/MobileBottomNav.tsx`：管理员/财务底部导航与“更多”按钮。
- `apps/web/src/features/mobile/MobileMoreSheet.tsx`：用户信息、登录渠道和电脑端能力说明。
- `apps/web/src/components/ModalDialog.tsx`：入库确认、出库确认和取消确认共用的可访问弹窗。

### 查询与首页

- `apps/web/src/features/inventory/inventory-api.ts`：库存查询类型和 fetch 客户端。
- `apps/web/src/pages/InventoryQueryPage.tsx`：`/admin/inventory` 页面；桌面列表、移动卡片共用一份请求状态。
- `apps/web/src/pages/DashboardPage.tsx`：从 `App.tsx` 移出首页呈现；保留桌面布局并增加已确认的移动首页。

### 入库

- `apps/web/src/features/drafts/session-draft.ts`：版本化、用户隔离的 session 草稿读写。
- `apps/web/src/features/inbound/inbound-form.ts`：表单类型、Decimal 金额、校验、成功重置规则。
- `apps/web/src/pages/InboundPage.tsx`：共享数据加载/提交状态；桌面与移动呈现只挂载一套。

### 出库

- `apps/web/src/features/outbound/outbound-workflow.ts`：四步状态、分配汇总、原因校验、批次重校验与草稿键。
- `apps/web/src/features/outbound/MobileOutboundFlow.tsx`：选择、分配、复核、完成四步 UI及独立取消入口。
- `apps/web/src/features/outbound/DesktopOutboundTable.tsx`：从现有页面提取桌面表格，保持现有行为。
- `apps/web/src/pages/OutboundPage.tsx`：共享待办加载与提交协调器，根据唯一断点挂载一种呈现。

### 通知与集成

- `apps/web/src/features/notifications/notification-tasks.ts`：通知类型、有效跳转、30 秒轮询常量和业务完成事件。
- `apps/web/src/features/notifications/use-notification-tasks.ts`：进入、打开、visibility、业务完成和打开时轮询刷新。
- `apps/web/src/features/notifications/NotificationCenter.tsx`：桌面 popover 与移动 sheet 的任务呈现。
- `apps/api/src/application/inventory/notification-service.ts`：输出可渲染的 `/admin/outbound` 与 `/admin/inventory` 跳转。
- `apps/web/src/components/AppShell.tsx`、`apps/web/src/layouts/AdminLayout.tsx`、`apps/web/src/App.tsx`：接入拆分后的壳层、路由和页面。
- `apps/web/src/styles.css`：响应式 token、安全区、动态视口、卡片、表单、向导与窄屏溢出规则。

### 测试与状态

- `tests/unit/web/mobile-navigation.test.ts`：角色导航和 `820px` 规则。
- `tests/unit/web/session-draft.test.ts`：草稿版本、用户/业务隔离和清理。
- `tests/unit/web/inbound-form.test.ts`：金额、字段校验和成功保留。
- `tests/unit/web/outbound-workflow.test.ts`：四步、分配、原因、失效批次和 Decimal 汇总。
- `tests/unit/inventory/notification-service.test.ts`：任务生命周期和有效链接。
- `tests/e2e/mobile/mobile-shell.spec.ts`：导航、首页、更多和无横向溢出。
- `tests/e2e/mobile/mobile-test-helpers.ts`：通过现有本地认证入口建立管理员/财务浏览器会话。
- `tests/e2e/mobile/inventory-query.spec.ts`：查询卡片、价格权限和详情。
- `tests/e2e/mobile/inbound.spec.ts`：单页入库、二次确认、草稿和成功保留。
- `tests/e2e/mobile/outbound.spec.ts`：四步出库、返回编辑、库存冲突与取消。
- `tests/e2e/mobile/notification-tasks.spec.ts`：任务刷新、有效跳转和电脑端提示。
- `tests/e2e/navigation/dashboard.spec.ts`、`tests/e2e/navigation/workspace-tools.spec.ts`：桌面回归。
- `PROJECT_STATUS.md`：记录移动范围、基线、验证证据和未部署状态。

---

### Task 1: 建立可重复的本地基线与响应式/权限导航接缝

**Files:**
- Create: `apps/web/src/features/mobile/mobile-navigation.ts`
- Create: `apps/web/src/features/mobile/use-mobile-viewport.ts`
- Create: `tests/unit/web/mobile-navigation.test.ts`

**Interfaces:**
- Produces: `MOBILE_MEDIA_QUERY = '(max-width: 820px)'`。
- Produces: `getMobileNavigation(role: 'ADMIN' | 'FINANCE'): readonly MobileNavigationItem[]`。
- Produces: `isMobileNavigationActive(pathname: string, item: MobileNavigationItem): boolean`。
- Produces: `useMobileViewport(): boolean`，首次读取 `matchMedia().matches` 并订阅 `change`。

- [x] **Step 1: 准备 Node 24 和 Prisma Client，并记录当前非 Docker 基线**

Run in PowerShell:

```powershell
Set-Location -LiteralPath 'D:\桌面\仓库\.worktrees\mobile-responsive'
$runtimeNode = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$env:PATH = "$runtimeNode;$env:PATH"
node --version
$env:DATABASE_URL = 'postgresql://build:build@127.0.0.1:5432/build'
corepack pnpm exec prisma generate
Remove-Item Env:DATABASE_URL
corepack pnpm typecheck
```

Expected: Node 输出 `v24` 或更高；Prisma 生成成功；类型检查退出码为 0。若类型检查失败，先记录真实基线并停止功能修改，使用 `superpowers:systematic-debugging` 处理。

- [x] **Step 2: 写角色导航失败测试**

```ts
import { describe, expect, it } from "vitest";
import { getMobileNavigation, isMobileNavigationActive, MOBILE_MEDIA_QUERY } from "../../../apps/web/src/features/mobile/mobile-navigation";

describe("mobile navigation", () => {
  it("gives admins the five approved task entries", () => {
    expect(getMobileNavigation("ADMIN").map((item) => item.label)).toEqual(["首页", "查询", "入库", "出库", "更多"]);
  });

  it("removes mutation entries for finance", () => {
    expect(getMobileNavigation("FINANCE").map((item) => item.label)).toEqual(["首页", "查询", "报表", "更多"]);
  });

  it("uses the inclusive 820px boundary and exact route matching", () => {
    expect(MOBILE_MEDIA_QUERY).toBe("(max-width: 820px)");
    const inventory = getMobileNavigation("ADMIN").find((item) => item.label === "查询")!;
    expect(isMobileNavigationActive("/admin/inventory", inventory)).toBe(true);
    expect(isMobileNavigationActive("/admin/items", inventory)).toBe(false);
  });
});
```

- [x] **Step 3: 运行测试确认 RED**

Run: `corepack pnpm vitest run tests/unit/web/mobile-navigation.test.ts`

Expected: FAIL，原因是 `mobile-navigation.ts` 尚不存在。

- [x] **Step 4: 实现最小导航配置与断点 hook**

```ts
// apps/web/src/features/mobile/mobile-navigation.ts
export const MOBILE_MEDIA_QUERY = "(max-width: 820px)";

export type MobileNavigationItem = {
  label: "首页" | "查询" | "入库" | "出库" | "报表" | "更多";
  href?: string;
  action?: "more";
};

const adminItems: readonly MobileNavigationItem[] = [
  { label: "首页", href: "/" },
  { label: "查询", href: "/admin/inventory" },
  { label: "入库", href: "/admin/inbound" },
  { label: "出库", href: "/admin/outbound" },
  { label: "更多", action: "more" },
];

const financeItems: readonly MobileNavigationItem[] = [
  { label: "首页", href: "/" },
  { label: "查询", href: "/admin/inventory" },
  { label: "报表", href: "/admin/reports" },
  { label: "更多", action: "more" },
];

export function getMobileNavigation(role: "ADMIN" | "FINANCE"): readonly MobileNavigationItem[] {
  return role === "ADMIN" ? adminItems : financeItems;
}

export function isMobileNavigationActive(pathname: string, item: MobileNavigationItem): boolean {
  if (!item.href) return false;
  return item.href === "/" ? pathname === "/" : pathname === item.href;
}
```

```ts
// apps/web/src/features/mobile/use-mobile-viewport.ts
import { useEffect, useState } from "react";
import { MOBILE_MEDIA_QUERY } from "./mobile-navigation";

export function useMobileViewport(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_MEDIA_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return mobile;
}
```

- [x] **Step 5: 运行 GREEN 与类型检查**

Run:

```powershell
corepack pnpm vitest run tests/unit/web/mobile-navigation.test.ts
corepack pnpm --filter @warehouse/web typecheck
```

Expected: 3 tests PASS；web 类型检查退出码 0。

- [x] **Step 6: 提交接缝**

```powershell
git add apps/web/src/features/mobile/mobile-navigation.ts apps/web/src/features/mobile/use-mobile-viewport.ts tests/unit/web/mobile-navigation.test.ts
git commit -m "test: define mobile navigation boundary"
```

---

### Task 2: 实现底部导航、更多面板和移动壳层

**Files:**
- Create: `apps/web/src/features/mobile/MobileBottomNav.tsx`
- Create: `apps/web/src/features/mobile/MobileMoreSheet.tsx`
- Create: `apps/web/src/components/ModalDialog.tsx`
- Create: `tests/e2e/mobile/mobile-shell.spec.ts`
- Create: `tests/e2e/mobile/mobile-test-helpers.ts`
- Modify: `apps/web/src/components/AppShell.tsx:1-492`
- Modify: `apps/web/src/layouts/AdminLayout.tsx:6-28`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `getMobileNavigation()`、`isMobileNavigationActive()`、`useMobileViewport()`。
- Produces: `MobileBottomNav({ role, pathname, onOpenMore })`。
- Produces: `MobileMoreSheet({ open, user, loginChannel, onClose })`。
- Produces: `ModalDialog({ open, title, children, confirmLabel?, dangerous?, busy?, onConfirm?, onClose })`；`MobileMoreSheet` 复用它的 dismiss-only 模式，后续业务弹窗复用确认模式。

- [x] **Step 1: 写移动壳层 E2E 失败测试**

```ts
import { expect, test } from "@playwright/test";
import { loginAs } from "./mobile-test-helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("admin gets task navigation with balanced icon and label sizes", async ({ page }) => {
  await loginAs(page, "/", "ADMIN");
  const nav = page.getByRole("navigation", { name: "手机任务导航" });
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(nav.getByRole("button", { name: "更多" })).toBeVisible();
  await expect(nav).toContainText("首页查询入库出库更多");
  const sizing = await nav.evaluate((node) => {
    const icon = node.querySelector("svg")!;
    const label = node.querySelector("span")!;
    return { icon: icon.getBoundingClientRect().width, label: getComputedStyle(label).fontSize };
  });
  expect(sizing.icon).toBe(18);
  expect(sizing.label).toBe("12px");
});

test("more sheet explains desktop-only work without horizontal overflow", async ({ page }) => {
  await loginAs(page, "/", "ADMIN");
  await page.getByRole("button", { name: "更多" }).click();
  await expect(page.getByRole("dialog", { name: "更多功能" })).toContainText("调拨");
  await expect(page.getByRole("dialog", { name: "更多功能" })).toContainText("电脑端");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("finance gets query and report navigation without inventory mutations", async ({ page }) => {
  await loginAs(page, "/", "FINANCE");
  const nav = page.getByRole("navigation", { name: "手机任务导航" });
  await expect(nav).toContainText("首页查询报表更多");
  await expect(nav).not.toContainText("入库");
  await expect(nav).not.toContainText("出库");
});
```

```ts
// tests/e2e/mobile/mobile-test-helpers.ts
import type { Page } from "@playwright/test";

export async function loginAs(page: Page, returnTo: string, role: "ADMIN" | "FINANCE"): Promise<void> {
  await page.goto(`http://127.0.0.1:3001/auth/local?returnTo=${encodeURIComponent(returnTo)}&role=${role}`);
}
```

- [x] **Step 2: 运行测试确认 RED**

Run: `corepack pnpm playwright test tests/e2e/mobile/mobile-shell.spec.ts`

Expected: FAIL，页面没有“手机任务导航”。

- [x] **Step 3: 实现移动导航与更多面板**

`MobileBottomNav` 使用 `Home`、`Search`、`PackagePlus`、`PackageCheck`、`BarChart3`、`Ellipsis`，统一传入 `size={18}`、`strokeWidth={1.8}`；链接最小高度 `56px`，外层附加 `padding-bottom: env(safe-area-inset-bottom)`。“更多”是 button，不伪造 URL。

`MobileMoreSheet` 组合 `ModalDialog` 的 dismiss-only 模式，显示用户、角色、登录渠道，以及“调拨、盘点、月结、主数据维护请在电脑端处理”。`ModalDialog` 统一提供 `role="dialog"`、`aria-modal="true"`、初始焦点、焦点循环、body 滚动锁、Escape/遮罩/关闭按钮和触发点焦点恢复；传入 `confirmLabel` 时才渲染确认按钮。

`AppShell` 在 `useMobileViewport()` 为 true 时挂载 `MobileBottomNav`，隐藏桌面侧边栏与汉堡抽屉；为 false 时保留原侧边栏和桌面 topbar。不要同时渲染移动抽屉和底部导航。

- [x] **Step 4: 增加动态视口、安全区与触控 CSS**

```css
:root { --mobile-nav-height: 56px; }

.mobile-app-frame { min-height: 100vh; min-height: 100dvh; }
.mobile-bottom-nav { display: none; }

@media (max-width: 820px) {
  .sidebar, .mobile-nav-toggle { display: none; }
  .workspace { min-width: 0; min-height: 100vh; min-height: 100dvh; }
  .main-content { padding: 16px 16px calc(var(--mobile-nav-height) + env(safe-area-inset-bottom) + 16px); }
  .mobile-bottom-nav {
    position: fixed; inset: auto 0 0; z-index: 40;
    display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
    min-height: var(--mobile-nav-height);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .mobile-bottom-nav a, .mobile-bottom-nav button {
    min-width: 44px; min-height: 56px; font-size: 12px;
  }
  .mobile-bottom-nav svg { width: 18px; height: 18px; }
  input, select, textarea { font-size: 16px; }
}
```

- [x] **Step 5: 运行 320/390/430/820 和桌面回归**

Run:

```powershell
corepack pnpm playwright test tests/e2e/mobile/mobile-shell.spec.ts
corepack pnpm playwright test tests/e2e/navigation/workspace-tools.spec.ts
corepack pnpm --filter @warehouse/web typecheck
```

Expected: 移动测试与现有桌面壳层测试 PASS；类型检查退出码 0。

- [x] **Step 6: 提交移动壳层**

```powershell
git add apps/web/src/features/mobile apps/web/src/components/ModalDialog.tsx apps/web/src/components/AppShell.tsx apps/web/src/layouts/AdminLayout.tsx apps/web/src/styles.css tests/e2e/mobile/mobile-test-helpers.ts tests/e2e/mobile/mobile-shell.spec.ts
git commit -m "feat: add role-aware mobile application shell"
```

---

### Task 3: 增加移动首页和库存/批次查询页

**Files:**
- Create: `apps/web/src/features/inventory/inventory-api.ts`
- Create: `apps/web/src/pages/InventoryQueryPage.tsx`
- Create: `apps/web/src/pages/DashboardPage.tsx`
- Create: `tests/e2e/mobile/inventory-query.spec.ts`
- Modify: `apps/web/src/App.tsx:18-293`
- Modify: `apps/web/src/components/AppShell.tsx:8-27,105-147,220-223,351-406`
- Modify: `apps/web/src/styles.css`
- Modify: `tests/e2e/navigation/dashboard.spec.ts`
- Modify: `tests/e2e/navigation/workspace-tools.spec.ts`

**Interfaces:**
- Produces: `InventorySearchResult`、`InventorySearchLocation`。
- Produces: `searchInventory({ query, warehouseId, signal }): Promise<InventorySearchResult[]>`。
- Produces: `InventoryQueryPage({ warehouseId, role })`，role 仅允许 `ADMIN | FINANCE`。
- Produces: `DashboardPage({ cards, loading, role })`；同一数据输入下选择移动或桌面呈现。

- [x] **Step 1: 写查询页面失败测试**

```ts
import { loginAs } from "./mobile-test-helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("inventory search renders warehouse and batch cards with cost for admin", async ({ page }) => {
  await page.route(/\/admin\/reports\/inventory-search.*/, (route) => route.fulfill({
    json: [{
      itemId: "item-1", code: "TEA-001", name: "接待茶叶", unit: "盒",
      totalQuantity: "12", totalAmount: "240.00",
      locations: [{ warehouseId: "wh-1", warehouseName: "北京总仓", batchId: "batch-1", batchNo: "B-001", quantity: "12", unitCost: "20", amount: "240.00" }],
    }],
  }));
  await loginAs(page, "/admin/inventory?query=TEA", "ADMIN");
  await expect(page.getByRole("article", { name: /TEA-001/ })).toContainText("北京总仓");
  await expect(page.getByRole("article", { name: /TEA-001/ })).toContainText("批次 B-001");
  await expect(page.getByRole("article", { name: /TEA-001/ })).toContainText("单价 20");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
```

- [x] **Step 2: 运行确认 RED**

Run: `corepack pnpm playwright test tests/e2e/mobile/inventory-query.spec.ts`

Expected: FAIL，`/admin/inventory` 尚未分发 `InventoryQueryPage`。

- [x] **Step 3: 提取库存客户端并实现语义查询页**

```ts
export async function searchInventory(input: {
  query: string;
  warehouseId: string;
  signal?: AbortSignal;
}): Promise<InventorySearchResult[]> {
  const params = new URLSearchParams({ query: input.query.trim(), warehouseId: input.warehouseId });
  const response = await fetch(`${apiBaseUrl}/admin/reports/inventory-search?${params}`, {
    credentials: "include",
    signal: input.signal,
  });
  if (!response.ok) throw new Error("库存查询加载失败");
  return response.json() as Promise<InventorySearchResult[]>;
}
```

`InventoryQueryPage` 从 `window.location.search` 读取初始 `query`，250ms 防抖，仓库变化中止旧请求；移动端每个物品一个 `article`、每个 location 一个批次组，桌面端用表格。管理员和财务都显示价格/金额，因为现有 API 只对这两个角色开放；申请人仍在 App 权限门禁之前被拒绝。

顶部全局搜索复用 `searchInventory()`；结果点击改为 `/admin/inventory?query=<code>`，不再跳到主数据 `/admin/items`。

`App` 的财务分发顺序固定为：`/admin/inventory` 渲染 `InventoryQueryPage`，`/admin/reports` 渲染 `ReportsPage`，其他路径才渲染只读能力说明。管理员在 `/admin/inventory` 渲染相同查询页，避免现有财务 fallback 提前截断查询路由。

- [x] **Step 4: 从 App 提取首页并实现已确认移动层级**

移动首页只呈现：仓库选择、问候、统一搜索、同一白色面板内的“手机入库/实际出库”、紧凑“今日概览”和轻提示。图标统一 `18px`，正文标签 `13px`，不复用当前 26/28px 大图标。`App` 的 dashboard 请求在现有四个请求之外增加一次 `/admin/notifications`：`PENDING_OUTBOUND` 映射待出库数、`LOW_STOCK` 条目数映射低库存、现有 active items 映射库存品类、通知数组长度映射通知数；Task 6 再把这次读取收敛到统一任务 hook。桌面首页保留原四指标、快捷入口和运行状态。

财务首页只显示查询与报表快捷入口，不发起 `/admin/items`、`/admin/outbound/pending` 等管理员请求。

- [x] **Step 5: 运行查询、首页与桌面回归**

Run:

```powershell
corepack pnpm playwright test tests/e2e/mobile/inventory-query.spec.ts tests/e2e/mobile/mobile-shell.spec.ts
corepack pnpm playwright test tests/e2e/navigation/dashboard.spec.ts tests/e2e/navigation/workspace-tools.spec.ts
corepack pnpm --filter @warehouse/web typecheck
```

Expected: 新移动查询/首页 PASS；原桌面 dashboard/workspace 工具 PASS；类型检查退出码 0。

- [x] **Step 6: 提交首页与查询**

```powershell
git add apps/web/src/features/inventory apps/web/src/pages/InventoryQueryPage.tsx apps/web/src/pages/DashboardPage.tsx apps/web/src/App.tsx apps/web/src/components/AppShell.tsx apps/web/src/styles.css tests/e2e/mobile/inventory-query.spec.ts tests/e2e/navigation/dashboard.spec.ts tests/e2e/navigation/workspace-tools.spec.ts
git commit -m "feat: add mobile inventory search and dashboard"
```

---

### Task 4: 用单页分组式实现可恢复的手机入库

**Files:**
- Create: `apps/web/src/features/drafts/session-draft.ts`
- Create: `apps/web/src/features/inbound/inbound-form.ts`
- Create: `tests/unit/web/session-draft.test.ts`
- Create: `tests/unit/web/inbound-form.test.ts`
- Create: `tests/e2e/mobile/inbound.spec.ts`
- Modify: `apps/web/src/pages/InboundPage.tsx:1-95`
- Modify: `apps/web/src/App.tsx:162-218`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: `readSessionDraft<T>(storage, key, expectedUserId, version): T | null`。
- Produces: `writeSessionDraft<T>(storage, key, envelope)` 与 `clearSessionDraft(storage, key)`。
- Produces: `InboundDraft`、`createInboundDraft(today)`、`calculateInboundAmount()`、`validateInboundDraft()`、`reconcileInboundDraft()`、`resetInboundAfterSuccess()`。
- Consumes: `ModalDialog` 和 `useMobileViewport()`。

- [x] **Step 1: 写草稿和入库规则失败测试**

```ts
const validInbound = {
  warehouseId: "wh-1",
  itemId: "item-1",
  batchNo: "B-001",
  quantity: "2",
  unitCost: "20",
  purchasedAt: "2026-08-13",
  purchaser: "仓库管理员",
  remark: "",
};

describe("inbound form", () => {
  it("uses Decimal for expected amount", () => {
    expect(calculateInboundAmount("0.1", "0.2")).toBe("0.02");
  });

  it("requires a remark when cost is zero", () => {
    expect(validateInboundDraft({ ...validInbound, unitCost: "0", remark: "" })).toEqual(expect.objectContaining({ remark: "单价为 0 时必须填写备注" }));
  });

  it("retains only warehouse, purchase date and purchaser after success", () => {
    expect(resetInboundAfterSuccess(validInbound)).toEqual({
      warehouseId: validInbound.warehouseId,
      itemId: "", batchNo: "", quantity: "", unitCost: "",
      purchasedAt: validInbound.purchasedAt, purchaser: validInbound.purchaser, remark: "",
    });
  });
});

describe("session draft", () => {
  it("rejects another user or version", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    } satisfies Storage;
    writeSessionDraft(storage, "inbound", { version: 1, userId: "admin-1", value: validInbound });
    expect(readSessionDraft(storage, "inbound", "admin-2", 1)).toBeNull();
    expect(readSessionDraft(storage, "inbound", "admin-1", 2)).toBeNull();
  });

  it("clears only an invalid master-data reference and preserves the other fields", () => {
    expect(reconcileInboundDraft(validInbound, { warehouseIds: ["wh-2"], itemIds: ["item-1"] })).toEqual({
      draft: { ...validInbound, warehouseId: "" },
      staleFields: ["warehouseId"],
    });
  });
});
```

- [x] **Step 2: 运行确认 RED**

Run: `corepack pnpm vitest run tests/unit/web/session-draft.test.ts tests/unit/web/inbound-form.test.ts`

Expected: FAIL，两个 feature 文件尚不存在。

- [x] **Step 3: 实现通用草稿和精确金额纯函数**

```ts
export type DraftEnvelope<T> = { version: number; userId: string; value: T };

export function readSessionDraft<T>(storage: Storage, key: string, userId: string, version: number): T | null {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "null") as DraftEnvelope<T> | null;
    return parsed?.version === version && parsed.userId === userId ? parsed.value : null;
  } catch {
    return null;
  }
}
```

`calculateInboundAmount` 使用 `new Decimal(quantity).mul(unitCost).toFixed(2)`；空值或非数值返回 `null`。`validateInboundDraft` 返回 `Partial<Record<keyof InboundDraft, string>>`，精确覆盖仓库、物品、批次、正数数量、非负单价、采购日期和零价备注。

`reconcileInboundDraft(draft, { warehouseIds, itemIds })` 在标准数据加载完成后检查恢复值：失效仓库只清空 `warehouseId`，失效物品只清空 `itemId`，其他字段原样保留，并返回 `staleFields` 供页面显示“标准数据已变化，请重新选择”。

- [x] **Step 4: 写入库交互 E2E 失败测试**

测试必须覆盖：390×844 单页分组无横向滚动；预计金额；提交前摘要弹窗；失败保留字段；刷新恢复；主动放弃清草稿；成功后只保留仓库、采购日期、采购人；按钮提交中禁用。

Run: `corepack pnpm playwright test tests/e2e/mobile/inbound.spec.ts`

Expected: FAIL，现有页面没有分组、确认弹窗和草稿恢复。

- [x] **Step 5: 重构 InboundPage 为共享控制器与单一呈现树**

`InboundPage` 新增必需 prop `userId`。初始化时从 `warehouse.inbound.v1.<userId>` 恢复，字段变化后写入 sessionStorage；成功、主动放弃时清除。移动端分为“仓库与物品”“批次与采购信息”“数量与预计金额”三组；桌面端保留当前网格但使用同一 `form/errors/submitting` 状态。

点击保存先运行纯函数校验，再打开 `ModalDialog`；确认后 POST。服务端错误保留草稿；401 引导重新登录但不删除非敏感字段；成功调用 `resetInboundAfterSuccess` 并发出 `warehouse:business-completed` 事件。

```ts
const reconciled = reconcileInboundDraft(restoredDraft, {
  warehouseIds: warehouses.map((warehouse) => warehouse.id),
  itemIds: items.map((item) => item.id),
});
setForm(reconciled.draft);
setStaleFields(reconciled.staleFields);
```

- [x] **Step 6: 运行 RED→GREEN 验证**

Run:

```powershell
corepack pnpm vitest run tests/unit/web/session-draft.test.ts tests/unit/web/inbound-form.test.ts
corepack pnpm playwright test tests/e2e/mobile/inbound.spec.ts
corepack pnpm playwright test tests/e2e/admin/inbound.spec.ts
corepack pnpm --filter @warehouse/web typecheck
```

Expected: 纯规则、移动入库和既有 `tests/e2e/admin/inbound.spec.ts` 回归 PASS；类型检查退出码 0。

- [x] **Step 7: 提交手机入库**

```powershell
git add apps/web/src/features/drafts apps/web/src/features/inbound apps/web/src/pages/InboundPage.tsx apps/web/src/App.tsx apps/web/src/styles.css tests/unit/web/session-draft.test.ts tests/unit/web/inbound-form.test.ts tests/e2e/mobile/inbound.spec.ts
git commit -m "feat: add recoverable mobile inbound form"
```

---

### Task 5: 用四步向导实现完整手机出库与危险取消

**Files:**
- Create: `apps/web/src/features/outbound/outbound-workflow.ts`
- Create: `apps/web/src/features/outbound/MobileOutboundFlow.tsx`
- Create: `apps/web/src/features/outbound/DesktopOutboundTable.tsx`
- Create: `tests/unit/web/outbound-workflow.test.ts`
- Create: `tests/e2e/mobile/outbound.spec.ts`
- Modify: `apps/web/src/pages/OutboundPage.tsx:1-187`
- Modify: `apps/web/src/App.tsx:162-218`
- Modify: `apps/web/src/styles.css`
- Modify: `tests/integration/inventory/outbound-service.test.ts`

**Interfaces:**
- Produces: `OutboundStep = 'select' | 'allocate' | 'review' | 'complete'`。
- Produces: `OutboundDraft`，含单一 `approvalId`、`step`、`allocations`、`reason`。
- Produces: `summarizeOutbound()`、`validateAllocationStep()`、`validateReviewStep()`、`reconcileBatchOptions()`。
- Produces: `MobileOutboundFlow` callbacks：`onReloadOptions`、`onConfirm`、`onCancel`、`onCompleted`。
- Consumes: `session-draft.ts`、`ModalDialog`、`useMobileViewport()`。

- [x] **Step 1: 写四步状态与分配规则失败测试**

```ts
describe("outbound workflow", () => {
  it("supports multiple warehouses and batches with Decimal totals", () => {
    const summary = summarizeOutbound({
      id: "approval-1",
      weComSpNo: "202608130001",
      status: "PENDING_OUTBOUND",
      lines: [{ id: "line-1", itemId: "item-1", requestedQuantity: "0.3" }],
    }, [
      { id: "a1", approvalLineId: "line-1", warehouseId: "wh-1", batchId: "b1", quantity: "0.1" },
      { id: "a2", approvalLineId: "line-1", warehouseId: "wh-2", batchId: "b2", quantity: "0.2" },
    ], [
      { batchId: "b1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "1", unitCost: "0.2" },
      { batchId: "b2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "1", unitCost: "0.3" },
    ]);
    expect(summary.actualQuantity).toBe("0.3");
    expect(summary.amount).toBe("0.08");
  });

  it("requires a reason for partial and zero issue", () => {
    expect(validateReviewStep({ requestedQuantity: "2", actualQuantity: "1", amount: "20.00" }, "")).toEqual({ reason: "少出或零出必须填写原因" });
    expect(validateReviewStep({ requestedQuantity: "2", actualQuantity: "0", amount: "0.00" }, "")).toEqual({ reason: "少出或零出必须填写原因" });
  });

  it("marks changed batches invalid without deleting other input", () => {
    const draft: OutboundDraft = {
      approvalId: "approval-1",
      step: "review",
      reason: "",
      allocations: [
        { id: "allocation-stale", approvalLineId: "line-1", warehouseId: "wh-1", batchId: "old-batch", quantity: "1" },
        { id: "allocation-valid", approvalLineId: "line-1", warehouseId: "wh-2", batchId: "batch-2", quantity: "1" },
      ],
    };
    const reconciled = reconcileBatchOptions(draft, [
      { batchId: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "4", unitCost: "20" },
    ]);
    expect(reconciled.invalidAllocationIds).toEqual(["allocation-stale"]);
    expect(reconciled.draft.allocations).toEqual(draft.allocations);
    expect(reconciled.draft.step).toBe("review");
  });
});
```

- [x] **Step 2: 运行确认 RED**

Run: `corepack pnpm vitest run tests/unit/web/outbound-workflow.test.ts`

Expected: FAIL，`outbound-workflow.ts` 尚不存在。

- [x] **Step 3: 实现纯工作流和审批单草稿键**

```ts
export function outboundDraftKey(userId: string, approvalId: string): string {
  return `warehouse.outbound.v1.${encodeURIComponent(userId)}.${encodeURIComponent(approvalId)}`;
}

export function reconcileBatchOptions(draft: OutboundDraft, options: readonly BatchOption[]): ReconciledOutboundDraft {
  const valid = new Set(options.map((option) => `${option.warehouseId}:${option.batchId}`));
  return {
    draft: { ...draft, step: "review" },
    invalidAllocationIds: draft.allocations
      .filter((row) => row.batchId && !valid.has(`${row.warehouseId}:${row.batchId}`))
      .map((row) => row.id),
  };
}
```

分配校验逐审批行比较合计，不允许超过审批数量；允许合计为 0，但复核步骤要求原因。金额只用 Decimal 预览，最终值仍取服务端响应。

- [x] **Step 4: 写移动出库与取消 E2E 失败测试**

覆盖：选择一张待办；每个物品至少一条分配；新增跨仓/跨批次；步骤返回不丢失；少出原因；刷新恢复；提交前重新 GET options；库存变化停留复核并标记失效行；二次确认；重复点击只发一个 POST；成功清草稿并从待办消失；取消必须填原因且二次确认。

Run: `corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts`

Expected: FAIL，现有页面是内嵌表格编辑而非四步向导。

- [x] **Step 5: 提取桌面表格并实现移动四步流**

`OutboundPage({ userId })` 只负责待办、options、confirm/cancel API 与响应式选择；桌面行为移入 `DesktopOutboundTable`，不得更改现有按钮、请求体和成功文案的测试契约。移动端一次只打开一张审批单的 `OutboundDraft`：

1. `select`：卡片列待办，单独提供“取消待办”；
2. `allocate`：按审批行分组，每条分配依次选仓库、批次、数量；
3. `review`：显示每行审批/实际/差额和总金额，少出/零出原因；
4. `complete`：显示服务端 id、状态、实际数量、金额。

最终确认前重新 `GET /admin/outbound/:approvalId/options`，调用 `reconcileBatchOptions`。无失效项才打开二次确认并 POST `/admin/outbound/confirm`。取消用独立危险弹窗：先录入原因，再展示审批号+原因二次确认，POST `/admin/outbound/:approvalId/cancel`。

confirm/cancel 返回 401 时保留当前 session 草稿并导航到企业微信登录，returnTo 指向 `/admin/outbound`；重新登录后仅当会话用户 id 与草稿 envelope 一致才恢复。成功或用户明确放弃时清除对应审批单草稿。

- [x] **Step 6: 增加路由回归以固定取消和并发错误**

```ts
it("cancels only a pending approval with a reason", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/admin/outbound/approval-1/cancel",
    headers: { cookie: adminCookie },
    payload: { reason: "申请人撤回" },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ approvalId: "approval-1", status: "VOIDED" });
});
```

同时保留/补齐：空原因 400、重复确认 409、余额变化 409、财务 403。不要改变现有服务错误分类。

- [x] **Step 7: 运行工作流、API、移动和桌面回归**

Run:

```powershell
corepack pnpm vitest run tests/unit/web/outbound-workflow.test.ts tests/unit/inventory/outbound-allocator.test.ts tests/integration/inventory/outbound-service.test.ts
corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts
corepack pnpm playwright test tests/e2e/admin/outbound.spec.ts
corepack pnpm --filter @warehouse/web typecheck
```

Expected: 纯函数、`tests/integration/inventory/outbound-service.test.ts` 服务/路由、移动向导和 `tests/e2e/admin/outbound.spec.ts` 桌面回归 PASS；类型检查退出码 0。

- [x] **Step 8: 提交四步出库**

```powershell
git add apps/web/src/features/outbound apps/web/src/pages/OutboundPage.tsx apps/web/src/App.tsx apps/web/src/styles.css tests/unit/web/outbound-workflow.test.ts tests/e2e/mobile/outbound.spec.ts tests/integration/inventory/outbound-service.test.ts
git commit -m "feat: add guided mobile outbound workflow"
```

---

### Task 6: 把通知改为实时任务中心并修正业务跳转

**Files:**
- Create: `apps/web/src/features/notifications/notification-tasks.ts`
- Create: `apps/web/src/features/notifications/use-notification-tasks.ts`
- Create: `apps/web/src/features/notifications/NotificationCenter.tsx`
- Create: `tests/e2e/mobile/notification-tasks.spec.ts`
- Modify: `apps/api/src/application/inventory/alert-service.ts:3-18`
- Modify: `apps/api/src/application/inventory/notification-service.ts:36-87`
- Modify: `tests/unit/inventory/alert-service.test.ts`
- Modify: `tests/unit/inventory/notification-service.test.ts`
- Modify: `apps/web/src/components/AppShell.tsx:29-36,93-102,179-209,409-448`
- Modify: `apps/web/src/pages/InboundPage.tsx`
- Modify: `apps/web/src/pages/OutboundPage.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: `NOTIFICATION_POLL_INTERVAL_MS = 30_000`。
- Produces: `BUSINESS_COMPLETED_EVENT = 'warehouse:business-completed'` 与 `announceBusinessCompleted()`。
- Produces: `useNotificationTasks({ enabled, open })`，返回 `{ tasks, loading, error, refresh }`。
- Produces: `NotificationCenter({ role, mobile })`。

- [x] **Step 1: 写通知生命周期与链接失败测试**

```ts
it("links actionable tasks to renderable mobile routes", async () => {
  const service = new NotificationService({
    getPendingOutboundCount: async () => 1,
    listLowStock: async () => [{ itemId: "item-1", itemCode: "TEA-001", itemName: "Tea Leaves", totalQuantity: "1", minimumStock: "3" }],
    getPeriodStatus: async () => ({ code: "2026-08", status: "CLOSED" }),
    getStocktakeNotice: async () => ({ count: 0, href: "/admin/stocktake" }),
    getAnomalyCount: async () => 0,
  });
  const tasks = await service.list();
  expect(tasks.find((task) => task.kind === "PENDING_OUTBOUND")?.href).toBe("/admin/outbound");
  expect(tasks.find((task) => task.kind === "LOW_STOCK")?.href).toBe("/admin/inventory?query=TEA-001");
});

it("removes tasks when their source state is resolved", async () => {
  let pending = 1;
  const service = new NotificationService({
    getPendingOutboundCount: async () => pending,
    listLowStock: async () => [],
    getPeriodStatus: async () => ({ code: "2026-08", status: "CLOSED" }),
    getStocktakeNotice: async () => ({ count: 0, href: "/admin/stocktake" }),
    getAnomalyCount: async () => 0,
  });
  expect(await service.list()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "PENDING_OUTBOUND" })]));
  pending = 0;
  expect(await service.list()).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "PENDING_OUTBOUND" })]));
});
```

- [x] **Step 2: 运行确认 RED**

Run: `corepack pnpm vitest run tests/unit/inventory/notification-service.test.ts`

Expected: FAIL，当前链接为 `/admin/outbound/pending` 和 `/admin/items`。

- [x] **Step 3: 修正服务端链接并实现任务刷新 hook**

给 `AlertItem` 和 `LowStockItem` 增加 `itemCode`，由 `AlertService` 从现有物品主数据复制编码，不改数据库字段。低库存 href 固定为 `/admin/inventory?query=${encodeURIComponent(item.itemCode)}`，使用唯一物品编码命中现有库存检索。同步更新 alert-service 与 notification-service 单测，不得保留无法渲染的伪路由。

`useNotificationTasks` 在 enabled 后初次加载；open 从 false→true 立即刷新；open 时 `setInterval(..., 30_000)`，关闭清理；监听 `visibilitychange`，仅 `document.visibilityState === 'visible'` 刷新；监听 `BUSINESS_COMPLETED_EVENT` 立即刷新。无本地“全部已读”状态。

```ts
export const NOTIFICATION_POLL_INTERVAL_MS = 30_000;
export const BUSINESS_COMPLETED_EVENT = "warehouse:business-completed";

export function announceBusinessCompleted(): void {
  window.dispatchEvent(new Event(BUSINESS_COMPLETED_EVENT));
}
```

- [x] **Step 4: 写移动任务中心 E2E 失败测试**

覆盖：通知按钮显示任务数；移动端打开为不溢出的 sheet；待出库跳 `/admin/outbound`；低库存跳 `/admin/inventory?query=...`；盘点/月结/异常显示“请在电脑端处理”；模拟业务完成事件后二次响应为空，任务从 DOM 消失。

Run: `corepack pnpm playwright test tests/e2e/mobile/notification-tasks.spec.ts`

Expected: FAIL，当前通知是桌面 popover 且有“全部已读”。

- [x] **Step 5: 提取 NotificationCenter 并接入业务完成事件**

桌面保持 popover；移动端使用全宽 bottom sheet。任务条目根据 kind 渲染：`PENDING_OUTBOUND`、`LOW_STOCK` 是链接；`STOCKTAKE`、`PERIOD_CLOSE`、`ANOMALY` 是摘要和电脑端提示。入库成功、出库成功、取消成功调用 `announceBusinessCompleted()`。

- [x] **Step 6: 运行通知和壳层回归**

Run:

```powershell
corepack pnpm vitest run tests/unit/inventory/notification-service.test.ts
corepack pnpm playwright test tests/e2e/mobile/notification-tasks.spec.ts tests/e2e/mobile/mobile-shell.spec.ts
corepack pnpm playwright test tests/e2e/navigation/workspace-tools.spec.ts
corepack pnpm typecheck
```

Expected: 通知服务、移动任务中心、移动壳层和桌面 workspace 回归 PASS；全仓类型检查退出码 0。

- [x] **Step 7: 提交任务中心**

```powershell
git add apps/api/src/application/inventory/alert-service.ts apps/api/src/application/inventory/notification-service.ts apps/web/src/features/notifications apps/web/src/components/AppShell.tsx apps/web/src/pages/DashboardPage.tsx apps/web/src/pages/InboundPage.tsx apps/web/src/pages/OutboundPage.tsx apps/web/src/styles.css tests/unit/inventory/alert-service.test.ts tests/unit/inventory/notification-service.test.ts tests/e2e/mobile/notification-tasks.spec.ts
git commit -m "feat: turn mobile notifications into live tasks"
```

---

### Task 7: 企业微信窄屏、焦点、软键盘与桌面回归门禁

**Files:**
- Create: `tests/e2e/mobile/mobile-viewport-matrix.spec.ts`
- Modify: `tests/e2e/mobile/mobile-shell.spec.ts`
- Modify: `tests/e2e/mobile/inbound.spec.ts`
- Modify: `tests/e2e/mobile/outbound.spec.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/components/ModalDialog.tsx`
- Modify: `apps/web/src/features/mobile/MobileMoreSheet.tsx`
- Modify: `apps/web/src/features/notifications/NotificationCenter.tsx`

**Interfaces:**
- Consumes: 所有移动页面和弹层。
- Produces: 320×568、390×844、430×932、820×900 与 821×900 的边界回归矩阵。

- [x] **Step 1: 写视口矩阵失败测试**

```ts
import { loginAs } from "./mobile-test-helpers";

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 820, height: 900 },
]) {
  test(`${viewport.width}x${viewport.height} has one mobile tree and no page overflow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await loginAs(page, "/", "ADMIN");
    await expect(page.getByRole("navigation", { name: "手机任务导航" })).toHaveCount(1);
    await expect(page.locator(".sidebar")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("821px mounts only desktop navigation", async ({ page }) => {
  await page.setViewportSize({ width: 821, height: 900 });
  await loginAs(page, "/", "ADMIN");
  await expect(page.getByRole("navigation", { name: "手机任务导航" })).toHaveCount(0);
  await expect(page.locator(".sidebar")).toBeVisible();
});
```

- [x] **Step 2: 运行确认 RED**

Run: `corepack pnpm playwright test tests/e2e/mobile/mobile-viewport-matrix.spec.ts`

Expected: 任何安全区、溢出、重复交互树或 820/821 边界错误均明确 FAIL。

- [x] **Step 3: 修复布局与可访问性问题**

逐项满足：`100dvh` + `100vh` fallback；安全区；输入字号 16px；触控 44px；弹层打开锁 body；初始焦点进入弹层；Tab 不逃逸；Escape/返回关闭；关闭后焦点恢复；错误出现后滚动/聚焦首个错误；固定底栏不遮当前输入和提交按钮；所有 popover/sheet 最大宽度 `calc(100vw - 24px)`；不使用 hover-only 操作。

在 `mobile-viewport-matrix.spec.ts` 再增加一条跨断点状态测试：在 820px 填写入库批次，切到 821px 后仍显示同一批次；页面只切换呈现树，不丢共享父级状态。弹层测试用 `Tab`/`Shift+Tab` 断言焦点循环，用 `Escape` 断言关闭并恢复焦点；浏览器历史返回在无打开弹层时仍回到上一个页面。

- [x] **Step 4: 跑完整移动矩阵和关键桌面 E2E**

Run:

```powershell
corepack pnpm playwright test tests/e2e/mobile
corepack pnpm playwright test tests/e2e/navigation/dashboard.spec.ts tests/e2e/navigation/workspace-tools.spec.ts tests/e2e/admin
corepack pnpm --filter @warehouse/web build
```

Expected: 全部移动 E2E、关键桌面 E2E PASS；web 构建退出码 0。

- [x] **Step 5: 提交兼容性门禁**

```powershell
git add apps/web/src/styles.css apps/web/src/components/ModalDialog.tsx apps/web/src/features/mobile/MobileMoreSheet.tsx apps/web/src/features/notifications/NotificationCenter.tsx tests/e2e/mobile
git commit -m "test: cover enterprise wechat mobile viewports"
```

---

### Task 8: 更新项目状态、执行新鲜全量验证并评审

**Files:**
- Create: `PROJECT_STATUS.md`（以 `D:\桌面\仓库\PROJECT_STATUS.md` 为状态入口内容基础，用 `apply_patch` 带入当前分支并更新，不使用覆盖式复制）
- Modify: `docs/superpowers/plans/2026-08-13-mobile-responsive.md`（只勾选实际完成步骤并记录真实验证证据）

**Interfaces:**
- Consumes: 所有实现、测试和提交。
- Produces: 可供用户验收的本地分支、真实验证证据和未部署状态；不合并、不推送、不发布。

- [x] **Step 1: 更新 PROJECT_STATUS.md**

必须准确写入：

```markdown
- 手机端范围：查询、通知、单页入库、四步出库与取消；调拨/盘点/月结/主数据维护保留电脑端。
- Git 基线：codex/mobile-responsive 从 codex/production-deployment@5f17963 创建；原 feat/warehouse-system@270d7f8 脏工作树未触碰。
- 设计规格：docs/superpowers/specs/2026-08-13-mobile-responsive-design.md。
- 验证结果：逐条列出日期、命令、通过/失败数量；Docker 若未恢复，明确标记环境阻塞。
- 部署状态：仅本地实现和验证，尚未部署，等待用户验收。
```

- [x] **Step 2: 运行不依赖 Docker 的全量验证**

Run with Node 24+ and freshly generated Prisma Client:

```powershell
corepack pnpm vitest run --exclude 'tests/deployment/**'
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:e2e
git diff --check 5f17963...HEAD
git status --short --branch
```

Expected: 所有非部署 Vitest、类型检查、构建、E2E 和 whitespace check 退出码 0；工作树只允许存在正在更新的计划/状态文件，提交后必须 clean。必须读取输出中的测试总数和失败数，不得只看退出码。

2026-08-13 新鲜证据：bundled Node `v24.19.0`；dummy `DATABASE_URL` 下 Prisma generate exit 0；非 deployment Vitest 为 48 files（45 passed/3 skipped）、252 tests（236 passed/16 skipped/0 failed）；typecheck/build exit 0；隔离 3301/5474 memory/local-auth E2E 为 104 passed/0 failed/0 skipped；`git diff --check 5f17963...HEAD` 无输出。完整细节见 `.superpowers/sdd/2026-08-13-mobile-responsive/task-8-report.md`。

- [ ] **Step 3: Docker 恢复后运行部署验证**

前置检查：

```powershell
Get-VM -Name DockerDesktopVM | Select-Object State,Status
docker image inspect node:24-alpine
docker run --rm --mount "type=bind,src=D:\桌面\仓库\.worktrees\mobile-responsive,dst=/workspace,readonly" node:24-alpine /bin/sh -lc 'test -r /workspace/package.json'
```

Expected: VM `Running`；image inspect 快速返回；只读挂载探针退出码 0。随后运行：

```powershell
corepack pnpm vitest run tests/deployment/deployment-scripts.test.ts
corepack pnpm test
docker compose -f docker-compose.prod.yml config
```

Expected: deployment 测试 PASS；随后真正的完整 `corepack pnpm test` 退出码 0；production compose config 可解析且不输出 Secret 值。

若仍出现 `0x800705AA` 或 VM 为 Off，停止 Docker 验证并在 `PROJECT_STATUS.md` 记录环境阻塞；不得重装、重置 VM、改 Secret 或伪称通过。

2026-08-13 前置结果：`DockerDesktopVM State=Off, Status=Operating normally`。已按规则停止，Step 3 保持未勾选；未进行 image inspect、挂载、deployment tests 或 Compose config。

- [x] **Step 4: 使用 requesting-code-review 做规格与代码评审**

评审固定比较点：`5f17963...HEAD`。评审清单：手机/桌面权限；单一交互树；Decimal；草稿隔离；入库保留；出库重校验与取消；任务刷新；企业微信视口；无 Secret/部署变更。收到意见后必须先使用 `superpowers:receiving-code-review`，逐条验证后再修改。

2026-08-14：主任务已完成 review_task8 并返回 2 个 Important、1 个 Minor；本轮使用 receiving-code-review 技术核验后处理，结果记录于 Task 8 报告 Review Fix Round 1。

随后整分支最终评审返回 1 个 Important、1 个 Minor。唯一最终修复轮关闭了手机直达电脑端专属页面的 Important；scoped re-review 确认 0 Critical、0 Important。真实 Prisma `P2002` 尚未转换为稳定重复批次业务错误，作为不承载手机响应式范围的后端契约 Minor 留档，并在 `PROJECT_STATUS.md` 明确披露。

- [x] **Step 5: 修复 deferred 审计问题、补充表征覆盖并重新运行受影响验证**

实际行为或测试隔离缺陷先增加/确认回归测试 RED，再最小修复至 GREEN；对既有正确行为补充的 characterization coverage 如实记录首次运行结果，不人为制造 RED。Task 8 的实际修复与补证分类见报告。最后重新运行 Step 2 的完整命令；若触及部署文件，再运行 Step 3。

- [x] **Step 6: 提交状态文档并确认 clean**

```powershell
git add PROJECT_STATUS.md docs/superpowers/plans/2026-08-13-mobile-responsive.md
git commit -m "docs: record mobile responsive verification"
git status --short --branch
```

Expected: `codex/mobile-responsive` 工作树 clean。不要合并、推送或部署；进入 `superpowers:finishing-a-development-branch`，把保留分支、合并或 PR 的选择交给用户。

---

## Final Verification Checklist

- [x] 管理员移动导航恰为五项，财务恰为四项，申请人仍被后台门禁拒绝。
- [x] 320、390、430、820 宽度仅挂载移动树；821 仅挂载桌面树。
- [x] 移动首页采用统一白色快捷面板、紧凑概览和约 18px 图标，不恢复大面积操作卡。
- [x] `/admin/inventory` 可按物品/仓库/批次查询，管理员和财务可见价格，申请人不可访问。
- [x] 手机入库为单页分组，一个物品一个批次，Decimal 金额与成功保留规则有测试。
- [x] 手机出库为四步，多仓/多批次、少出/零出、库存重校验、二次确认和取消均有测试。
- [x] 入库/出库草稿按版本、用户、业务隔离，成功/放弃清除，刷新可恢复。
- [x] 通知是源状态驱动的任务，不保留“全部已读”；打开时每 30 秒轮询，业务完成后立即刷新。
- [x] 盘点、月结、调拨、主数据维护在手机端只提示电脑端处理。
- [x] `100dvh` 回退、安全区、44px 触控、16px 输入、焦点、滚动锁和无横向溢出通过矩阵验证。
- [x] 桌面首页、搜索、入库、出库、报表和导航关键回归通过。
- [x] `PROJECT_STATUS.md` 记录基线、范围、真实验证结果和未部署状态。
- [x] 未修改/输出生产 Secret，未连接生产数据库，未部署、未推送。
