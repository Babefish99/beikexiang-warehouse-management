# 集团仓库管理系统项目状态

> 最后更新：2026-09-01（Asia/Shanghai；生产发布、审批补同步、自动备份与期初工作簿审计均截至 2026-09-01）
> 用途：作为后续 Codex 任务、人工开发、测试和部署的统一交接入口。开始新任务时先读本文件，再检查 Git、服务器和企业微信的实时状态。
> 安全：本文不保存 Secret、数据库密码、会话密钥、回调 Token 或 EncodingAESKey。
> 摘要交接：日常验收与运维请先读 [项目状态与发布交接](docs/项目状态与发布交接.md)，完整时间线和证据仍以本文件为准。
> 对话状态：生产源码为 `ae4bd80ef66445d9da0c44e0dfd2fc1b1ec5465f`，服务器发布版本为 `20260901T090016Z-ae4bd80ef664-3056372`；当前收口分支在该生产源码之上补充日期无关的测试与交接文档，精确 `HEAD` 以实时 Git 为准。CI-only PR #13 已合并。审批 `202609010007` 已手工重同步为 `APPROVED/PENDING_OUTBOUND`，物品单位已更正为“件”，没有实际出库或库存流水；自动备份 timer 已安装并完成一次备份完整性验证。仍待企业微信自动回调订阅、隔离恢复演练、期初数据人工确认/导入，以及未来单独授权的实际出库与报表验收。

## 1. 当前结论

项目已具备轻量仓库系统的主要业务代码、PostgreSQL 持久化、企业微信审批同步和阿里云部署能力，公网域名为 `https://warehouse.beikexiang.cn`。2026-09-01 已将源码 `ae4bd80ef66445d9da0c44e0dfd2fc1b1ec5465f` 发布为 `20260901T090016Z-ae4bd80ef664-3056372`；生产健康检查、审批手工补同步及自动备份完整性均已有证据，但系统整体仍属于“生产联调收口阶段”，尚不能判定为正式生产验收完成，主要原因是：

- 审批 `202609010007` 已手工补同步成功，状态为 `APPROVED/PENDING_OUTBOUND`；物品 `ACCEPT-61AD5B0-01` 单位已更正为“件”，审批明细为 1 条，`OUTBOUND_COUNT=0`、`LEDGER_COUNT=0`。这证明手工同步链路可用，但自动回调订阅尚未保存。
- 企业微信“招待品领用（酒、茶、粉条等）”模板的状态变化回调通知仍待操作当下确认。启用后还需用新测试审批验证自动生成待出库单以及重复通知不重复建单。
- systemd 每日备份已启用且 active，时区为 `Asia/Shanghai`，每天 02:30 后随机延迟 0–10 分钟；已验证一份备份的权限、gzip 和 SHA-256，但隔离恢复演练仍待即时确认。
- 期初工作簿仍有 223 个数量、39 个仓库/物品组合、`WH-01 + BJ0008` 确认单价、`WP0010` 分类、两组重复名称和盘点日期需要人工确认；生产尚未导入。
- 实际出库和报表验收明确未执行；实际扣减库存属于未来必须单独授权的业务操作。

## 2. 产品范围与已确认规则

详细业务规格以 [集团轻量化仓库管理系统设计说明](docs/superpowers/specs/2026-08-07-group-warehouse-management-design.md) 为准；手机响应式规格以 [手机响应式设计说明](docs/superpowers/specs/2026-08-13-mobile-responsive-design.md) 为准。本节只记录后续开发最容易误解的决定。

### 2.1 系统定位

- 管理集团共 3 个仓库，主要物品为招待酒水、茶叶等，不建设复杂 WMS。
- 企业微信继续作为领用申请和领导审批入口；新增库存管理后台处理实际库存业务。
- 电脑网页为主要操作端；手机端范围是查询、通知、单页入库、四步出库与取消。
- 调拨、盘点、月结和主数据维护保留电脑端；手机端只提示到电脑端处理，不建设另一套完整应用。
- 第一阶段不包含库位、条码、自动拣货、自动采购和财务系统写入接口。

### 2.2 领用与出库

- 企业微信审批模板使用标准物品选项，支持 1—5 行物品明细；用途和部门必须填写。
- 申请人不选择仓库，管理员实际出库时选择仓库、采购批次和数量。
- 审批通过不预占库存；确认实际出库时才校验并扣减。
- 实际数量可以少于审批数量或为 0，但不能超过审批数量；少出或 0 出必须填写原因。
- 一张审批单只结案一次，少出后不得继续补出；需要再次领用时重新发起审批。
- 不允许替换审批物品；允许同一审批单跨仓库、跨批次出库。
- 不需要领用人签收确认；附件和签字材料不强制上传。
- 待出库审批不进入库存流水和月度报表，也不要求按审批通过时间顺序办理。
- 已确认记录不直接删除；通过退库、作废或调整业务保留审计链路。

### 2.3 成本、入库、调拨、退库和盘点

- 管理员直接登记入库，第一阶段不走企业微信审批；入库必须选择仓库。
- 正常登记入库不再手填批次号：服务端按采购日期生成全局 `YYYYMMDD-001` 日序号（例如 `20260814-001`），客户端仅说明规则并在成功后显示服务端实际分配的号码。期初库存和历史批次继续保留手工批次号，不适用该规则。
- 出库金额严格使用管理员选择的采购批次单价；允许一个物品拆分多个批次。
- 生产日期和到期日期保留但不强制填写；赠送物品允许单价为 0，并通过备注说明。
- 调拨无需审批，默认一键完成；同时记录调出、调入、数量、金额、批次和原因。
- 调拨单独列示，但不改变集团整体入库额和出库额。
- 退库无需审批，但必须关联原审批单和原出库记录；单独列示并冲减原出库。
- 每月底盘点三个仓库。盘盈盘亏允许调整，但必须填写差异原因并保留调整前后数量、金额、操作人和时间。
- 最低库存按物品统一设置，以三个仓库合计数量判断，只通知管理员。

### 2.4 月结、报表与主数据

- 每月必须盘点并结账；结账后不得直接修改当期业务，只能通过可审计的冲正或调整处理。
- 报表同时保留数量和金额，调拨、退库和盘点调整单独列示。
- 财务接受系统导出的重新设计版 Excel 报表，不要求复刻旧 Excel 版式。
- 只录入实盘确认后的期初库存；历史 Excel 继续归档，不导入历史流水。
- 三个仓库名称允许管理员修改。
- 标准物品只允许管理员维护；停用物品显示“启用”，启用物品显示“停用”。
- 企业微信选项 key 不在普通管理界面展示，但技术字段保留，用于审批物品映射。
- 企业微信物品选项与后台物品库第一阶段不自动同步，由管理员同步维护；审批结果自动接收能力仍需保留。
- 申请人和审批人不查看库存数量、采购单价或金额；管理员后台可以查询库存和物品位置。

## 3. 已有系统能力

代码中已经存在以下页面和 API，是否符合最终操作习惯仍需用户统一验收：

- 首页库存总览、通知中心、业务快捷入口、仓库选择和全局搜索。
- 库存台账、标准物品库、仓库维护。
- 期初库存固定 Excel 预览/一次性整批导入、正常入库、待出库及实际出库；Excel 导入能力已包含在当前生产版本，但正式期初数据尚未导入。
- 调拨、退库、月末盘点、库存调整和月度结账。
- 库存汇总、出入库流水、筛选查询和 Excel 兼容报表导出。
- 企业微信登录、审批详情获取、审批回调入口及按审批编号补同步的代码接缝。
- 管理员写操作审计、已结期间写入限制和 PostgreSQL 事务持久化。
- 本地手机响应式分支提供角色化移动导航、查询、通知、单页入库、四步出库与取消；复杂业务仍使用电脑端。

视觉目标继续以固定资产系统 `D:\桌面\固定资产` 为参考，统一公司 Logo、字号、间距、卡片、侧边栏、顶部栏和按钮风格。首页指标图标和部分响应式排版仍属于视觉验收项，不视为最终定稿。

本轮移动端视觉收敛值（`max-width: 820px`）：一级、二级、三级标题分别为 `25px`、`18px`、`15px`；首页仓库选择和快捷操作均为 `14px` 且保持至少 `44px` 触控高度；日期、只读批次预览和采购人使用同规格 `44px` 输入控件，日期及 WebKit 日期编辑文本左对齐；出库状态卡片采用固定图标列与可换行文字列。该设计沿用电脑端与固定资产项目的企业界面语言，仍以用户手机验收为最终依据。

## 4. 技术结构

- 前端：React 19、Vite、TypeScript。
- API：Fastify、TypeScript。
- 数据库：PostgreSQL 16、Prisma 7。
- 部署：Docker Compose、Caddy HTTPS 反向代理。
- 测试：Vitest、Playwright、真实 PostgreSQL 集成测试和部署配置测试。

主要目录：

```text
D:\桌面\仓库
├─ apps\web                 前端
├─ apps\api                 API 与业务服务
├─ prisma                   数据模型、迁移和结构化 seed
├─ tests                    单元、集成、端到端及部署测试
├─ docs\superpowers\specs   已确认设计
├─ docs\superpowers\plans   实施计划
└─ .worktrees
   ├─ production-deployment 生产部署分支工作区
   └─ mobile-responsive     手机响应式本地实现工作区
```

默认本地开发入口：

- Web：`http://127.0.0.1:5174`
- API：`http://127.0.0.1:3001`
- 启动：`corepack pnpm dev`

本轮 E2E 使用隔离入口 Web `http://127.0.0.1:5474`、API `http://127.0.0.1:3301`，没有终止或占用默认端口进程。

## 5. Git 与本地工作状态

### 5.1 当前源码与集成状态

