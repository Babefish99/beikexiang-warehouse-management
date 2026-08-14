# Task 5 Report — 手机出库四步向导

## Status

DONE。已在隔离工作树实现手机“选择待办 → 分配库存 → 复核出库 → 出库完成”四步向导，并提取、保留桌面完整表格操作。未部署、未 push、未连接生产数据库、未读取或修改生产 Secret。

## 改动文件

- `apps/web/src/features/outbound/outbound-workflow.ts`
- `apps/web/src/features/outbound/MobileOutboundFlow.tsx`
- `apps/web/src/features/outbound/DesktopOutboundTable.tsx`
- `apps/web/src/pages/OutboundPage.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `apps/api/src/application/errors/business-rule-error.ts`
- `tests/unit/web/outbound-workflow.test.ts`
- `tests/e2e/mobile/outbound.spec.ts`
- `tests/e2e/admin/outbound.spec.ts`
- `tests/integration/inventory/outbound-service.test.ts`
- `.superpowers/sdd/2026-08-13-mobile-responsive/task-5-report.md`

## RED

### 纯工作流初始 RED

```powershell
corepack pnpm vitest run tests/unit/web/outbound-workflow.test.ts
```

退出码 1；`1 failed` test file、`no tests`，精确原因是无法解析尚不存在的 `apps/web/src/features/outbound/outbound-workflow.ts`。

### 移动向导初始 RED

在本树 API 3301 / Web 5474、`PERSISTENCE_DRIVER=memory`、`LOCAL_AUTH_BYPASS=true` 隔离栈运行：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts --config playwright.task5.config.ts
```

退出码 1；`3 failed / 1 passed`（1.2m）。失败分别找不到“选择待办”、分配行与“取消待办”，与旧页面仍为桌面内嵌表格而非四步向导一致；无横溢通用用例已通过。

### Decimal / API / React 追加 RED

- 纯函数首轮为 `4 passed / 1 failed`：同一夹具同时超过审批量与批次余额，拆分夹具后分别固定两条规则。
- API 组合首轮为 `21 passed / 1 failed`：重复确认实际返回 400、brief 要求 409；将 `already closed` / `stock balance changed` 最小映射为 409 后目标测试通过，服务错误消息与服务层分类未改。
- 移动实现首轮仍 `3 failed / 1 passed`：React StrictMode setup→cleanup→setup 后 mounted ref 未恢复 true，合法异步 pending 被丢弃；补对称 setup 后通过。
- 零数量 payload mutation check 为 `5 passed / 1 failed`：零行被发给只接受正数分配的服务端；最小修复为过滤零行，零出库用空 allocations + reason 表达。

## GREEN / 回归

### 工作流、allocator、服务与路由

```powershell
corepack pnpm vitest run tests/unit/web/outbound-workflow.test.ts tests/unit/inventory/outbound-allocator.test.ts tests/integration/inventory/outbound-service.test.ts
```

退出码 0；`3 passed` test files，`23 passed` tests。覆盖 Decimal 汇总与规范化、审批/批次上限、少出/零出原因、失效批次保留输入、草稿 runtime shape、取消原因、重复确认 409、未登录 401、财务 403。

