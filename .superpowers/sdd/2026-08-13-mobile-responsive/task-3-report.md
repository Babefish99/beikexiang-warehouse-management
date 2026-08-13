# Task 3 Report

## Status

DONE_WITH_CONCERNS

移动首页、管理员/财务共用库存查询页、库存查询客户端、路由分发和全局搜索目的路由均已实现；TypeScript 类型检查和 `git diff --check` 通过。Playwright GREEN/回归受到工作区外已有 3001/5174 服务及其本地登录状态污染，独立端口尝试又被残留 `tsx watch` 子进程占用，按有界诊断规则停止重试，详见 concerns。

## 改动文件

- `apps/web/src/features/inventory/inventory-api.ts`
- `apps/web/src/pages/InventoryQueryPage.tsx`
- `apps/web/src/pages/DashboardPage.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/styles.css`
- `tests/e2e/mobile/inventory-query.spec.ts`
- `tests/e2e/navigation/dashboard.spec.ts`
- `tests/e2e/navigation/workspace-tools.spec.ts`
- `.superpowers/sdd/2026-08-13-mobile-responsive/task-3-report.md`

## RED

命令：

```powershell
corepack pnpm playwright test tests/e2e/mobile/inventory-query.spec.ts
```

结果：退出码 1，3 failed。

- 管理员库存查询：找不到 `article`（`/admin/inventory` 尚未分发查询页）。
- 移动管理员首页：找不到 `/你好/` 标题（尚未实现移动首页层级）。
- 财务库存查询：找不到“库存查询”标题（财务 fallback 提前截断路由）。

以上均为目标行为缺失导致的语义断言失败，不是测试语法或环境启动失败。

## GREEN / 回归

### 通过

命令：

```powershell
corepack pnpm --filter @warehouse/web typecheck
```

精确结果：退出码 0；输出 `$ tsc -b --pretty false`，0 errors。

命令：

```powershell
git diff --check
```

精确结果：退出码 0；仅 Git 的 LF→CRLF 工作区提示，无 whitespace error。

### 未能取得 GREEN 的 Playwright 命令

默认命令：

```powershell
corepack pnpm playwright test tests/e2e/mobile/inventory-query.spec.ts
```

结果：退出码 1，3 failed；Playwright `reuseExistingServer: true` 复用了工作区外已有 5174/3001。失败快照为“集团仓库管理系统 / 使用企业微信登录管理员后台”，未进入实现页面。

独立端口命令（本工作树 API 3301 / Web 5474）：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/inventory-query.spec.ts
```

第一次结果：退出码 1，3 failed，原因是 3301 启动时未带本地测试专用 `LOCAL_AUTH_BYPASS=true`，登录路由返回 404。

补入本地测试开关后一次结果：退出码 1，3 failed；先前 `tsx watch` 子进程仍占用 3301，新配置未接管端口，失败快照仍为登录页。按要求停止重复尝试，未停止或修改主工作树服务。

因此以下 brief 指定 Playwright 组合没有虚假声明为通过：

```powershell
corepack pnpm playwright test tests/e2e/mobile/inventory-query.spec.ts tests/e2e/mobile/mobile-shell.spec.ts
corepack pnpm playwright test tests/e2e/navigation/dashboard.spec.ts tests/e2e/navigation/workspace-tools.spec.ts
```

## React / 权限 / 窄屏自审

- React：初始 query 使用 lazy state 从 `window.location.search` 读取；250ms 防抖 effect 只负责外部请求；cleanup 同时清 timer 和 abort controller；仓库变化终止旧请求；组件均在模块顶层定义；五个首页数据读取并行；全局搜索复用 `searchInventory()`；通知读取通过共享在途 Promise/短缓存去重，避免 App 与 AppShell 同时请求。
- 权限：`InventoryQueryPage` 的 role 类型仅允许 `ADMIN | FINANCE`；申请人仍在 App 的权限门禁之前拒绝；管理员和财务都显示价格/金额；财务首页只渲染查询/报表入口，dashboard effect 的 `user.role !== "ADMIN"` 门禁确保不请求 items、pending、transactions 或 notifications；API 仍由服务端 `/admin/reports` 权限校验控制，没有客户端权限回退。
- 窄屏：`useMobileViewport()` 沿用 ≤820px 契约；移动查询每物品一个 `article`、每 location 一个批次组，桌面使用表格；移动首页包含仓库选择、问候、统一搜索、同一白色操作面板、今日概览和轻提示；关键按钮/选择/搜索高度 ≥44px；页面图标 18px、正文标签 13px；CSS 使用 `minmax(0, 1fr)`、`min-width: 0` 和 `overflow-wrap` 防止 320px 横向溢出。由于 E2E 环境污染，320/390/430/820 浏览器实测未能取得新鲜 PASS。

## Commit 列表

- `feat: add mobile inventory search and dashboard`（本次 Task 3 提交）

## Concerns

- Playwright 的固定 3001/5174 + `reuseExistingServer` 会复用其他工作树服务；这是 Task2 ledger 已知的 workspace-tools 测试隔离问题。本任务没有修改测试基础设施或停止外部服务。
- 本次没有读取/修改生产 Secret、没有连接生产数据库、没有部署、没有 push。
- 因无新鲜 Playwright GREEN，交付状态不能标为 DONE；集成者应在端口隔离且本地认证明确启用的干净环境重跑 brief 两组 E2E。
