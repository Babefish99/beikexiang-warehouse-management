# 集团仓库期初数据导入模板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 `D:\桌面\酒水2026年7月.xlsx` 的“基础资料”和“汇总”生成一份可采集、校验和复核三仓期初库存的五表 Excel 模板。

**Architecture:** 使用 `@oai/artifact-tool` 只读导入源工作簿，将主数据和原综合期末库存规范化为内存对象，再新建独立工作簿。生成逻辑与验收逻辑分别放在临时 Node 脚本中：生成器负责五表、公式、格式和校验，验收器重新导入最终文件检查结构、行数、关键公式和错误值；最终文件保存在仓库的 `outputs/warehouse-initial-import-template/`，但不提交 Git。

**Tech Stack:** Node.js 24、JavaScript ES modules、`@oai/artifact-tool` 2.8.6+、Microsoft Excel `.xlsx`、Git/PowerShell。

## Global Constraints

- 原文件 `D:\桌面\酒水2026年7月.xlsx` 只读，不覆盖、不重命名。
- 只参考源工作簿的“基础资料”和“汇总”，不读取其他业务明细表来推导库存。
- 仓库固定映射为 `WH-01` 集团二楼仓库、`WH-02` 内区1号仓库、`WH-03` 1区车库后仓库。
- 输出工作簿只包含 `填写说明`、`仓库清单`、`物品资料`、`期初库存`、`核对汇总` 五个工作表，顺序固定。
- `物品资料` 为 81 行，`期初库存` 为 243 行，`仓库清单` 为 3 行，`核对汇总` 为 81 行。
- 空白数量表示未盘点，`0` 表示已盘点且库存为零；实盘数量不得为负。
- 黄色为人工输入，灰色为公式或引用，红色为阻塞性错误，绿色为校验通过。
- 三仓实盘合计、金额和差异由公式驱动；不得把计算结果写死。
- `CY0008` 的源综合期末库存 `-1` 只作为异常提示，不复制到任何仓库实盘数量。
- `BJ0009`、`BJ0034`、`BJ0051` 必须标记为“原汇总缺失”。
- `WP0010` 类别异常、参考单价缺失和同名不同编码信息需要保留并显式提示。
- 模板不连接、不读取或写入本地/生产数据库；不 Push、不部署、不修改生产 Secret 或企业微信配置。
- 不恢复、删除或覆盖 `stash@{0}`，不清理或提交既有未跟踪计划、`.tmp_ppt/` 或演示资料。
- 输出工作簿不提交 Git；Git 只提交本计划及完成后的两份状态文档。

---

## File Map

- Create: `C:\Users\Administrator\AppData\Local\Temp\codex-excel-analysis-20260824\verify_initial_inventory_template.mjs` — 独立验收器，重新导入输出文件并断言工作簿契约。
- Create: `C:\Users\Administrator\AppData\Local\Temp\codex-excel-analysis-20260824\build_initial_inventory_template.mjs` — 唯一生成器，读取源文件并生成、渲染、导出模板。
- Create: `D:\桌面\仓库\outputs\warehouse-initial-import-template\集团仓库期初数据导入模板.xlsx` — 最终交付文件，不加入 Git。
- Create: `D:\桌面\仓库\outputs\warehouse-initial-import-template\previews\*.png` — 五张视觉检查预览，不加入 Git。
- Modify: `D:\桌面\仓库\PROJECT_STATUS.md` — 记录模板产物、验证结果和仍待人工填写/导入事项。
- Modify: `D:\桌面\仓库\docs\项目状态与发布交接.md` — 同步简要交接，不改变线上版本事实。

### Task 1: 建立可执行的工作簿验收契约

**Files:**
- Create: `C:\Users\Administrator\AppData\Local\Temp\codex-excel-analysis-20260824\verify_initial_inventory_template.mjs`
- Test: `D:\桌面\仓库\outputs\warehouse-initial-import-template\集团仓库期初数据导入模板.xlsx`

