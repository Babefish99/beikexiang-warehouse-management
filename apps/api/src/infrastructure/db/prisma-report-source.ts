import type { PrismaClient } from "@prisma/client";

import type { ReportEntry } from "../../application/reports/report-query-service.js";

export interface PrismaReportBalance {
  warehouseId: string;
  itemId: string;
  batchId: string;
  remainingQuantity: string;
  unitCost: string;
}

export class PrismaReportSource {
  constructor(private readonly prisma: PrismaClient) {}

  async listEntries(): Promise<ReportEntry[]> {
    const entries = await this.prisma.inventoryLedgerEntry.findMany({ orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
    return entries.map((entry) => ({
      id: entry.id,
      occurredAt: entry.occurredAt.toISOString(),
      warehouseId: entry.warehouseId,
      itemId: entry.itemId,
      batchId: entry.batchId,
      type: entry.type,
      quantity: entry.quantity.toString(),
      unitCost: entry.unitCost.toString(),
      amount: entry.amount.toFixed(2),
      referenceType: entry.referenceType,
    }));
  }

  async listBalances(): Promise<PrismaReportBalance[]> {
    const balances = await this.prisma.stockBalance.findMany({ orderBy: [{ warehouseId: "asc" }, { itemId: "asc" }, { batchId: "asc" }] });
    return balances.map((balance) => ({ warehouseId: balance.warehouseId, itemId: balance.itemId, batchId: balance.batchId, remainingQuantity: balance.remainingQuantity.toString(), unitCost: balance.unitCost.toString() }));
  }
}
