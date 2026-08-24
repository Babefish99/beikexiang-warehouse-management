import ExcelJS from "exceljs";

export const WORKSHEET_NAMES = ["填写说明", "仓库清单", "物品资料", "期初库存", "核对汇总"] as const;

export const WORKSHEET_HEADERS = {
  仓库清单: ["仓库编码", "仓库名称", "状态"],
  物品资料: ["物料编号", "物品名称", "类别", "单位", "规格", "参考单价", "数据状态", "问题说明"],
  期初库存: [
    "仓库编码",
    "仓库名称",
    "物料编号",
    "物品名称",
    "类别",
    "单位",
    "规格",
    "批次号",
    "实盘数量",
    "确认单价",
    "金额",
    "备注",
    "校验状态",
    "错误说明",
  ],
  核对汇总: [
    "物料编号",
    "物品名称",
    "原综合期末库存",
    "三仓实盘合计",
    "数量差异",
    "三仓金额合计",
    "核对状态",
    "问题说明",
  ],
} as const;

export const ALLOWED_WORKBOOK_CATEGORY_LABELS = {
  BJ: ["白酒"],
  HJ: ["红酒"],
  CY: ["茶叶", "陈皮"],
  WP: ["物品", "烟"],
} as const;

export const ITEM_CODES = [
  ...Array.from({ length: 20 }, (_, index) => `BJ${String(index + 1).padStart(4, "0")}`),
  ...Array.from({ length: 20 }, (_, index) => `HJ${String(index + 1).padStart(4, "0")}`),
  ...Array.from({ length: 20 }, (_, index) => `CY${String(index + 1).padStart(4, "0")}`),
  ...Array.from({ length: 21 }, (_, index) => `WP${String(index + 1).padStart(4, "0")}`),
];

const WAREHOUSES = [
  { code: "WH-01", name: "测试仓库一" },
  { code: "WH-02", name: "测试仓库二" },
  { code: "WH-03", name: "测试仓库三" },
] as const;

function workbookCategoryLabel(code: string): string {
  const prefix = code.slice(0, 2) as keyof typeof ALLOWED_WORKBOOK_CATEGORY_LABELS;
  const labels = ALLOWED_WORKBOOK_CATEGORY_LABELS[prefix];
  if (code === "WP0010") return "物品";
  const itemNumber = Number(code.slice(2));
  return labels[(itemNumber - 1) % labels.length]!;
}

export async function buildOpeningStockWorkbook(
  mutate?: (workbook: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const instructionsSheet = workbook.addWorksheet(WORKSHEET_NAMES[0]);
  instructionsSheet.getCell("A6").value = "盘点基准日期";
  instructionsSheet.getCell("B6").value = new Date("2026-08-24T00:00:00.000Z");

  const warehousesSheet = workbook.addWorksheet(WORKSHEET_NAMES[1]);
  warehousesSheet.addRow([...WORKSHEET_HEADERS.仓库清单]);
  for (const warehouse of WAREHOUSES) {
    warehousesSheet.addRow([warehouse.code, warehouse.name, "启用"]);
  }

  const itemsSheet = workbook.addWorksheet(WORKSHEET_NAMES[2]);
  itemsSheet.addRow([...WORKSHEET_HEADERS.物品资料]);
  for (const code of ITEM_CODES) {
    itemsSheet.addRow([code, `测试物品 ${code}`, workbookCategoryLabel(code), "个", null, 10, null, null]);
  }

  const inventorySheet = workbook.addWorksheet(WORKSHEET_NAMES[3]);
  inventorySheet.addRow([...WORKSHEET_HEADERS.期初库存]);
  let inventoryIndex = 0;
  for (const code of ITEM_CODES) {
    for (const warehouse of WAREHOUSES) {
      inventorySheet.addRow([
        warehouse.code,
        warehouse.name,
        code,
        `测试物品 ${code}`,
        workbookCategoryLabel(code),
        "个",
        null,
        null,
        inventoryIndex === 0 ? 2 : 0,
        inventoryIndex === 0 ? 10 : null,
        inventoryIndex === 0 ? 20 : 0,
        inventoryIndex === 0 ? "实盘确认" : null,
        null,
        null,
      ]);
      inventoryIndex += 1;
    }
  }

  const summarySheet = workbook.addWorksheet(WORKSHEET_NAMES[4]);
  summarySheet.addRow([...WORKSHEET_HEADERS.核对汇总]);
  for (const code of ITEM_CODES) {
    summarySheet.addRow([code, `测试物品 ${code}`, 0, code === ITEM_CODES[0] ? 2 : 0, 0, code === ITEM_CODES[0] ? 20 : 0, null, null]);
  }

  mutate?.(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
