# 集团仓库管理 MVP

这是一个面向三仓库场景的轻量库存后台。企业微信继续承担申请与审批入口，后台负责实际出入库、批次成本、调拨、退库、盘点、月结和报表。

## 项目结构

- `apps/web`：React 19 + Vite 管理后台
- `apps/api`：Fastify API，负责认证、企业微信接入、库存业务和报表
- `prisma`：Prisma 7 schema、迁移和结构化 seed
- `tests`：unit / integration / e2e 测试

## 本地开发

1. 安装 Node.js 24+，启用 Corepack：
   `corepack enable`
2. 安装依赖：
   `corepack pnpm install`
3. 复制 `.env.example` 为 `.env`
4. 默认本地开发可直接使用内存持久化：
   - `PERSISTENCE_DRIVER=memory`
   - 不要求本地必须连 PostgreSQL
5. 启动前后端：
   `corepack pnpm dev`
6. API 健康检查：
   [http://localhost:3001/health](http://localhost:3001/health)
7. Web 后台：
   [http://localhost:5174](http://localhost:5174)

## Prisma schema / migration / seed

可以先准备可访问的 PostgreSQL 来验证 schema、迁移和结构化 seed：

```env
PERSISTENCE_DRIVER=prisma
DATABASE_URL=postgresql://warehouse:warehouse@localhost:5432/warehouse
SHADOW_DATABASE_URL=postgresql://warehouse:warehouse@localhost:5432/warehouse_shadow
```

再执行：

```bash
corepack pnpm db:migrate
corepack pnpm db:seed
```

Prisma 7 在使用 `--from-migrations` 或 `migrate dev` 时还需要单独的 `SHADOW_DATABASE_URL`；不要将它设置成主库地址。

`PERSISTENCE_DRIVER=prisma` 会为主数据、身份与审计、入库/期初、出库、调拨、退库、盘点、月结、审批同步、通知、库存查询和报表统一注入同一个 Prisma 客户端。应用关闭时只断开这一个客户端。`memory` 分支继续用于本地开发和测试，不会在 Prisma 模式下充当库存真相来源。

当前仓库不会导入历史 Excel。seed 只 upsert 结构化基础数据：

- 3 个仓库：`WH-01` / `WH-02` / `WH-03`
- 标准物品分类：`BJ` / `CY` / `WP`

## 启动与安全约束

- `PERSISTENCE_DRIVER=memory` 仅适用于开发/演示；`NODE_ENV=production` 下会拒绝启动
- `NODE_ENV=production` 必须使用 `PERSISTENCE_DRIVER=prisma` 并提供 `DATABASE_URL`
- 正式环境 `SESSION_SECRET` 至少 32 个字符，且不能使用 `.env.example` 中的占位值
- `LOCAL_AUTH_BYPASS=true` 只在非生产环境生效；正式环境配置为 `true` 会拒绝启动
- 本地 bypass 只接受 loopback 来源与 loopback/配置主机名
- 正式环境必须完整提供 `WE_COM_CORP_ID`、`WE_COM_AGENT_ID`、`WE_COM_SECRET`、`WE_COM_CALLBACK_TOKEN` 和 `WE_COM_ENCODING_AES_KEY`；EncodingAESKey 必须是企业微信提供的 43 字符无填充 Base64 值，解码后正好 32 字节
- 正式环境的 `WE_COM_ADMIN_IDS` 至少要包含一个非占位的企业微信 UserID，作为首位生产管理员；多个 UserID 使用英文逗号分隔，`WE_COM_FINANCE_IDS` 可选
- 正式环境的 `API_BASE_URL` 与 `WEB_BASE_URL` 都必须是 HTTPS

`GET /health` 会返回 API 状态、当前持久化驱动和数据库状态。`memory` 模式明确返回 `database.status=not_required`；Prisma 模式执行实时数据库查询，数据库不可用时返回 HTTP 503 和 `database.status=unavailable`。

## 企业微信上线前检查清单

截至 2026-08-11，应用侧全业务 Prisma 接线和本地 PostgreSQL 重建/重启验收已经具备；这不等于真实公网和企业微信生产联通已经完成。上线前仍需在真实环境完成：

1. 部署可公网访问的 HTTPS API 域名
2. 将 `API_BASE_URL` 设置为对应 HTTPS 地址
3. 在企业微信后台配置回调 URL、Token、EncodingAESKey
4. 提供真实 `WE_COM_CORP_ID`、`WE_COM_AGENT_ID`、`WE_COM_SECRET`，并在 `WE_COM_ADMIN_IDS` 配置首位生产管理员的企业微信 UserID
5. 跑迁移与 seed，确认数据库连通
6. 通过 `/health` 验证实时数据库探针
7. 用真实企业微信账号完成一次登录与审批回调验收

在这些条件满足前，不应声称“企业微信生产连接已完成”。
