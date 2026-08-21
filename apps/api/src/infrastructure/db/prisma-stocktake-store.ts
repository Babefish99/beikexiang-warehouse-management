import type { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";

import type { StocktakeAdjustment, StocktakeBalance, StocktakeStore } from "../../application/inventory/stocktake-service.js";
import { assertPrismaPeriodOpen, runInventoryTransaction } from "./prisma-inventory-transaction.js";

export class PrismaStocktakeStore implements StocktakeStore {
  constructor(private readonly prisma: PrismaClient) {}

  async balance(warehouseId: string, batchId: string): Promise<StocktakeBalance | undefined> {
    const balance = await this.prisma.stockBalance.findFirst({ where: { warehouseId, batchId } });
    return balance ? toStocktakeBalance(balance) : undefined;
  }

  async listBalances(): Promise<StocktakeBalance[]> {
    return (await this.prisma.stockBalance.findMany({ orderBy: [{ warehouseId: "asc" }, { batchId: "asc" }] })).map(toStocktakeBalance);
  }

  async record(adjustment: StocktakeAdjustment): Promise<void> {
    const occurredAt = new Date(adjustment.occurredAt);
    const delta = new Decimal(adjustment.quantityDelta);
    await runInventoryTransaction(this.prisma, async (transaction) => {
      const period = await transaction.accountingPeriod.upsert({ where: { periodCode: adjustment.periodCode }, update: {}, create: { periodCode: adjustment.periodCode, status: "OPEN" } });
      if (period.status !== "OPEN") throw new Error(`closed period: ${adjustment.periodCode}`);
      await assertPrismaPeriodOpen(transaction, occurredAt);
      const balance = await transaction.stockBalance.findUnique({
        where: { warehouseId_itemId_batchId: { warehouseId: adjustment.warehouseId, itemId: adjustment.itemId, batchId: adjustment.batchId } },
      });
      if (!balance) throw new Error("stocktake balance not found");
      if (!balance.remainingQuantity.equals(adjustment.bookQuantity)) throw new Error("stocktake balance changed; reload options");
      const updated = await transaction.stockBalance.updateMany({
        where: { id: balance.id, remainingQuantity: adjustment.bookQuantity },
        data: { remainingQuantity: adjustment.actualQuantity },
      });
      if (updated.count !== 1) throw new Error("stocktake balance changed; reload options");
      const batchUpdated = await transaction.procurementBatch.updateMany({
        where: { id: adjustment.batchId, ...(delta.isNegative() ? { remainingQuantity: { gte: delta.abs().toString() } } : {}) },
        data: { remainingQuantity: { increment: delta.toString() } },
      });
      if (batchUpdated.count !== 1) throw new Error("stocktake balance changed; reload options");
      await transaction.stocktake.create({
        data: {
          id: adjustment.stocktakeId,
          stocktakeNo: `STK-${adjustment.stocktakeId}`,
          periodCode: adjustment.periodCode,
          status: "COMPLETED",
          operatorId: adjustment.operatorId,
          reason: adjustment.reason,
          adjustments: { create: { id: crypto.randomUUID(), periodCode: adjustment.periodCode, warehouseId: adjustment.warehouseId, itemId: adjustment.itemId, batchId: adjustment.batchId, bookQuantity: adjustment.bookQuantity, actualQuantity: adjustment.actualQuantity, quantity: delta.toString(), unitCost: adjustment.unitCost, amount: delta.abs().mul(adjustment.unitCost).toFixed(2), reason: adjustment.reason?.trim() || "no difference", operatorId: adjustment.operatorId } },
        },
      });
      await transaction.inventoryLedgerEntry.create({
        data: { id: crypto.randomUUID(), warehouseId: adjustment.warehouseId, itemId: adjustment.itemId, batchId: adjustment.batchId, type: "STOCKTAKE_ADJUSTMENT", quantity: delta.toString(), unitCost: adjustment.unitCost, amount: delta.abs().mul(adjustment.unitCost).toFixed(2), referenceType: "STOCKTAKE", referenceId: adjustment.stocktakeId, occurredAt },
      });
    });
  }
}

function toStocktakeBalance(balance: { warehouseId: string; itemId: string; batchId: string; remainingQuantity: { toString(): string }; unitCost: { toString(): string } }): StocktakeBalance {
  return { warehouseId: balance.warehouseId, itemId: balance.itemId, batchId: balance.batchId, bookQuantity: balance.remainingQuantity.toString(), unitCost: balance.unitCost.toString() };
}
