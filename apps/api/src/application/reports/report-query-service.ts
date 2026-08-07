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

function inPeriod(entry: ReportEntry, period: string): boolean {
  const start = new Date(`${period}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const occurredAt = new Date(entry.occurredAt);
  return occurredAt >= start && occurredAt < end;
}

export class InventoryReportService {
  constructor(private readonly listEntries: () => Promise<ReportEntry[]>) {}

  async getSummary(period: string): Promise<Array<{ itemId: string; quantity: string; amount: string }>> {
    const grouped = new Map<string, { quantity: Decimal; amount: Decimal }>();
    for (const entry of (await this.listEntries()).filter((candidate) => inPeriod(candidate, period))) {
      const current = grouped.get(entry.itemId) ?? { quantity: new Decimal(0), amount: new Decimal(0) };
      current.quantity = current.quantity.plus(entry.quantity);
      current.amount = current.amount.plus(new Decimal(entry.quantity).mul(entry.unitCost));
      grouped.set(entry.itemId, current);
    }
    return [...grouped.entries()].map(([itemId, value]) => ({ itemId, quantity: value.quantity.toString(), amount: value.amount.toFixed(2) }));
  }
}

export class TransactionReportService {
  constructor(private readonly listEntries: () => Promise<ReportEntry[]>) {}

  private async listByType(period: string, types: string[]): Promise<ReportEntry[]> {
    return (await this.listEntries()).filter((entry) => inPeriod(entry, period) && types.includes(entry.type));
  }

  getInbound(period: string): Promise<ReportEntry[]> { return this.listByType(period, ["INBOUND", "OPENING_BALANCE"]); }
  getOutbound(period: string): Promise<ReportEntry[]> { return this.listByType(period, ["OUTBOUND"]); }
  getTransfers(period: string): Promise<ReportEntry[]> { return this.listByType(period, ["TRANSFER_IN", "TRANSFER_OUT"]); }
  getReturns(period: string): Promise<ReportEntry[]> { return this.listByType(period, ["RETURN"]); }
  getAdjustments(period: string): Promise<ReportEntry[]> { return this.listByType(period, ["ADJUSTMENT", "STOCKTAKE_ADJUSTMENT"]); }
}
