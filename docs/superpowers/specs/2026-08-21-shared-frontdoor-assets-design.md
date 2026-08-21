# 共享 Caddy 前门与固定资产站点隔离设计

## 1. 文档状态

- 状态：设计已确认，待规格审阅
- 日期：2026-08-21
- 范围：集团仓库管理系统的本地部署配置与部署配置测试

## 2. 背景与目标

仓库系统的 `web` 服务已经是生产服务器的 HTTPS 前门。固定资产系统以独立容器
`beikexiang-assets` 运行，并通过外部 Docker 网络接入该前门。仓库前门重建时必须
继续为固定资产域名提供路由，且不能让两个系统的域名、HTTP 路由或内部服务边界混淆。

本次目标是将共享前门的唯一配置来源收敛到仓库项目，使固定资产路由的本地配置、镜像
覆盖和回归测试能够一起审查与复现。

## 3. 已确认部署拓扑

- 仓库项目的 Compose 项目为 `warehouse-prod`；其 `web` 服务持有 80/443 并加入
  `warehouse-prod_edge`。
- 固定资产容器名称为 `beikexiang-assets`，仅暴露容器端口 `8088`，并作为外部网络
  `warehouse-prod_edge` 的成员接入前门。
- 仓库 PostgreSQL 与 API 的 `backend` 网络仍为内部网络；固定资产服务不得加入该网络，
  也不得发布宿主机 `8088` 端口。

## 4. 域名与接口隔离

| 外部域名 | 上游服务 | 允许的路由边界 |
| --- | --- | --- |
| `warehouse.beikexiang.cn` | 仓库静态 Web 与 `api:3001` | 仓库页面；`/auth/*`、`/wecom/*`、`/health`、`/admin/*` |
| `assets.beikexiang.cn` | `beikexiang-assets:8088` | 仅固定资产应用自身的页面与接口 |

相同路径名称（例如 `/auth` 或 `/health`）可以存在于两个应用中，但必须由精确的主机名
分流；不得通过公共路径前缀、通配域名或跨项目 API 代理实现复用。固定资产域名保留其
所需的相机权限策略，仓库域名保留原有更严格策略。

## 5. 本地实现

1. 在 `deploy/Caddyfile` 保留并完善 `assets.beikexiang.cn` 的独立站点块，仅反代至
   `beikexiang-assets:8088`。
2. 新增 `deploy/frontdoor-assets.override.yml`：它只覆盖 Compose 的 `web` 前门镜像，
   通过 `FRONTDOOR_IMAGE` 提供镜像并显式设置 `build: null`。该覆盖文件供既有的固定
   资产前门切换脚本使用，不启动或替换 API、migrate、PostgreSQL 等仓库服务。
3. 扩充 `tests/deployment/production-config.test.ts`，以静态部署配置测试锁定域名到上游
   的映射以及覆盖文件的最小作用范围。

固定资产项目的源码、生产配置、Secret、数据库和企业微信设置不在本次修改范围内。

## 6. 验收与验证

- 测试首先在缺少前门覆盖文件或错误路由时失败。
- 测试通过后，固定资产站点块必须只指向 `beikexiang-assets:8088`，不得指向 `api:3001`；
  仓库 API 路由仍只指向 `api:3001`。
- 覆盖文件只能包含 `web` 服务、`FRONTDOOR_IMAGE` 和 `build: null`，不得影响仓库的
  API、迁移或数据库。
- 完成实现后运行部署配置定向测试、类型检查、生产构建和 `git diff --check`。
- 如本地 Docker 可用，再进行不连接生产环境的 Compose 配置检查；Docker 不可用时明确
  记录该限制，不以本地测试替代生产验证。

## 7. 非目标与发布边界

- 不在本项 Push、部署、重启线上服务或切换前门镜像。
- 不操作生产数据库、生产 Secret、企业微信配置或固定资产业务代码。
- 生产发布须作为后续独立任务，重新核验服务器实时容器/网络状态、备份与两个域名健康
  检查后，才可执行。
