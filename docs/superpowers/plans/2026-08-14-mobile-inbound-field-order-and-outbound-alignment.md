# 手机端入库字段排序与出库对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变服务端批次权威、出库业务和桌面操作能力的前提下，让手机端入库的日期/批次字段统一、左对齐且按日期预览编号，并让出库状态卡片的图标和文字对齐。

**Architecture:** 批次预览是 `inbound-form.ts` 中不依赖网络的纯函数；`InboundPage` 只消费该值并继续提交原有的无 `batchNo` 请求。`OutboundPage` 负责状态卡片的语义结构，`MobileOutboundFlow` 仅在有待办、错误或失效草稿时呈现选择区域，以避免空态中的孤立标题，同时保持既有草稿清理能力。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Playwright、现有 CSS 变量和 lucide-react 图标。

## Global Constraints

- 移动端断点为 `max-width: 820px`；日期、批次预览和按钮最小触控高度为 `44px`，表单字体为 `16px`。
- 批次预览格式固定为 `YYYYMMDD-001`；它只是客户端格式预览，入库 POST 不得新增 `batchNo`，服务端返回的编号仍为最终结果。
- iOS/企业微信 WebView 中日期内容必须左对齐且保留原生日历选择器。
- 参考 `D:\桌面\固定资产\src\styles.css` 的统一输入规格、图标文字成组对齐和紧凑白卡片；不改固定资产项目源码。
- 821px 及以上保留现有桌面行为；不部署、不 Push、不连接生产数据或生产 Secret。

---

### Task 1: 入库日期与只读批次预览

**Files:**
- Modify: `apps/web/src/features/inbound/inbound-form.ts`
- Modify: `apps/web/src/pages/InboundPage.tsx:199-204`
- Modify: `apps/web/src/styles.css:251-267`
- Modify: `tests/unit/web/inbound-form.test.ts`
- Modify: `tests/e2e/mobile/inbound.spec.ts:39-82,181-190`

**Interfaces:**
- Consumes: `InboundDraft.purchasedAt: string`，格式为 HTML date input 的 `YYYY-MM-DD`。
- Produces: `previewInboundBatchNo(purchasedAt: string): string`；无日期时返回 `""`，有效日期时返回 `"YYYYMMDD-001"`。
- Preserves: `createInboundPayload(draft): InboundDraft` 返回值中没有 `batchNo`。

- [ ] **Step 1: 写入失败的纯函数与移动页面测试**

在 `tests/unit/web/inbound-form.test.ts` 导入 `previewInboundBatchNo`，新增下列断言：

```ts
it("previews the first server-style batch number from the selected purchase date", () => {
  expect(previewInboundBatchNo("2026-08-14")).toBe("20260814-001");
  expect(previewInboundBatchNo("")).toBe("");
  expect(previewInboundBatchNo("2026/08/14")).toBe("");
});
```

在 `tests/e2e/mobile/inbound.spec.ts` 将旧的“没有批次号”断言换成可访问性和顺序断言，并在日期变化后断言预览更新：

```ts
const date = page.getByLabel("采购日期 *");
const batchPreview = page.getByLabel("批次号（系统生成）");
await expect(batchPreview).toHaveAttribute("readonly", "");
await expect(batchPreview).toHaveValue("选择采购日期后自动生成");
await date.fill("2026-08-14");
await expect(batchPreview).toHaveValue("20260814-001");
expect(await date.evaluate((node) => node.compareDocumentPosition(
  document.querySelector<HTMLInputElement>('input[aria-label="批次号（系统生成）"]')!,
) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
```

并测量日期、批次、采购人输入框的 `width`/`height`，要求日期和批次均至少 44px 且与采购人宽度相等；检查 `input[type=date]`、`::-webkit-datetime-edit` 和 `::-webkit-date-and-time-value` 的 `textAlign` 为 `left`（浏览器支持伪元素时）。继续断言向 `/admin/inbound` 发出的 JSON 没有 `batchNo`。

- [ ] **Step 2: 运行测试，确认当前行为失败**

Run:

```powershell
corepack pnpm exec vitest run tests/unit/web/inbound-form.test.ts
corepack pnpm exec playwright test tests/e2e/mobile/inbound.spec.ts --grep "purchase date|批次"
```

Expected: 纯函数导入失败，且页面不存在标签为“批次号（系统生成）”的只读输入框；当前日期控件的 WebKit 编辑区在手机视口不能满足完整左对齐契约。

- [ ] **Step 3: 实现最小预览和统一控件样式**

在 `inbound-form.ts` 实现纯函数，只接受精确的 ISO 日期字符串：

```ts
export function previewInboundBatchNo(purchasedAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(purchasedAt.trim());
  return match ? `${match[1]}${match[2]}${match[3]}-001` : "";
}
```

在 `InboundPage.tsx` 计算 `const batchPreview = previewInboundBatchNo(form.purchasedAt);`，将采购字段依次渲染为日期、只读批次、采购人：

