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

## 切换到 Prisma / PostgreSQL

如需验证 Prisma-backed adapter seam，请先准备可访问的 PostgreSQL，然后把 `.env` 改成：

```env
PERSISTENCE_DRIVER=prisma
DATABASE_URL=postgresql://warehouse:warehouse@localhost:5432/warehouse
```

再执行：

```bash
corepack pnpm db:migrate
corepack pnpm db:seed
```

当前仓库不会导入历史 Excel。seed 只 upsert 结构化基础数据：

- 3 个仓库：`WH-01` / `WH-02` / `WH-03`
- 标准物品分类：`BJ` / `CY` / `WP`

## 启动与安全约束

- `PERSISTENCE_DRIVER=memory` 仅适用于开发/演示；`NODE_ENV=production` 下会拒绝启动
- `PERSISTENCE_DRIVER=prisma` 需要提供 `DATABASE_URL`
- `LOCAL_AUTH_BYPASS=true` 只在非生产环境生效
- 本地 bypass 只接受 loopback 来源与 loopback/配置主机名
- 企业微信生产回调启用时，`API_BASE_URL` 必须是 HTTPS

## 企业微信上线前检查清单

在 Friday, August 7, 2026 这次交付中，仓库只补到了“上线前配置与 seam”，没有伪造真实生产联通。上线前仍需你在真实环境完成：

1. 部署可公网访问的 HTTPS API 域名
2. 将 `API_BASE_URL` 设置为对应 HTTPS 地址
3. 在企业微信后台配置回调 URL、Token、EncodingAESKey
4. 提供真实 `WE_COM_CORP_ID`、`WE_COM_AGENT_ID`、`WE_COM_SECRET`
5. 切换 `PERSISTENCE_DRIVER=prisma`
6. 跑迁移与 seed，确认数据库连通
7. 用真实企业微信账号完成一次登录与审批回调验收

在这些条件满足前，不应声称“企业微信生产连接已完成”。