- 当前生产源码提交：`ae4bd80ef66445d9da0c44e0dfd2fc1b1ec5465f`。
- `feat/warehouse-system@6abeef7` 是本轮收口前的集成基线；当前工作分支在生产源码之上另含日期无关测试与交接文档，精确提交差异以实时 Git 为准。
- GitHub Actions CI-only PR #13 已合并。
- 已交付的共享前门代码提交：`77619dc fix(deploy): preserve fixed assets frontdoor`；它在 `a03e87e merge: integrate mobile responsive release branch` 的已合并集成基线上新增了共享 Caddy 前门本地配置。其后的 `77e722b` 只补充 Docker 测试时序交接记录。
- 合并前与生产分支重叠的未提交内容已保存在 `stash@{0}`（`codex pre-mobile-merge backup 2026-08-21`）作为安全备份；未自动恢复或删除。
- 用户原有的未跟踪计划文档、演示文稿检查文件和临时演示目录仍保留在工作区，未改写、未清理、未提交。
- 2026-08-25 曾将期初库存 Excel 导入截止提交 `700eb74` 以 `--ff-only` 快进集成到 `feat/warehouse-system`；这是历史阶段记录，后续 CI 合并及生产收口已由当前 `ae4bd80` 状态取代。

### 5.2 生产部署历史

- 路径：`D:\桌面\仓库\.worktrees\production-deployment`
- 分支：`codex/production-deployment`
- 原基线提交：`5f17963 fix: harden WeCom template deployment guard`
- 该工作区的历史发布源提交：`fada1d6738d6ddd30db7eefb3de60e06771f7fc7`（手机验收记录所在提交）。合并提交为 `de6c69d`；后续本地视觉收敛提交包括 `a305f6d`、`f856ad0`、`7a97ca0`、`22b8592`（日期与批次预览）和 `1706971`（出库状态对齐）。这些旧发布证据不代表当前服务器版本。
- 本轮入库批次与移动视觉实现链路：`1deb803` → `ab03e9e`/`b6d95d0`（规格与计划）→ `cbffdf7` → `9a49b3a` → `ad6dada` → `f0f0ee0` → `c015088` → `5c44967`（移除陈旧桌面入库批次字段测试）。本状态记录随后作为同一集成分支的验证提交；原开发工作区保持未修改。
- 当前分支头为 `b2bedbf docs: add project status handoff`。该分支包含生产 Prisma 接线、部署脚本、备份/恢复、Caddy 和企业微信生产配置保护，并已于 2026-08-21 合并回当前开发分支。

### 5.3 手机响应式来源分支

- 分支：`codex/mobile-responsive`
- 创建基线：`codex/production-deployment@5f17963`
- 实现规格：`docs/superpowers/specs/2026-08-13-mobile-responsive-design.md`
- 本轮实现提交：`3837dfe fix: close mobile verification gaps`、`8c8f8a7 test: isolate legacy end-to-end specs`。
- 状态：已通过 `de6c69d` 合并到生产部署分支，并随发布源 `fada1d6` 发布；这是已归档的历史来源分支状态。

### 5.4 合并后的基线规则

开发与生产部署代码已在历史基线 `feat/warehouse-system@a03e87e` 完成正常合并；共享前门、企业微信校验文本、Excel 导入、CI 和备份定时器等后续变更均已进入当前 `ae4bd80` 源码。以后发布仍必须从实时集成基线运行完整门禁、备份生产数据库并生成新版本，不能用旧分支覆盖服务器。

## 6. 阿里云部署状态

### 6.1 基础信息

- ECS：`i-uf6ig2xdl67rqerk67l1`
- 地域：上海 `cn-shanghai`
- 系统与规格：Ubuntu 22.04，2 vCPU / 2 GiB。
- 公网 IP：`106.14.224.213`
- 域名：`warehouse.beikexiang.cn`
- 服务器目录：`/opt/beikexiang-warehouse`
- Compose 项目：`warehouse-prod`
- 生产 Compose 文件：`docker-compose.prod.yml`
- 当前发布版本：`20260901T090016Z-ae4bd80ef664-3056372`（来源 `ae4bd80ef66445d9da0c44e0dfd2fc1b1ec5465f`）。旧版本证据保留在下方时间线中。
- 运行服务：Web/Caddy、API、PostgreSQL；数据库和 API 不直接暴露公网端口。
- PostgreSQL 使用 Docker 持久卷；应用容器升级不应删除数据卷。

服务器上另有 `/opt/yuemuhui/deploy` 项目，不属于本系统，任何部署和清理操作都不得触碰。

### 6.2 配置与安全

- 运行配置保存在服务器受限文件中，权限应保持 `600`；敏感值不得复制到 Git 或本状态文档。
- 正式环境必须关闭本地开发登录。
- 本次发布曾短暂使用受限 SSH 公钥传输发布包；发布后已从服务器授权文件和本机临时目录移除私钥。VPN/SSH 不稳定时优先通过阿里云 Workbench 或云助手执行服务器命令。
- 部署脚本支持发布前 PostgreSQL 备份、镜像回滚和数据库恢复；备份脚本默认保留 14 天。
- 已安装 `warehouse-backup.service` 与 `warehouse-backup.timer`；timer 已启用并 active。服务器时区为 `Asia/Shanghai`，计划每天 02:30 后随机延迟 0–10 分钟执行，备份脚本默认保留 14 天。

### 6.3 最近核验

- 2026-09-01 发布 `20260901T090016Z-ae4bd80ef664-3056372`，对应源码 `ae4bd80ef66445d9da0c44e0dfd2fc1b1ec5465f`。生产健康检查通过；本轮没有执行实际出库或期初库存导入。
- 自动备份 timer 已启用且 active，下一次计划为 2026-09-02 02:30 后随机 0–10 分钟。手工触发计划服务生成 `warehouse-20260901T092006Z-3074723.sql.gz`（8306 字节）和 manifest（264 字节），均为 `root:root`、权限 `600`，gzip 与 SHA-256 校验通过。隔离恢复演练仍待即时确认，禁止恢复到生产数据库。
- 2026-08-22 经用户授权发布 `20260822T023810Z-3f61393e00633d7efac09918b7e60fe4b06acd2f-3531208`。服务器归档 SHA-256 `31b6006c612b334860ab7366cba9e264ef1b495a81c5e9917585735099c997b7` 与本机一致；部署脚本生成发布前备份 `warehouse-20260822T023811Z-3531381.sql.gz`，顺序构建 migrate/API/Web、执行迁移/seed 并启动服务。发布后 API、PostgreSQL、Web 均为 `healthy`；服务器与本机公网复验的仓库健康端点均报告 Prisma 与数据库 `ok`，企业微信校验文本精确匹配，固定资产入口均为 HTTP 200。未删除数据卷、未修改生产 Secret、未 Push、未触碰 `/opt/yuemuhui/deploy`。
- 2026-08-22 经用户授权发布 `20260821T165246Z-d41db29673c2e169654b89741bf35ae948939ab5-2896536`。服务器已验证上传包 SHA-256 为 `7caa4e85c6f9485c98c70875bf9eea00b20ef6b06abf71233e3437b0feb7b8ec`，发布脚本生成新的发布前 PostgreSQL 备份、依次构建 migrate/API/Web、执行迁移/seed 并启动服务；没有删除数据卷、修改生产 Secret 或触碰 `/opt/yuemuhui/deploy`。
- 该发布完成后，`warehouse-prod` 的 Web、API、PostgreSQL 均为 `healthy`。服务器通过生产主机名复验：仓库首页返回 HTTP 200，`/WW_verify_uIghWtRwsuUPacAx.txt` 返回精确字节 `uIghWtRwsuUPacAx`，固定资产入口 `https://assets.beikexiang.cn/` 同时返回 HTTP 200；共享前门仍按精确主机名隔离两个项目。
- 2026-08-14 已发布 `20260814T093837Z-fada1d6738d6-8012`：发布脚本先生成可读备份清单的 PostgreSQL 备份，再依次构建 migrate、API、Web 镜像，执行迁移/seed 并启动服务。发布前备份文件和 manifest 已存在；未删除数据卷，未触碰 `/opt/yuemuhui/deploy`。
- 发布后独立核验：`warehouse-prod` 的 API、PostgreSQL、Web 均为 `running healthy`；Compose 配置校验通过；容器内 API 与经 Caddy、生产主机名解析的 `/health` 都返回 200，响应含 `persistenceDriver: prisma` 与数据库 `ok`；当前 release 记录来源为 `fada1d6738d6`。
- 历史上当前电脑对 `https://warehouse.beikexiang.cn/health` 的请求曾在 TLS 阶段被重置（发布前后均复现），因此当时未把公网外部客户端探测记为通过。2026-08-21 后续同机复验已得到受信 TLS 的 HTTP 200；详见 10.11。该新证据不替代服务器容器/共享网络的发布前复核。
- 上一次部署记录显示 API、PostgreSQL、Web 均健康，公网首页和 `/health` 返回 200，公网仅暴露 22/80/443。
- 2026-08-13 本地再次查询时，DNS 仍正确解析到 `106.14.224.213`，但当前电脑到 HTTPS 的请求被重置，因此线上实时健康状态需要在下一次服务器操作前重新核验。
- 生产分支上一次完整验证记录：208 个测试通过、16 个跳过，类型检查、构建和 Compose 校验通过。该结果只对应提交 `5f17963`。
- 2026-08-13 本轮只读前置检查显示 `DockerDesktopVM State=Off, Status=Operating normally`；按门禁规则立即停止 Docker image、只读挂载、deployment 测试和 Compose config，没有重启或重试。

## 7. 企业微信接入状态

### 7.1 已完成

