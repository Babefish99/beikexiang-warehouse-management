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
