# 手机端字阶与入库批次号实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让登记入库由服务端生成 `YYYYMMDD-001` 日序批次号，并将手机端视觉字阶收敛到电脑端设计语言。

**Architecture:** 新增纯批次号函数，由内存和 Prisma 入库存储共同调用；普通入库请求不再带 `batchNo`，存储层返回实际分配的号码。前端草稿和确认态不再保存手填批次，页面仅呈现自动规则；共享移动 CSS 负责标题字阶、仓库选择、快捷操作和日期左对齐。

**Tech Stack:** React 19、TypeScript、Vite、Fastify 5、Prisma 7、Vitest、Playwright。

## Global Constraints

- 仅修改 `D:\桌面\仓库\.worktrees\production-deployment` 的 `codex/production-deployment` 分支；不触碰 `D:\桌面\仓库` 的用户脏工作区。
- 正常登记入库的批次号格式必须严格为 `YYYYMMDD-001`，同一采购日期全局递增三位序号；期初库存和历史批次不改。
- 服务端是编号的唯一权威；客户端不得预测可提交的具体序号。
- 手机端在 `max-width: 820px` 下 H1/H2/H3 分别为 25px/18px/15px；仓库选择和快捷操作均为 14px，触控目标至少 44px。
- 不连接生产数据库、不读取或输出 Secret、不部署、不 Push；验收环境继续使用内存持久化。

---

### Task 1: 服务端自动日序批次号

**Files:**
- Create: `apps/api/src/application/inventory/batch-number.ts`
- Modify: `apps/api/src/application/inventory/inbound-service.ts`
- Modify: `apps/api/src/infrastructure/db/prisma-inventory-entry-store.ts`
- Test: `tests/unit/inventory/batch-number.test.ts`
- Test: `tests/integration/inventory/shared-memory-state.test.ts`

**Interfaces:**
- Consumes: 已校验的 ISO 采购日期和当前已存在批次号数组。
- Produces: `nextInboundBatchNo(purchasedAt: string, existingBatchNos: Iterable<string>): string`，以及 `recordStockEntry()` 返回的 `{ orderId, batchId, batchNo }`。

- [ ] **Step 1: 写失败的批次号单元测试**

