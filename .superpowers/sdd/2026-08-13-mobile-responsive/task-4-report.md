# Task 4 Report — 手机入库单页分组式

## Status

Complete. 已在 `codex/mobile-responsive` 隔离工作树实现可恢复的手机入库单页分组式，同时保留桌面双列完整操作语义。未部署、未 push、未连接生产数据库、未读取或持久化生产 Secret。

## 改动文件

- `apps/web/src/features/drafts/session-draft.ts`
- `apps/web/src/features/inbound/inbound-form.ts`
- `apps/web/src/pages/InboundPage.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `tests/unit/web/session-draft.test.ts`
- `tests/unit/web/inbound-form.test.ts`
- `tests/e2e/mobile/inbound.spec.ts`
- `.superpowers/sdd/2026-08-13-mobile-responsive/task-4-report.md`

## RED 证据

### 纯逻辑初始 RED

命令：

```powershell
corepack pnpm vitest run tests/unit/web/session-draft.test.ts tests/unit/web/inbound-form.test.ts
```

精确结果：退出码 1；`2 failed` test files、`no tests`。失败原因分别为无法解析尚不存在的：

- `apps/web/src/features/drafts/session-draft`
- `apps/web/src/features/inbound/inbound-form`

### Decimal 正零边界 RED

首次最小实现后运行同一纯逻辑命令，精确结果：退出码 1；`1 failed | 10 passed`。`quantity: "0"` 的验证期望 `{ quantity: "数量必须为正数" }`，实际为 `{}`。原因是 Decimal.js 的 `isPositive()` 不表达严格大于零；生产实现改为 `greaterThan(0)`。

### 损坏 envelope RED

命令：

```powershell
corepack pnpm vitest run tests/unit/web/session-draft.test.ts
```

精确结果：退出码 1；`1 failed | 3 passed`。匹配用户与版本但缺少 `value` 的合法 JSON envelope，期望安全返回 `null`，实际返回 `undefined`。生产实现增加对象形状与自有 `value` 字段检查。

### 移动交互初始 RED

隔离启动：Playwright `webServer` 临时配置只启动本工作树 API `3301` 与 Web `5474`；API 设置 `PERSISTENCE_DRIVER=memory`、`LOCAL_AUTH_BYPASS=true`，Web 设置 `VITE_API_BASE_URL=http://127.0.0.1:3301`。临时配置与两个本地启动脚本在验证后已删除，未提交。

命令：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/inbound.spec.ts --config playwright.task4.config.ts
```

精确结果：退出码 1；`6 failed`（67.9s）。五项找不到命名分组 `仓库与物品`；成功流程一项等待 `确认入库` dialog 按钮超时。失败与现有页面缺少分组、确认弹窗、移动草稿流程一致。

实现后首轮结果：退出码 1；`4 passed / 2 failed`（10.6s）。两项仅因 Playwright 模糊按钮名同时匹配 `关闭确认入库` 与 `确认入库`，strict mode 报 2 elements；测试改用 `exact: true`，未改变产品要求。

## GREEN 与回归证据

### 纯逻辑最终 GREEN

```powershell
corepack pnpm vitest run tests/unit/web/session-draft.test.ts tests/unit/web/inbound-form.test.ts
```

精确结果：退出码 0；`2 passed` test files，`11 passed` tests。

### Web 类型检查

```powershell
corepack pnpm --filter @warehouse/web typecheck
```

精确结果：退出码 0；`tsc -b --pretty false` 无错误。

### 移动、桌面与权限隔离回归

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/inbound.spec.ts --config playwright.task4.config.ts
```

首次产品 GREEN：退出码 0；`6 passed (8.2s)`。

补充桌面与权限回归后的最终结果：退出码 0；`8 passed (9.3s)`，覆盖：

