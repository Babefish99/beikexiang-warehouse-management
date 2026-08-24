import type ExcelJS from "exceljs";

import type {
  OpeningStockImportCommitDraft,
  OpeningStockImportCommitRow,
  OpeningStockWorkbookParser,
} from "../../apps/api/src/application/inventory/opening-stock-import-contract.js";
import { buildOpeningStockWorkbook } from "./opening-stock-workbook.js";

export async function openingStockCommitDraftFixture(
  parser: OpeningStockWorkbookParser,
  options: {
    fileSha256?: string;
    operatorId?: string;
    financeReviewer?: string;
    mutateWorkbook?: (workbook: ExcelJS.Workbook) => void;
  } = {},
): Promise<OpeningStockImportCommitDraft> {
  const workbook = await buildOpeningStockWorkbook(options.mutateWorkbook);
  const parsed = await parser.parse({ fileName: "期初库存.xlsx", buffer: workbook });
  if (!parsed.baselineDate || parsed.issues.some((issue) => issue.severity === "ERROR")) {
    throw new Error("invalid opening stock test fixture");
  }
  const rows: OpeningStockImportCommitRow[] = parsed.rows
    .filter((row) => row.disposition === "IMPORT")
    .map((row) => {
      if (!row.batchNo || row.quantity === undefined || row.unitCost === undefined || !row.amount) {
        throw new Error(`invalid positive test row: ${row.sheetRow}`);
      }
      return {
        sheetRow: row.sheetRow,
        warehouseCode: row.warehouseCode,
        itemCode: row.itemCode,
        batchNo: row.batchNo,
        quantity: row.quantity,
        unitCost: row.unitCost,
        amount: row.amount,
        remark: row.remark,
      };
    });
  return {
    id: "INITIAL_OPENING_STOCK",
    fileSha256: options.fileSha256 ?? "a".repeat(64),
    sourceFileName: "期初库存.xlsx",
    baselineDate: parsed.baselineDate,
    operatorId: options.operatorId ?? "admin-1",
    financeReviewer: options.financeReviewer ?? "财务甲",
    itemCount: parsed.summary.itemCount,
    createdItemCount: parsed.summary.itemCount,
    inventoryRowCount: parsed.summary.inventoryRowCount,
    positiveRowCount: parsed.summary.positiveRowCount,
    zeroRowCount: parsed.summary.zeroRowCount,
    totalQuantity: parsed.summary.totalQuantity,
    totalAmount: parsed.summary.totalAmount,
    items: parsed.items,
    rows,
  };
}
