# SDD ledger — plan: docs/superpowers/plans/2026-08-13-mobile-responsive.md
Task 1: minor (deferred): active 测试未覆盖根路径严格匹配及 action-only“更多”永不 active（tests/unit/web/mobile-navigation.test.ts）
Task 1: fix round 1/5 (0 addressed, 1 open — useMobileViewport 本体仍无直接行为测试；修复 diff 新增 matchMedia 双实例竞态 Minor；commit 2bb435d..aaa2cae)
Task 1: fix round 2/5 (2 addressed, 0 open — 真实 hook 测试覆盖初始/change/unmount，单一 MediaQueryList；commit aaa2cae..1a4225a)
Task 1: minor (deferred): hook 单测依赖 React unstable client internals 与 package-local React 导入，升级时脆弱（tests/unit/web/mobile-navigation.test.ts）
Task 1: complete (commits 9120621..1a4225a, review clean)
Task 2: minor (deferred): workspace-tools.spec.ts 硬编码 3001，隔离工作树桌面回归被重定向到主树 5174，需在最终验证前修正测试隔离
Task 2: minor (deferred): mobile-shell.spec.ts 尚未自动化覆盖 ModalDialog focus trap、Escape、滚动锁、焦点恢复与 confirm 模式；Task 7 必须覆盖
Task 2: fix round 1/5 (1 addressed, 0 open — 移动端弹窗关闭、取消与确认控件达到 44px 触控尺寸；commit 36f7a6d..1946b50)
Task 2: complete (commits 1a4225a..1946b50, review clean)
Task 3: minor (deferred): InventoryQueryPage 在 250ms 防抖期间短暂显示空态，且缺少 request generation 守卫；最终审查前补快速改 query/切仓竞态与失败恢复测试
Task 3: minor (deferred): 财务测试访问库存页且未拦 transactions，尚未直接证明财务首页对 items/pending/transactions/notifications 的管理员请求为零
Task 3: fix round 1/5 (3 addressed, 0 open — 桌面四指标、真实待出库数量、桌面测试隔离；commits cd23dc4..89ac454)
Task 3: complete (commits 1946b50..89ac454, review clean)
Task 4: minor (deferred): 手机入库核心 E2E mock POST 且未断言完整 payload，尚未动态证明真实已认证写入路径
Task 4: minor (deferred): tests/e2e/admin/inbound.spec.ts 仍硬编码 3001 未在隔离端口运行；新 env-aware 401 测试仅等价覆盖权限语义
Task 4: fix round 1/5 (3 addressed, 1 open — 草稿 runtime shape、Decimal(18,4) 与规范 payload、弹窗内失败可见均解决；新增重复 assertive live region；commits 14ca575..49829c2)
Task 4: fix round 2/5 (1 addressed, 0 open — 确认弹窗失败时全页唯一 alert 且位于 dialog 内；commits 49829c2..96fc31a)
Task 4: complete (commits 89ac454..96fc31a, review clean)
Task 5: minor (deferred): 手机出库成功 E2E 未断言完整 confirm payload，integration 用例名含 stock changed 但实际只覆盖重复确认；最终审查前补真实路由级 stock balance changed → 409
Task 5: fix round 1/5 (3 addressed, 1 open — 恢复保留步骤、options 陈旧响应防护、pending 消失不空白与重校验零 POST；新增 stale 草稿仅单一内存态导致孤儿；commits 3af19c9..80f5c53)
Task 5: fix round 2/5 (1 addressed, 1 open — stale 草稿持久索引支持刷新与多份逐一处理；新增 pending 未加载时误判 active 草稿为 stale；commits 80f5c53..23f787c)
Task 5: minor (deferred): stale 草稿索引 lazy initializer 在 render 中幂等修剪 sessionStorage，违反 render purity；最终审查前移至 effect/显式加载接缝
Task 5: fix round 3/5 (1 addressed, 1 open — pending 加载状态门禁解决初始误判；新增 OutboundPage 并发 loadPending 旧响应覆盖新结果；commits 23f787c..2e88d88)
Task 5: fix round 4/5 (1 addressed, 0 open — OutboundPage 所有 pending 请求统一 epoch/mounted 守卫，旧成功/错误不可覆盖；commits 2e88d88..fa51d52)
Task 5: complete (commits 96fc31a..fa51d52, review clean)
Task 6: minor (deferred): notification stale-response E2E 依赖 700/800ms sleep，最终审查前改为可控 deferred handshake
Task 6: fix round 1/5 (2 addressed, 0 open — store 身份隔离/旧响应失效、桌面通知 toggle 与顶栏 popover 互斥；commits 94f15cb..a7ccdbf)
Task 6: complete (commits fa51d52..a7ccdbf, review clean)
Task 7: minor (deferred): viewport matrix mock 长规格/长批次但只断言长仓库文本；需补显式渲染与无横溢断言
Task 7: minor (deferred): 820→821 填写长采购人但未在切换后检查，报告对 purchaser 保留的表述强于证据
Task 7: fix round 1/5 (4 addressed, 2 open — 同挂载/长值、Modal属性错误聚焦、通知fulfill握手、缩高避栏与safe-area策略已解决；新增弹层链接phantom历史与重叠Modal owner覆盖；commits e7adcf5..8e05807)
Task 7: fix round 2/5 (2 addressed, 2 open — 普通内部链接phantom与owner stack重叠Back解决；新增preventDefault/router链接绕过与非顶层关闭提前恢复body/focus；commits 8e05807..e2b2a6f)
Task 7: fix round 3/5 (2 addressed, 0 open — 应用拦截链接消费sentinel无phantom、mounted owner栈统一body/focus生命周期；commits e2b2a6f..340e3f7)
Task 7: complete (commits a7ccdbf..340e3f7, review clean)
Task 8: resolved (Task 3/7 follow-up evidence — workspace-tools/inbound are env-aware for isolated 3301/5474; ModalDialog focus/Escape/scroll/focus-return and overlapping ownership covered; notification stale response uses controlled handshake; long warehouse/batch/spec and purchaser retention are asserted; commits through 340e3f7)
Task 8: fix round 1 (InventoryQueryPage loading begins during debounce and request generation rejects stale query/warehouse/error responses; finance dashboard proves zero items/pending/transactions/notifications requests; inbound E2E asserts complete payload plus authenticated memory persistence; outbound E2E asserts complete confirm payload and route-level concurrent stock change returns 409; stale outbound index pruning moved from render initializer to effect/explicit prune; root/action active tests added and React unstable/package-local hook seam replaced with useSyncExternalStore store; RED/GREEN evidence in task-8-report.md; commit 3837dfe)
Task 8: fix round 2 (legacy E2E API endpoints made env-aware across 7 specs; inbound rejection case now reaches the server under current client validation and preserves inputs; targeted 30/30 and isolated full E2E 104/104; commit 8c8f8a7)
Task 8: verification complete (non-deployment Vitest 236 passed/16 skipped; E2E 104 passed/0 skipped; Prisma generate, typecheck, build and diff-check passed; DockerDesktopVM Off blocks Docker/deployment checks; no remaining deferred Minor from Tasks 1–7)