**Interfaces:**
- Consumes: `OUTPUT_XLSX` 环境变量或默认最终输出路径。
- Produces: 退出码 `0` 和一行 JSON 验收摘要；任一契约不满足时以非零退出码失败。

- [ ] **Step 1: 写入结构、行数和公式错误验收器**

```js
import assert from "node:assert/strict";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const outputPath = process.env.OUTPUT_XLSX ??
  "D:/桌面/仓库/outputs/warehouse-initial-import-template/集团仓库期初数据导入模板.xlsx";
const expectedSheets = ["填写说明", "仓库清单", "物品资料", "期初库存", "核对汇总"];
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
const sheetInspection = await wb.inspect({ kind: "sheet", include: "name", maxChars: 4000 });
const actualSheets = sheetInspection.ndjson
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line).name)
  .filter(Boolean);
assert.deepEqual(actualSheets, expectedSheets);

const warehouses = wb.worksheets.getItem("仓库清单").getRange("A2:C4").values;
assert.deepEqual(warehouses, [
  ["WH-01", "集团二楼仓库", "启用"],
  ["WH-02", "内区1号仓库", "启用"],
  ["WH-03", "1区车库后仓库", "启用"],
]);
assert.equal(wb.worksheets.getItem("物品资料").getRange("A2:A82").values.length, 81);
assert.equal(wb.worksheets.getItem("期初库存").getRange("A2:N244").values.length, 243);
assert.equal(wb.worksheets.getItem("核对汇总").getRange("A2:H82").values.length, 81);

const formulas = await wb.inspect({ kind: "formula", maxChars: 30000, options: { maxResults: 2000 } });
assert.match(formulas.ndjson, /期初库存/);
assert.match(formulas.ndjson, /SUMIF|SUMIFS/);
const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 1000 },
  maxChars: 30000,
});
assert.equal(errors.ndjson.trim(), "");

console.log(JSON.stringify({ sheets: actualSheets.length, items: 81, stockRows: 243, result: "pass" }));
```

- [ ] **Step 2: 运行验收器并确认 RED**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  'C:\Users\Administrator\AppData\Local\Temp\codex-excel-analysis-20260824\verify_initial_inventory_template.mjs'
```

Expected: 非零退出，原因是最终 `.xlsx` 尚不存在；失败必须发生在读取输出文件阶段，而不是模块解析阶段。

### Task 2: 读取并规范化源工作簿数据

**Files:**
- Create: `C:\Users\Administrator\AppData\Local\Temp\codex-excel-analysis-20260824\build_initial_inventory_template.mjs`
- Read: `D:\桌面\酒水2026年7月.xlsx`

**Interfaces:**
- Produces: `items: Item[]`、`summaryByCode: Map<string, SummaryReference>` 和 `warehouses: Warehouse[]`。
- `Item`: `{ code: string, name: string, category: string, unit: string, specification: string, referencePrice: number | null, dataStatus: string, issue: string }`。
- `SummaryReference`: `{ endingQuantity: number | null, sourceIssue: string }`。
- `Warehouse`: `{ code: "WH-01" | "WH-02" | "WH-03", name: string, status: "启用" }`。

- [ ] **Step 1: 启动一次电子表格创建操作并建立运行目录**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  'C:\Users\Administrator\.codex\plugins\cache\openai-primary-runtime\spreadsheets\26.819.11345\skills\spreadsheets\container_tools\mark_artifact_operation_started.mjs' `
  --operation-kind create --expected-output-count 1 --output-format xlsx
```

Expected: exit `0`。本次创建过程中只运行一次该命令。

- [ ] **Step 2: 实现只读提取与数据断言**

```js
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const sourcePath = "D:/桌面/酒水2026年7月.xlsx";
const source = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const baseRows = source.worksheets.getItem("基础资料").getRange("A2:F82").values;
const summaryRows = source.worksheets.getItem("汇总").getRange("A4:L81").values;
assert.equal(baseRows.length, 81);
assert.equal(summaryRows.length, 78);