```tsx
<label>
  <span>批次号（系统生成）</span>
  <input aria-label="批次号（系统生成）" readOnly value={batchPreview || "选择采购日期后自动生成"} />
  <small>提交后由系统确认实际序号</small>
</label>
```

保留原日期 `onChange`、校验和 API payload；不得把 `batchPreview` 写入草稿或发送到 API。

在移动 CSS 中对 `.inbound-form input[type="date"]` 和普通 `.inbound-form input` 明确使用相同的 `width`、`min-height`、`box-sizing`、边框/圆角/内边距和 `font-size: 16px`。将日期字段本身以及 WebKit 的 `::-webkit-datetime-edit` 和 `::-webkit-date-and-time-value` 都设为 `text-align: left`；不得使用会破坏原生日期选择器的 `appearance: none`。

- [ ] **Step 4: 运行测试，确认通过并检查窄屏**

Run:

```powershell
corepack pnpm exec vitest run tests/unit/web/inbound-form.test.ts
corepack pnpm exec playwright test tests/e2e/mobile/inbound.spec.ts
corepack pnpm --filter @warehouse/web typecheck
```

Expected: 新增预览、字段顺序、只读、无 `batchNo` 请求、日期左对齐和 320/390/430/820px 无溢出断言通过；TypeScript 不报错。

- [ ] **Step 5: 提交入库变更**

```powershell
git add apps/web/src/features/inbound/inbound-form.ts apps/web/src/pages/InboundPage.tsx apps/web/src/styles.css tests/unit/web/inbound-form.test.ts tests/e2e/mobile/inbound.spec.ts
git commit -m "fix: align mobile inbound date and batch preview"
```

### Task 2: 出库状态卡片图文对齐和空态标题

**Files:**
- Modify: `apps/web/src/pages/OutboundPage.tsx:88-91`
- Modify: `apps/web/src/features/outbound/MobileOutboundFlow.tsx:127-131,263-267`
- Modify: `apps/web/src/styles.css:235-276`
- Modify: `tests/e2e/mobile/outbound.spec.ts:32-58,162-180,336-344`

**Interfaces:**
- Consumes: `pending: PendingApproval[]`、`pendingState`、现有 `visibleStaleDrafts`。
- Produces: `.outbound-status-notice`（图标和文字的稳定组）和 `showSelectionHeading`（仅有待办、失效草稿或流程错误时为真）。
- Preserves: 待出库的分配、取消、确认、失效草稿放弃和桌面 `DesktopOutboundTable`。

- [ ] **Step 1: 写入失败的出库移动端测试**

在 `tests/e2e/mobile/outbound.spec.ts` 增加空 pending 响应用例，并补充下列断言：

```ts
await loginAs(page, "/admin/outbound", "ADMIN");
await expect(page.getByText("当前没有待出库审批")).toBeVisible();
await expect(page.getByRole("heading", { name: "选择待办" })).toHaveCount(0);
const status = page.locator(".outbound-status-notice");
const icon = status.locator("svg");
const content = status.locator(".outbound-status-notice__content");
expect(await status.evaluate(({ getBoundingClientRect }) => {
  const { left: containerLeft } = getBoundingClientRect();
  const iconRect = icon.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();
  return iconRect.left >= containerLeft && contentRect.left > iconRect.right;
})).toBe(true);
```

修正为 Playwright 页面内可序列化的评估函数：在同一个 `status.evaluate` 中通过 `querySelector` 获取 SVG 和内容节点。另在现有“草稿状态已变化”用例断言“选择待办”仍可见，确保草稿清理入口不丢失。

- [ ] **Step 2: 运行测试，确认当前行为失败**

Run:

```powershell
corepack pnpm exec playwright test tests/e2e/mobile/outbound.spec.ts --grep "当前没有待出库审批|draft safely"
```

Expected: 当前移动端空 pending 状态仍渲染“选择待办”，且没有 `.outbound-status-notice` / `.outbound-status-notice__content` 的图文结构。

- [ ] **Step 3: 实现语义结构和对齐样式**

在 `OutboundPage.tsx` 用下列语义结构替换扁平 `.notice` 内容：

```tsx
<div className="notice outbound-status-notice">
  <ShieldCheck className="outbound-status-notice__icon" size={24} aria-hidden="true" />
  <div className="outbound-status-notice__content">
    <strong>{statusTitle}</strong>
    <p>管理员确认实际数量后系统即时检查并扣减库存。少出或零出必须填写原因，本次结案后不能补出。</p>
  </div>
</div>
```

CSS 使用 `display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 10px;`；图标 `flex`/grid 轨道不可收缩，内容最小宽度为零、文字左对齐并正常换行。把刷新按钮保持为 `inline-flex`、`align-items: center`、`justify-content: center`、固定图文间距，确保其在手机端不偏移。