- 已创建自建应用“集团仓库管理系统”，AgentId 为 `1000007`。
- CorpID、AgentId 和应用 Secret 已安全配置到服务器；本文不记录实际敏感值。
- 应用主页已设置为 `https://warehouse.beikexiang.cn`。
- 已勾选“在微信插件中始终进入主页”。客户端可能需要关闭旧窗口或重启后重新验证打开效果。
- API 已实现登录回调、审批回调和审批详情查询所需代码入口。
- 2026-08-22 在企业微信后台核验：网页授权及 JS-SDK 的可信域名为 `warehouse.beikexiang.cn` 且已启用；企业可信 IP 已配置 `106.14.224.213`（1 个 IP）。
- 2026-08-22 经用户明确授权，已将当前唯一的企业微信申请人账号加入生产运行配置的 `WE_COM_ADMIN_IDS`；未在本文记录该账号的 `userid`。API 服务已强制重建，容器为 `healthy` 且运行时配置已核验。
- 2026-09-01 审批 `202609010007` 已用生产审批凭据手工重同步成功，状态为 `APPROVED/PENDING_OUTBOUND`；物品 `ACCEPT-61AD5B0-01` 单位已更正为“件”，且出库单和库存流水均为 0。

### 7.2 未完成

- 企业微信人工客服已处理此前的域名主体校验；仓库 Web 的所有权校验文本、可信域名和可信 IP 均已完成发布/配置。历史 `60020` 错误未在 2026-09-01 的真实审批读取与补同步中复现。
- 2026-08-22 曾因管理员映射与旧 Cookie 角色固化显示“暂无后台权限”；按 `weComUserId` 实时重算白名单角色的修复已发布并继续包含于当前版本。该历史问题与当前尚待保存的审批自动回调订阅是不同事项。
- “招待品领用（酒、茶、粉条等）”审批模板的自动回调订阅尚未保存；保存通知订阅前必须取得操作当下确认。
- 手工重同步已经通过真实审批验证，但自动回调及重复通知幂等仍需用新测试审批验收。
- 实际出库和报表验收未执行，且实际出库必须未来单独授权。

### 7.3 后续执行顺序

1. 在操作当下确认后，只勾选并保存“招待品领用（酒、茶、粉条等）”的审批状态变化回调通知。
2. 用一张新测试审批验证自动回调、待出库单生成和重复通知幂等；不执行实际出库。
3. 实际出库和报表验收留待未来单独授权。

## 8. 数据与 Excel 状态

- 历史 Excel 只作为归档，不导入历史出入库流水。
- 生产数据库只应导入实盘确认后的期初库存，并保留仓库、物品、批次、数量和采购单价。
- 曾参考的文件包括 `D:\桌面\账面酒水库存汇总表（2026.07.30）(1).xlsx` 第二个工作表，以及微信文件目录中的 2026 年 7 月酒水期末库存。
- 早期本地内存模式曾出现中文乱码和重启后数据消失；这批导入不能视为生产数据已完成。
- 当前结构化 seed 只负责角色、3 个仓库和 `BJ/HJ/CY/WP` 四类规范分类，不导入历史 Excel。
- 三个仓库正式名称已确定；正式物品主数据和生产期初批次库存仍需完成真实盘点、财务复核后，通过一次性生产导入创建和核对。
- 本地分支 `codex/opening-stock-excel-import` 已实现管理员专属的 5 MB `.xlsx` 预览与一次性提交：固定校验 81 条物品和 243 条盘点行，零库存完整验证后跳过写库，缺失物品与正库存原子写入，并记录盘点基准日期、财务复核人和安全审计；旧单行接口已返回 410。
- 期初导入后，管理员可以在系统内调整，但必须走有原因、有调整前后值和操作日志的审计流程；不得直接删除数据。
- 本轮完整门禁未设置 `TEST_DATABASE_URL`，因此 Prisma 条件套件跳过；内存、API 和浏览器验收已完成，但不把它表述为本轮新鲜 PostgreSQL 事务证明，更不等同于生产导入。
- 2026-09-01 只读审计当前工作簿：81 条物品资料存在，但固定 243 个仓库/物品组合中只有 204 个，39 个组合缺失；223 个数量为空，`WH-01 + BJ0008` 的正库存缺确认单价；`WP0010` 分类以及 `CY0017/CY0018`、`WP0001/WP0010` 两组重复名称需确认，盘点基准日期也需业务确认。结构可生成非覆盖修正版，但阻塞业务值不得推断或代填。

## 9. 待办优先级

### P0：正式投产前必须完成

1. 即时确认并保存企业微信“招待品领用（酒、茶、粉条等）”自动回调订阅；随后用新测试审批验证自动同步和幂等建单，不执行实际出库。
2. 在隔离临时 PostgreSQL 实例中完成备份恢复演练；生产备份本身的 gzip、manifest、SHA-256 与权限已通过。
3. 人工确认 223 个数量、39 个缺失组合、`WH-01 + BJ0008` 单价、`WP0010` 分类、重复名称和盘点日期；财务复核后再执行生产期初导入。
4. 实际出库和报表验收留待未来单独授权；当前审批继续保持 `PENDING_OUTBOUND`，不得为验收而扣减库存。

### P1：正式使用体验

1. 完成固定资产视觉系统对齐和首页图标最终验收。
2. 验收本地手机响应式范围：查询、通知、单页入库、四步出库与取消；复杂业务继续使用电脑网页。
3. 聚焦式全站中文、字号、弹窗表单、按钮与反馈语义修正已合入并包含于当前源码；固定资产视觉最终人工验收、全量 CSS 设计令牌重构和历史后端英文错误清理仍为后续体验工作。
4. 全局搜索与仓库范围已完成自动化验收：搜索结果可按物品展示仓库、批次、数量和金额并跳转库存查询；“全部仓库”与单仓切换会刷新搜索、首页指标和报表范围，并阻止旧请求结果覆盖新范围。

### P2：运行稳定性

1. 建立固定发布流程：本地修改 → 测试 → 数据库备份 → 镜像发布 → 健康检查 → 保留回滚版本。
2. 增加运行日志、磁盘、数据库容量和证书续期检查。
3. 根据实际使用量再决定是否建设 CI/CD；当前规模不要求立即引入复杂流水线。

## 10. 验证与发布门禁

### 10.1 手机响应式分支的新鲜验证（2026-08-13 至 2026-08-14）

所有命令将 bundled Node `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` 放在 PATH 首位，实际版本 `v24.19.0`。Prisma generate 使用仅指向 `127.0.0.1:65432` 的 dummy `DATABASE_URL`，没有连接数据库。

- `corepack pnpm exec prisma generate`：exit 0，Prisma Client v7.9.1 生成成功。
- `corepack pnpm exec vitest run --exclude 'tests/deployment/**'`：48 个文件，45 passed、3 skipped；254 个测试，238 passed、16 skipped、0 failed；exit 0。
- `corepack pnpm typecheck`：API/Web 均完成，exit 0。
- `corepack pnpm build`：API/Web 均完成；Web 1613 modules transformed，exit 0。
- `corepack pnpm test:e2e`（隔离 3301/5474、memory/local-auth）：119 passed、0 failed、0 skipped，36.3s，exit 0。
- `git diff --check 5f17963...HEAD`：无输出，exit 0。
- Docker/deployment：环境阻塞。`DockerDesktopVM` 为 Off，未运行 image inspect、只读挂载、deployment tests、完整含部署测试或 Compose config。

Task 8 首轮完整 E2E 曾为 75 passed、29 failed；29 个失败全部来自旧 spec 硬编码 API 端口 3001。将 7 个 legacy spec 改为 env-aware 后，相关定向验证 30/30 通过，当时全量 104/104 通过；加入最终手机直达路由门禁等回归后，主流程最终为 119/119。该 failing run 是测试隔离缺陷证据，不是产品行为失败。财务零管理员请求、完整入库 payload/memory persistence、完整出库 payload/route 409 是在既有正确行为上新增且首次即过的表征覆盖，不记作 TDD RED。

### 10.2 通用发布门禁

任何人或后续 Codex 任务在声称“可上线”前，仍需在 Docker 恢复后运行并记录完整测试、deployment tests、Compose config、生产数据库备份和服务器健康检查。企业微信全链路未通过、生产期初库存未核对或服务器实时健康检查未通过时，不能宣称正式上线完成。

### 10.3 手机端字段与出库对齐复验（2026-08-14）

- TDD RED：`previewInboundBatchNo` 尚不存在；手机入库页没有“批次号（系统生成）”只读控件。出库空态仍显示孤立“选择待办”。
- TDD GREEN：`tests/unit/web/inbound-form.test.ts` 为 14 passed；隔离 memory/local-auth 的入库、出库、手机壳层、首页导航及管理员入库 E2E 共 35 passed、0 failed（API `3301` / Web `5474`）；日期与批次预览字段顺序、左对齐、44px 高度、无 `batchNo` POST、出库图文分组、失效草稿保留及 320/390/430/820px 无溢出均有自动断言。
- `corepack pnpm --filter @warehouse/web typecheck`：exit 0；`corepack pnpm --filter @warehouse/web build`：1613 modules transformed、exit 0；`git diff --check`：无输出。
- Node `v24.19.0` 下执行 `corepack pnpm exec vitest run --exclude 'tests/deployment/**'`：46 passed、3 skipped；243 passed、17 skipped、0 failed。跳过项均为需要外部 PostgreSQL 的 Prisma 集成套件。
- 内置浏览器对局域网验收地址 `192.168.3.21:5482` 的自动访问被客户端策略拒绝（`ERR_BLOCKED_BY_CLIENT`）；这不影响本机 API/Vite、隔离 E2E 或用户手机实际访问。验收服务 `3307` / `5481` / `5482` 保持运行且未重启；用户已于 2026-08-14 完成本地/手机视觉验收并确认通过。
- DockerDesktopVM 仍为 Off，本轮未运行 Docker、deployment 或 Compose 门禁；未连接生产数据库、未部署、未 Push。

