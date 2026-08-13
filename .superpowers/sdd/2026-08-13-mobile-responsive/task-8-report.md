# Task 8 实现与验证报告

日期：2026-08-13 至 2026-08-14（Asia/Shanghai）
工作树：`D:\桌面\仓库\.worktrees\mobile-responsive`
分支：`codex/mobile-responsive`
比较基线：`codex/production-deployment@5f17963`
Task 8 起点：`340e3f7`

## 1. 边界与安全

- 未改动 `D:\桌面\仓库` 的 `feat/warehouse-system@270d7f8` 脏工作树。
- 未改动 production worktree，未连接生产数据库，未读取、修改或输出生产 Secret。
- 未 push、未部署；本报告不是最终独立 code review，后续评审由主任务执行。
- E2E 仅使用 memory persistence、local-auth 和隔离端口 API `3301` / Web `5474`；未终止或占用默认 `3001` / `5174` 进程。

## 2. Deferred ledger 裁决

### 已由后续任务解决，本轮记为 resolved

| 原 deferred | 裁决与证据 |
| --- | --- |
| Task 2 workspace-tools / Task 4 inbound 硬编码 3001 | Task 3/7 新接缝已 env-aware；最终审查又发现 7 个 legacy specs 仍硬编码 3001，本轮统一改为 `apiUrl` / `apiUrlPattern`，定向 30/30、全量 104/104。 |
| ModalDialog focus trap、Escape、scroll lock、focus return、confirm/stack ownership | Task 3/7 已覆盖 focus/Escape/body/focus 生命周期、重叠 owner 与链接 history 所有权；本轮不重复改实现。 |
| notification stale-response 使用 700/800ms sleep | Task 7 已改为可控 deferred handshake；本轮不重复。 |
| 长仓库/批次/规格渲染与横向溢出、820→821 purchaser 保留 | Task 7 已补显式断言；本轮不重复。 |

### 仍真实并影响最终审查：行为修复与表征性补证

以下只把实际观察到失败、随后修改实现的项目称为 RED→GREEN。对既有行为新增的断言首次运行即通过，归类为 characterization/coverage evidence，不制造失败记录。

| Deferred | 证据类型 | 结果 |
| --- | --- | --- |
| InventoryQueryPage 防抖空态与 stale query/切仓/错误恢复 | 行为修复。新 E2E 在输入后立即断言 loading，RED 为 loading count 期望 1、实际 0；随后用受控 query、warehouse 和 rejected response 验证竞态。 | 防抖期同步进入 loading；`requestGeneration` 使旧成功、旧错误和旧 finally 都不能覆盖新请求，GREEN。 |
| 财务首页管理员请求必须为零 | 表征性补证；四路请求监听在既有实现上首次即通过。 | 固定财务首页对 `/admin/items`、`/admin/outbound/pending`、`/admin/reports/transactions`、`/admin/notifications` 均为 0 request。 |
| 入库完整 payload 与真实已认证写入 | 表征性补证；exact payload 与 authenticated memory persistence 在既有实现上首次即通过。 | 固定 exact `{warehouseId,itemId,batchNo,quantity,unitCost,purchasedAt,purchaser,remark}`；Fastify route + local-auth 写入 shared memory，随后 transfer options 观察到 balance。未连接 DB。 |
| 出库完整 confirm payload 与 stock changed → 409 | 表征性补证；exact payload 与校验后并发库存变化 route 用例在既有实现上首次即通过。 | 固定完整 confirm payload；route 返回 409 和 `stock balance changed; retry transaction`，且不产生 ledger。 |
| stale outbound index 在 render lazy initializer 中写 sessionStorage | 行为修复；单测先要求 read 不修改 index，显式 prune 后才删除 stale entry。 | `readIndexedOutboundDrafts` 改为纯读；新增 `pruneOutboundDraftIndex`，由 effect 明确 load/prune，GREEN。 |
| Task 1 root/action-only active 与 React unstable/package-local seam | root/action-only 是表征性补证，首次即通过；store API 是测试接缝重构，3 个用例 RED 为 `createMobileViewportStore is not a function`。 | 导出 store，hook 使用 `useSyncExternalStore`；不再依赖 React unstable internals 或 package-local React 导入，相关 6/6 GREEN。 |

最终裁决：Tasks 1–7 ledger 中没有剩余未处理 Minor。

## 3. 额外 E2E 隔离审计

第一次隔离全 E2E：75 passed、29 failed。29 个失败全部来自 7 个 legacy specs 将 API 写死到 3001，浏览器因此被默认开发服务重定向，而不是产品功能失败。

本轮将以下 spec 改为共享 env-aware helper：

- `tests/e2e/admin/approval-sync.spec.ts`
- `tests/e2e/admin/inventory-operations.spec.ts`
- `tests/e2e/admin/master-data.spec.ts`
- `tests/e2e/admin/period-close.spec.ts`
- `tests/e2e/admin/reports.spec.ts`
- `tests/e2e/auth/roles.spec.ts`
- `tests/e2e/navigation/sidebar.spec.ts`