const text = (value) => value == null ? "" : String(value).trim();
const numberOrNull = (value) => value === "" || value == null || Number.isNaN(Number(value)) ? null : Number(value);
const duplicateNameCounts = new Map();
for (const row of baseRows) duplicateNameCounts.set(text(row[1]), (duplicateNameCounts.get(text(row[1])) ?? 0) + 1);

const items = baseRows.map((row) => {
  const [rawCode, rawName, rawCategory, rawUnit, rawSpecification, rawPrice] = row;
  const code = text(rawCode);
  const name = text(rawName);
  const category = text(rawCategory);
  const unit = text(rawUnit);
  const issues = [];
  if (!code || !name || !category || !unit) issues.push("必填字段缺失");
  if (code === "WP0010" || category === "个") issues.push("类别疑似列错位，请人工确认");
  if (numberOrNull(rawPrice) == null) issues.push("参考单价缺失");
  if ((duplicateNameCounts.get(name) ?? 0) > 1) issues.push("同名不同编码，请人工确认");
  return {
    code,
    name,
    category,
    unit,
    specification: text(rawSpecification),
    referencePrice: numberOrNull(rawPrice),
    dataStatus: issues.some((issue) => issue.includes("必填") || issue.includes("列错位")) ? "需确认" : "可用",
    issue: issues.join("；"),
  };
});
assert.equal(new Set(items.map((item) => item.code)).size, 81);

const summaryByCode = new Map(summaryRows.map((row) => [text(row[0]), {
  endingQuantity: numberOrNull(row[8]),
  sourceIssue: text(row[0]) === "CY0008" && numberOrNull(row[8]) < 0 ? "源综合期末库存为负数" : "",
}]));
assert.deepEqual(items.filter((item) => !summaryByCode.has(item.code)).map((item) => item.code), ["BJ0009", "BJ0034", "BJ0051"]);
assert.equal(summaryByCode.get("CY0008").endingQuantity, -1);

const warehouses = [
  { code: "WH-01", name: "集团二楼仓库", status: "启用" },
  { code: "WH-02", name: "内区1号仓库", status: "启用" },
  { code: "WH-03", name: "1区车库后仓库", status: "启用" },
];
```

- [ ] **Step 3: 运行提取阶段并确认源数据断言通过**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  'C:\Users\Administrator\AppData\Local\Temp\codex-excel-analysis-20260824\build_initial_inventory_template.mjs' --phase extract
```

Expected: 输出 `{"items":81,"summaryRows":78,"missingSummary":3,"negativeSummary":1}` 并以 exit `0` 结束。

### Task 3: 生成五表结构、输入区和公式校验

**Files:**
- Modify: `C:\Users\Administrator\AppData\Local\Temp\codex-excel-analysis-20260824\build_initial_inventory_template.mjs`
- Create: `D:\桌面\仓库\outputs\warehouse-initial-import-template\集团仓库期初数据导入模板.xlsx`

**Interfaces:**
- Consumes: Task 2 的 `items`、`summaryByCode`、`warehouses`。
- Produces: 只含五张固定工作表的 `Workbook`，其中 `期初库存!I:J`、`期初库存!L` 和 `填写说明!B5` 为人工输入区，其余核心引用/计算列受公式或预填值驱动。

- [ ] **Step 1: 新建五个工作表并批量写入固定数据**

```js
const wb = Workbook.create();
const instructions = wb.worksheets.add("填写说明");
const warehouseSheet = wb.worksheets.add("仓库清单");
const itemSheet = wb.worksheets.add("物品资料");
const stockSheet = wb.worksheets.add("期初库存");
const reconciliationSheet = wb.worksheets.add("核对汇总");

warehouseSheet.getRange("A1:C4").values = [
  ["仓库编码", "仓库名称", "状态"],
  ...warehouses.map(({ code, name, status }) => [code, name, status]),
];
itemSheet.getRange("A1:H82").values = [
  ["物料编号", "物品名称", "类别", "单位", "规格", "参考单价", "数据状态", "问题说明"],
  ...items.map((item) => [item.code, item.name, item.category, item.unit, item.specification, item.referencePrice, item.dataStatus, item.issue]),
];

const stockRows = items.flatMap((item) => warehouses.map((warehouse) => [
  warehouse.code, warehouse.name, item.code, item.name, item.category, item.unit,
  item.specification, null, null, item.referencePrice, null, null, null, null,
]));
assert.equal(stockRows.length, 243);
stockSheet.getRange("A1:N244").values = [[
  "仓库编码", "仓库名称", "物料编号", "物品名称", "类别", "单位", "规格",
  "批次号", "实盘数量", "确认单价", "金额", "备注", "校验状态", "错误说明",
], ...stockRows];
```

