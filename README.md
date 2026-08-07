# 集团轻量化仓库管理系统

这是集团三仓库的轻量化库存后台。企业微信继续作为员工申请和领导审批入口，后台负责接收已通过的审批、管理员实际出库、批次成本、调拨、退库、盘点、月结和 Excel 报表。

## 项目结构

- `apps/web`：React 19 + Vite 管理后台，沿用固定资产项目 `beikexiang-assets` 的侧边栏、顶部栏、页面标题、卡片和表单视觉语言。
- `apps/api`：Fastify API，负责认证、企业微信接入、库存事务和报表查询。
- `prisma`：数据库模型和种子数据（后续任务创建）。
- `tests`：单元、集成和端到端测试。

## 本地启动

1. 安装 Node.js 24+，并启用 Corepack：`corepack enable`。
2. 安装依赖：`corepack pnpm install`。
3. 复制 `.env.example` 为 `.env`，按环境填写配置。
4. 启动 PostgreSQL：`docker compose up -d postgres`。
5. 启动前后端：`corepack pnpm dev`。
6. API 健康检查：<http://localhost:3001/health>。
7. 管理后台：<http://localhost:5174>。

## 参考界面

固定资产项目 `C:\Users\Administrator\Documents\Codex\2026-07-24\g-i\work\beikexiang-assets` 仅作为只读视觉参考。仓库系统不会在运行时依赖该路径，也不会修改参考项目。