### 10.3 最终分支评审修复（2026-08-14）

- 手机端桌面专属路由已统一门禁：标准物品库、仓库设置、期初库存、调拨、退库、盘点和月结在 `<=820px` 只显示“请在电脑端处理”，不挂载原可写页面或发起页面专属请求；`821px+` 保留完整页面。
- 手机可用范围不变：入库、出库、库存查询和报表继续可用。
- 前端在收到稳定的 `batch number already exists` 业务错误时，会同时保留确认弹窗/输入值，并在批次号字段显示错误与 `aria-invalid`；未知及网络错误仍使用通用错误处理。生产 Prisma 唯一约束的 `P2002` 统一转换已于 2026-08-25 在本地隔离分支完成，详见 10.19。
- 最终整分支评审的规格级 Important（手机直达电脑端专属可写页面）已经关闭；当时停放的后端错误契约 Minor 已由 10.19 的本地实现关闭，等待合回集成分支和后续另行授权发布。
- 主流程最终新鲜验证：非部署 Vitest 238 passed/16 skipped、隔离 E2E 119/119、API/Web typecheck、API/Web build 和 diff-check 均通过；Docker 门禁仍因 VM Off 未运行。

### 10.4 本地合并验证与验收环境（2026-08-14）

- 合并：`codex/mobile-responsive` 已无冲突合并至本地 `codex/production-deployment`，合并提交为 `de6c69d`；未执行 Push、部署、服务器操作或生产 Secret 修改。
- 合并后新鲜验证：Prisma Client 生成成功；非部署 Vitest 45 个文件通过、3 个 PostgreSQL 条件跳过，238 passed/16 skipped；API/Web typecheck 与 build 通过；隔离 E2E 119/119 通过；`git diff --check 5f17963..HEAD` 通过。
- Docker/deployment：`DockerDesktopVM State=Off, Status=Operating normally`，按门禁未运行 Docker image、只读挂载、deployment tests 或 Compose config。
- 本机验收：Web `http://127.0.0.1:5480`，API `http://127.0.0.1:3307/health`；仅使用 memory persistence 与 local-auth，数据只在本机进程内有效，关闭服务后会清空，不连接任何真实或生产数据库。

### 10.5 入库自动批次与移动视觉调整的新鲜验证（2026-08-14）

- 基线：`codex/production-deployment` 在 `5c44967 test: remove stale admin inbound batch selector` 上开始本轮验证；原开发工作区 `D:\桌面\仓库` 仍保留其用户已有未提交修改且未被本轮改写、清理或提交。
- Prisma：`corepack pnpm exec prisma generate` 使用仅指向本机虚构数据库的 `DATABASE_URL`，exit 0；没有连接真实或生产数据库。
- 非部署 Vitest：`corepack pnpm exec vitest run --exclude tests/deployment/**`，46 个文件 passed、3 个文件 skipped；242 个测试 passed、17 个测试 skipped、0 failed，exit 0。跳过项是需要外部 Prisma 数据库的条件测试。
- 类型与构建：`@warehouse/api` typecheck、`@warehouse/web` typecheck、`@warehouse/web` build 均 exit 0；Web 构建转换 1613 个模块。
- 隔离 E2E：以 `PERSISTENCE_DRIVER=memory`、`LOCAL_AUTH_BYPASS=true` 启动在 API `127.0.0.1:3103`、Web `127.0.0.1:5180`；`corepack pnpm exec playwright test --config playwright.config.ts` 为 121 passed、0 failed（31.4s）。默认 3001/5174 已被其他进程占用，未复用或停止；本轮自有 3103/5180 已在测试后释放。
- 差异检查：`git diff --check 1deb803..HEAD` 无输出、exit 0。
- Docker/deployment：`DockerDesktopVM State=Off, Status=Operating normally`；未运行 Docker/部署测试、Compose 检查，也未重启 Docker。
- 本地验收边界：未停止或修改用户验收监听的 5481/5482；未运行 Push、部署、服务器操作或生产 Secret/数据库操作。用户已确认本地/手机验收通过；当前继续保持本地状态，等待用户决定是否进入后续发布流程。

### 10.6 服务器发布与交付核验（2026-08-14）

- 发布源：`fada1d6738d6ddd30db7eefb3de60e06771f7fc7`；服务器 release：`20260814T093837Z-fada1d6738d6-8012`。上传前发布包 SHA-256 为 `8964f7470f02e36a9d4ba0af904e35c0e512db5fc93f11227125dc517653d9cd`，服务器校验值一致。
- 发布前置：目标目录存在、生产环境文件权限为 `600`、API/PostgreSQL/Web 初始均健康、当前与上一 release 记录可读；隔离 staging 配置校验成功。发布脚本的预升级 PostgreSQL 备份及 manifest 均通过存在性核验。
- 新鲜服务器验证：`docker compose ... config --quiet` exit 0；`warehouse-prod` 的 API、PostgreSQL、Web 均为 `running healthy`；API 健康端点与强制解析至 `127.0.0.1` 的 Caddy HTTPS `/health` 均为 HTTP 200，报告 `prisma` 持久化和数据库 `ok`；release metadata 的 `source_revision=fada1d6738d6`。
- 安全与清理：未 Push、未改生产 Secret、未删除数据卷、未触碰 `/opt/yuemuhui/deploy`。临时 SSH 公钥、服务器临时发布包与隔离 staging 目录均已移除；本机临时私钥已移除。代码归档副本仍留在受 Git 忽略的本机临时目录，未含生产配置或 Secret，也不会提交或上传。
- 外部入口边界：本机 `curl` 对公网 HTTPS 在发布前后均被连接重置，故未把它记为公网通过；服务器内部经 Caddy 的生产主机名健康验证已通过。企业微信真实全链路、ICP 相关配置与生产主数据验收仍待完成。

### 10.7 项目状态交接文档核验（2026-08-21）

- 交接摘要已建立为 `docs/项目状态与发布交接.md`，并由本文件顶部入口链接；摘要只复述本文件中已核验的发布事实与未完成边界。
- 本次仅文档变更后的新鲜本机门禁：以临时本机数据库地址生成 Prisma Client 后，`corepack pnpm test` 为 48 个文件通过、3 个文件跳过；256 个测试通过、17 个测试跳过、0 个失败（25.98s）。跳过项仍为需要外部 Prisma 数据库的条件测试。
- 本次没有 Push、部署、服务器操作、生产 Secret 或数据库操作；不改变 2026-08-14 服务器发布和公网入口的既有结论。

### 10.8 开发与生产部署分支整合（2026-08-21）

- 在保留用户文件并创建安全 stash 后，将 `codex/production-deployment@b2bedbf` 无冲突合并到 `feat/warehouse-system`，本地合并提交为 `a03e87e`。
- 合并后发现本机已生成的 Prisma Client 仍对应旧 schema；通过 DMMF 核验确认缺少 `outboundStatus`、`InboundBatchSequence` 等模型后，执行 `corepack pnpm exec prisma generate` 重新生成客户端。该操作只更新本机依赖产物，没有修改业务源码或数据库。
- 合并后新鲜门禁：`corepack pnpm test -- --reporter=dot --silent` 为 48 个文件通过、3 个文件跳过，256 个测试通过、17 个测试跳过；`corepack pnpm typecheck` 和 `corepack pnpm build` 均通过；Web 构建转换 1613 个模块。
- 本次没有 Push、重新部署、服务器操作、生产 Secret 或数据库操作；服务器继续运行 `20260814T093837Z-fada1d6738d6-8012`。

### 10.9 新任务交接入口（2026-08-21）

- 当前对话已完成手机响应式分支交付、生产部署分支回合并、Prisma Client 同步验证和状态文档收口。用户后续将在新任务中提出新的开发需求；不要从旧对话推断尚未明确的新需求。
- 新任务开始时必须先完整阅读本文件和 `docs/项目状态与发布交接.md`，再运行 `git status --short --branch`、`git log -3 --oneline --decorate` 与 `git stash list` 核对实时状态。
- 不要假定仓库存在 `main` 分支。当前集成分支为 `feat/warehouse-system`；已核验的分支整合提交为 `a03e87e`，当前共享前门本地验证提交为 `77619dc`。开始开发时以实际 `HEAD` 为准。
- `stash@{0}` 是合并前重叠修改的安全备份。未经差异审查和用户确认，不得自动 `pop`、`apply` 或 `drop`；它不属于新需求的默认实现输入。
- 工作区现有 `.tmp_ppt/`、两份 2026-08-08 计划文档、演示文稿检查文件和演示目录均为用户保留资料。新任务不得清理、覆盖或顺带提交。
- 下一次功能开发应先判断影响范围；涉及多步骤功能时从当前集成基线创建明确分支或 worktree，不得使用不存在的 `main` 作为引用。修改完成后至少运行针对性测试、类型检查、生产构建和 `git diff --check`。
- 下一次服务器发布、Push、生产数据库操作或企业微信配置变更仍需单独授权；不能因本地代码已整合而推断线上已更新。

### 10.10 共享 Caddy 前门与固定资产站点隔离（2026-08-21）