- [ ] **Step 2: 写入说明、基准日期输入和逐行公式**

```js
instructions.getRange("A1:F1").merge();
instructions.getRange("A1").values = [["集团仓库期初数据导入模板"]];
instructions.getRange("A3:B12").values = [
  ["填写顺序", "先填写 B5 盘点基准日期，再填写“期初库存”的黄色单元格。"],
  ["仓库范围", "WH-01 集团二楼仓库；WH-02 内区1号仓库；WH-03 1区车库后仓库。"],
  ["盘点基准日期", null],
  ["数量规则", "空白表示未盘点；0 表示已盘点且库存为零；不得填写负数。"],
  ["单价规则", "数量大于 0 时确认单价必填且不得为负；数量为 0 时可留空。"],
  ["颜色", "黄色=人工填写；灰色=公式/引用；红色=阻塞错误；绿色=通过。"],
  ["公式列", "仓库名称、物品信息、批次号、金额和校验列禁止改写。"],
  ["正式导入", "消除全部阻塞错误后，由管理员和财务共同确认；本模板本身不会写入数据库。"],
  ["系统读取", "后续导入仅读取“物品资料”和“期初库存”。"],
  ["源文件", "参考 D:\\桌面\\酒水2026年7月.xlsx 的“基础资料”和“汇总”，原文件保持不变。"],
];
instructions.getRange("B5").setNumberFormat("yyyy-mm-dd");

for (let row = 2; row <= 244; row += 1) {
  stockSheet.getRange(`H${row}`).formulas = [[`=IF('填写说明'!$B$5="","","OPEN-"&TEXT('填写说明'!$B$5,"yyyymmdd")&"-"&SUBSTITUTE(A${row},"-","")&"-"&C${row})`]];
  stockSheet.getRange(`K${row}`).formulas = [[`=IF(OR(I${row}="",J${row}=""),"",I${row}*J${row})`]];
  stockSheet.getRange(`N${row}`).formulas = [[`=IF('填写说明'!$B$5="","盘点基准日期未填写",IF(I${row}="","实盘数量未填写",IF(I${row}<0,"实盘数量不得为负",IF(AND(I${row}>0,OR(J${row}="",J${row}<0)),"正库存必须填写非负单价",IF(COUNTIFS($A$2:$A$244,A${row},$C$2:$C$244,C${row},$H$2:$H$244,H${row})>1,"仓库+物料+批次重复","")))))`]];
  stockSheet.getRange(`M${row}`).formulas = [[`=IF(N${row}="","通过","错误")`]];
}
```

- [ ] **Step 3: 写入核对公式和明确的源异常说明**

```js
reconciliationSheet.getRange("A1:H82").values = [[
  "物料编号", "物品名称", "原综合期末库存", "三仓实盘合计",
  "数量差异", "三仓金额合计", "核对状态", "问题说明",
], ...items.map((item) => {
  const ref = summaryByCode.get(item.code);
  const sourceIssue = !ref ? "原汇总缺失" : ref.sourceIssue;
  return [item.code, item.name, ref?.endingQuantity ?? null, null, null, null, null, sourceIssue];
})];

for (let row = 2; row <= 82; row += 1) {
  reconciliationSheet.getRange(`D${row}`).formulas = [[`=SUMIF('期初库存'!$C$2:$C$244,A${row},'期初库存'!$I$2:$I$244)`]];
  reconciliationSheet.getRange(`E${row}`).formulas = [[`=IF(C${row}="","",D${row}-C${row})`]];
  reconciliationSheet.getRange(`F${row}`).formulas = [[`=SUMIF('期初库存'!$C$2:$C$244,A${row},'期初库存'!$K$2:$K$244)`]];
  reconciliationSheet.getRange(`G${row}`).formulas = [[`=IF(H${row}<>"","错误",IF(COUNTIF('期初库存'!$C$2:$C$244,A${row})<>3,"错误",IF(COUNTIFS('期初库存'!$C$2:$C$244,A${row},'期初库存'!$M$2:$M$244,"通过")<>3,"待填写",IF(E${row}=0,"通过","不一致"))))`]];
}
```

