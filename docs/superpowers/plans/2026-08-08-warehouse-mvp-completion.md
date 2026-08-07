# 集团仓库 MVP 完成功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 完成当前仓库系统所有已暴露但尚未闭环的 MVP 功能，最终一次性验收。

**Architecture:** 保持现有 React/Vite + Fastify 分层结构。库存规则继续集中在 API application/domain service 中，页面只负责表单状态和请求；所有数量、金额、期间和不可删除规则由服务端最终校验。先完成可操作的内存运行版，再用同一接口替换持久化实现。

**Tech Stack:** TypeScript、React、Vite、Fastify、Vitest、Playwright、Decimal.js、Prisma/PostgreSQL。

## Global Constraints

- 企业微信仍是申请和审批入口；本地开发登录只用于测试。
- 管理员实际出库时选择仓库、批次和数量；不预占库存。
- 实际出库不能超过审批数量，可以少出；少出或零出必须填写原因，且审批单只能结案一次。
- 出库金额使用入库批次采购单价；调拨沿用原批次和单价。
- 调拨无需审批；退库必须关联原审批和原出库；盘点差异必须填写原因并保留前后数量。
- 已确认记录不可删除；月度结账后禁止直接修改当期流水。
- 历史 Excel 只归档；期初库存以实盘后录入为准。

---

### Task 1: 出库确认闭环

Reference: docs/superpowers/specs/2026-08-08-outbound-confirmation-design.md and docs/superpowers/plans/2026-08-08-outbound-confirmation.md.

Implement the available-batch API, expandable approval editor, multi-warehouse/batch allocations, partial/zero issue reason validation, server confirmation, success refresh, and E2E payload/error tests.

### Task 2: 调拨、退库和月度盘点表单

Files:
- Modify: apps/api/src/application/inventory/transfer-service.ts
- Modify: apps/api/src/application/inventory/return-service.ts
- Modify: apps/api/src/application/inventory/stocktake-service.ts
- Modify: apps/api/src/routes/admin/transfers.ts
- Modify: apps/api/src/routes/admin/returns.ts
- Modify: apps/api/src/routes/admin/stocktake.ts
- Modify: apps/web/src/pages/TransfersPage.tsx
- Modify: apps/web/src/pages/ReturnsPage.tsx
- Modify: apps/web/src/pages/StocktakePage.tsx
- Test: tests/integration/inventory/transfer-return.test.ts
- Test: tests/integration/inventory/stocktake-close.test.ts
- Test: tests/e2e/admin/inventory-operations.spec.ts

Add read endpoints for selectable balances and issued allocations, then build forms. Transfer selects source/destination warehouse, item, batch, quantity, and required reason. Return selects original outbound allocation, quantity, and required reason. Stocktake selects period, warehouse, item, batch, book quantity, actual quantity, and requires a difference reason. Confirmations display server results and keep form values on errors.

### Task 3: 物品、仓库和入库选择器

Files:
- Modify: apps/api/src/application/warehouses/warehouse-service.ts
- Modify: apps/api/src/routes/admin/warehouses.ts
- Modify: apps/web/src/pages/ItemsPage.tsx
- Modify: apps/web/src/pages/WarehousesPage.tsx
- Modify: apps/web/src/pages/InboundPage.tsx
- Modify: apps/web/src/pages/OpeningStockPage.tsx
- Test: tests/integration/master-data-routes.test.ts
- Test: tests/e2e/admin/master-data.spec.ts

Add administrator-only item create/update/deactivate controls, warehouse maintenance controls where supported, and replace free-text warehouse/item fields in inbound and opening-stock forms with standard data selectors. Preserve item code immutability after ledger activity and display API errors.

### Task 4: 首页库存数据、报表明细和 Excel 导出

Files:
- Modify: apps/api/src/application/reports/report-query-service.ts
- Modify: apps/api/src/routes/admin/reports.ts
- Create or modify: apps/api/src/infrastructure/export/report-export.ts
- Modify: apps/api/src/server.ts
- Modify: apps/web/src/App.tsx
- Modify: apps/web/src/pages/ReportsPage.tsx
- Test: tests/unit/reports/report-query.test.ts
- Test: tests/integration/reports/excel-export.test.ts
- Test: tests/e2e/admin/reports.spec.ts

Wire report services to the current ledger source, show real inventory/report values instead of dashes, add transaction type filters, and implement a downloadable Excel-compatible report with quantity and amount columns. Keep transfers, returns, and stocktake adjustments separately listed. Export is disabled only when the report query itself is unavailable.

### Task 5: 持久化和上线前运行配置

Files:
- Modify: apps/api/src/server.ts
- Create or modify: apps/api/src/infrastructure/db/*
- Modify: prisma/schema.prisma
- Modify: prisma/seed.ts
- Modify: .env.example
- Modify: README.md
- Test: tests/integration/db-schema.test.ts
- Test: tests/e2e/auth/roles.spec.ts

Introduce Prisma-backed repositories for users, warehouses, items, approvals, batches, ledger entries, outbound orders, transfers, returns, stocktakes, periods, and audit logs. Keep in-memory repositories for unit tests. Add startup configuration checks, migration/seed instructions, durable audit records, and a production checklist for HTTPS Enterprise WeChat callback configuration. Do not claim live Enterprise WeChat production connectivity without a reachable HTTPS deployment and real credentials.

### Final verification

Run:

corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
$env:WEB_BASE_URL='http://127.0.0.1:5174'
corepack pnpm test:e2e --reporter=line
git diff --check

Then perform a whole-branch code review and leave the local browser on the dashboard for unified acceptance.
