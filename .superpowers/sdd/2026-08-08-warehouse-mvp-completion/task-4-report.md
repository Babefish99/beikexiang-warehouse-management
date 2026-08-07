# Task 4 Report

## DONE

- 报表服务已接入当前内存库存流水源，汇总与交易明细不再读取空数组。
- 报表支持按期间与交易类型筛选，`all / inbound / outbound / transfers / returns / adjustments` 可查询。
- 调拨、退库、盘点调整已在交易明细中单独列示。
- 导出已实现为 Excel 兼容的 UTF-8 BOM CSV 下载，响应头为可下载附件，不再保留“导出待接入”占位按钮。
- 首页卡片改为读取真实接口数据，不再显示假数据或破折号。
- 前端报表错误会提示且保留当前筛选值；导出仅在报表查询不可用时禁用。

## 阻塞

- 无任务内阻塞。
- 说明：仓库流程里的 `requesting-code-review` 依赖 reviewer 子代理；本会话没有可用的该类分发能力，因此未自动执行该额外流程，但不影响本次实现、验证与提交。

## 修改文件

- `apps/api/src/application/inventory/stocktake-service.ts`
- `apps/api/src/application/reports/report-query-service.ts`
- `apps/api/src/infrastructure/export/report-export.ts`
- `apps/api/src/routes/admin/reports.ts`
- `apps/api/src/server.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/pages/ReportsPage.tsx`
- `tests/unit/reports/report-query.test.ts`
- `tests/integration/reports/excel-export.test.ts`
- `tests/e2e/admin/reports.spec.ts`

## 导出格式

- 当前运行时没有可用的 xlsx/artifact 依赖，因此采用 UTF-8 BOM CSV 作为 Excel 兼容导出格式。
- 下载文件名格式：`inventory-report-<period>-<type>.csv`

## 测试结果

- `corepack pnpm vitest run tests/unit/reports/report-query.test.ts` ✅
- `corepack pnpm vitest run tests/integration/reports/excel-export.test.ts` ✅
- `corepack pnpm exec playwright test tests/e2e/admin/reports.spec.ts --reporter=line` ✅
- `corepack pnpm typecheck` ✅
- `git diff --check` ✅

## Commit

- `feat: wire live inventory reports and export` (current HEAD at delivery)