旧 inbound rejection 用例还存在一个测试契约问题：当前客户端要求零单价入库必须填写备注，旧用例没有备注，因此不会发 POST。用例现在填写备注、完成确认 dialog，让 mocked server 真正返回 `inbound rejected by server`，并继续断言输入保留。定向 relevant run 30/30，最终全 E2E 104/104；未发现产品实现回归。

## 4. 提交

- `3837dfe fix: close mobile verification gaps`：11 files，218 insertions、92 deletions。
- `8c8f8a7 test: isolate legacy end-to-end specs`：7 files，97 insertions、88 deletions。
- Task 8 状态、计划、ledger 和本报告：`docs: record mobile responsive verification`（本报告所在提交）。

## 5. 新鲜全量验证

本轮命令均在 `D:\桌面\仓库\.worktrees\mobile-responsive` 执行，并把 bundled Node 路径 `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` 放在 PATH 首位；`node --version` 为 `v24.19.0`。

Prisma 使用仅指向 `127.0.0.1:65432` 的 dummy `DATABASE_URL`，不连接真实数据库。

| 门禁 | 精确结果 |
| --- | --- |
| `corepack pnpm exec prisma generate` | exit 0；Prisma Client v7.9.1，251ms。 |
| `corepack pnpm exec vitest run --exclude 'tests/deployment/**'` | 48 files：45 passed、3 skipped；252 tests：236 passed、16 skipped、0 failed；exit 0；4.66s。skip 均为需要显式 DB 环境的 Prisma suites。 |
| `corepack pnpm typecheck` | API/Web 均 Done；exit 0。 |
| `corepack pnpm build` | API/Web 均 Done；Web 1612 modules transformed，2.19s；exit 0。 |
| `corepack pnpm test:e2e` | 隔离 3301/5474、memory/local-auth；104 passed、0 failed、0 skipped；31.7s；exit 0。 |
| `git diff --check 5f17963...HEAD` | 无输出，exit 0。 |
| `git status --short --branch` | 文档提交后预期并最终核对为仅 `## codex/mobile-responsive`。 |

## 6. Docker 状态

有界只读前置 `Get-VM -Name DockerDesktopVM` 返回：

```text
Name   : DockerDesktopVM
State  : Off
Status : Operating normally
```

按 Task 8 规则立即停止 Docker/deployment 验证。没有 Restart、重装、reset、Secret 变更或重试；没有继续执行 image inspect、readonly mount、deployment tests、完整含 deployment Vitest 或 Compose config。该项是环境阻塞，不记录为通过。

## 7. PROJECT_STATUS 与计划更新摘要

- 从主状态入口保留产品规则、技术结构、部署、企业微信、数据和维护规则，并在当前分支用 patch 创建。
- 明确手机范围：查询、通知、单页入库、四步出库与取消；调拨/盘点/月结/主数据电脑端。
- 明确 production `5f17963` 基线、原 `feat@270d7f8` 脏树未触、手机 design 路径。
- 记录新鲜测试精确计数、dummy DB、Docker VM Off 阻塞、未部署/待验收。
- 计划只勾选实际完成项；Docker Step 3 保持未勾选。主任务已完成 requesting-code-review 并发出本轮反馈，Step 4 已同步勾选。

## 8. 最终状态、端口和关注项

- 提交后工作树应 clean；最终命令输出另行核对。
- 隔离 E2E 结束后 3301/5474 均无 listener。
- 默认端口仍由用户/其他工作树进程监听：3001 PID 24900（0.0.0.0）、PID 18664（127.0.0.1）；5174 PID 3360。均未触碰。
- 唯一未完成环境门禁是 Docker/deployment 验证；本轮 review 反馈已处理，是否继续复审由主任务决定。

## 9. Review Fix Round 1（2026-08-14）

- 技术核验确认 `shared-memory-state.test.ts` 未绑定 driver，`buildServer()` 会继承父进程的 `PERSISTENCE_DRIVER`。RED 使用仅指向本机未监听 `127.0.0.1:65432` 的 dummy URL 和 inherited `prisma`：1 file failed、3 tests failed，日志明确为 Prisma `P1001`；没有连接真实数据库。修复只在 suite `beforeEach` 固定 `memory`，并在 `afterAll` 断言 `vi.unstubAllEnvs()` 恢复 inherited driver；同一 inherited `prisma` 环境 GREEN 为 1 file passed、3 tests passed。
- 修正本报告证据分类：财务零请求、完整 inbound payload/memory persistence、完整 outbound payload/route 409 均是首次即过的 characterization coverage，不再表述为 RED→GREEN。计划 Step 5 同步限定为“真实缺陷按 TDD，补证如实记录首次结果”。
- inventory query 的 query/error 竞态移除固定 300ms 和可选 release；与切仓段统一使用 `expect.poll(releases.has(...))` 后必选 release。该 spec 5 passed、0 failed。
- 本轮没有修改生产代码。定向 Vitest 为 4 files / 33 tests passed；其中 inherited `prisma` 的 shared-memory 单独复核为 1 file / 3 tests passed。inventory-query E2E 为 5 passed、0 failed、0 skipped；typecheck API/Web 均 Done；`git diff --check` 无输出。提交后再核对 branch status 和 `5f17963...HEAD` diff-check。
