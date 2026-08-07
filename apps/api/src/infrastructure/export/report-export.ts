import type { ReportEntry, TransactionReportType } from "../../application/reports/report-query-service.js";

export interface ReportExportInput {
  period: string;
  type: TransactionReportType;
  summary: Array<{ itemId: string; quantity: string; amount: string }>;
  transactions: ReportEntry[];
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }
  return value;
}

function formatCsvRow(values: Array<string | number>): string {
  return values.map((value) => escapeCsvCell(String(value))).join(",");
}

export function buildExcelCompatibleReport(input: ReportExportInput): Buffer {
  const lines = [
    formatCsvRow(["库存报表", `${input.period}`, input.type]),
    "",
    "库存汇总",
    formatCsvRow(["物品", "数量", "金额"]),
    ...input.summary.map((row) => formatCsvRow([row.itemId, row.quantity, row.amount])),
    "",
    "交易明细",
    formatCsvRow(["时间", "仓库", "物品", "类型", "数量", "单价", "金额", "引用类型"]),
    ...input.transactions.map((row) => formatCsvRow([row.occurredAt, row.warehouseId, row.itemId, row.type, row.quantity, row.unitCost, row.amount, row.referenceType])),
  ];

  return Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8");
}
