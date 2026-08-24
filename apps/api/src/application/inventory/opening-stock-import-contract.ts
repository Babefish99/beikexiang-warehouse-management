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

export type OpeningStockImportAvailability = "AVAILABLE" | "BLOCKED_BY_ACTIVITY" | "COMPLETED";

export interface OpeningStockImportResult {
  id: "INITIAL_OPENING_STOCK";
  fileSha256: string;
  sourceFileName: string;
  baselineDate: string;
  operatorId: string;
  financeReviewer: string;
  itemCount: number;
  createdItemCount: number;
  inventoryRowCount: number;
  positiveRowCount: number;
  zeroRowCount: number;
  totalQuantity: string;
  totalAmount: string;
  importedAt: string;
}

export interface OpeningStockImportStatus {
  availability: OpeningStockImportAvailability;
  completedImport?: OpeningStockImportResult;
}

export interface OpeningStockImportCommitRow {
  sheetRow: number;
  warehouseCode: string;
  itemCode: string;
  batchNo: string;
  quantity: string;
  unitCost: string;
  amount: string;
  remark?: string;
}

export interface OpeningStockImportCommitDraft extends Omit<OpeningStockImportResult, "importedAt"> {
  items: ParsedOpeningStockItem[];
  rows: OpeningStockImportCommitRow[];
}

export interface OpeningStockImportPreviewRow {
  sheetRow: number;
  warehouseCode: string;
  itemCode: string;
  itemName: string;
  batchNo: string;
  quantity: string;
  unitCost: string;
  amount: string;
  remark?: string;
  disposition: "IMPORT" | "SKIP_ZERO" | "INVALID";
}

export interface OpeningStockMasterDataSnapshot {
  availability: OpeningStockImportAvailability;
  completedImport?: OpeningStockImportResult;
  warehouses: Array<{
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    isPlaceholder?: boolean;
  }>;
  categories: Array<{ id: string; code: string; prefix: string; name: string }>;
  items: Array<{
    id: string;
    code: string;
    name: string;
    specification?: string;
    unit: string;
    categoryId: string;
    isActive: boolean;
  }>;
  existingBatchKeys: string[];
}

export interface OpeningStockImportStore {
  getSnapshot(): Promise<OpeningStockMasterDataSnapshot>;
  commit(input: OpeningStockImportCommitDraft): Promise<OpeningStockImportResult>;
}

export interface OpeningStockImportPreview {
  baselineDate?: string;
  canCommit: boolean;
  fileSha256: string;
  previewToken?: string;
  previewExpiresAt?: string;
  summary: OpeningStockWorkbookSummary & { newItemCount: number; existingItemCount: number };
  issues: OpeningStockImportIssue[];
  rows: OpeningStockImportPreviewRow[];
}