- 仓库项目的 `deploy/Caddyfile` 现在是其共享前门发布的权威配置来源；固定资产项目源码未修改。`warehouse.beikexiang.cn` 继续仅服务仓库静态页面和 `api:3001` 的仓库接口；`assets.beikexiang.cn` 是独立站点，仅反代 Docker DNS 上游 `beikexiang-assets:8088`。即使两个项目存在同名路径，仍以精确主机名隔离，不共享路径前缀或跨项目 API 代理。
- 新增 `deploy/frontdoor-assets.override.yml`，它只将 Compose 的 `web` 服务替换为 `${FRONTDOOR_IMAGE}` 并设置 `build: null`，与固定资产系统现有共享前门切换脚本兼容；它不涉及 API、migrate、PostgreSQL、8088 宿主机端口或 `backend` 内部网络。
- TDD 证据：新增覆盖文件断言后，`corepack pnpm exec vitest run tests/deployment/production-config.test.ts` 首次为 11 项中 1 项失败，错误为 `expected '' to contain 'web:'`；新增最小覆盖文件后同一命令为 11/11 通过。
- 新鲜本地门禁：Docker Engine 客户端/服务端均为 27.2.0；以 `deploy/.env.production.example` 和临时 `FRONTDOOR_IMAGE=beikexiang/frontdoor:local` 执行 `docker compose ... config --quiet` exit 0，未启动、构建、拉取容器或连接服务器。随后部署配置 Vitest 11/11、`corepack pnpm typecheck`、`corepack pnpm build`（Web 转换 1613 个模块）及 `git diff --check HEAD~1..HEAD` 均 exit 0。
- 提交：设计规格为 `1deb36b docs: specify shared frontdoor isolation`，本地配置为 `77619dc fix(deploy): preserve fixed assets frontdoor`。该实现阶段没有 Push、部署、服务器 Shell 命令、生产数据库、生产 Secret 或企业微信操作；服务器仍运行 `20260814T093837Z-fada1d6738d6-8012`。授权发布前仍须重新核验服务器容器/共享网络，并经 Caddy 对两个主机名分别执行健康检查。
- 分支收口复验：默认文件并行的完整 Vitest 首次在既有 `tests/deployment/deployment-scripts.test.ts` 中出现一次 `spawnSync docker ETIMEDOUT`，失败点是本机 Docker 运行缓存的 `node:24-alpine` 进行 Linux `/bin/sh` 打包验证。该单文件随后为 4/4 通过（14.14s）；Docker Engine 27.2.0 与本地镜像均可用，且最近提交未修改该测试或打包脚本。关闭文件并行后完整套件为 48 个文件通过、3 个文件跳过，258 个测试通过、17 个跳过、0 个失败（43.86s）。这是本机 Docker 调度的时序风险，非本次共享前门产品行为回归；后续应在 Docker 空闲时复验默认并行套件后再决定是否调整测试并行策略。

### 10.11 公网 HTTPS 与共享入口复验（2026-08-21）

- 从本机只读复验：`warehouse.beikexiang.cn` 与 `assets.beikexiang.cn` 的 A 记录均为 `106.14.224.213`，四个 TCP 探测（两个域名的 80/443）均成功。`http://warehouse.beikexiang.cn/health` 返回 Caddy 的 308 HTTPS 跳转；两个域名的 HTTPS 健康端点均为证书校验成功的 HTTP 200，固定资产首页同样为 200。
- 两站点 HTTPS 响应的 `Permissions-Policy` 分别为仓库的 `camera=()` 与固定资产的 `camera=(self)`，与按精确主机名隔离的前门策略一致。此为外部入口行为证据；未通过服务器 Shell 读取容器、网络或 Caddy 运行时配置，故它们仍是授权发布前的复核项。
- 同次阿里云控制台只读核验显示实例 `i-uf6ig2xdl67rqerk67l1` 为运行中且健康状态正常，公网 IP 为 `106.14.224.213`。未执行重启、发布、安全组修改、数据库或 Secret 操作。此前“本机 TLS 重置”已在当前电脑上排除；手机公网复验尚未执行，故 HTTPS 的正式验收项仍保持待办。正式生产验收还受企业微信真实链路、主数据及下一次授权发布的容器复核约束。

### 10.12 企业微信仓库域名所有权校验文本修复（2026-08-21）

- 人工客服确认已处理此前“域名主体校验未通过”后，用户在仓库自建应用重新配置 `warehouse.beikexiang.cn` 时收到“域名所有权验证不通过”。这与主体校验不同；当时可信域名没有保存，固定资产应用已配置而仓库应用可信 IP 尚未配置。后续配置结果见 10.14。
- 本机只读公网核验：固定资产域名上的现有校验文本返回 `HTTP 200`、`text/plain; charset=utf-8`、16 字节；仓库域名同路径虽返回 `HTTP 200`，但为 `text/html; charset=utf-8`、432 字节的 SPA 回退页。因此不能把仅凭状态码 200 视为校验文件可用，根因是仓库 Web 发布物缺少该静态文本。
- TDD：先在 `tests/unit/web/vite-config.test.ts` 断言仓库 Web 的 public 目录存在企业微信校验文本；首次定向测试按预期失败（`expected false to be true`）。随后新增最小 public 静态文件，发现末尾换行使内容变为 17 字节，移除后同一测试为 2/2 通过。
- 新鲜本地验证：`corepack pnpm test tests/unit/web/vite-config.test.ts` 为 2/2 通过；`corepack pnpm typecheck`、`corepack pnpm build` 均 exit 0；生产 Web 构建产物含 16 字节校验文本。未执行 Push、部署、服务器操作、生产数据库、生产 Secret 或企业微信保存操作。
- 已完成：经用户授权，提交 `d41db296` 已于 2026-08-22 发布为 `20260821T165246Z-d41db29673c2e169654b89741bf35ae948939ab5-2896536`。发布后服务器经生产主机名核验，仓库首页为 HTTP 200，校验路径返回精确 16 字节 `uIghWtRwsuUPacAx`，固定资产入口也为 HTTP 200；未 Push、未修改生产 Secret 或企业微信设置。
- 已完成：企业微信后台已显示可信域名 `warehouse.beikexiang.cn` 为已启用，企业可信 IP 已配置 `106.14.224.213`（1 个 IP）。
- 已完成：经用户明确授权，已从生产数据中识别当前唯一申请人并将其加入 `WE_COM_ADMIN_IDS`，随后仅重建 API 服务；运行时配置和 API 健康状态均已复核。未将 `userid` 记录到本文，未修改生产数据库数据、回调 Token、EncodingAESKey、审批模板、Secret 或应用可见范围。随后截图复现仍为领用人，已确认现有 8 小时会话将角色写入 Cookie，关闭/重开客户端不会刷新角色；按会话 `weComUserId` 实时重算角色的最小修复已在 10.15 所述发布中上线。可信域名、IP 白名单和应用内部角色映射不能混同。

### 10.13 授权生产发布与共享前门核验（2026-08-22）

- 用户授权发布当前仓库版本后，本机先通过定向校验文本测试（2/2）、API/Web 类型检查、生产构建及 `git diff --check`，再将仅含发布文件的归档上传到服务器；服务器 SHA-256 与本机一致。发布源是 `d41db29673c2e169654b89741bf35ae948939ab5`，发布版本为 `20260821T165246Z-d41db29673c2e169654b89741bf35ae948939ab5-2896536`。
- 部署脚本的日志确认：先创建 PostgreSQL 备份，再以受限内存顺序构建 migrate、API 和 Web 镜像，执行迁移/seed，并在启动 API、Web 后完成部署。发布期间前门按设计短暂停止，完成后所有 `warehouse-prod` 容器均恢复为 healthy。
- 发布后服务器通过真实生产主机名验证仓库首页 HTTP 200、企业微信校验文本精确为 `uIghWtRwsuUPacAx`、固定资产首页 HTTP 200。由此确认共享 Caddy 前门仍将 `warehouse.beikexiang.cn` 与 `assets.beikexiang.cn` 按主机名隔离；未触碰无关的 `yuemuhui` 服务。

### 10.14 企业微信可信配置与后台角色排查（2026-08-22）

- 用户确认后，企业微信自建应用页面显示网页授权及 JS-SDK 的可信域名 `warehouse.beikexiang.cn` 为“已启用”，企业可信 IP 已配置 1 个地址（`106.14.224.213`）。未修改回调 Token、EncodingAESKey、审批模板、Secret 或应用可见范围。
- 同日企业微信客户端进入仓库应用显示“暂无后台权限，当前企业微信账号只能发起和查看领用申请”。代码证据：`apps/web/src/App.tsx` 仅在会话角色为 `APPLICANT` 时显示该页面；`apps/api/src/server.ts` 的 `roleForUser` 仅将位于 `WE_COM_ADMIN_IDS` / `WE_COM_FINANCE_IDS` 的 OAuth `userid` 分别赋予 `ADMIN` / `FINANCE`，否则返回 `APPLICANT`。因此这是应用内部角色白名单缺少当前账号，而非本次可信域名/IP 配置失败。
- 已完成配置：用户明确要求将当前登录账号设为管理员后，以生产数据库中唯一的 `APPLICANT` 记录识别目标并更新生产 `WE_COM_ADMIN_IDS`。API 服务已强制重建；容器为 `healthy`，运行时环境已确认包含该管理员映射，仓库首页和企业微信所有权校验文件仍分别返回 HTTP 200 与精确校验文本。随后关闭/重开企业微信应用的截图仍显示领用人，原因是 `SessionService` 将角色固化在最长 8 小时的 `warehouse_session` 加密 Cookie 中，前端优先使用有效 `/auth/session` 响应。经用户授权，测试驱动实现的最小修复已随 `3f61393` 发布：每次读取有效企业微信会话时，按其中的 `weComUserId` 重新解析当前白名单角色，因此既有会话也能立即获得授予或撤销；本地绕过登录会话带有经签名的 `isLocalAuth` 标记，但仅在当前本地绕过开关启用时保持其测试角色。本文不保存该 `userid`；未写入生产业务数据，也未修改回调 Token、EncodingAESKey、审批模板、Secret 或应用可见范围。本地定向认证测试为 19/19 通过（企业微信 4、本地绕过 13、会话服务 2），完整测试为 48 个文件通过、3 个跳过（262/262 通过、17 个跳过），API/Web 类型检查、生产构建和 `git diff --check` 均通过，认证安全复审无阻塞项；发布后容器、共享前门和公网健康核验均通过，仍待当前账号的企业微信界面确认。