- [ ] **Step 4: 添加数据验证、表格、冻结窗格与视觉语义**

```js
const navy = "#17365D";
const orange = "#ED7D31";
const inputYellow = "#FFF2CC";
const formulaGray = "#E7E6E6";
const errorRed = "#FCE4D6";
const passGreen = "#E2F0D9";

for (const [sheet, headerRange] of [
  [warehouseSheet, "A1:C1"], [itemSheet, "A1:H1"], [stockSheet, "A1:N1"], [reconciliationSheet, "A1:H1"],
]) {
  sheet.showGridLines = false;
  sheet.getRange(headerRange).format = { fill: navy, font: { bold: true, color: "#FFFFFF" }, wrapText: true };
  sheet.freezePanes.freezeRows(1);
}
instructions.showGridLines = false;
instructions.getRange("A1:F1").format = { fill: navy, font: { bold: true, color: "#FFFFFF", size: 16 } };
instructions.getRange("B5").format.fill = inputYellow;
stockSheet.getRange("I2:J244").format.fill = inputYellow;
stockSheet.getRange("L2:L244").format.fill = inputYellow;
stockSheet.getRange("A2:H244").format.fill = formulaGray;
stockSheet.getRange("K2:N244").format.fill = formulaGray;
stockSheet.getRange("I2:I244").dataValidation = { rule: { type: "decimal", operator: "greaterThanOrEqual", formula1: 0 } };
stockSheet.getRange("J2:J244").dataValidation = { rule: { type: "decimal", operator: "greaterThanOrEqual", formula1: 0 } };
stockSheet.getRange("M2:N244").conditionalFormats.addCustom("=$M2=\"错误\"", { fill: errorRed, font: { color: "#C00000" } });
stockSheet.getRange("M2:N244").conditionalFormats.addCustom("=$M2=\"通过\"", { fill: passGreen, font: { color: "#006100" } });
reconciliationSheet.getRange("G2:H82").conditionalFormats.addCustom("=$G2=\"错误\"", { fill: errorRed, font: { color: "#C00000" } });
reconciliationSheet.getRange("G2:H82").conditionalFormats.addCustom("=$G2=\"通过\"", { fill: passGreen, font: { color: "#006100" } });
warehouseSheet.tables.add("A1:C4", true, "WarehouseListTable");
itemSheet.tables.add("A1:H82", true, "ItemMasterTable");
stockSheet.tables.add("A1:N244", true, "OpeningInventoryTable");
reconciliationSheet.tables.add("A1:H82", true, "ReconciliationTable");
```

- [ ] **Step 5: 设置列宽、数值格式并导出最终工作簿**

```js
stockSheet.getRange("I2:I244").setNumberFormat("0.00");
stockSheet.getRange("J2:K244").setNumberFormat("¥#,##0.00");
itemSheet.getRange("F2:F82").setNumberFormat("¥#,##0.00");
reconciliationSheet.getRange("C2:E82").setNumberFormat("0.00");
reconciliationSheet.getRange("F2:F82").setNumberFormat("¥#,##0.00");
for (const [sheet, widths] of [
  [warehouseSheet, [14, 22, 10]],
  [itemSheet, [14, 24, 12, 10, 24, 14, 12, 36]],
  [stockSheet, [14, 20, 14, 24, 12, 10, 22, 36, 14, 14, 16, 28, 12, 34]],
  [reconciliationSheet, [14, 24, 18, 18, 14, 18, 12, 32]],
]) widths.forEach((width, index) => sheet.getRangeByIndexes(0, index, sheet.getUsedRange().rowCount, 1).format.columnWidth = width);

const outputDir = "D:/桌面/仓库/outputs/warehouse-initial-import-template";
await fs.mkdir(outputDir, { recursive: true });
const file = await SpreadsheetFile.exportXlsx(wb);
await file.save(`${outputDir}/集团仓库期初数据导入模板.xlsx`);
```