- 隔离 3301 上未登录 `/admin/inbound` 与 `/admin/opening-stock` 均返回 401；
- 390×844 单页三组、预计金额、确认摘要、失败保留、刷新恢复、主动放弃清草稿；
- 成功后仅保留仓库、采购日期、采购人，进入明确成功状态；
- 提交期间确认按钮 disabled 且总 POST 次数为 1；
- 320 / 390 / 430 / 820 无横向溢出且保存按钮高度至少 44px；
- 1280px 桌面保持双列网格并展示完整确认摘要。

`tests/e2e/admin/inbound.spec.ts` 未直接执行：它把请求硬编码为 `http://localhost:3001`，直接运行会触碰明确禁止的主工作树端口。没有修改该基础设施；其“未登录入库和期初库存均为 401”语义已在本任务 E2E 使用 env-aware `apiUrl()` 对隔离 3301 等价覆盖并通过。

### Diff 与隔离清理

```powershell
git diff --check
```

精确结果：退出码 0，无 whitespace error。

最终端口检查：3301、5474 均 `FREE`；3001、5174 原有监听仍在，未停止、未修改。

## 质量边界自审

### Decimal 与字段规则

- `calculateInboundAmount` 只用 Decimal.js：`0.1 × 0.2 = 0.02`，不使用浮点 `Number` 计算金额。
- 空白或非法数值返回 `null`；数量严格大于零；单价非负；零价在 Decimal 归一化后要求非空备注。
- 仓库、物品、批次、数量、单价、采购日期均有明确字段错误；没有持久化空白占位行的概念，当前模型是单笔入库表单。

### 草稿隔离与安全

- key 为 `warehouse.inbound.v1.<userId>`，envelope 同时校验 userId 与 version。
- JSON 损坏、缺字段、用户不匹配、版本不兼容均安全返回 `null`。
- 恢复后仅清理失效仓库或物品引用，其余字段保留并提示 `标准数据已变化，请重新选择`。
- 仅保存入库表单的非敏感业务字段；不保存 cookie、token、密码、Secret 或生产配置。
- 主动放弃与成功均清草稿；服务端失败、网络错误、401 均保留草稿。

### 确认与重复提交

- 点击保存先运行纯函数校验，再打开摘要 `ModalDialog`。
- 提交中设置 busy/disabled，并以函数入口 guard 防止重复提交；E2E 断言 POST 仅一次。
- 成功清草稿、调用 `resetInboundAfterSuccess`、显示成功状态并派发 `warehouse:business-completed`。

### 移动与桌面

- `<=820px` 为三组单列：`仓库与物品`、`批次与采购信息`、`数量与预计金额`。
- 表单控件和按钮移动端最小高度 44px；320/390/430/820 E2E 均无横溢。
- `>820px` fieldset 使用 `display: contents` 维持原两列网格与完整字段/确认/提交语义。
- 预计金额在 render 期间派生；主数据请求使用 `Promise.all`；同类字段由稳定 `updateField` 更新；没有组件内定义组件或 effect 镜像派生值。

### 权限

- App 仍只在既有 ADMIN 路由分支渲染入库页；未新增客户端伪权限。
- FINANCE/APPLICANT 分支未改变；服务端权限未修改。
- 隔离未登录 401 回归通过。

## Commit 列表

- `667b94a feat: add recoverable mobile inbound form`
- 报告提交：见本文件所在提交。

## Concerns

- 唯一验证限制是旧 `tests/e2e/admin/inbound.spec.ts` 的 3001 硬编码与本任务隔离要求冲突；已用同语义 env-aware 3301 E2E 覆盖，不修改旧测试基础设施。
- Playwright 独立栈需要一次性临时配置才能在宿主后台进程策略下托管 3301/5474；临时文件已删除。仓库默认 Playwright config 仍指向 3001/5174，后续在相同隔离约束下复跑应采用等价的外部临时 config 或先统一仓库测试端口配置（不属于 Task 4）。

## 隔离进程所有权与清理

- 启动前确认 3301/5474 均空闲。
- 所有 Task 4 浏览器验证均由 Playwright `webServer` 启动并拥有本工作树命令，固定 API 3301 / Web 5474；API 为 memory persistence。
- Playwright 结束后自动回收其子进程；最终确认 3301/5474 均空闲。
- 3001/5174 原有监听全程保留，未终止、未修改；未访问生产数据库、未部署、未 push。

