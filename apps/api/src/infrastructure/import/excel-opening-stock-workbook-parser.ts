import ExcelJS from "exceljs";
import { Decimal } from "decimal.js";

import { BusinessRuleError } from "../../application/errors/business-rule-error.js";
import type {
  OpeningStockImportIssue,
  OpeningStockWorkbookSummary,
  OpeningStockWorkbookParser,
  ParsedOpeningStockItem,
  ParsedOpeningStockRow,
  ParsedOpeningStockWorkbook,
} from "../../application/inventory/opening-stock-import-contract.js";
import { CANONICAL_ITEM_CATEGORIES } from "../../domain/items/item-category.js";

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

const ITEM_FIRST_ROW = 2;
const ITEM_LAST_ROW = 82;
const INVENTORY_FIRST_ROW = 2;
const INVENTORY_LAST_ROW = 244;
const ITEM_AUTHORITATIVE_COLUMNS = [1, 2, 3, 4, 5, 6] as const;
const INVENTORY_AUTHORITATIVE_COLUMNS = [1, 3, 9, 10, 12] as const;
const ITEM_CODE_PATTERN = /^(BJ|HJ|CY|WP)\d{4}$/;
const DECIMAL_INPUT_PATTERN = /^-?\d+(?:\.\d+)?$/;
const DECIMAL_18_4_MAX = new Decimal("99999999999999.9999");
const DECIMAL_18_2_MAX = new Decimal("9999999999999999.99");
const FIXED_WAREHOUSE_CODES = ["WH-01", "WH-02", "WH-03"] as const;

type CategoryPrefix = ParsedOpeningStockItem["categoryPrefix"];

interface AuthoritativeCellValue {
  value: ExcelJS.CellValue | null;
  formulaRejected: boolean;
}

function addIssue(
  issues: OpeningStockImportIssue[],
  issue: Omit<OpeningStockImportIssue, "message"> & { message?: string },
): void {
  issues.push({ ...issue, message: issue.message ?? issue.code });
}

function isFormulaValue(value: ExcelJS.CellValue | null | undefined): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    ("formula" in value || "sharedFormula" in value)
  );
}

