# 阿里云 ECS 正式上线实施计划

> **实施方式：** 使用 Superpowers 测试先行、逐任务复核，并通过 Codex 内置浏览器中的阿里云 Workbench 完成服务器操作。

**目标：** 将集团仓库管理系统部署到阿里云 ECS `i-uf6ig2xdl67rqerk67l1`，使用 PostgreSQL 持久化全部业务数据，并具备 HTTPS、企业微信登录/审批回调、自动重启、备份和回滚能力。

**已确认服务器：** Ubuntu 22.04、2 vCPU、2 GiB 内存、40 GiB 系统盘、公网 IP `106.14.224.213`。数据库与 API 不直接暴露公网，只开放 Web 的 80/443 和管理用 22。

## 全局约束

- 不以 `PERSISTENCE_DRIVER=memory` 或 `NODE_ENV!=production` 冒充正式环境。
- 库存数量、批次成本、出库、调拨、退库、盘点差异、月结、审批同步和审计日志必须在进程/容器重启后保留。
- 数据库端口 `5432` 和 API 端口 `3001` 只允许容器内部访问。
- 生产环境关闭本地开发登录；正式使用企业微信登录。
- 部署前自动备份数据库；升级失败时可恢复上一镜像、上一配置和数据库备份。
- 保留当前工作区所有已有修改，不覆盖、不清理、不顺带提交无关文件。
- 本阶段采用单台 ECS、单 API 实例，符合 3 个仓库、1 名管理员的规模；所有库存写操作仍须使用数据库事务和并发校验。

## Task 1：建立隔离的生产实施工作区与基线

**文件：**

- 创建隔离 worktree：`D:/桌面/仓库/.worktrees/production-deployment`
- 记录基线：`.superpowers/sdd/2026-08-11-aliyun-production-deployment/progress.md`

**步骤：**

1. 从当前已跟踪文件状态生成只读快照，不改变原工作区脏文件。
2. 创建 `codex/production-deployment` 分支和隔离 worktree。
3. 在隔离工作区运行现有单元/集成测试、类型检查和构建，记录真实基线；不把既有失败归因于本任务。

## Task 2：补齐 Prisma 数据模型与身份/审计持久化

**文件：**

- 修改：`prisma/schema.prisma`
- 新建：`prisma/migrations/*_production_persistence/migration.sql`
- 修改：`prisma/seed.ts`
- 修改：`apps/api/src/infrastructure/db/runtime.ts`
- 测试：`tests/integration/db-schema.test.ts`
- 新增：`tests/integration/db/prisma-master-data.test.ts`

**要求：**

1. 为审批单增加独立的出库状态和取消原因，避免把企业微信审批状态与仓库出库状态混用。
2. 角色、用户、仓库、分类、物品和审计日志使用 Prisma 仓储；登录或写审计前幂等创建对应用户/角色，不能因外键导致登录失败。
3. 修正 seed 中中文名称，仓库使用稳定 ID，重复 seed 不产生重复记录。
4. 测试先验证失败，再实现；在真实 PostgreSQL 容器上验证迁移、seed、更新和重启读取。

## Task 3：实现库存全业务 Prisma 事务仓储

**文件：**

- 新建：`apps/api/src/infrastructure/db/prisma-inventory-entry-store.ts`
- 新建：`apps/api/src/infrastructure/db/prisma-outbound-store.ts`
- 新建：`apps/api/src/infrastructure/db/prisma-movement-store.ts`
- 新建：`apps/api/src/infrastructure/db/prisma-stocktake-store.ts`
- 新建：`apps/api/src/infrastructure/db/prisma-approval-sync-store.ts`
- 新建：`apps/api/src/infrastructure/db/prisma-accounting-period-store.ts`
- 新建：`apps/api/src/infrastructure/db/prisma-report-source.ts`
- 按需修改：`apps/api/src/application/inventory/*.ts`
- 按需修改：`apps/api/src/application/periods/period-close-service.ts`
- 测试：`tests/integration/inventory/prisma-*.test.ts`

**要求：**

1. 入库/期初库存：同一事务创建入库单、批次、余额和流水。
2. 出库：校验审批上限和当前批次余量，同一事务扣减余额、写出库单/分配/流水并结案审批；并发变化必须失败并提示重试。
3. 调拨：同一事务扣来源、增目标、保留原批次单价、写调拨单和双向流水。
4. 退库：必须关联原出库分配，累计不得超过原出库数量，同一事务回补余额并写退库记录/流水。
5. 盘点：保存账面数、实盘数、差异原因、操作人、调整前后数量和流水。
6. 月结：期间状态持久化；已结期间禁止写入库存业务。
7. 企业微信审批与同步尝试持久化；重复回调幂等，不重新打开已结案审批。
8. 报表从数据库流水和余额读取，不再依赖进程内 Map。