---

## Fix Round 1 / 5（base `14ca575`）

### Status

已修复三个 Important：入库草稿 runtime shape、Decimal(18,4) 输入域与提交规范化、提交失败在仍打开确认弹窗中的可见性与重试语义。

### 真实 schema / API 语义核对

- `prisma/schema.prisma` 中 `InboundLine.quantity/unitCost` 与 `ProcurementBatch.quantity/unitCost` 均为 `@db.Decimal(18, 4)`；即最多 18 位总精度、4 位小数、14 位整数。
- `InboundService.create()` 接收字符串 quantity/unitCost，使用 Decimal 校验并传入 store；purchasedAt 是字符串并由服务端转换为 ISO DateTime。
- 本轮不连接真实数据库；客户端在 POST 前对两个 Decimal 字段执行相同精度边界约束，并发送规范化普通十进制字符串，日期发送已 trim 的 `YYYY-MM-DD`。

### RED 1：runtime shape 与 Decimal(18,4) 纯逻辑

命令：

```powershell
corepack pnpm vitest run tests/unit/web/session-draft.test.ts tests/unit/web/inbound-form.test.ts
```

精确结果：退出码 1；`2 failed` test files，`5 failed | 11 passed` tests。

- `readSessionDraft(..., guard)` 未消费 guard，array `[]` 被原样返回而非 `null`。
- `isInboundDraft` 与 `createInboundPayload` 不存在。
- 科学计数/超精度格式没有字段错误。
- `calculateInboundAmount("1e1000000", "2")` 未返回 `null`，而是展开为巨量零字符串，证明存在无界 `toFixed` 风险。

### RED 2：浏览器页面接线 mutation check

为了证明 E2E 能捕获页面接线缺失，在保持纯函数实现的情况下临时移除 InboundPage 的 guard、payload builder 与 modal alert 接线；mutation 随后全部恢复，未提交。

隔离命令（临时 Playwright config 托管本树 API 3301 / Web 5474，API 为 memory persistence + local auth）：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/inbound.spec.ts --config playwright.task4-fix.config.ts --grep "failed draft|invalid runtime"
```

精确结果：退出码 1；`2 failed`。

- POST 实际 payload 为 `quantity: "01.2300"`、`unitCost: "0000.2000"`，期望 `"1.23"`、`"0.2"`。
- sessionStorage 中 `{ quantity: 2 }` 的损坏入库草稿导致页面标题 `登记入库` 5 秒内不可见，即页面白屏。

随后单独推进失败可见性断言：

```powershell
corepack pnpm playwright test tests/e2e/mobile/inbound.spec.ts --config playwright.task4-fix.config.ts --grep "failed draft"
```

精确结果：退出码 1；`1 failed`。仍打开的 `确认入库` dialog 内 `getByRole("alert")` 5 秒内不存在；证明原页面 alert 被 backdrop 隔离，用户在弹窗语义中看不到失败原因。

### 修复

- `readSessionDraft` 新增可选 type guard；匹配 envelope 后仍必须通过 value runtime guard。
- `isInboundDraft` 仅接受非 null、非 array 对象，且 brief 中 8 个必需字段全部是字符串。
- Decimal 输入先用有界普通十进制格式解析：拒绝指数、hex、负零、超过 4 位小数、超过 14 位整数；`99999999999999.9999` 上限通过。格式检查通过后才构造 Decimal 并执行正数/非负业务规则。
- `calculateInboundAmount` 共用有界解析，巨大指数在 Decimal/toFixed 前返回 `null`。
- `createInboundPayload` 对 quantity/unitCost 使用 Decimal `toString()`，并 trim batchNo、purchasedAt、purchaser、remark；E2E mock POST 断言关键 payload。
- 服务端或网络错误继续保持确认弹窗打开，并在 dialog body 内以 `role=alert` 显示；busy 结束后确认按钮重新 enabled，可修复外部状态后重试，草稿不清除。

### GREEN / 回归

纯逻辑：

```powershell
corepack pnpm vitest run tests/unit/web/session-draft.test.ts tests/unit/web/inbound-form.test.ts
```

精确结果：退出码 0；`2 passed` test files，`16 passed` tests。

移动 / 桌面 / 权限隔离回归：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/inbound.spec.ts --config playwright.task4-fix.config.ts
```