### 10.15 会话角色实时解析修复的授权发布（2026-08-22）

- 用户授权发布当前仓库版本后，本机重新通过认证定向测试 19/19、API/Web 类型检查、生产构建与 `git diff --check`；完整测试基线为 48 个文件通过、3 个跳过（262/262 通过、17 个跳过）。发布源为 `3f61393e00633d7efac09918b7e60fe4b06acd2f`，本机归档 SHA-256 为 `31b6006c612b334860ab7366cba9e264ef1b495a81c5e9917585735099c997b7`。
- 服务器上传归档 SHA-256 一致且不含 `deploy/.env.production`；发布脚本创建发布前备份 `warehouse-20260822T023811Z-3531381.sql.gz`，顺序构建 migrate/API/Web、执行迁移/seed，并完成发布版本 `20260822T023810Z-3f61393e00633d7efac09918b7e60fe4b06acd2f-3531208`。API、PostgreSQL、Web 均为 `healthy`，服务器和本机公网的仓库 `/health` 均返回 Prisma 与数据库 `ok`，校验文本精确为 `uIghWtRwsuUPacAx`，固定资产入口为 HTTP 200；共享 `warehouse-prod_edge` 网络仍包含仓库、固定资产和其他既有服务，未触碰 `yuemuhui`、生产 Secret 或数据卷，且未 Push。
- 未完成事项：当前企业微信账号需刷新/重新进入仓库应用，以确认既有 Cookie 会被新服务端代码实时映射为管理员；企业微信真实登录、审批回调和完整业务链路仍未验收。

### 10.16 紧凑桌面布局本地验证与交接（2026-08-22，2026-08-24 复验）

- 来源分支 `codex/compact-desktop-layout@46b1b22` 实现了获批的紧凑桌面行为，并已在 2026-08-24 通过合并提交 `7b85a76` 进入 `feat/warehouse-system`：在 `821px–1180px` 默认显示 `64px` 图标侧栏；鼠标悬停或键盘焦点临时以 `232px` 覆盖内容区，而工作区仍保留 `64px`；指针点击固定后工作区同步使用 `232px` 留边；再次点击收起；刷新恢复默认收起；`<=820px` 的既有手机导航未改。`821px/980px` 紧凑顶栏保留当前页、角色及头像/菜单控件且无水平溢出；`1180px` 的网格、指标和仪表盘仍可读，`1181px`/`820px` 保持既有桌面/手机边界。
- 2026-08-24 新鲜侧栏 E2E：为避免 Playwright 默认端口复用本机固定资产系统，显式使用仓库专属临时端口和进程级测试配置（API `127.0.0.1:13001`、Web `127.0.0.1:13000`、memory persistence、local-auth）执行 `corepack pnpm exec playwright test tests/e2e/navigation/sidebar.spec.ts`，14/14 通过（29.0s）。除 ADMIN/FINANCE 既有标签与 href、悬停/指针固定与取消固定、键盘焦点与取消固定、工作区焦点收起、刷新及 `1181px`/`820px` 行为/边界/角色覆盖外，覆盖 `980px` 展开品牌边界、`821px`/`980px`/`1080px` 焦点顺序与几何、`821px`/`980px`/`1180px` 长姓名控件收容，以及切换控件的可访问名称/`aria-expanded`、导航文字提示和完整 Tab 路径至当前用户菜单。临时端口和进程已在测试后释放，未停止或修改固定资产系统的既有本地服务。
- 隔离本地浏览器视觉验收（不是生产或企业微信验收）：`820px` 为手机底部导航和手机入库表单、无桌面侧栏或页面溢出；`980px` 为 64px 紧凑侧栏、保留顶栏上下文/角色、两列指标和单列仪表盘，入库表单可读且无溢出，悬停覆盖为 232px/工作区 64px、固定后为 232px/工作区 232px；`1180px` 为紧凑侧栏、四项指标和单列仪表盘，入库表单可读且无水平溢出；`1440px` 为完整 232px 侧栏和双列仪表盘，入库表单亦可读且无水平溢出。`980px` 适配修正后再次量得品牌 Logo 190px、切换控件 32px、间距 3px，均在品牌范围内。
- Docker Desktop 本地门禁已解除：经用户手动加入精确父目录 `D:\桌面\仓库\.worktrees\compact-desktop-layout\.superpowers` 并应用设置后，只读 bind-mount 探针返回 `bind-ok`；定向 `tests/deployment/deployment-scripts.test.ts` 为 4/4 通过（26.01s）。此前的 `spawnSync docker ETIMEDOUT` 根因是该动态 `release-test-*` 临时目录的父目录未获 Docker Desktop 文件共享授权，不需要修改产品代码、测试调度或超时策略。
- 新鲜完整 Vitest：临时启动当前仓库 API `127.0.0.1:13001`，并将 `bootstrap.test.ts` 的完整健康检查 URL 显式设为 `http://127.0.0.1:13001/health` 后，`corepack pnpm test` 为 48 个文件通过、3 个跳过；262 个测试通过、17 个跳过、0 个失败（20.12s）。一次并行执行曾使 `bootstrap.test.ts` 触发固定 5 秒超时；该测试单独运行 1/1 通过（59ms），无产品回归证据。
- 新鲜类型、构建与差异检查：`corepack pnpm typecheck` exit 0；`corepack pnpm build` exit 0（Web 转换 1613 个模块）；文档修改后 `git diff --check` 无输出、exit 0。
- 本地集成：2026-08-24 按用户选择将 `codex/compact-desktop-layout@46b1b22` 本地合并到 `feat/warehouse-system`。合并时以紧凑布局分支的获批交互和 14 项 E2E 为主，并保留集成分支随后加入的登录测试稳定性处理及切换按钮 hover/focus 可见样式；旧的并行侧栏状态机与对应单元测试已移除。合并暂存结果再次通过侧栏 E2E 14/14（28.1s）、完整 Vitest 48 个文件通过/3 个跳过且 262 个测试通过/17 个跳过（13.75s）、API/Web 类型检查、生产构建和 `git diff --check`。
- 合并提交 `7b85a76` 的提交后复验再次通过：侧栏 E2E 14/14（26.0s）；完整 Vitest 48 个文件通过、3 个跳过，262 个测试通过、17 个跳过、0 个失败（36.26s）；API/Web 类型检查、生产构建和最终 `git diff --check` 均通过。已清理本次拥有的 `.worktrees/compact-desktop-layout` worktree，并删除已合并的来源分支 `codex/compact-desktop-layout`；未触碰其他 worktree。
- 历史边界：该轮只完成本地合并与验证，当时没有生产变更，服务器版本为 `3f61393`；当前生产版本见第 6 节。

### 10.17 三仓期初库存 Excel 模板（2026-08-24，本地）

- 已确认三个正式仓库及现有系统编码：`WH-01` 集团二楼仓库、`WH-02` 内区1号仓库、`WH-03` 1区车库后仓库。设计规格为 `docs/superpowers/specs/2026-08-24-initial-inventory-excel-template-design.md`，实施计划提交为 `b249ce7`。
- 以只读方式参考 `D:\桌面\酒水2026年7月.xlsx` 的“基础资料”和“汇总”，生成本地文件 `outputs/warehouse-initial-import-template/集团仓库期初数据导入模板.xlsx`；源文件未覆盖、未重命名，核验时 SHA-256 为 `BE7F558EBBD640818B3CB760CA08478C9C7A2B55531CA66B71E47A048979B947`。输出文件为 58,239 字节，SHA-256 为 `7673B6C689C061E8A4544B493A98754FDA03F66BDE4D46CBB59C9C83366E8D08`，作为本地交付物不加入 Git。
- 上述大小与摘要仅是模板生成完成时的历史指纹。2026-08-24 收尾阶段只读复核原工作区同名文件时，其大小已变为 75,532 字节且存在 Excel 临时锁文件；检查时的 `物品资料` 表头不再符合已批准的固定 8 列导入契约。该文件可能仍在人工编辑，本轮没有覆盖或修复它；正式导入前必须关闭/完成编辑，并重新通过系统预览校验。
- 模板只含五张固定工作表：`填写说明`、`仓库清单`、`物品资料`、`期初库存`、`核对汇总`；包含 3 条仓库映射、81 条物品资料、243 条三仓盘点行和 81 条核对行。盘点基准日期、实盘数量、确认单价和备注为黄色人工输入区；仓库/物品引用、批次号、金额、校验状态和三仓核对由公式驱动。
- 已知源异常已显式保留：`CY0008` 原综合期末库存为 `-1` 且不复制到实盘数量；`BJ0009`、`BJ0034`、`BJ0051` 标记“原汇总缺失”；`WP0010` 类别“个”标记疑似列错位；同名不同编码与参考单价缺失均在物品资料中提示。
- 新鲜验收：独立验收器先因输出文件不存在按预期 RED；生成后结构、唯一编码、三仓各 81 行、空白实盘数量、关键公式和公式错误扫描均通过。内存场景为 `BJ0016` 填入基准日期及三仓数量 `1/2/5`，自动生成三个稳定批次号，金额为 `99/198/495`，三仓合计 `8`、金额 `792`、差异 `0`，三行和汇总状态均为“通过”。五张工作表均已渲染并完成视觉检查；随后 `corepack pnpm typecheck`、`corepack pnpm build`（Web 转换 1613 个模块）和 `git diff --check` 均 exit 0。默认并行完整 Vitest 一次仅在既有 `bootstrap.test.ts` 的固定 5 秒健康请求上超时；健康端点实时返回 200，该单测独立 1/1 通过（68ms），禁用文件并行后的完整套件为 48 个文件通过、3 个跳过，262 个测试通过、17 个跳过、0 失败（49.50s），未修改产品或测试代码。
- 尚未完成：填写真实盘点基准日期、三仓实盘数量和确认单价；管理员与财务核对；生产发布；任何本地或生产数据库导入。Excel 预览/整批事务导入已经在下述 10.18 实现并进入本地集成分支，模板本身仍不会连接数据库。
- 历史边界：该轮没有生产变更，当时服务器运行 `20260822T023810Z-3f61393e00633d7efac09918b7e60fe4b06acd2f-3531208`；当前生产版本见第 6 节。`stash@{0}` 和进入该任务前已有的未跟踪计划、`.tmp_ppt/`、演示资料均未动。