在 `MobileOutboundFlow.tsx` 定义：

```ts
const showSelectionHeading = pending.length > 0 || visibleStaleDrafts.length > 0 || Boolean(reviewError);
```

在 `!draft` 分支中仅当 `showSelectionHeading` 为真渲染 `<h2>选择待办</h2>`。不可改变 stale draft 列表、选择卡片或异常显示的顺序。

- [ ] **Step 4: 运行测试，确认通过和移动回归**

Run:

```powershell
corepack pnpm exec playwright test tests/e2e/mobile/outbound.spec.ts
corepack pnpm exec playwright test tests/e2e/mobile/mobile-shell.spec.ts
corepack pnpm --filter @warehouse/web typecheck
```

Expected: 空态没有孤立标题；图标、标题、说明在 320px 至 820px 视口对齐且无横向溢出；失效草稿仍可见并可放弃；既有出库分配和桌面路由行为不回归。

- [ ] **Step 5: 提交出库变更**

```powershell
git add apps/web/src/pages/OutboundPage.tsx apps/web/src/features/outbound/MobileOutboundFlow.tsx apps/web/src/styles.css tests/e2e/mobile/outbound.spec.ts
git commit -m "fix: align mobile outbound status content"
```

### Task 3: 视觉验证、状态记录和交付门禁

**Files:**
- Modify: `PROJECT_STATUS.md`
- Modify: `.superpowers/sdd/2026-08-14-mobile-typography-and-batch-number/task-4-report.md` (or a new dated report if the existing report is not appropriate)
- Modify: `docs/superpowers/plans/2026-08-14-mobile-inbound-field-order-and-outbound-alignment.md`

**Interfaces:**
- Consumes: Task 1 和 Task 2 的已提交变更及本地验收环境 `192.168.3.21:5482`。
- Produces: 可复现的验证证据，且 `PROJECT_STATUS.md` 如实标记“本地验收待用户决定下一步”。

- [ ] **Step 1: 在隔离栈做最终移动/桌面验证**

Run (use isolated memory API/web ports, never stop the user acceptance listeners):

```powershell
corepack pnpm exec vitest run tests/unit/web/inbound-form.test.ts
corepack pnpm exec playwright test tests/e2e/mobile/inbound.spec.ts tests/e2e/mobile/outbound.spec.ts tests/e2e/mobile/mobile-shell.spec.ts
corepack pnpm exec playwright test tests/e2e/navigation/dashboard.spec.ts tests/e2e/admin/inbound.spec.ts
corepack pnpm --filter @warehouse/web typecheck
corepack pnpm --filter @warehouse/web build
git diff --check 1deb803..HEAD
```

Expected: 所有指定用例、类型检查、构建和 diff 检查通过。若 DockerDesktopVM 仍为 Off，不重启它，不运行 Docker 门禁，并在状态文档中说明。

- [ ] **Step 2: 在本地验收地址做浏览器视觉抽查**

打开 `http://192.168.3.21:5482/` 的管理员本地登录流程，检查 390px 等效布局：日期和批次框同宽、日期文本靠左、日期改为 `2026-08-14` 后批次显示 `20260814-001`、出库空态图文对齐且无孤立标题。此步骤只验证本地内存环境，不写入生产。

- [ ] **Step 3: 更新状态和计划复选框**

在 `PROJECT_STATUS.md` 追加实际提交、验证命令结果、验收地址和“未部署、未 Push、用户验收待决定”。在本计划中勾选已完成步骤；报告中记录 RED/ GREEN 结果和任何无法执行的 Docker 门禁。

- [ ] **Step 4: 使用 verification-before-completion 并提交文档**

在声称完成前读取 `superpowers:verification-before-completion`，重新运行至少状态中列出的窄门禁并确认输出，再执行：

```powershell
git add PROJECT_STATUS.md docs/superpowers/plans/2026-08-14-mobile-inbound-field-order-and-outbound-alignment.md .superpowers/sdd
git commit -m "docs: record mobile inbound alignment verification"
git status --short --branch
```

Expected: 工作树干净；仅交付本地验收，不部署、不 Push。

## Self-review

- **Spec coverage:** Task 1 覆盖日期左对齐、同规格控件、日期在前、只读 `YYYYMMDD-001` 预览和服务端权威；Task 2 覆盖出库图文对齐、空态孤立标题和失效草稿保留；Task 3 覆盖窄屏、桌面回归、状态更新和本地验收。
- **Placeholder scan:** 未发现未定事项标记、泛化“适当处理”或未命名测试步骤；每个测试、函数、选择器、命令和预期都有明确说明。
- **Type consistency:** `previewInboundBatchNo` 由纯模块导出并仅在页面消费；`showSelectionHeading` 使用当前 `pending`、`visibleStaleDrafts` 和 `reviewError`，不新增跨模块状态；批次预览不加入 `InboundDraft` 或请求负载。