## Task 4：生产运行时接线与重启验收

**文件：**

- 修改：`apps/api/src/server.ts`
- 修改：`apps/api/src/infrastructure/db/runtime.ts`
- 修改：`.env.example`
- 修改：`README.md`
- 新增：`tests/integration/db/prisma-restart-persistence.test.ts`

**要求：**

1. `PERSISTENCE_DRIVER=prisma` 时只注入 Prisma 业务仓储；`memory` 仅用于开发和测试。
2. 解除 Prisma 启动阻断之前，必须由真实 PostgreSQL 重启测试证明：新增物品、期初库存、出库、调拨、退库、盘点、月结和报表数据均可恢复。
3. `/health` 同时报告 API、数据库和持久化驱动状态；数据库不可用时健康检查失败。
4. 生产配置缺少强会话密钥、数据库地址或 HTTPS 企业微信回调时启动即失败。

## Task 5：制作可回滚的生产部署包

**文件：**

- 新建：`Dockerfile`
- 新建：`docker-compose.prod.yml`
- 新建：`deploy/Caddyfile`
- 新建：`deploy/.env.production.example`
- 新建：`deploy/scripts/backup.sh`
- 新建：`deploy/scripts/deploy.sh`
- 新建：`deploy/scripts/rollback.sh`
- 新增配置测试：`tests/deployment/production-config.test.ts`

**要求：**

1. 多阶段构建 API 与静态 Web，运行镜像不携带源码和开发依赖。
2. Caddy 同域名托管 Web，并把 `/auth/*`、`/admin/*`、`/wecom/*`、`/health` 转发到 API；SPA 路由回退到 `index.html`。
3. PostgreSQL 使用持久卷和健康检查，不映射公网端口；API 只在内部网络暴露。
4. 容器设置自动重启、日志轮转、内存限制和健康检查，适配 2 GiB ECS。
5. 每次升级先执行 `pg_dump`；部署脚本保留上一镜像标签，回滚脚本不会静默删除数据库卷。

## Task 6：部署到 ECS 并完成服务器级验收

**服务器目录：** `/opt/beikexiang-warehouse`

**步骤：**

1. 通过 Codex 内置浏览器中的阿里云 Workbench 核对 Docker、Compose、防火墙、磁盘和监听端口。
2. 创建最小权限部署目录和生产环境文件；敏感值只保存在服务器 `.env.production`，权限设为 `600`，不写入 Git。
3. 上传构建上下文，构建镜像，启动 PostgreSQL，执行 `prisma migrate deploy` 和结构化 seed，再启动 API/Web。
4. 安全组/防火墙只开放 80、443；保留 22；确认 3001、5432 公网不可达。
5. 验证 `/health`、页面资源、API 鉴权、容器自动重启、数据库备份和恢复演练。
6. 创建一条测试库存记录，重启 API 与 PostgreSQL 容器后确认记录、流水和报表仍存在，再删除测试业务只能通过可审计的冲销/调整流程，不直接删库。

## Task 7：域名、HTTPS 与企业微信切换

**届时需要用户提供/确认：**

1. 一个可管理 DNS 的域名或子域名，例如 `warehouse.example.com`，并将 A 记录指向 `106.14.224.213`。
2. 企业微信应用的 CorpID、AgentID、Secret、审批模板 ID、回调 Token 与 EncodingAESKey；只通过项目现有安全文件或当面配置，不在对话中粘贴 Secret。
3. 企业微信可信域名/授权回调域配置确认。

**验收：**

1. Caddy 自动签发可信 HTTPS 证书，HTTP 自动跳转 HTTPS。
2. 关闭本地开发登录，用真实企业微信账号完成扫码登录。
3. 用一张测试领用审批单完成“审批通过 → 自动接收 → 管理员实际出库 → 报表出现流水”的全链路。

## 最终验证命令

```powershell
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
docker compose -f docker-compose.prod.yml config
git diff --check
```

服务器侧还必须验证：

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml exec -T api node -e "fetch('http://127.0.0.1:3001/health').then(r=>r.json()).then(console.log)"
curl -fsS https://<正式域名>/health
ss -lntp
```

只有本地测试、真实 PostgreSQL 重启测试、服务器健康检查、外网 HTTPS、端口隔离和企业微信全链路全部通过后，才宣称“正式上线完成”。