function isNonBlankValue(value: ExcelJS.CellValue | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function plainCellText(cell: ExcelJS.Cell, value: ExcelJS.CellValue | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  return cell.text.trim();
}

function readAuthoritativeCell(
  sheet: ExcelJS.Worksheet,
  row: number,
  column: number,
  field: string,
  issues: OpeningStockImportIssue[],
): AuthoritativeCellValue {
  const value = sheet.getRow(row).getCell(column).value;
  if (isFormulaValue(value)) {
    addIssue(issues, {
      severity: "ERROR",
      code: "AUTHORITATIVE_FORMULA_NOT_ALLOWED",
      sheet: sheet.name,
      row,
      field,
      message: `${field}不能使用公式`,
    });
    return { value: null, formulaRejected: true };
  }
  return { value: value ?? null, formulaRejected: false };
}

function validateSheetContract(workbook: ExcelJS.Workbook, issues: OpeningStockImportIssue[]): void {
  const actualNames = workbook.worksheets.map((sheet) => sheet.name);
  if (
    actualNames.length !== WORKSHEET_NAMES.length ||
    actualNames.some((name, index) => name !== WORKSHEET_NAMES[index])
  ) {
    addIssue(issues, {
      severity: "ERROR",
      code: "WORKBOOK_SHEETS_INVALID",
      message: `工作表必须依次为：${WORKSHEET_NAMES.join("、")}`,
    });
  }
}

function validateHeaders(
  sheet: ExcelJS.Worksheet | undefined,
  expectedHeaders: readonly string[],
  issues: OpeningStockImportIssue[],
): void {
  if (!sheet) return;
  const headerRow = sheet.getRow(1);
  const headersMatch = expectedHeaders.every((header, index) => {
    const value = headerRow.getCell(index + 1).value;
    return !isFormulaValue(value) && plainCellText(headerRow.getCell(index + 1), value ?? null) === header;
  });
  let hasUnexpectedHeader = false;
  headerRow.eachCell({ includeEmpty: false }, (cell, column) => {
    if (column > expectedHeaders.length && isNonBlankValue(cell.value)) hasUnexpectedHeader = true;
  });
  if (!headersMatch || hasUnexpectedHeader) {
    addIssue(issues, {
      severity: "ERROR",
      code: "WORKSHEET_HEADERS_INVALID",
      sheet: sheet.name,
      row: 1,
      message: `${sheet.name}表头与固定模板不一致`,
    });
  }
}

function rowHasAuthoritativeValue(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  columns: readonly number[],
): boolean {
  const row = sheet.getRow(rowNumber);
  return columns.some((column) => isNonBlankValue(row.getCell(column).value));
}

function validateFixedBusinessRowCount(
  sheet: ExcelJS.Worksheet | undefined,
  firstRow: number,
  lastRow: number,
  authoritativeColumns: readonly number[],
  expectedCount: number,
  issueCode: string,
  issues: OpeningStockImportIssue[],
): void {
  if (!sheet) return;
  let businessRowCount = 0;
  for (let row = firstRow; row <= lastRow; row += 1) {
    if (rowHasAuthoritativeValue(sheet, row, authoritativeColumns)) businessRowCount += 1;
  }
  sheet.eachRow((row) => {
    if (row.number > lastRow && authoritativeColumns.some((column) => isNonBlankValue(row.getCell(column).value))) {
      businessRowCount += 1;
    }
  });
  if (businessRowCount !== expectedCount) {
    addIssue(issues, {
      severity: "ERROR",
      code: issueCode,
      sheet: sheet.name,
      message: `${sheet.name}必须包含 ${expectedCount} 条固定业务行`,
    });
  }
}

function normalizeBaselineDate(
  sheet: ExcelJS.Worksheet | undefined,
  issues: OpeningStockImportIssue[],
): string | undefined {
  if (!sheet) return undefined;
  const read = readAuthoritativeCell(sheet, 6, 2, "盘点基准日期", issues);
  if (read.formulaRejected) return undefined;
  const value = read.value;
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    addIssue(issues, {
      severity: "ERROR",
      code: "BASELINE_DATE_REQUIRED",
      sheet: sheet.name,
      row: 6,
      field: "盘点基准日期",
      message: "填写说明!B6 必须填写盘点基准日期",
    });
    return undefined;
  }

  let normalized: string | undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const isUtcMidnight =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;
    if (isUtcMidnight) normalized = value.toISOString().slice(0, 10);
  } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const candidate = value.trim();
    const parsed = new Date(`${candidate}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate) normalized = candidate;
  }

  if (!normalized) {
    addIssue(issues, {
      severity: "ERROR",
      code: "BASELINE_DATE_INVALID",
      sheet: sheet.name,
      row: 6,
      field: "盘点基准日期",
      message: "盘点基准日期必须是有效的 YYYY-MM-DD 日期",
    });
  }
  return normalized;
}

function deriveCategoryPrefix(code: string): CategoryPrefix {
  const prefix = code.slice(0, 2);
  return CANONICAL_ITEM_CATEGORIES.some((category) => category.prefix === prefix)
    ? (prefix as Exclude<CategoryPrefix, "">)
    : "";
}

function optionalText(text: string): string | undefined {
  return text === "" ? undefined : text;
}

function parseItems(
  sheet: ExcelJS.Worksheet | undefined,
  issues: OpeningStockImportIssue[],
): ParsedOpeningStockItem[] {
  if (!sheet) return [];
  const items: ParsedOpeningStockItem[] = [];
  const codeRows = new Map<string, number>();

  for (let row = ITEM_FIRST_ROW; row <= ITEM_LAST_ROW; row += 1) {
    const codeCell = readAuthoritativeCell(sheet, row, 1, "物料编号", issues);
    const nameCell = readAuthoritativeCell(sheet, row, 2, "物品名称", issues);
    const categoryCell = readAuthoritativeCell(sheet, row, 3, "类别", issues);
    const unitCell = readAuthoritativeCell(sheet, row, 4, "单位", issues);
    const specificationCell = readAuthoritativeCell(sheet, row, 5, "规格", issues);
    const referenceCostCell = readAuthoritativeCell(sheet, row, 6, "参考单价", issues);

    const code = plainCellText(sheet.getRow(row).getCell(1), codeCell.value).toUpperCase();
    const name = plainCellText(sheet.getRow(row).getCell(2), nameCell.value);
    const categoryLabel = plainCellText(sheet.getRow(row).getCell(3), categoryCell.value);
    const unit = plainCellText(sheet.getRow(row).getCell(4), unitCell.value);
    const specification = plainCellText(sheet.getRow(row).getCell(5), specificationCell.value);
    const referenceUnitCost = plainCellText(sheet.getRow(row).getCell(6), referenceCostCell.value);
    const categoryPrefix = deriveCategoryPrefix(code);

    if (!ITEM_CODE_PATTERN.test(code)) {
      addIssue(issues, {
        severity: "ERROR",
        code: "ITEM_CODE_INVALID",
        sheet: sheet.name,
        row,
        field: "物料编号",
        message: "物料编号必须由 BJ、HJ、CY 或 WP 加四位数字组成",
      });
    }
    if (code !== "") {
      const firstRow = codeRows.get(code);
      if (firstRow !== undefined) {
        addIssue(issues, {
          severity: "ERROR",
          code: "ITEM_CODE_DUPLICATE",
          sheet: sheet.name,
          row,
          field: "物料编号",
          message: `物料编号 ${code} 与第 ${firstRow} 行重复`,
        });
      } else {
        codeRows.set(code, row);
      }
    }
    if (name === "") {
      addIssue(issues, {
        severity: "ERROR",
        code: "ITEM_NAME_REQUIRED",
        sheet: sheet.name,
        row,
        field: "物品名称",
        message: "物品名称不能为空",
      });
    }
    if (unit === "") {
      addIssue(issues, {
        severity: "ERROR",
        code: "ITEM_UNIT_REQUIRED",
        sheet: sheet.name,
        row,
        field: "单位",
        message: "单位不能为空",
      });
    }
    const allowedLabels = categoryPrefix === "" ? undefined : ALLOWED_WORKBOOK_CATEGORY_LABELS[categoryPrefix];
    if (!allowedLabels || !(allowedLabels as readonly string[]).includes(categoryLabel)) {
      addIssue(issues, {
        severity: "ERROR",
        code: "ITEM_CATEGORY_INVALID",
        sheet: sheet.name,
        row,
        field: "类别",
        message: `类别 ${categoryLabel || "（空）"} 与物料编号不匹配`,
      });
    }
    if (referenceUnitCost === "" && !referenceCostCell.formulaRejected) {
      addIssue(issues, {
        severity: "WARNING",
        code: "REFERENCE_UNIT_COST_MISSING",
        sheet: sheet.name,
        row,
        field: "参考单价",
        message: "参考单价为空，请在期初库存表确认非零库存单价",
      });
    }

    items.push({
      sheetRow: row,
      code,
      name,
      categoryLabel,
      categoryPrefix,
      unit,
      specification: optionalText(specification),
      referenceUnitCost: optionalText(referenceUnitCost),
    });
  }

  const rowsByNormalizedName = new Map<string, ParsedOpeningStockItem[]>();
  for (const item of items) {
    const normalizedName = item.name.trim().toLocaleLowerCase();
    if (normalizedName === "") continue;
    const matchingItems = rowsByNormalizedName.get(normalizedName) ?? [];
    matchingItems.push(item);
    rowsByNormalizedName.set(normalizedName, matchingItems);
  }
  for (const matchingItems of rowsByNormalizedName.values()) {
    if (new Set(matchingItems.map((item) => item.code)).size <= 1) continue;
    for (const item of matchingItems) {
      addIssue(issues, {
        severity: "WARNING",
        code: "DUPLICATE_ITEM_NAME",
        sheet: sheet.name,
        row: item.sheetRow,
        field: "物品名称",
        message: `物品名称 ${item.name} 被多个物料编号使用`,
      });
    }
  }

  return items;
}

function parseInventoryRows(
  sheet: ExcelJS.Worksheet | undefined,
  issues: OpeningStockImportIssue[],
): ParsedOpeningStockRow[] {
  if (!sheet) return [];
  const rows: ParsedOpeningStockRow[] = [];
  for (let row = INVENTORY_FIRST_ROW; row <= INVENTORY_LAST_ROW; row += 1) {
    const warehouseCell = readAuthoritativeCell(sheet, row, 1, "仓库编码", issues);
    const itemCell = readAuthoritativeCell(sheet, row, 3, "物料编号", issues);
    const quantityCell = readAuthoritativeCell(sheet, row, 9, "实盘数量", issues);
    const unitCostCell = readAuthoritativeCell(sheet, row, 10, "确认单价", issues);
    const remarkCell = readAuthoritativeCell(sheet, row, 12, "备注", issues);

    const warehouseCode = plainCellText(sheet.getRow(row).getCell(1), warehouseCell.value).toUpperCase();
    const itemCode = plainCellText(sheet.getRow(row).getCell(3), itemCell.value).toUpperCase();
    const quantity = plainCellText(sheet.getRow(row).getCell(9), quantityCell.value);
    const unitCost = plainCellText(sheet.getRow(row).getCell(10), unitCostCell.value);
    const remark = plainCellText(sheet.getRow(row).getCell(12), remarkCell.value);

    rows.push({
      sheetRow: row,
      warehouseCode,
      itemCode,
      quantity: optionalText(quantity),
      unitCost: optionalText(unitCost),
      remark: optionalText(remark),
    });
  }
  return rows;
}

export function openingStockBatchNo(baselineDate: string, warehouseCode: string, itemCode: string): string {
  return `OPEN-${baselineDate.replaceAll("-", "")}-${warehouseCode.replaceAll("-", "")}-${itemCode}`;
}

type InventoryNumericField = "QUANTITY" | "UNIT_COST";

function parseInventoryDecimal(
  rawValue: string,
  numericField: InventoryNumericField,
  row: number,
  issues: OpeningStockImportIssue[],
): Decimal | undefined {
  const field = numericField === "QUANTITY" ? "实盘数量" : "确认单价";
  const fieldName = numericField === "QUANTITY" ? "实盘数量" : "确认单价";
  if (!DECIMAL_INPUT_PATTERN.test(rawValue)) {
    addIssue(issues, {
      severity: "ERROR",
      code: `${numericField}_FORMAT_INVALID`,
      sheet: "期初库存",
      row,
      field,
      message: `${fieldName}必须是普通十进制数字，不能使用指数记法`,
    });
    return undefined;
  }
  const fractionLength = rawValue.split(".")[1]?.length ?? 0;
  if (fractionLength > 4) {
    addIssue(issues, {
      severity: "ERROR",
      code: `${numericField}_PRECISION_INVALID`,
      sheet: "期初库存",
      row,
      field,
      message: `${fieldName}最多保留四位小数`,
    });
    return undefined;
  }

  const value = new Decimal(rawValue);
  if (value.lt(0)) {
    addIssue(issues, {
      severity: "ERROR",
      code: `${numericField}_NEGATIVE`,
      sheet: "期初库存",
      row,
      field,
      message: `${fieldName}不能为负数`,
    });
    return undefined;
  }
  if (value.gt(DECIMAL_18_4_MAX)) {
    addIssue(issues, {
      severity: "ERROR",
      code: `${numericField}_OUT_OF_RANGE`,
      sheet: "期初库存",
      row,
      field,
      message: `${fieldName}超出 Decimal(18,4) 可保存范围`,
    });
    return undefined;
  }
  return value;
}

function combinationKey(warehouseCode: string, itemCode: string): string {
  return `${warehouseCode}\u0000${itemCode}`;
}

function rowHasBlockingIssue(issues: OpeningStockImportIssue[], row: number): boolean {
  return issues.some(
    (issue) => issue.severity === "ERROR" && issue.sheet === "期初库存" && issue.row === row,
  );
}

function normalizeInventoryRows(input: {
  baselineDate?: string;
  items: ParsedOpeningStockItem[];
  rows: ParsedOpeningStockRow[];
  issues: OpeningStockImportIssue[];
}): { rows: ParsedOpeningStockRow[]; summary: OpeningStockWorkbookSummary } {
  const { baselineDate, items, rows, issues } = input;
  const knownItemCodes = new Set(items.map((item) => item.code).filter((code) => code !== ""));
  const knownWarehouseCodes = new Set<string>(FIXED_WAREHOUSE_CODES);
  const combinationCounts = new Map<string, number>();
  for (const row of rows) {
    const key = combinationKey(row.warehouseCode, row.itemCode);
    combinationCounts.set(key, (combinationCounts.get(key) ?? 0) + 1);
  }

  for (const row of rows) {
    const key = combinationKey(row.warehouseCode, row.itemCode);
    if ((combinationCounts.get(key) ?? 0) > 1) {
      addIssue(issues, {
        severity: "ERROR",
        code: "INVENTORY_COMBINATION_DUPLICATE",
        sheet: "期初库存",
        row: row.sheetRow,
        message: `仓库 ${row.warehouseCode} 与物料 ${row.itemCode} 的组合重复`,
      });
    }
  }
  for (const itemCode of knownItemCodes) {
    for (const warehouseCode of FIXED_WAREHOUSE_CODES) {
      if ((combinationCounts.get(combinationKey(warehouseCode, itemCode)) ?? 0) === 0) {
        addIssue(issues, {
          severity: "ERROR",
          code: "INVENTORY_COMBINATION_MISSING",
          sheet: "期初库存",
          message: `缺少仓库 ${warehouseCode} 与物料 ${itemCode} 的盘点组合`,
        });
      }
    }
  }

  let positiveRowCount = 0;
  let zeroRowCount = 0;
  let totalQuantity = new Decimal(0);
  let totalAmount = new Decimal(0);
  const normalizedRows: ParsedOpeningStockRow[] = [];

  for (const row of rows) {
    if (!knownWarehouseCodes.has(row.warehouseCode)) {
      addIssue(issues, {
        severity: "ERROR",
        code: "INVENTORY_WAREHOUSE_UNKNOWN",
        sheet: "期初库存",
        row: row.sheetRow,
        field: "仓库编码",
        message: `仓库编码 ${row.warehouseCode || "（空）"} 不在固定仓库清单中`,
      });
    }
    if (!knownItemCodes.has(row.itemCode)) {
      addIssue(issues, {
        severity: "ERROR",
        code: "INVENTORY_ITEM_UNKNOWN",
        sheet: "期初库存",
        row: row.sheetRow,
        field: "物料编号",
        message: `物料编号 ${row.itemCode || "（空）"} 不在物品资料中`,
      });
    }

    let quantity: Decimal | undefined;
    if (row.quantity === undefined) {
      addIssue(issues, {
        severity: "ERROR",
        code: "QUANTITY_REQUIRED",
        sheet: "期初库存",
        row: row.sheetRow,
        field: "实盘数量",
        message: "实盘数量未填写",
      });
    } else {
      quantity = parseInventoryDecimal(row.quantity, "QUANTITY", row.sheetRow, issues);
    }

    let unitCost: Decimal | undefined;
    if (quantity?.gt(0) && row.unitCost === undefined) {
      addIssue(issues, {
        severity: "ERROR",
        code: "UNIT_COST_REQUIRED",
        sheet: "期初库存",
        row: row.sheetRow,
        field: "确认单价",
        message: "正库存行必须填写确认单价",
      });
    } else if (row.unitCost !== undefined) {
      unitCost = parseInventoryDecimal(row.unitCost, "UNIT_COST", row.sheetRow, issues);
    }

    if (quantity?.gt(0) && unitCost?.eq(0) && !row.remark) {
      addIssue(issues, {
        severity: "ERROR",
        code: "ZERO_COST_REMARK_REQUIRED",
        sheet: "期初库存",
        row: row.sheetRow,
        field: "备注",
        message: "正库存的零成本行必须填写原因备注",
      });
    }

    let amount: string | undefined;
    if (quantity?.eq(0)) {
      amount = "0.00";
    } else if (quantity?.gt(0) && unitCost) {
      amount = quantity.mul(unitCost).toFixed(2);
      if (new Decimal(amount).gt(DECIMAL_18_2_MAX)) {
        addIssue(issues, {
          severity: "ERROR",
          code: "AMOUNT_OUT_OF_RANGE",
          sheet: "期初库存",
          row: row.sheetRow,
          field: "金额",
          message: "服务端重算金额超出 Decimal(18,2) 可保存范围",
        });
      }
    }

    const batchNo =
      baselineDate && row.warehouseCode !== "" && row.itemCode !== ""
        ? openingStockBatchNo(baselineDate, row.warehouseCode, row.itemCode)
        : undefined;
    let disposition: ParsedOpeningStockRow["disposition"];
    if (!rowHasBlockingIssue(issues, row.sheetRow) && baselineDate && quantity && amount !== undefined) {
      disposition = quantity.eq(0) ? "SKIP_ZERO" : "IMPORT";
    }

    const normalizedRow: ParsedOpeningStockRow = {
      ...row,
      quantity: quantity?.toString() ?? row.quantity,
      unitCost: unitCost?.toString() ?? row.unitCost,
      batchNo,
      amount,
      disposition,
    };
    normalizedRows.push(normalizedRow);

    if (disposition === "IMPORT") {
      positiveRowCount += 1;
      totalQuantity = totalQuantity.plus(quantity!);
      totalAmount = totalAmount.plus(amount!);
    } else if (disposition === "SKIP_ZERO") {
      zeroRowCount += 1;
    }
  }

  if (totalQuantity.gt(DECIMAL_18_4_MAX)) {
    addIssue(issues, {
      severity: "ERROR",
      code: "TOTAL_QUANTITY_OUT_OF_RANGE",
      sheet: "期初库存",
      message: "期初库存总数量超出 Decimal(18,4) 可保存范围",
    });
  }
  if (totalAmount.gt(DECIMAL_18_2_MAX)) {
    addIssue(issues, {
      severity: "ERROR",
      code: "TOTAL_AMOUNT_OUT_OF_RANGE",
      sheet: "期初库存",
      message: "期初库存总金额超出 Decimal(18,2) 可保存范围",
    });
  }

  return {
    rows: normalizedRows,
    summary: {
      itemCount: items.length,
      inventoryRowCount: rows.length,
      positiveRowCount,
      zeroRowCount,
      totalQuantity: totalQuantity.toString(),
      totalAmount: totalAmount.toFixed(2),
    },
  };
}

export class ExcelOpeningStockWorkbookParser implements OpeningStockWorkbookParser {
  async parse(input: { fileName: string; buffer: Buffer }): Promise<ParsedOpeningStockWorkbook> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(Uint8Array.from(input.buffer).buffer);
    } catch {
      throw new BusinessRuleError("无法解析期初库存 Excel", 400);
    }

    const issues: OpeningStockImportIssue[] = [];
    validateSheetContract(workbook, issues);
    validateHeaders(workbook.getWorksheet("仓库清单"), WORKSHEET_HEADERS.仓库清单, issues);
    validateHeaders(workbook.getWorksheet("物品资料"), WORKSHEET_HEADERS.物品资料, issues);
    validateHeaders(workbook.getWorksheet("期初库存"), WORKSHEET_HEADERS.期初库存, issues);
    validateHeaders(workbook.getWorksheet("核对汇总"), WORKSHEET_HEADERS.核对汇总, issues);

    const itemsSheet = workbook.getWorksheet("物品资料");
    const inventorySheet = workbook.getWorksheet("期初库存");
    validateFixedBusinessRowCount(
      itemsSheet,
      ITEM_FIRST_ROW,
      ITEM_LAST_ROW,
      ITEM_AUTHORITATIVE_COLUMNS,
      81,
      "ITEM_ROW_COUNT_INVALID",
      issues,
    );
    validateFixedBusinessRowCount(
      inventorySheet,
      INVENTORY_FIRST_ROW,
      INVENTORY_LAST_ROW,
      INVENTORY_AUTHORITATIVE_COLUMNS,
      243,
      "INVENTORY_ROW_COUNT_INVALID",
      issues,
    );

    const baselineDate = normalizeBaselineDate(workbook.getWorksheet("填写说明"), issues);
    const items = parseItems(itemsSheet, issues);
    const parsedRows = parseInventoryRows(inventorySheet, issues);
    const normalized = normalizeInventoryRows({ baselineDate, items, rows: parsedRows, issues });

    return {
      baselineDate,
      items,
      rows: normalized.rows,
      issues,
      summary: normalized.summary,
    };
  }
}
