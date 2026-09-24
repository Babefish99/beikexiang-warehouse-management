# 首页库存总览设计 QA

- 日期：2026-09-24
- 参考图：`C:\Users\Administrator\.codex\generated_images\01a0d0f0-7c69-7af0-89f9-fd6cedcec946\exec-2f417384-518c-4fc3-8f2c-c70c8f64b4f9.png`
- 实现截图：`test-results/dashboard-inventory-1280x720.png`
- 并排对比：`C:\Users\Administrator\.codex\visualizations\2026\09\24\01a0d0f0-7c69-7af0-89f9-fd6cedcec946\dashboard-design-compare.png`
- 验证视口：1280 × 720

## 核对结果

- 保留既有侧边栏、顶部栏、指标卡和品牌视觉。
- 首页采用单一“全部库存总览”面板，不展示仓库拆分。
- 表格仅显示物品、当前库存、状态和近期变动；未显示物品编码及最低库存。
- 品类筛选包含全部品类、酒水、茶叶、粉条和其他，位于搜索框左侧。
- 品类选择器复用系统仓库切换器的按钮、浮层菜单、选中态和辅助说明样式，并支持点击外部或 Esc 关闭。
- 状态页签、品类筛选、名称或规格搜索均完成浏览器交互验证。
- 1280 × 720 与 980 × 900 视口均无页面级横向溢出。

## 严重性检查

- P0：0
- P1：0
- P2：0
- P3：0

final result: passed
