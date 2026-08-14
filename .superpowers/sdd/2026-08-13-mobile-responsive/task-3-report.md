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

## Fix / Verification Round

### 进程所有权核验与清理

开始前通过 `Get-NetTCPConnection` 与 `Get-CimInstance Win32_Process` 核验：

- 5474 / PID 28228 的命令行指向 `D:\桌面\仓库\.worktrees\mobile-responsive\apps\web\...vite.js`。
- 3301 / PID 35108 的命令行指向 `D:\桌面\仓库\.worktrees\mobile-responsive\node_modules\...tsx... src/server.ts`。

仅终止上述两个本工作树进程。终止后 3301/5474 均释放；3001/5174 原有监听仍保持，未停止或修改。

只读确认本地测试持久化变量为 `PERSISTENCE_DRIVER=memory`，`LOCAL_AUTH_BYPASS=true` 仅在非生产环境有效。

### 干净隔离栈

API 显式环境：

```powershell
$env:API_PORT='3301'
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
$env:LOCAL_AUTH_BYPASS='true'
$env:PERSISTENCE_DRIVER='memory'
corepack pnpm --filter @warehouse/api dev
```

Web 显式环境：

```powershell
$env:VITE_API_BASE_URL='http://127.0.0.1:3301'
corepack pnpm --filter @warehouse/web exec vite --host 127.0.0.1 --port 5474 --strictPort
```

健康结果：API 返回 `{"status":"ok","service":"warehouse-api","persistenceDriver":"memory","database":{"status":"not_required"}}`；Web 5474 返回 HTTP 200。

### 移动组合 GREEN

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/inventory-query.spec.ts tests/e2e/mobile/mobile-shell.spec.ts
```

精确结果：退出码 0；`11 passed (5.2s)`。覆盖管理员/财务库存查询、移动首页、导航、更多面板、44px 对话框触控目标，以及 320/390/430/820 宽度无横向溢出。

### 桌面组合已知隔离失败

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/navigation/dashboard.spec.ts tests/e2e/navigation/workspace-tools.spec.ts
```

精确结果：退出码 1；`9 failed (77.7s)`。`dashboard.spec.ts` 与 `workspace-tools.spec.ts` 均在测试体内硬编码导航到 `http://127.0.0.1:3001/auth/local...`，因此没有进入隔离 5474；所有失败均为首页/控件不可见或等待超时，没有出现本任务产品逻辑断言失败。按 Task2 ledger 不扩张测试基础设施。

### 最终静态验证与清理

```powershell
corepack pnpm --filter @warehouse/web typecheck
```

精确结果：退出码 0；输出 `$ tsc -b --pretty false`，0 errors。

本轮无需生产代码修复；仅追加本报告。隔离验证完成后终止本轮从该工作树启动的 3301/5474 进程，并再次确认端口释放、3001/5174 未受影响、Git 工作树干净。

## Fix Round 1/5

### Status

DONE

Fix base：`cd23dc4`。仅修复审查提出的三个 Important；未处理已登记的两个 Minor，未扩张生产实现范围。

### RED

1. 真实聚合通知与 pending 数组数量：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/inventory-query.spec.ts --grep "notification-derived overview"
```

精确结果：退出码 1；`1 failed`。夹具使用 2 条 `/admin/outbound/pending` 和真实 NotificationService 形态的 1 条 `PENDING_OUTBOUND` 聚合通知；预期 `待出库2`，实际 `待出库1`。

2. 桌面严格四指标：在隔离 URL helper 修复后，临时恢复旧 tone 过滤并运行现有严格断言：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/navigation/dashboard.spec.ts --grep "dashboard quick actions"
```

精确结果：退出码 1；`1 failed`。`.metric__value` 预期 4，实际 5。随后立即恢复 label 白名单修复；旧实现未提交。

3. 桌面隔离登录：Fix/Verification Round 已记录旧硬编码命令在同一 3301/5474 隔离栈上 `9 failed (77.7s)`，所有测试通过硬编码 `127.0.0.1:3001/auth/local` 未进入隔离 Web；这条已有失败证据作为本 Important 的 RED，未重复运行污染命令。

### 最小修复

- `App.tsx`：移动“待出库”复用已并行读取的 `pending.length`，不新增请求；低库存仍映射 `LOW_STOCK` 通知条目数，通知仍映射通知数组长度。
- `DashboardPage.tsx`：桌面按明确 label 白名单选择原四指标，不再依赖非唯一 tone；移动端仍按四个确认 label 读取今日概览。
- `mobile-test-helpers.ts`：导出 `apiBaseUrl`、`webBaseUrl`、`apiUrl()`、`apiUrlPattern()` 和既有 `loginAs()`，统一尊重 `API_BASE_URL` / `WEB_BASE_URL`。
- `dashboard.spec.ts`、`workspace-tools.spec.ts`：所有登录和 API 拦截改用共享 helper，不改生产配置。
- `inventory-query.spec.ts`：使用真实单条聚合通知形态，pending 数组两条，并分别期待待出库 2、通知 2。

### 隔离栈所有权

启动前确认 3301/5474 无监听。随后仅从本工作树启动：

```powershell
$env:API_PORT='3301'
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
$env:LOCAL_AUTH_BYPASS='true'
$env:PERSISTENCE_DRIVER='memory'
corepack pnpm --filter @warehouse/api dev

$env:VITE_API_BASE_URL='http://127.0.0.1:3301'
corepack pnpm --filter @warehouse/web exec vite --host 127.0.0.1 --port 5474 --strictPort
```

健康检查通过：API memory / `database.status=not_required`，Web HTTP 200。验证后仅按命令行包含 `D:\桌面\仓库\.worktrees\mobile-responsive` 的进程所有权终止 3301/5474；3001/5174 不触碰。

### GREEN / 回归

桌面组合：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/navigation/dashboard.spec.ts tests/e2e/navigation/workspace-tools.spec.ts
```

精确结果：退出码 0；`9 passed (10.2s)`。

移动组合：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/inventory-query.spec.ts tests/e2e/mobile/mobile-shell.spec.ts
```

精确结果：退出码 0；`11 passed (5.0s)`。

类型与差异检查：

```powershell
corepack pnpm --filter @warehouse/web typecheck
git diff --check
```

精确结果：均退出码 0；TypeScript 0 errors；无 whitespace error（仅 LF→CRLF 提示）。

### Commit

- `fix: correct mobile dashboard counts and test isolation`（Fix Round 1 提交）

### Concerns

- 无本轮阻塞或剩余 Important。
- 未读取/修改生产 Secret，未连接生产数据库，未部署，未 push，未触碰主工作树服务。
