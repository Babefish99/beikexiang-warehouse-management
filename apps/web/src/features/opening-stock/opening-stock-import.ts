export type OpeningStockIssueSeverity = "ERROR" | "WARNING";

export interface OpeningStockImportIssue {
  severity: OpeningStockIssueSeverity;
  code: string;
  sheet?: string;
  row?: number;
  field?: string;
  message: string;
}

export interface OpeningStockImportSummary {
  itemCount: number;
  newItemCount: number;
  existingItemCount: number;
  inventoryRowCount: number;
  positiveRowCount: number;
  zeroRowCount: number;
  totalQuantity: string;
  totalAmount: string;
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

export interface OpeningStockImportPreview {
  baselineDate?: string;
  canCommit: boolean;
  fileSha256: string;
  previewToken?: string;
  previewExpiresAt?: string;
  summary: OpeningStockImportSummary;
  issues: OpeningStockImportIssue[];
  rows: OpeningStockImportPreviewRow[];
}

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

export type OpeningStockImportAvailability =
  | "AVAILABLE"
  | "BLOCKED_BY_ACTIVITY"
  | "COMPLETED";

export interface OpeningStockImportStatus {
  availability: OpeningStockImportAvailability;
  completedImport?: OpeningStockImportResult;
}

export type OpeningStockIssueFilter = "ALL" | OpeningStockIssueSeverity;

export function canCommitOpeningStockImport(input: {
  preview: OpeningStockImportPreview | null;
  fileMatchesPreview: boolean;
  financeReviewer: string;
  confirmed: boolean;
  now: Date;
}): boolean {
  const { preview } = input;
  if (
    !preview?.canCommit ||
    !preview.previewToken ||
    !preview.previewExpiresAt ||
    !input.fileMatchesPreview ||
    input.financeReviewer.trim() === "" ||
    !input.confirmed
  ) {
    return false;
  }

  const expiresAt = new Date(preview.previewExpiresAt).getTime();
  return Number.isFinite(expiresAt) && input.now.getTime() < expiresAt;
}

export function filterOpeningStockIssues(
  issues: readonly OpeningStockImportIssue[],
  filter: OpeningStockIssueFilter,
): OpeningStockImportIssue[] {
  return filter === "ALL"
    ? [...issues]
    : issues.filter((issue) => issue.severity === filter);
}