### 手机四步流

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts --config playwright.task5.config.ts
```

退出码 0；`4 passed (8.7s)`。覆盖选择待办、每物品分配、跨仓/跨批、返回保留、少出原因、刷新恢复、提交前再次 GET options、库存变化停留复核并标失效、二次确认、双击单 POST、成功清草稿、危险取消、320/390/430/820 无横溢。

### 桌面回归

旧 spec 的硬编码 3001 改为复用 Task3 env-aware helper 后在相同隔离栈运行：

```powershell
corepack pnpm playwright test tests/e2e/admin/outbound.spec.ts --config playwright.task5.config.ts
```

退出码 0；`3 passed (6.8s)`。桌面旧“办理出库 / 确认实际出库”按钮、请求体、成功文案和失败保留输入契约均通过。

### 类型与差异

```powershell
corepack pnpm --filter @warehouse/web typecheck
corepack pnpm --filter @warehouse/api typecheck
git diff --check
```

均退出码 0；Web/API TypeScript 0 errors；无 whitespace error（仅 Git LF→CRLF 提示）。

## 质量边界自审

- Decimal：手机数量解析只接受普通十进制、最多 14 位整数/4 位小数；审批行、批次余额、汇总与预计金额均用 Decimal.js；最终完成金额使用服务端响应。
- 重校验：打开最终确认前强制重新 GET options 并 reconcile；批次删除或余额减少均保留 draft、停留复核、标记具体失效行。
- 草稿：key 同时编码 userId 与 approvalId；envelope 校验 version/userId/runtime shape；刷新恢复；网络/服务/401 失败保留；成功或“放弃办理”清除。
- 取消：独立危险弹窗先要求原因，再显示审批号和原因二次确认；成功清对应草稿并移除待办。
- 防重：confirm/cancel 用 ref 锁在同步入口阻止快速双击；按钮 busy/disabled；E2E 确认 confirm POST 仅一次。
- 权限：客户端不修改审批状态、不伪造通过；确认和取消仍受服务端管理员权限限制，未登录 401、财务 403 回归通过。
- React：汇总为 render 派生；组件均模块顶层；回调稳定；请求结果在卸载后不提交，且 StrictMode setup 对称；不新增请求瀑布。
- 移动/桌面：`<=820px` 选择四步向导，控件/按钮最小 44px、正文标签 13px、图标 18px；`>820px` 使用提取后的完整桌面表格。

## Commit

- `feat: add guided mobile outbound workflow`（见本报告所在提交）

## Concerns

- 为满足 brief 的重复确认/库存变化 409，调整了共享 admin business-error HTTP 映射；服务层错误消息和异常类型未改，相关 API/typecheck 回归通过。
- 交付前独立只读审查按有界时限收口：未确认 Critical/Important，但审查者在完整读取 diff 前被中止，因此不作为完整审查结论；新鲜自动验证与本报告逐项自审均已完成。
- 隔离 E2E 使用临时 config/启动脚本，验证后已删除且未提交。
- 未处理 Task4 已登记的两个 deferred Minor。

## 端口与清理

- 启动前 3301/5474 空闲；仅本树进程使用这两个端口，API 为 memory/local-auth。
- 最终 3301、5474 均 `FREE`；3001/5174 原有监听保持，未停止或修改。
- 无部署、无 push、无生产数据库连接、无生产 Secret 读取/修改。

---

## Fix Round 1 / 5（base `3af19c9`）

### Status

DONE。仅修复三个 Important：reconcile 保留当前步骤、options 请求防陈旧响应、active approval 离开 pending 后安全退出；并补充库存变化后 confirm POST 必须为 0 的直接负断言。

### RED

纯函数：

```powershell
corepack pnpm vitest run tests/unit/web/outbound-workflow.test.ts
```

退出码 1；`1 failed / 6 passed`。`reconcileBatchOptions()` 对 allocate draft 的唯一差异为 `step` 从 `allocate` 错误变为 `review`。

隔离移动目标组（本树 API 3301 / Web 5474、memory/local-auth）：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts --config playwright.task5-fix1.config.ts --grep "restores an allocate|does not resurrect|exits a draft safely|keeps the review visible"
```

退出码 1；`3 failed / 1 passed (24.4s)`：

- allocate 刷新后找不到“分配库存”，证明恢复绕到了 review；
- 加载中放弃后旧 options fulfill，session 草稿数期望 0、实际 1；
- pending 移除当前审批后找不到“待办状态已变化”，页面空白；
- 库存变化停留复核用例通过，并新增 `confirmPosts === 0` 断言。

### 最小修复

- `reconcileBatchOptions()` 返回复制 draft，不再修改 step；allocate 恢复仍在分配步骤并必须通过 `validateAllocationStep()`，review 重校验自然保持 review。
- `MobileOutboundFlow` 为 options 请求维护单调 epoch 与 active approvalId；响应只有同时满足 mounted、epoch 最新、approvalId 当前才可更新 state/session。放弃、pending 消失与卸载均递增 epoch 并清 active id，使旧响应无效。
- StrictMode effect setup 每次将 mounted 恢复 true，cleanup 使请求失效；合法第二次 setup 响应不被误丢。
- active draft 对应 approval 离开 pending 时，仅退出内存流程并显示“待办状态已变化”；session 草稿保留，其他待办可继续选择，用户可显式“放弃该草稿”后清除。

### GREEN / 回归

目标移动组：退出码 0；`4 passed (7.7s)`。

完整移动组：

```powershell
corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts --config playwright.task5-fix1.config.ts
```

退出码 0；`7 passed (9.7s)`。

纯函数 / allocator / API：

```powershell
corepack pnpm vitest run tests/unit/web/outbound-workflow.test.ts tests/unit/inventory/outbound-allocator.test.ts tests/integration/inventory/outbound-service.test.ts
```