- [ ] **Step 6: 运行生成器**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  'C:\Users\Administrator\AppData\Local\Temp\codex-excel-analysis-20260824\build_initial_inventory_template.mjs'
```

Expected: 输出包含 `outputPath`、`items: 81`、`stockRows: 243`、`sheets: 5`，并以 exit `0` 结束。

### Task 4: 执行结构、公式和视觉验收

**Files:**
- Modify: `C:\Users\Administrator\AppData\Local\Temp\codex-excel-analysis-20260824\verify_initial_inventory_template.mjs`
- Create: `D:\桌面\仓库\outputs\warehouse-initial-import-template\previews\填写说明.png`
- Create: `D:\桌面\仓库\outputs\warehouse-initial-import-template\previews\仓库清单.png`
- Create: `D:\桌面\仓库\outputs\warehouse-initial-import-template\previews\物品资料.png`
- Create: `D:\桌面\仓库\outputs\warehouse-initial-import-template\previews\期初库存.png`
- Create: `D:\桌面\仓库\outputs\warehouse-initial-import-template\previews\核对汇总.png`

**Interfaces:**
- Consumes: Task 3 生成的最终 `.xlsx`。
- Produces: 可机读验收摘要与五张 PNG；视觉检查后只修补同一个生成器并重新导出。

- [ ] **Step 1: 增加关键业务断言**

```js
const itemSheet = wb.worksheets.getItem("物品资料");
const stockSheet = wb.worksheets.getItem("期初库存");
const reconciliationSheet = wb.worksheets.getItem("核对汇总");
const itemCodes = itemSheet.getRange("A2:A82").values.flat();
assert.equal(new Set(itemCodes).size, 81);
assert.equal(stockSheet.getRange("A2:A244").values.filter(([code]) => code === "WH-01").length, 81);
assert.equal(stockSheet.getRange("A2:A244").values.filter(([code]) => code === "WH-02").length, 81);
assert.equal(stockSheet.getRange("A2:A244").values.filter(([code]) => code === "WH-03").length, 81);

const reconciliationRows = reconciliationSheet.getRange("A2:H82").values;
const byCode = new Map(reconciliationRows.map((row) => [row[0], row]));
assert.equal(byCode.get("CY0008")[2], -1);
assert.match(String(byCode.get("CY0008")[7]), /负数/);
for (const code of ["BJ0009", "BJ0034", "BJ0051"]) assert.equal(byCode.get(code)[7], "原汇总缺失");
assert.equal(stockSheet.getRange("I2:I244").values.flat().filter((value) => value != null && value !== "").length, 0);
```

- [ ] **Step 2: 运行验收器并确认 GREEN**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  'C:\Users\Administrator\AppData\Local\Temp\codex-excel-analysis-20260824\verify_initial_inventory_template.mjs'
```

Expected: `{"sheets":5,"items":81,"stockRows":243,"result":"pass"}`，无公式错误值，exit `0`。

- [ ] **Step 3: 从最终文件重新导入并渲染全部五张工作表**

```js
const previewDir = "D:/桌面/仓库/outputs/warehouse-initial-import-template/previews";
await fs.mkdir(previewDir, { recursive: true });
for (const sheetName of expectedSheets) {
  const preview = await wb.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`${previewDir}/${sheetName}.png`, new Uint8Array(await preview.arrayBuffer()));
}
```

Run: 再次运行验收器。

Expected: `previews` 目录包含五张非空 PNG。

