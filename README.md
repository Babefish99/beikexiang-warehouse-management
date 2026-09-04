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
- 标准物品分类：`BJ` / `HJ` / `CY` / `WP`

## 期初库存 Excel 导入

- 电脑端管理员可上传一个不超过 5 MB 的固定格式 `.xlsx`，先完成服务端预览，再凭短时签名凭证重新上传同一文件并执行一次性正式提交；财务和申请人不能操作。
- 工作簿固定校验五张工作表、表头和最多 81 条物品资料/243 条盘点数据；只解析实际存在的非空业务行，不要求补齐每个物品与三个仓库的笛卡尔积。显式零库存行参与数量和金额校验，但不会创建零数量批次、余额、明细或流水。
- 正式提交以盘点基准日期作为批次和会计期间日期，在一个事务中创建缺失物品、正库存批次及余额，并记录管理员、财务复核人、文件摘要和汇总审计。
- 旧单行 `POST /admin/opening-stock` 已停用并返回 HTTP 410，避免绕过整批校验、一次性约束和共同复核记录。
- 该能力已包含在生产版本中；真实工作簿仍须先通过预览并由管理员记录财务复核人，生产数据库只允许执行一次期初导入。

## 启动与安全约束

- `PERSISTENCE_DRIVER=memory` 仅适用于开发/演示；`NODE_ENV=production` 下会拒绝启动
- `NODE_ENV=production` 必须使用 `PERSISTENCE_DRIVER=prisma` 并提供 `DATABASE_URL`
- 正式环境 `SESSION_SECRET` 至少 32 个字符，且不能使用 `.env.example` 中的占位值
- `LOCAL_AUTH_BYPASS=true` 只在非生产环境生效；正式环境配置为 `true` 会拒绝启动
- 本地 bypass 只接受 loopback 来源与 loopback/配置主机名
- 正式环境必须完整提供 `WE_COM_CORP_ID`、`WE_COM_AGENT_ID`、`WE_COM_SECRET`、`WE_COM_CALLBACK_TOKEN`、`WE_COM_ENCODING_AES_KEY` 和 `WE_COM_APPROVAL_TEMPLATE_ID`；主模板 ID 必须是非占位值。`WE_COM_LEGACY_APPROVAL_TEMPLATE_IDS` 是可选的旧模板兼容列表，多个 ID 使用英文逗号分隔；运行时会去除首尾空白、空项和重复项，并把主模板放在允许列表首位。审批详情的 `template_id` 只有在该允许列表中时才会在解析或保存前被接受；EncodingAESKey 必须是企业微信提供的 43 字符无填充 Base64 值，解码后正好 32 字节
- 正式环境的 `WE_COM_ADMIN_IDS` 至少要包含一个非占位的企业微信 UserID，作为首位生产管理员；多个 UserID 使用英文逗号分隔，`WE_COM_FINANCE_IDS` 可选
- 正式环境的 `API_BASE_URL` 与 `WEB_BASE_URL` 都必须是 HTTPS

`GET /health` 会返回 API 状态、当前持久化驱动和数据库状态。`memory` 模式明确返回 `database.status=not_required`；Prisma 模式执行实时数据库查询，数据库不可用时返回 HTTP 503 和 `database.status=unavailable`。

## 审批模板兼容切换与异常处理

- `WE_COM_APPROVAL_TEMPLATE_ID` 始终指向当前主模板；完成切换后应为新的“审批意向”模板。`WE_COM_LEGACY_APPROVAL_TEMPLATE_IDS` 只填写仍需读取的旧选择器或固定文本模板 ID，可以留空，也可以用英文逗号填写多个值。
- 发布顺序必须是“兼容代码与数据库迁移先上线，模板后切换”：首次部署保留当前模板为主模板并让旧模板列表为空，确认迁移、API、Web、PostgreSQL 和健康检查正常后，再创建并验收新模板；切换时将新模板设为主模板、原模板移入旧模板列表。不得先切模板再部署代码。
- 旧审批只有在重新同步后能证明选择器映射、启用物品、审批单位和正整数数量完全一致时才可按锁定物品办理。固定文本、占位或联调物品、映射不一致、模板来源不明、缺少单位或小数数量会进入 `REAPPLY_REQUIRED`（界面显示“需重新申请”），保留原始事实，但禁止选择物品、批次或确认出库。
- 已经完成、部分出库或零出库结案的审批后来被企业微信撤销时会进入 `REVOCATION_EXCEPTION`（界面显示“撤销异常”）。系统保留原出库决定、库存扣减和流水，不自动回补库存；管理员必须按正式退库或异常处置流程处理。
- 真实 Secret、回调 Token、EncodingAESKey、会话密钥、数据库凭据和生产环境文件不得写入 Git、日志或交接文档。仓库中的示例配置只能保留占位值；实际值只写入服务器上权限受限的环境文件。
- 本地测试、类型检查、构建和浏览器测试通过只表示代码就绪，不等于代码已部署、新模板已在企业微信启用，或真实回调/候选项已经完成生产验收。首次模板验收必须停在最终确认之前，不得调用确认接口或扣减库存；实际出库仍需另行明确授权。

## 企业微信上线前检查清单

截至 2026-08-11，应用侧全业务 Prisma 接线和本地 PostgreSQL 重建/重启验收已经具备；这不等于真实公网和企业微信生产联通已经完成。上线前仍需在真实环境完成：

1. 部署可公网访问的 HTTPS API 域名
2. 将 `API_BASE_URL` 设置为对应 HTTPS 地址
3. 在企业微信后台配置回调 URL、Token、EncodingAESKey
4. 提供真实 `WE_COM_CORP_ID`、`WE_COM_AGENT_ID`、`WE_COM_SECRET`，并在 `WE_COM_ADMIN_IDS` 配置首位生产管理员的企业微信 UserID
5. 先保留当前模板 ID 为 `WE_COM_APPROVAL_TEMPLATE_ID`、让 `WE_COM_LEGACY_APPROVAL_TEMPLATE_IDS` 为空，部署兼容代码并执行迁移与 seed
6. 通过 `/health` 验证实时数据库探针，并确认既有审批、库存、流水和出库单计数未被迁移改变
7. 在企业微信创建并人工核对新的“仓库物品领用申请”模板、审批节点、抄送人与回调配置
8. 将新模板 ID 写入 `WE_COM_APPROVAL_TEMPLATE_ID`，将原模板 ID 写入 `WE_COM_LEGACY_APPROVAL_TEMPLATE_IDS`，再通过部署机制重启并验证两个模板均可接受
9. 用真实企业微信账号完成一次登录、审批回调和候选/批次选项验收，同时确认不相关模板会被拒绝
10. 首次验收停在最终确认之前，不调用 `/admin/outbound/confirm`，并复核出库单与 `OUTBOUND` 流水计数没有增加
11. 验收通过后停止发起旧模板；旧模板 ID 暂留兼容列表用于历史审批读取

在这些条件满足前，不应声称“企业微信生产连接已完成”。