退出码 0；`3 passed` test files、`24 passed` tests。

桌面回归：

```powershell
corepack pnpm playwright test tests/e2e/admin/outbound.spec.ts --config playwright.task5-fix1.config.ts
```

退出码 0；`3 passed (6.4s)`。

```powershell
corepack pnpm --filter @warehouse/web typecheck
corepack pnpm --filter @warehouse/api typecheck
git diff --check
```

均退出码 0；Web/API TypeScript 0 errors；无 whitespace error（仅 LF→CRLF 提示）。

### Commit / Concerns / 清理

- Fix commit：见本节所在提交。
- 本轮无产品 concern；成功 payload 与真实路由 stock-changed→409 留作已登记 Minor，未扩张。
- 临时 Playwright config/启动脚本验证后删除，未提交。
- 最终 3301/5474 释放；3001/5174 原监听未停止或修改；无生产 DB、Secret、部署或 push。

---

## Fix Round 3 / 5（base `23f787c`）

### Status

DONE。仅修复 pending 请求未决时把所有持久草稿误判 stale 并开放删除入口的问题；未处理 render-purity 与其他已登记 Minor。

### RED

隔离移动目标组（API 3301 / Web 5474、memory/local-auth）：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts --config playwright.task5-fix3.config.ts --grep "waits for pending|only after pending"
```

退出码 1；`2 failed`。两个延迟 pending 用例在“正在读取待出库审批…”期间，`stale-draft-approval-1` 期望 count 0、实际均为 1，证明未决空数组被误当为已加载空列表。

### 最小修复

- `OutboundPage` 显式传递 `loading | loaded | error` pending 状态。
- `MobileOutboundFlow` 只在 `loaded` 时运行 active 草稿恢复、active approval 离开 pending 判定，以及 stale 列表分类/删除入口渲染。
- loading 期间不显示 stale、不恢复错误状态；error 期间由父页显示加载错误且不开放未知状态草稿删除；loaded 且含审批时恢复 active，loaded 空列表时才显示 stale。
- 保留 StrictMode 的 mounted/epoch 语义，不改变 options 请求生命周期。

### GREEN / 回归

目标 E2E：退出码 0；`2 passed (6.5s)`。

移动全组：

```powershell
corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts --config playwright.task5-fix3.config.ts
```

退出码 0；`11 passed (13.1s)`。

纯函数 / allocator / API：退出码 0；`3 passed` test files、`26 passed` tests。

桌面回归：退出码 0；`3 passed (6.6s)`。

```powershell
corepack pnpm --filter @warehouse/web typecheck
corepack pnpm --filter @warehouse/api typecheck
git diff --check
```

均退出码 0；Web/API TypeScript 0 errors；无 whitespace error（仅 LF→CRLF 提示）。

### Commit / Concerns / 清理

- Fix commit：见本节所在提交。
- 本轮无产品 concern；render-purity 与其他已登记 Minor 未处理。
- 临时 Playwright config/启动脚本已删除，未提交。
- 最终 3301/5474 释放；3001/5174 原监听未停止或修改；无生产 DB、Secret、部署或 push。

---

## Fix Round 4 / 5（base `2e88d88`）

### Status

DONE。仅修复唯一 open Important：`OutboundPage.loadPending()` 的并发旧响应可覆盖较新刷新结果。所有初始 effect、手动刷新以及 confirm/cancel 完成后的刷新继续统一经过同一 `loadPending()` 接缝。

### RED

在隔离的 API 3301 / Web 5474、`PERSISTENCE_DRIVER=memory`、`LOCAL_AUTH_BYPASS=true` 环境增加可控重叠请求 E2E：先保持 active 草稿，随后让较早请求 A 延迟返回空数组、较新请求 B 立即返回 `approval-1`；B 恢复 active 后再释放 A。

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts --config playwright.task5-fix4.config.ts --grep "ignores an older empty pending response"
```

旧实现退出码 1；`1 failed (11.2s)`。释放 A 后最终找不到“待处理 1 张审批单”，失败定位在 active 状态保持断言，证明旧空响应覆盖 B 并把草稿重新归为 stale。

### 最小修复

- `OutboundPage` 增加单调 `pendingRequestEpoch`；每次 `loadPending()` 获取独立 epoch。
- 只有组件仍 mounted 且请求 epoch 仍为最新时，才能提交 `pending`、`loadError` 或 `loading=false`；旧成功、旧错误与旧 finally 均不能覆盖新状态。
- unmount / StrictMode cleanup 递增 epoch 并置 mounted=false，使全部在途请求失效；合法第二次 setup 恢复 mounted=true 后可发起新请求。
- 已卸载组件拒绝再启动 pending 请求；`loadPending` 仍保持空依赖，未形成 effect 自激。