```ts
expect(nextInboundBatchNo("2026-08-14T00:00:00.000Z", [])).toBe("20260814-001");
expect(nextInboundBatchNo("2026-08-14T00:00:00.000Z", ["20260814-001", "20260814-009"])).toBe("20260814-010");
expect(() => nextInboundBatchNo("invalid", [])).toThrow("purchasedAt is invalid");
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `corepack pnpm exec vitest run tests/unit/inventory/batch-number.test.ts`

Expected: FAIL，因为 `batch-number.ts` 与 `nextInboundBatchNo` 尚不存在。

- [ ] **Step 3: 实现纯函数与服务端接口**

```ts
export function nextInboundBatchNo(purchasedAt: string, existingBatchNos: Iterable<string>): string {
  const date = new Date(purchasedAt);
  if (Number.isNaN(date.getTime())) throw new Error("purchasedAt is invalid");
  const prefix = date.toISOString().slice(0, 10).replaceAll("-", "");
  const highest = [...existingBatchNos]
    .map((value) => new RegExp(`^${prefix}-(\\d{3})$`).exec(value)?.[1])
    .filter((value): value is string => Boolean(value))
    .reduce((max, value) => Math.max(max, Number(value)), 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}
```

`InboundInput` 删除 `batchNo`，而 `StockEntryInput` 增加 `autoGenerateBatchNo: boolean` 和可选 `batchNo`。普通入库设置 `autoGenerateBatchNo: true`；期初库存继续传入手工批次号和 `false`。内存存储从状态中的现有批次生成号码；Prisma 存储在事务内查询同日格式批次、写入唯一号码，并且只在自动生成路径收到 Prisma `P2002` 时重试三次。两个存储均返回实际 `batchNo`，`InboundService.create()` 返回它。

- [ ] **Step 4: 写内存 API 集成断言**

```ts
const first = await admin.post("/admin/inbound", { data: validInboundWithoutBatchNo });
const second = await admin.post("/admin/inbound", { data: validInboundWithoutBatchNo });
expect(await first.json()).toMatchObject({ batchNo: "20260814-001" });
expect(await second.json()).toMatchObject({ batchNo: "20260814-002" });
```

并保留 `POST /admin/opening-stock` 含手工 `batchNo` 的既有断言。

- [ ] **Step 5: 运行 GREEN 验证**

Run: `corepack pnpm exec vitest run tests/unit/inventory/batch-number.test.ts tests/integration/inventory/shared-memory-state.test.ts`

Expected: PASS；两个正常入库请求按日期得到 `001`、`002`，期初库存路径仍通过。

- [ ] **Step 6: 提交服务端任务**

```bash
git add apps/api/src/application/inventory/batch-number.ts apps/api/src/application/inventory/inbound-service.ts apps/api/src/infrastructure/db/prisma-inventory-entry-store.ts tests/unit/inventory/batch-number.test.ts tests/integration/inventory/shared-memory-state.test.ts
git commit -m "feat: generate inbound batch numbers by purchase date"
```

### Task 2: 入库表单和确认态移除手工批次

**Files:**
- Modify: `apps/web/src/features/inbound/inbound-form.ts`
- Modify: `apps/web/src/pages/InboundPage.tsx`
- Modify: `apps/api/src/routes/admin/inbound.ts`
- Test: `tests/unit/web/inbound-form.test.ts`
- Test: `tests/e2e/mobile/inbound.spec.ts`

**Interfaces:**
- Consumes: `POST /admin/inbound` 的无 `batchNo` 请求与返回值 `{ inboundId, batchIds, batchNo }`。
- Produces: 没有 `batchNo` 的 `InboundDraft`、只读自动批次说明、包含实际号码的完成消息。

- [ ] **Step 1: 写失败的前端与端到端测试**

```ts
expect(createInboundPayload(validInbound)).not.toHaveProperty("batchNo");
await expect(page.getByLabel("批次号 *")).toHaveCount(0);
await expect(page.getByText("按采购日期自动生成，例如 20260814-001")).toBeVisible();
await expect(page.getByText("入库已登记：inbound-1，批次 20260814-001")).toBeVisible();
```

把旧的 `B-001` 填写、草稿恢复和批次字段错误断言替换为“客户端不传 batchNo、服务端返回实际批次号”的断言。

- [ ] **Step 2: 运行测试确认 RED**

Run: `corepack pnpm exec vitest run tests/unit/web/inbound-form.test.ts` and `corepack pnpm exec playwright test tests/e2e/mobile/inbound.spec.ts --config playwright.config.ts`

Expected: FAIL，因为表单仍要求并发送 `batchNo`。

- [ ] **Step 3: 实现最小表单迁移**

将草稿 schema 升级为不含 `batchNo` 的新版本，旧 sessionStorage 草稿安全忽略。采购与批次分组将可编辑输入替换为固定说明文本；确认摘要显示“按采购日期自动生成”。API 路由 payload 不再读取或校验客户端 `batchNo`，并将服务端实际号码写入 201 响应与成功提示。

- [ ] **Step 4: 运行 GREEN 验证**

Run: `corepack pnpm exec vitest run tests/unit/web/inbound-form.test.ts` and `corepack pnpm exec playwright test tests/e2e/mobile/inbound.spec.ts --config playwright.config.ts`

Expected: PASS；手机和桌面入库都没有可编辑批次号，成功页面显示服务端号码，失败草稿保留其它录入值。

- [ ] **Step 5: 提交表单任务**

```bash
git add apps/web/src/features/inbound/inbound-form.ts apps/web/src/pages/InboundPage.tsx apps/api/src/routes/admin/inbound.ts tests/unit/web/inbound-form.test.ts tests/e2e/mobile/inbound.spec.ts
git commit -m "feat: remove manual inbound batch entry"
```

### Task 3: 手机端字阶、仓库选择和日期对齐

**Files:**
- Modify: `apps/web/src/styles.css`
- Test: `tests/e2e/mobile/mobile-shell.spec.ts`
- Test: `tests/e2e/mobile/inbound.spec.ts`

**Interfaces:**
- Consumes: `.mobile-dashboard__warehouse`、`.mobile-dashboard__actions`、`.page-header h1`、`.inbound-form` 的现有语义 DOM。
- Produces: 在 320px、390px、430px、820px 下可计算的统一字阶和左对齐日期输入。

- [ ] **Step 1: 写失败的视觉度量断言**

```ts
expect(await warehouseSelect.evaluate((node) => getComputedStyle(node).fontSize)).toBe("14px");
expect(await action.evaluate((node) => getComputedStyle(node).fontSize)).toBe("14px");
expect(await page.locator("h1").first().evaluate((node) => getComputedStyle(node).fontSize)).toBe("25px");
expect(await page.locator(".inbound-form__group legend").first().evaluate((node) => getComputedStyle(node).fontSize)).toBe("15px");
expect(await dateInput.evaluate((node) => getComputedStyle(node).textAlign)).toBe("left");
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `corepack pnpm exec playwright test tests/e2e/mobile/mobile-shell.spec.ts tests/e2e/mobile/inbound.spec.ts --config playwright.config.ts`

Expected: FAIL，当前仓库选择会被通用移动输入规则提升为 16px，移动首页 H1 为 21px，日期控件没有显式左对齐。

- [ ] **Step 3: 实现共享移动样式**

在最终移动媒体查询中，以高于通用 `input, select, textarea` 的选择器将 `.mobile-dashboard__warehouse select` 与 `.mobile-dashboard__actions a` 设为 14px；将页面 H1 统一为 25px、概览 H2 为 18px、表单 legend/H3 为 15px。为 `input[type="date"]` 和 `::-webkit-datetime-edit` 写入 `text-align: left`，不改最小高度、边框、颜色或底部导航安全区。

- [ ] **Step 4: 运行 GREEN 和窄屏回归**

Run: `corepack pnpm exec playwright test tests/e2e/mobile/mobile-shell.spec.ts tests/e2e/mobile/inbound.spec.ts tests/e2e/mobile/mobile-viewport-matrix.spec.ts --config playwright.config.ts`

Expected: PASS；手机首页控制字体一致、三级标题递减、日期左对齐，320/390/430/820 无横向溢出。

- [ ] **Step 5: 提交视觉任务**

```bash
git add apps/web/src/styles.css tests/e2e/mobile/mobile-shell.spec.ts tests/e2e/mobile/inbound.spec.ts
git commit -m "style: align mobile typography with desktop"
```

### Task 4: 文档与完整验证

**Files:**
- Modify: `PROJECT_STATUS.md`
- Modify: `.superpowers/sdd/2026-08-13-mobile-responsive/task-8-report.md`

**Interfaces:**
- Consumes: 三个实现任务的提交、测试输出和当前本地验收环境边界。
- Produces: 可复查的批次号规则、手机视觉验收证据和未部署状态。

- [ ] **Step 1: 运行类型检查和构建**

Run: `corepack pnpm --filter @warehouse/api typecheck; corepack pnpm --filter @warehouse/web typecheck; corepack pnpm --filter @warehouse/web build`

Expected: 三个命令退出码均为 0。

- [ ] **Step 2: 运行聚焦与全量非 Docker 验证**

Run: `corepack pnpm exec vitest run --exclude tests/deployment/**` and `corepack pnpm exec playwright test --config playwright.config.ts`

Expected: 非 Docker Vitest 与隔离 E2E 全部通过；若 DockerDesktopVM 仍为 Off，则记录并跳过 Docker 门禁，不重启 Docker。

- [ ] **Step 3: 更新状态和验收记录**

在 `PROJECT_STATUS.md` 写明自动批次仅适用于正常入库、格式 `YYYYMMDD-001`、内存验收未接生产数据、未部署未 Push；报告记录 RED/GREEN、端口和手机白名单验收边界。

- [ ] **Step 4: 运行收尾检查并提交**

Run: `git diff --check 1deb803..HEAD` and `git status --short --branch`

Expected: diff 检查无输出，工作树只显示分支行。

```bash
git add PROJECT_STATUS.md
git commit -m "docs: record mobile batch and typography verification"
```
