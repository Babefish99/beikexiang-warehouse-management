import type { PrismaClient } from "@prisma/client";

import type { ReportEntry } from "../../application/reports/report-query-service.js";
import type { StoredBatch } from "../../application/inventory/inbound-service.js";
import type { InventoryReadSource } from "./runtime.js";

export interface PrismaReportBalance {
  warehouseId: string;
  itemId: string;
  batchId: string;
  remainingQuantity: string;
  unitCost: string;
}

export class PrismaReportSource implements InventoryReadSource {
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

  async listBatches(): Promise<StoredBatch[]> {
    const batches = await this.prisma.procurementBatch.findMany({ orderBy: [{ warehouseId: "asc" }, { batchNo: "asc" }] });
    return batches.map((batch) => ({
      id: batch.id,
      warehouseId: batch.warehouseId,
      itemId: batch.itemId,
      batchNo: batch.batchNo,
      quantity: batch.quantity.toString(),
      remainingQuantity: batch.remainingQuantity.toString(),
      unitCost: batch.unitCost.toString(),
      purchasedAt: batch.purchasedAt.toISOString(),
      productionDate: batch.productionDate?.toISOString(),
      expiryDate: batch.expiryDate?.toISOString(),
      purchaser: batch.purchaser ?? undefined,
    }));
  }

  getPendingOutboundCount(): Promise<number> {
    return this.prisma.approvalRequest.count({ where: { outboundStatus: "PENDING_OUTBOUND" } });
  }

  getStocktakeCount(): Promise<number> {
    return this.prisma.stockAdjustment.count();
  }

  getAnomalyCount(): Promise<number> {
    return this.prisma.stockAdjustment.count({ where: { quantity: { not: 0 } } });
  }

  getUnpostedAdjustmentCount(): Promise<number> {
    return this.prisma.stocktake.count({ where: { status: { not: "COMPLETED" } } });
  }
}