### GREEN / 回归

目标并发 E2E：退出码 0；`1 passed (4.7s)`。

完整移动组：

```powershell
corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts --config playwright.task5-fix4.config.ts
```

退出码 0；`12 passed (11.6s)`。

纯函数 / allocator / API：

```powershell
corepack pnpm vitest run tests/unit/web/outbound-workflow.test.ts tests/unit/inventory/outbound-allocator.test.ts tests/integration/inventory/outbound-service.test.ts
```

退出码 0；`3 passed` test files、`26 passed` tests。

桌面回归：退出码 0；`3 passed (5.2s)`。

```powershell
corepack pnpm --filter @warehouse/web typecheck
corepack pnpm --filter @warehouse/api typecheck
git diff --check
```

均退出码 0；Web/API TypeScript 0 errors；无 whitespace error（仅 LF→CRLF 提示）。

### Commit / Concerns / 清理

- Fix commit：`fix: ignore stale pending responses`（见本节所在提交）；提交后工作树应为 clean。
- 本轮无新增产品 concern；progress ledger 中既有 render-purity 与其他 deferred Minor 未扩张、未处理。
- 临时 Playwright config 已删除且不提交。
- 验证后 3301/5474 均释放；3001/5174 原有监听保持，未停止或修改；无生产 DB、Secret、部署或 push。

---

## Fix Round 2 / 5（base `80f5c53`）

### Status

DONE。仅修复唯一 open Important：stale 草稿从单一临时 state 改为用户隔离、版本化、可枚举的持久索引，支持刷新恢复与多份 stale 草稿逐份处理。

### RED

纯逻辑：

```powershell
corepack pnpm vitest run tests/unit/web/outbound-workflow.test.ts
```

退出码 1；`2 failed / 7 passed`。失败精确为 `outboundDraftIndexKey is not a function` 与 `isOutboundDraftIndex is not a function`，索引接口尚不存在。

隔离移动目标组（API 3301 / Web 5474、memory/local-auth）：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts --config playwright.task5-fix2.config.ts --grep "restores a stale|keeps multiple stale"
```

退出码 1；`2 failed`。刷新后找不到 `stale-draft-approval-1`；第二份 stale 出现后同样找不到 approval-1，证明单值 state 无法持久恢复且会覆盖。

### 最小修复

- 新增 `warehouse.outbound.index.v1.<encoded userId>` 索引，沿用 session draft envelope 的 version/userId 校验；条目只含 `approvalId + weComSpNo`。
- 不扫描整个 sessionStorage；读取索引后仅验证每个固定 `outboundDraftKey(userId, approvalId)`，缺失、损坏、跨用户或 completed draft 安全修剪。
- 保存草稿同步幂等加入索引；成功、取消、active 放弃与 stale 放弃同步移除对应索引项，不影响其他用户或其他审批草稿。
- UI 从单一 `staleDraft` 改为紧凑列表；只展示已不在 pending 的索引条目，因此 active pending 恢复不被 stale 提示抢占；多个 stale 可逐份放弃。

### GREEN / 回归

纯逻辑：`9 passed`。

目标 E2E：`2 passed (6.5s)`。

移动全组：

```powershell
corepack pnpm playwright test tests/e2e/mobile/outbound.spec.ts --config playwright.task5-fix2.config.ts
```

退出码 0；`9 passed (11.2s)`。

纯函数 / allocator / API：

```powershell
corepack pnpm vitest run tests/unit/web/outbound-workflow.test.ts tests/unit/inventory/outbound-allocator.test.ts tests/integration/inventory/outbound-service.test.ts
```

退出码 0；`3 passed` test files、`26 passed` tests。

桌面回归：`3 passed (7.3s)`。

```powershell
corepack pnpm --filter @warehouse/web typecheck
corepack pnpm --filter @warehouse/api typecheck
git diff --check
```

均退出码 0；Web/API TypeScript 0 errors；无 whitespace error（仅 LF→CRLF 提示）。

### Commit / Concerns / 清理

- Fix commit：见本节所在提交。
- 本轮无产品 concern；已登记 Minor 未处理。
- 临时 Playwright config/启动脚本已删除，未提交。
- 最终 3301/5474 释放；3001/5174 原监听未停止或修改；无生产 DB、Secret、部署或 push。
