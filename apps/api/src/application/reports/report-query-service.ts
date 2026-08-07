import { Decimal } from "decimal.js";

export interface ReportEntry {
  id: string;
  occurredAt: string;
  warehouseId: string;
  itemId: string;
  type: string;
  quantity: string;
  unitCost: string;
  amount: string;
  referenceType: string;
}

export type TransactionReportType = "all" | "inbound" | "outbound" | "transfers" | "returns" | "adjustments";

const transactionTypeMap: Record<TransactionReportType, string[] | null> = {
  all: null,
  inbound: ["INBOUND", "OPENING_BALANCE"],
  outbound: ["OUTBOUND"],
  transfers: ["TRANSFER_IN", "TRANSFER_OUT"],
  returns: ["RETURN"],
  adjustments: ["ADJUSTMENT", "STOCKTAKE_ADJUSTMENT"],
};

function inPeriod(entry: ReportEntry, period: string): boolean {
  const start = new Date(`${period}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const occurredAt = new Date(entry.occurredAt);
  return occurredAt >= start && occurredAt < end;
}

function isOnOrBeforePeriodEnd(entry: ReportEntry, period: string): boolean {
  const endExclusive = new Date(`${period}-01T00:00:00.000Z`);
  endExclusive.setUTCMonth(endExclusive.getUTCMonth() + 1);
  return new Date(entry.occurredAt) < endExclusive;
}

export class InventoryReportService {
  constructor(private readonly listEntries: () => Promise<ReportEntry[]>) {}

  async getSummary(period: string): Promise<Array<{ itemId: string; quantity: string; amount: string }>> {
    const grouped = new Map<string, { quantity: Decimal; amount: Decimal }>();
    for (const entry of (await this.listEntries()).filter((candidate) => isOnOrBeforePeriodEnd(candidate, period))) {
      const current = grouped.get(entry.itemId) ?? { quantity: new Decimal(0), amount: new Decimal(0) };
      current.quantity = current.quantity.plus(entry.quantity);
      current.amount = current.amount.plus(new Decimal(entry.quantity).mul(entry.unitCost));
      grouped.set(entry.itemId, current);
    }
    return [...grouped.entries()]
      .map(([itemId, value]) => ({ itemId, quantity: value.quantity.toString(), amount: value.amount.toFixed(2) }))
      .sort((left, right) => left.itemId.localeCompare(right.itemId));
  }
}

export class TransactionReportService {
  constructor(private readonly listEntries: () => Promise<ReportEntry[]>) {}

  async getByType(period: string, type: TransactionReportType): Promise<ReportEntry[]> {
    const allowedTypes = transactionTypeMap[type];
    return (await this.listEntries())
      .filter((entry) => inPeriod(entry, period) && (!allowedTypes || allowedTypes.includes(entry.type)))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  }

  getInbound(period: string): Promise<ReportEntry[]> { return this.getByType(period, "inbound"); }
  getOutbound(period: string): Promise<ReportEntry[]> { return this.getByType(period, "outbound"); }
  getTransfers(period: string): Promise<ReportEntry[]> { return this.getByType(period, "transfers"); }
  getReturns(period: string): Promise<ReportEntry[]> { return this.getByType(period, "returns"); }
  getAdjustments(period: string): Promise<ReportEntry[]> { return this.getByType(period, "adjustments"); }
}