精确结果：退出码 0；`9 passed (9.1s)`：

- 未登录入库与期初库存 401 权限语义；
- 失败草稿、规范化 payload、dialog 内 alert、按钮重新 enabled、刷新恢复；
- 损坏 runtime 草稿安全忽略且页面可用；
- 成功与防重复提交；
- 320 / 390 / 430 / 820 手机无横溢与触控；
- 1280 桌面双列与完整确认摘要。

类型检查：

```powershell
corepack pnpm --filter @warehouse/web typecheck
```

精确结果：退出码 0；`tsc -b --pretty false` 无错误。

`git diff --check`：退出码 0，无 whitespace error。

### 隔离进程清理与 concerns

- 启动前 3301/5474 均空闲；临时 Playwright config 与两个本地启动脚本只用于本轮隔离验证，GREEN 后已删除，未提交。
- 验证后 3301/5474 均 `FREE`；3001/5174 原监听仍在，未停止、未修改。
- 未读取生产 Secret、未连接生产数据库、未部署、未 push。
- 本轮无剩余产品 concern；旧 admin spec 的隔离问题按指示不扩张。

### Fix Round 1 commits / status

- Fix commit：见本节所在提交。
- 提交后确认 `git status` clean。

---

## Fix Round 2 / 5（base `49829c2`）

### Scope 与 RED

仅修复确认弹窗失败时重复 live-region：旧实现同时在页面背景与仍打开的 dialog 内渲染相同 `role="alert"`。E2E 在失败/重试场景新增断言：全页 alert 数量恰好 1，且该 alert 的最近 `[role="dialog"]` 非空。

隔离命令：

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
corepack pnpm playwright test tests/e2e/mobile/inbound.spec.ts --config playwright.task4-fix2.config.ts --grep "failed draft"
```

精确 RED：退出码 1；`1 failed`。`page.getByRole("alert")` 期望 count 1、实际 count 2；5 秒内连续 14 次解析都得到 2 个元素。

### 最小修复

页面级错误只在 `error && !confirming` 时渲染；确认 dialog 内的 alert 保留。未改失败保持草稿、按钮重新 enabled 或重试行为。

### GREEN / 回归

目标覆盖：同一隔离命令退出码 0；`1 passed (6.2s)`。确认失败后全页只有一个 alert，且位于 dialog 内。

完整入库 E2E 首轮：`8 passed / 1 failed (11.4s)`；唯一失败在 320px 用例进入产品页面前，Windows 导航到本地登录地址返回 `net::ERR_NO_BUFFER_SPACE`。按有界环境诊断，在确认 3301/5474 已释放后只重跑完整组一次：

```powershell
corepack pnpm playwright test tests/e2e/mobile/inbound.spec.ts --config playwright.task4-fix2.config.ts
```

精确最终结果：退出码 0；`9 passed (9.7s)`，包括失败/重试、损坏草稿、成功防重复、320/390/430/820 手机、1280 桌面、未登录权限。

类型与静态验证：

```powershell
corepack pnpm --filter @warehouse/web typecheck
git diff --check
```

精确结果：两条命令均退出码 0；TypeScript 无错误、无 whitespace error。

### 隔离清理 / concerns / status

- 临时 Playwright config 与本地启动脚本验证后删除，未提交。
- 3301/5474 最终空闲；3001/5174 原监听未停止、未修改。
- 未触生产、数据库、Secret、部署或 push；未处理任何其他 Minor。
- 唯一环境瞬态为已在一次有界重跑中消失的 `ERR_NO_BUFFER_SPACE`；无产品 concern。
- Fix commit：见本节所在提交；提交后 `git status` clean。
