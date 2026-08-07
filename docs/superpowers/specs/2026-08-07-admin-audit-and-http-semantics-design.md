# Admin Audit And HTTP Semantics Design

## Goal

为 `/admin` 下的变更路由补齐统一审计，并把管理员业务校验错误从默认 500 收敛为明确的 4xx JSON `{ error }`，同时不修改 Prisma schema 与共享库存状态模型。

## Scope

- 覆盖 `/admin` 下所有 `POST`、`PATCH`、`PUT`、`DELETE` 变更路由。
- 至少覆盖：items、warehouses、inbound、opening-stock、outbound confirm/cancel、transfers、returns、stocktake、period-close、approval resync。
- 成功和失败都要写审计事件。
- 未知程序错误继续保留 500。

## Approach

### 1. Shared admin mutation audit wrapper

新增一个路由层共享 helper，用它注册所有 `/admin` mutation。每条路由只提供：

- `method` 和 `url`
- 实际 handler
- `action`
- `entityType`
- `entityId` 提取逻辑
- 可选的 `afterData` 提取逻辑

helper 在 handler 成功或失败时统一调用 `auditService.record`，补齐：

- `actorUserId`
- `actorRole`
- `action`
- `entityType`
- `entityId`
- `requestId`
- `occurredAt`
- `status`
- `afterData`

### 2. Sanitized audit payloads

新增共享 sanitize 逻辑，对 request body 和返回结果做递归脱敏，去掉：

- `session`
- `secret`
- `token`
- `cookie`
- 以及类似命名的敏感字段

这样既满足 afterData 记录要求，也避免 session/secret 泄露。

### 3. Global admin business error handler

新增轻量 `BusinessRuleError` 和错误分类函数：

- `... not found ...` -> 404
- 其余已知业务校验/资源状态错误 -> 400
- 未识别错误 -> 500

全局 error handler 只对 `/admin` 路径返回 `{ error: message }`；非 `/admin` 维持现有 Fastify 默认行为。

### 4. Audit service compatibility

`InMemoryAuditService` 保存完整事件对象。

`PrismaAuditService` 不改 schema；把 schema 现有列继续写入，并将无法单独落列的字段（如 `actorRole`、`occurredAt`、`status`）合并进 JSON 数据中，保证内存实现与 Prisma 实现都能接收统一 envelope。

## Testing

- 先写失败测试再写实现。
- integration:
  - 至少一条 admin mutation 成功后审计包含 actor/request/action/status
  - 至少一条业务校验错误返回 400 + `{ error }`
  - auth/role 401/403 不回归
- 更新原本期待 500 的集成测试。

## Constraints

- 不修改 Prisma schema。
- 不修改主业务共享 inventory memory state 结构。
- 不重置或覆盖无关改动。
