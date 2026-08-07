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

Prisma 7 在使用 `--from-migrations` 或 `migrate dev` 时还需要单独的 `SHADOW_DATABASE_URL`；不要将它设置成主库地址。当前环境没有可达 PostgreSQL，因此这里只提交 migration 文件和配置 seam，不声称迁移已连接或应用到真实数据库。

当前 API 运行时不会接受 `PERSISTENCE_DRIVER=prisma`：核心库存、出库、调拨、退库、盘点和报表仍有内存业务 store，不能把部分 Prisma seam 当成生产持久化。API 在启动阶段会明确 fail-fast；在全业务 wiring 和真实 PostgreSQL 端到端验证完成前，请保持 `PERSISTENCE_DRIVER=memory` 运行本地开发。Prisma CLI 的迁移/seed 仍可单独使用 `DATABASE_URL` 验证。

当前仓库不会导入历史 Excel。seed 只 upsert 结构化基础数据：

- 3 个仓库：`WH-01` / `WH-02` / `WH-03`
- 标准物品分类：`BJ` / `CY` / `WP`

## 启动与安全约束

- `PERSISTENCE_DRIVER=memory` 仅适用于开发/演示；`NODE_ENV=production` 下会拒绝启动
- `PERSISTENCE_DRIVER=prisma` 当前会在 API 启动阶段被拒绝，原因是核心库存业务尚未全部接入 durable persistence
- `LOCAL_AUTH_BYPASS=true` 只在非生产环境生效
- 本地 bypass 只接受 loopback 来源与 loopback/配置主机名
- 企业微信生产回调启用时，`API_BASE_URL` 必须是 HTTPS

## 企业微信上线前检查清单

截至 Saturday, August 8, 2026，仓库只补到了“上线前配置与 seam”，没有伪造真实生产联通。上线前仍需你在真实环境完成：

1. 部署可公网访问的 HTTPS API 域名
2. 将 `API_BASE_URL` 设置为对应 HTTPS 地址
3. 在企业微信后台配置回调 URL、Token、EncodingAESKey
4. 提供真实 `WE_COM_CORP_ID`、`WE_COM_AGENT_ID`、`WE_COM_SECRET`
5. 完成库存、出库、调拨、退库、盘点和报表的全业务 Prisma wiring
6. 解除 API 对 `PERSISTENCE_DRIVER=prisma` 的启动阻断，并跑真实 PostgreSQL 端到端验收
7. 跑迁移与 seed，确认数据库连通
8. 用真实企业微信账号完成一次登录与审批回调验收

在这些条件满足前，不应声称“企业微信生产连接已完成”。