- [ ] **Step 4: 逐张视觉检查并通过生成器修正**

Inspect:

```text
填写说明.png：标题、基准日期、颜色说明、数量/单价规则完整可读。
仓库清单.png：三个编码与名称无裁切。
物品资料.png：表头、参考单价、数据状态、问题说明可读，WP0010 提示可见。
期初库存.png：14 列表头清晰，黄色输入列与灰色公式列区分明确，冻结行和筛选存在。
核对汇总.png：原综合库存、三仓合计、差异、金额、状态和异常说明可读。
```

若有裁切、错误色不清晰或列宽不足，只修改 `build_initial_inventory_template.mjs` 中对应宽度/格式，重新生成后完整重跑 Task 4，不直接编辑最终 `.xlsx`。

### Task 5: 更新项目交接并完成 Git 门禁

**Files:**
- Modify: `D:\桌面\仓库\PROJECT_STATUS.md`
- Modify: `D:\桌面\仓库\docs\项目状态与发布交接.md`
- Do not add: `D:\桌面\仓库\outputs\warehouse-initial-import-template\集团仓库期初数据导入模板.xlsx`

**Interfaces:**
- Consumes: Task 4 的新鲜验收结果和输出路径。
- Produces: 清楚区分“本地模板已完成”与“正式库存尚未填写/导入”的交接记录。

- [ ] **Step 1: 在两份状态文档记录实际结果**

两份文档均写明：

```text
- 已创建本地五表模板，仓库编码为 WH-01/WH-02/WH-03；源 Excel 未修改。
- 结构校验为 5 张工作表、81 条物品、243 条三仓盘点行、81 条核对行。
- 已完成公式错误扫描及五表 PNG 视觉检查。
- 已知源异常被保留：CY0008 为负数、BJ0009/BJ0034/BJ0051 缺少原汇总、WP0010 类别疑似错位。
- 尚未完成：盘点基准日期、三仓实盘数量/确认单价填写、管理员与财务复核，以及系统导入功能开发和正式数据库导入。
- 本轮未 Push、未部署、未操作生产数据库、Secret 或企业微信配置；服务器版本不变。
```

- [ ] **Step 2: 运行最终文件和 Git 验证**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  'C:\Users\Administrator\AppData\Local\Temp\codex-excel-analysis-20260824\verify_initial_inventory_template.mjs'
git diff --check
git status --short --branch
git stash list
```

Expected: 验收器 exit `0`；`git diff --check` exit `0`；状态仅包含两份交接文档、本轮未跟踪 `outputs/warehouse-initial-import-template/` 和进入任务前已有的未跟踪资料；`stash@{0}` 未变。

- [ ] **Step 3: 仅提交两份交接文档**

Run:

```powershell
git add -- PROJECT_STATUS.md 'docs/项目状态与发布交接.md'
git diff --cached --check
git commit -m "docs: record initial inventory template delivery"
```

Expected: 提交只含两份状态文档；输出 `.xlsx`、预览 PNG、既有未跟踪计划和演示资料均不在提交中。

- [ ] **Step 4: 提交后复验**

Run:

```powershell
git show --stat --oneline HEAD
git status --short --branch
git stash list
```

Expected: HEAD 为交接文档提交；`outputs/warehouse-initial-import-template/` 保持未跟踪以供用户取用；既有用户资料和 `stash@{0}` 仍保留。

## Plan Self-Review

- Spec coverage: 五表、三仓映射、81/243/81 行数、输入颜色、公式列、源异常、批次规则、行级校验、三仓核对、输出路径、只读源文件和生产边界均有对应任务。
- Placeholder scan: 未使用 `TBD`、模糊错误处理或未定义的后续实现步骤；所有命令、路径、字段和断言均明确。
- Type consistency: `items`、`summaryByCode`、`warehouses` 在 Task 2 定义，Task 3 以相同属性名消费；验收器始终读取同一最终输出路径和同一五表名称。
- Risk check: 输出工作簿不纳入 Git；只提交计划和状态文档；未授权线上操作不在计划中。
