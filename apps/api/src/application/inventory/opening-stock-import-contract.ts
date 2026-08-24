export type OpeningStockIssueSeverity = "ERROR" | "WARNING";

export interface OpeningStockImportIssue {
  severity: OpeningStockIssueSeverity;
  code: string;
  sheet?: string;
  row?: number;
  field?: string;
  message: string;
}

export interface ParsedOpeningStockItem {
  sheetRow: number;
  code: string;
  name: string;
  categoryLabel: string;
  categoryPrefix: "BJ" | "HJ" | "CY" | "WP" | "";
  unit: string;
  specification?: string;
  referenceUnitCost?: string;
}

export interface ParsedOpeningStockRow {
  sheetRow: number;
  warehouseCode: string;
  itemCode: string;
  quantity?: string;
  unitCost?: string;
  remark?: string;
  batchNo?: string;
  amount?: string;
  disposition?: "IMPORT" | "SKIP_ZERO";
}

export interface OpeningStockWorkbookSummary {
  itemCount: number;
  inventoryRowCount: number;
  positiveRowCount: number;
  zeroRowCount: number;
  totalQuantity: string;
  totalAmount: string;
}

export interface ParsedOpeningStockWorkbook {
  baselineDate?: string;
  items: ParsedOpeningStockItem[];
  rows: ParsedOpeningStockRow[];
  issues: OpeningStockImportIssue[];
  summary: OpeningStockWorkbookSummary;
}

export interface OpeningStockWorkbookParser {
  parse(input: { fileName: string; buffer: Buffer }): Promise<ParsedOpeningStockWorkbook>;
}
