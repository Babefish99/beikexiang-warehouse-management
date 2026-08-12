# Task 7 审批模板白名单安全补丁报告

日期：2026-08-12
范围：企业微信审批详情 `template_id` 白名单、生产配置与文档。未读取、打印或提交真实 `.env`、Secret、Cookie、授权码或数据库连接串。

## 实现

- 使用单一生产变量 `WE_COM_APPROVAL_TEMPLATE_ID`。
- 企业微信审批详情载荷映射 `template_id`。
- `ApprovalSyncService.sync()` 在获取详情后、调用解析器、查找已有审批记录或保存同步记录前，严格比较详情 `template_id` 与已配置模板 ID；不一致会拒绝同步并记录失败尝试。
- 审批回调和管理员手工重同步均复用 `sync()`，因此通过同一个校验点。
- `NODE_ENV=production` 下变量为空或以 `replace-with-` 开头时启动失败；memory/test 未设置该变量时保持兼容。
- 已更新 `.env.example`、`deploy/.env.production.example` 与 README，均仅包含占位符。

## TDD 记录

1. 先增加模板不匹配、生产变量缺失/占位符和生产示例配置测试。
2. RED：聚焦测试失败，原因分别为缺少模板变量/示例配置，以及同步在调用解析器后才失败，证明尚未执行解析前拦截。
3. 最小实现后，聚焦套件 56 项通过。
4. 管理员重同步集成测试通过后，临时移除唯一 guard 进行回归验证；该测试按预期失败，恢复 guard 后重新通过。

## 验证

- 聚焦测试：56 passed。
- `corepack pnpm test`：208 passed，16 skipped（既有外部 Prisma 环境条件测试）。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过。
- `docker compose --env-file deploy/.env.production.example -f docker-compose.prod.yml config --quiet`：通过；仅使用已提交示例配置。
- `git diff --check`：通过。

## 自审

- 模板 ID 比较使用严格相等，不进行大小写、空白或部分匹配归一化。
- 不匹配详情无法被解析或持久化；手工重同步路径由集成测试覆盖。
- 生产变量缺失和占位符均由配置单元测试覆盖；非生产 memory/test 兼容性保留。