### 10.18 期初库存 Excel 预览与一次性导入（2026-08-24 实现，2026-08-25 本地复验）

- 已确认规格为 `docs/superpowers/specs/2026-08-24-opening-stock-excel-import-design.md`，实施计划为 `docs/superpowers/plans/2026-08-24-opening-stock-excel-import.md`；实现最初位于独立 worktree 分支 `codex/opening-stock-excel-import`，基于 `feat/warehouse-system@dae0ce1`。2026-08-25 按用户选择把已验证截止提交 `700eb74` 以 `--ff-only` 快进进入本地集成分支；未 Push、未部署。实际 Git 状态显示远端功能分支已于本轮开始前存在并停在 `77e4b79`；来源 worktree 随后新增了无关的 CI 设计提交 `ddafb7b`，本次未将其带入集成分支，也未清理该并行 worktree/分支。
- 电脑端管理员可上传一个不超过 5 MB 的固定 `.xlsx`，先获得完整预览，再以绑定管理员、文件摘要和有效期的签名凭证重新上传同一文件并一次性提交。财务和申请人不能操作；手机端 `<=820px` 不挂载表单或发起导入请求。
- 系统读取“填写说明!B6”作为盘点基准日期，并读取“物品资料”和“期初库存”作为业务数据；仓库清单和核对汇总仅供人工辅助审核。服务端重新计算批次、金额和校验状态，不信任公式缓存。
- 固定契约校验 81 条物品和 243 条三仓盘点行。零库存行参与完整性和汇总校验但跳过写库；缺失物品与正库存的导入记录、仓库入库单、批次、余额、明细和 `OPENING_BALANCE` 流水在同一原子事务中创建，并以盘点基准日期决定批次和会计期间。
- 管理员必须填写线下共同核对的财务复核人并勾选确认；操作人只来自认证会话。成功与失败审计不保存文件 Buffer、预览凭证或 81/243 行原始明细。旧单行 `POST /admin/opening-stock` 已停止写入并返回 HTTP 410。
- 实现提交链为 `0bc6f4b`、`76fd42d`、`21c88ce`、`56731a7`、`6d91895`、`abc8766`、`5a3351e`、`444e120`、`e76d758`、`9a210d4`，依次覆盖 schema/分类、解析、校验、凭证、服务、内存/Prisma 事务、路由审计、页面和验收；收尾评审修订提交为 `a3bfe8c`。全量门禁首次发现 4 份旧集成测试仍用已退役端点构造库存；已保留 410 契约并把这些通用下游测试改用正常入库夹具。评审还补齐预览“总数量”、拒绝无表头额外业务列，并消除问题列表重复 React key；相关回归及随后完整套件均通过。
- 2026-08-25 新鲜验证：针对性 Vitest 为 8 个文件、99 个测试通过；默认完整 Vitest 为 54 个文件通过、4 个文件条件跳过，341 个测试通过、24 个跳过；隔离 API/Web 端口并显式启用 memory/local-auth 后，期初导入与移动边界 E2E 为 37/37。`corepack pnpm typecheck`、`corepack pnpm build`（Web 转换 1614 个模块）和 `git diff --check feat/warehouse-system..HEAD` 均 exit 0。
- 同日用无持久卷、验证后已删除的本地 PostgreSQL 16 容器执行全部 4 个 Prisma 条件套件。首次迁移后发现旧主数据集成断言只列 `BJ/CY/WP` 三类，与已确认的 `BJ/HJ/CY/WP` seed 契约不一致；补齐两处 `HJ` 断言后，Prisma 主数据、业务存储、期初导入事务和重启持久化共 24/24 通过，包含原子提交与故障回滚证据。带 `TEST_DATABASE_URL` 的默认文件并行完整套件为 364/365，仅旧“历史 seed ID 归一化”测试在全机并发下超过固定 5 秒；该测试单独为 3/3，通过真正的 `--no-file-parallelism` 完整复验为 58 个文件、365/365 通过（46.46s），因此记录为本机调度风险，不放宽超时。浏览器首轮也曾因测试启动遗漏 `PERSISTENCE_DRIVER=memory` 和 `LOCAL_AUTH_BYPASS=true` 返回 `local_auth_unavailable`；补齐既有 E2E 环境后单例及 37 项全量均通过，未修改产品代码。所有临时容器和 13000/13001/55432 端口均已清理释放。
- 本地集成后的新鲜门禁：默认完整 Vitest 为 54 个文件通过、4 个文件条件跳过，341 个测试通过、24 个跳过；隔离端口、memory persistence 和 local-auth 下的期初导入/移动边界 E2E 为 37/37。根工作区首次类型检查准确暴露 Prisma Client 仍按合并前 schema 生成；执行 `corepack pnpm exec prisma generate` 后确认生成类型包含 `OpeningStockImport`，随后 `corepack pnpm typecheck`、`corepack pnpm build`（Web 转换 1614 个模块）均 exit 0。该处理只更新未跟踪的本地依赖生成物，不修改产品代码或生产数据库。
- 后续生产前仍需：填写真实工作簿、由管理员和财务复核异常/数量/金额，在获得单独授权后完成生产备份与发布/迁移，再执行且仅执行一次正式数据库导入并核对不可变摘要。本轮没有新的 Push，也没有连接或修改生产数据库、生产配置、Secret 或企业微信后台。

### 10.19 重复批次数据库冲突统一（2026-08-25，本地）

- 在隔离工作树 `.worktrees/duplicate-batch-conflict`、分支 `codex/duplicate-batch-conflict` 上按 TDD 完成。服务端只把 `ProcurementBatch` 的 Prisma `P2002` 映射为 HTTP 409 和稳定消息 `batch number already exists`；自动批次分配继续最多重试 3 次，`InboundBatchSequence` 并发冲突仍可重试，其他模型的唯一约束错误不会被误标为批次重复。没有修改 Prisma schema 或迁移。
- 前端把稳定消息同时映射到只读的系统生成批次号字段和原有确认弹窗，保留用户草稿；字段设置 `aria-invalid` 并显示中文提示。用户修改采购日期时清除旧批次错误，刷新后仍按服务端结果重新判断。
- RED 证据包括：字段映射单元测试最初得到空错误对象；移动端 E2E 最初找不到 `aria-invalid`，补充采购日期清错断言后最初仍保持错误状态；真实 PostgreSQL 下手工批次冲突、自动重试耗尽及期初库存第二行冲突最初均抛出原始 `P2002`。GREEN 后入库表单单元测试 14/14、Prisma 业务存储 14/14、入库全套 E2E 11/11 通过。
- 新鲜门禁：API/Web 类型检查通过；生产构建通过（Web 1614 modules transformed）；在无持久卷的本地 PostgreSQL 16 临时容器上应用仓库 5 个迁移后，真正串行的完整 Vitest 为 58 个文件、366/366 通过。首次全量运行因临时库 `public` schema 未迁移而只有旧主数据套件 3 项失败，迁移后该套件 3/3 及完整复跑均通过；未放宽断言或超时。`git diff --check` 在文档更新后复验。临时容器已随验证结束删除，13010、13011、55442 端口均已释放。
- 本项已由 `codex/duplicate-batch-conflict@9eadaa1` 以 `--ff-only` 合回本地 `feat/warehouse-system`；尚未 Push 或部署，未连接或修改生产数据库、生产 Secret 或企业微信配置。

### 10.20 本地核心业务 E2E 门禁收口（2026-08-25）

- 在重复批次修复合入后，以隔离端口、内存持久化和本地认证执行完整 Playwright。首轮 139 项中 138 项通过，唯一失败来自 `tests/e2e/admin/master-data.spec.ts` 仍寻找已经正式退役的单行期初库存表单；现行页面及接口均按 10.18 使用 Excel 预览/一次性导入，因此这是遗留测试与已确认产品契约不一致，不是产品回归。
- 只删除上述过期用例，没有修改产品实现。Excel 导入的行错误、冲突后保留复核信息、成功后不可变摘要、已有库存活动时禁止初始化等现行 E2E 全部保留；相关主数据与期初导入两个 spec 为 10/10，通过后完整 E2E 为 138/138。
- 完整隔离门禁覆盖管理员和财务角色边界，以及入库、审批出库、调拨、退库、盘点、月结、报表与 Excel 导出界面契约。该结果关闭本地自动化证据缺口，但不替代真实企业微信账号、审批回调和正式数据的人工/生产验收。
- 本轮没有 Push、部署、生产数据库、Secret 或企业微信配置操作；`stash@{0}`、既有未跟踪资料及其他 worktree 未改动。

### 10.21 聚焦式 P1 界面一致性修正（2026-08-25，本地）

