# Warehouse MVP Audit Fix Report

## Scope

本次修复覆盖两个横切问题：

1. `/admin` 变更路由统一审计
2. 管理员业务校验错误与资源不存在的 HTTP 语义

## Implemented Changes

### 1. Shared admin mutation audit

- 新增共享 wrapper：`apps/api/src/routes/admin/admin-mutation-route.ts`
- 新增 Fastify admin request context：`apps/api/src/routes/admin/admin-request-context.ts`
- 为以下 `/admin` mutation 路由统一接入成功/失败审计：
  - items create / update / deactivate
  - warehouses update
  - inbound create
  - opening-stock create
  - outbound confirm / cancel
  - transfers create
  - returns create
  - stocktake create
  - period-close create
  - approvals resync

统一审计事件包含：

- `actorUserId`
- `actorRole`
- `action`
- `entityType`
- `entityId`
- `requestId`
- `occurredAt`
- `status`
- 可选 `errorMessage`
- 经脱敏的 `afterData`

脱敏规则会去掉 `session` / `secret` / `token` / `cookie` / `password` 等敏感字段。

### 2. Admin business error semantics

- 新增 `BusinessRuleError` 与 `classifyAdminBusinessError`
- 已知管理员业务校验错误统一返回 400 JSON `{ error: message }`
- 资源不存在类错误统一返回 404 JSON `{ error: message }`
- 未识别程序错误继续保留 500

### 3. Prisma audit compatibility

- 不修改 Prisma schema
- `PrismaAuditService` 继续写现有列
- 额外把 `actorRole`、`occurredAt`、`status`、`errorMessage` 合并进 JSON `afterData`

### 4. Verification-driven follow-up

- 补了成功审计与失败审计 integration 测试
- 更新了原先期待 500 的 integration 测试
- 把 e2e 中模拟业务错误的 mock 统一改为 400 + `{ error }`
- 修复了一个在全量 e2e 验证时暴露出的宿主问题：`playwright.config.ts` 的默认 `baseURL` 原来是 `http://localhost:5174`，而本地登录链路实际落在 `http://127.0.0.1:5174`；这会让 `page.goto("/")` 丢失 host-scoped session cookie。现已统一到 `127.0.0.1`

## Files Added

- `apps/api/src/application/errors/business-rule-error.ts`
- `apps/api/src/routes/admin/admin-mutation-route.ts`
- `apps/api/src/routes/admin/admin-request-context.ts`
- `tests/integration/admin/admin-audit.test.ts`
- `docs/superpowers/specs/2026-08-07-admin-audit-and-http-semantics-design.md`
- `docs/superpowers/plans/2026-08-07-admin-audit-and-http-semantics.md`
- `docs/superpowers/plans/2026-08-08-warehouse-mvp-audit-report.md`

## Fresh Verification

在 2026-08-08 本地执行并通过：

- `corepack pnpm test`
  - 36 test files passed
  - 146 tests passed
- `corepack pnpm test:e2e`
  - 31 tests passed
- `corepack pnpm typecheck`
  - passed
- `corepack pnpm build`
  - passed
- `git diff --check`
  - passed without whitespace errors

## Post-audit acceptance fixes

- Completed the administrator outbound page: approval expansion, multi-line/multi-batch allocation, actual quantity validation, partial/zero issue reasons, confirmation, refresh, and error state preservation.
- Changed period close to calculate pending outbound work on the server and removed client-supplied counts from the page.
- Enforced the current accounting period guard for inbound, opening stock, outbound, transfers, and returns after close.
- Added outbound and period-close end-to-end coverage.

## Notes

- 未修改 Prisma schema
- 未修改主业务共享 inventory memory state shape
- 本次报告文件名按用户要求写入 `2026-08-08`