- 在隔离工作树 `.worktrees/ui-consistency-audit`、分支 `codex/ui-consistency-audit` 上按批准范围和 TDD 完成，设计与实施计划分别为 `docs/superpowers/specs/2026-08-25-ui-consistency-audit-design.md`、`docs/superpowers/plans/2026-08-25-ui-consistency-audit.md`，实现提交为 `d6bc5bc`。本批次没有扩大到全量 CSS 设计令牌重构、历史后端英文错误清理，也保留物品维护专用宽弹窗。
- 中文与业务表述：新增统一库存状态展示映射，桌面/手机出库、调拨和退库结果不再直接显示 `PENDING_OUTBOUND`、`COMPLETED`、`PARTIALLY_ISSUED` 等内部枚举；手机出库“服务端 ID”改为“业务编号”，物品页“企业微信选项 key”改为“企业微信选项标识”。未知状态使用稳定中文兜底，不改变服务端枚举或 API 契约。
- 视觉与可访问性：期初库存失败重试按钮改用既有次要按钮样式；仅把成功提示、弹窗副标题和期初导入区标题/说明收敛到已确认字号；表单错误补充 `role="alert"`，成功反馈补充 `role="status"`。没有改变业务提交、权限、数据库或手机端导航行为。
- TDD RED 先确认状态映射模块缺失，并在隔离仓库端口上确认原页面仍显示英文枚举、旧技术字段、缺失 alert/status 语义、字号差异和无变体重试按钮；GREEN 后状态映射单元测试 13/13、Web 单元测试 60/60、受影响的 6 个 Playwright spec 40/40 通过。默认完整 Vitest 为 55 个文件通过、4 个条件跳过，354 个测试通过、25 个跳过；跳过项需要显式 `TEST_DATABASE_URL`，本轮没有连接数据库。
- API/Web 类型检查和生产构建均通过，Web 构建转换 1615 个模块；`git diff --check` 无错误。E2E 显式使用隔离 API `127.0.0.1:3413`、Web `127.0.0.1:5376`、memory persistence 和 local-auth，避免复用默认 3001 端口上的固定资产服务。
- 该功能分支完成时尚未合回 `feat/warehouse-system`；后续本地快进集成与复验见 10.22。全过程未 Push、未部署，未操作生产数据库、Secret 或企业微信配置；根工作区 `stash@{0}`、原有未跟踪计划/演示资料及其他 worktree 均未改动。服务器继续运行 `3f61393` 发布版本。

### 10.22 聚焦式 P1 界面修正本地集成（2026-08-25）

- 根工作区实际起点为 `feat/warehouse-system@70d7764`，只有既有未跟踪计划、演示和输出资料；`git merge-base --is-ancestor` 确认它是 `codex/ui-consistency-audit@2adf2c8` 的祖先后，以 `git merge --ff-only codex/ui-consistency-audit` 无冲突快进，本地集成分支更新为 `2adf2c8`。
- 合入后在根集成工作区执行默认完整 Vitest：55 个文件通过、4 个文件条件跳过，354 个测试通过、25 个跳过；受影响的 6 个 Playwright spec 在隔离 API `3413`、Web `5376`、memory/local-auth 下为 40/40。API/Web 类型检查、生产构建（Web 1615 modules transformed）和 `git diff --check 70d7764..HEAD` 均 exit 0。
- 该历史轮次只完成本地快进和验证，当时没有远端或生产变更；`stash@{0}`、原有未跟踪资料、`.worktrees/codex-opening-stock-excel-import`、`.worktrees/production-deployment` 均保持原样。当前远端与生产状态见文档顶部。

### 10.23 全局搜索与仓库范围自动化验收（2026-08-25）

- 审计确认现有 `AppShell`、`InventoryQueryPage` 和库存查询服务已经实现目标行为：全局搜索按编码、名称、批次或仓库查询，结果同时展示仓库、批次、数量与金额；点击结果会携带物品编码进入库存查询页。当前仓库范围由顶栏统一管理并传给搜索、首页指标和报表；切换范围时通过请求版本和取消控制避免旧结果覆盖。
- 现有自动化已覆盖集团全部仓库范围 `warehouseId=all`、单仓 `warehouse-2`、搜索结果跳转、切换后清除陈旧结果、筛选持久化与无效值回退。定向 Vitest 为库存查询服务/路由 2 个文件、5/5 通过；隔离 API `3421`、Web `5381`、memory/local-auth 下的 `workspace-tools` 与 `dashboard` Playwright 为 10/10 通过。
- 本项是既有能力的证据收口，没有修改产品代码或测试，也不需要另行 TDD 实现。仅更新交接状态；未 Push、未部署、未操作生产数据库、Secret 或企业微信配置，保留所有 stash、未跟踪资料和其他 worktree。

### 10.24 GitHub Actions CI 实现与合并（2026-08-31）

- 按 GitHub Issue #3，在同步基线 `feat/warehouse-system@bc9d6fd4caaa10cfb3a1562eec422c34134d56cf` 创建本地分支 `codex/github-actions-ci`。新增一个 CI workflow，提供独立的 `quality` 与 `e2e` 门禁，只触发于面向/更新 `feat/warehouse-system` 的 Pull Request、push 及手动运行；没有 `main`、部署 Job、生产 Secret 或写权限。
- 两个 Job 固定 `ubuntu-24.04`、Node `24.19.0`、pnpm `11.20.0` 和各自隔离的 `postgres:16-alpine` 服务；第三方 Action 均固定到官方发布标签对应的 40 位提交 SHA。工作流包含 pnpm store 缓存、Docker 基础镜像预拉取、Prisma 生成与迁移、完整串行 Vitest、根 typecheck/build、提交范围 `git diff --check`、完整 Chromium E2E、失败产物、并发取消、超时与只读权限。
- TDD RED 的 YAML 数据契约测试先以工作流缺失为原因 4/4 失败；GREEN 后 4/4 通过。首次完整 Vitest 因新工作树缺少 Prisma Client/工作区链接而在收集阶段失败，补充完整安装和显式 `prisma generate`；第二次发现命令中的额外 `--` 令串行参数未生效且全局 Prisma 模式污染普通测试，改为有效的 `pnpm test --no-file-parallelism --maxWorkers=1`，并用 `TEST_DATABASE_URL` 只启用数据库专用测试。
- 修正后的新鲜本地门禁：PostgreSQL 16 迁移 5/5；完整串行 Vitest 60 个文件、383/383；完整 Chromium Playwright 140/140；API/Web 根 typecheck 通过；生产 build 通过（Web 1615 modules transformed）；基线提交范围 `git diff --check` 通过。评审后复验还发现错配 preview token 测试只改 base64url 尾字符时可能保留同一解码字节，已改为篡改签名主体首字符，消除随机 201。测试使用一次性本地容器和隔离端口 API `3301`、Web `5474`，未导入正式数据。
- 本段前三条记录 CI 的本地实现阶段。后续已授权 Push 并创建 CI-only PR #13；该 PR 已合并，`6abeef7` 为合并后的旧集成基线。分支保护是否启用仍须以 GitHub 实时状态为准。
- 2026-08-31 经授权 Push 并创建 CI-only PR #13 后，首轮 `quality` 在完整 Vitest 中发现 Windows/Ubuntu ICU 对同优先级中文通知标题的 `localeCompare` 顺序不同。产品返回的通知集合与优先级均正确；测试已改为验证完整集合及 `[1,1,1,2,3]` 优先级序列，不再把环境相关的同级中文排序当作契约。该修复只调整测试，不改变产品逻辑。
- PR #13 第二轮远端 `e2e` 已 140/140 通过；`quality` 暴露旧 `bootstrap.test.ts` 依赖本机 `localhost:3001` 上已有服务，在干净 Ubuntu runner 上返回 `ECONNREFUSED`。启动契约现改为构建当前 API 并通过 Fastify `inject` 自包含验证 `/health`，同时显式关闭实例；定向 1/1、完整串行 Vitest 60 文件且 383/383 通过，消除了端口占用与外部进程造成的假阳性。

### 10.25 生产就绪收口（2026-09-01）

- 生产源码 `ae4bd80ef66445d9da0c44e0dfd2fc1b1ec5465f` 已发布为 `20260901T090016Z-ae4bd80ef664-3056372`；收口分支在其上仅增加测试稳定性与交接文档。CI-only PR #13 已合并。
- 审批 `202609010007` 手工重同步成功，审批/仓库状态为 `APPROVED/PENDING_OUTBOUND`；`ACCEPT-61AD5B0-01` 单位为“件”，审批明细 1 条，出库单和库存流水均为 0。没有执行实际出库。
- `warehouse-backup.service` 与 `warehouse-backup.timer` 已安装；服务器时区 `Asia/Shanghai`，timer 已启用且 active，每天 02:30 后随机延迟 0–10 分钟。备份 `warehouse-20260901T092006Z-3074723.sql.gz`（8306 字节）及 manifest（264 字节）均为 `root:root 600`，gzip 和 SHA-256 通过。
- 仍需即时确认的操作是企业微信审批自动回调订阅和隔离恢复演练。期初工作簿的 223 个数量、39 个缺失组合、`WH-01 + BJ0008` 单价、`WP0010` 分类、重复名称与盘点日期属于人工业务输入；生产尚未导入。实际出库与报表验收需未来单独授权。

## 11. 文档维护规则

出现以下事件时必须更新本文的“最后更新”“最近核验”和“待办优先级”：

- 合并分支或切换正式发布基线。
- 发布新的服务器镜像或执行回滚。
- 企业微信可信域名、可信 IP、回调或模板配置发生变化。
- 导入或调整生产期初库存。
- 完成用户验收、月结演练或数据库恢复演练。
- 域名、服务器、部署目录或运行方式发生变化。

更新时记录事实和验证证据；不能把“代码已实现”“已经部署”“已经联通”“已经验收”混写成同一种状态。
