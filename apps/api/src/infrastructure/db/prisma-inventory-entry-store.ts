import type { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";

import type { InventoryEntryStore } from "../../application/inventory/inbound-service.js";
import { assertPrismaPeriodOpen, runInventoryTransaction } from "./prisma-inventory-transaction.js";

export class PrismaInventoryEntryStore implements InventoryEntryStore {
  constructor(private readonly prisma: PrismaClient) {}

  async recordStockEntry(input: Parameters<InventoryEntryStore["recordStockEntry"]>[0]): Promise<{ orderId: string; batchId: string }> {
    const orderId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    const lineId = crypto.randomUUID();
    const ledgerId = crypto.randomUUID();
    const orderPrefix = input.referenceType === "OPENING_STOCK" ? "OPEN" : "IN";
    const source = input.referenceType === "OPENING_STOCK" ? "OPENING_STOCK" : "INBOUND";
    const receivedAt = new Date(input.occurredAt);
    const quantity = new Decimal(input.quantity);
    const unitCost = new Decimal(input.unitCost);

    await runInventoryTransaction(this.prisma, async (transaction) => {
      await assertPrismaPeriodOpen(transaction, receivedAt);
      await transaction.inboundOrder.create({
        data: {
          id: orderId,
          warehouseId: input.warehouseId,
          orderNo: `${orderPrefix}-${orderId}`,
          source,
          receivedAt,
          operatorId: input.operatorId?.trim() || "system",
          remark: input.remark,
        },
      });
      await transaction.procurementBatch.create({
        data: {
          id: batchId,
          warehouseId: input.warehouseId,
          itemId: input.itemId,
          batchNo: input.batchNo,
          quantity: quantity.toString(),
          remainingQuantity: quantity.toString(),
          unitCost: unitCost.toString(),
          purchasedAt: new Date(input.purchasedAt),
          productionDate: input.productionDate ? new Date(input.productionDate) : undefined,
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
          purchaser: input.purchaser,
        },
      });
      await transaction.stockBalance.create({
        data: {
          warehouseId: input.warehouseId,
          itemId: input.itemId,
          batchId,
          remainingQuantity: quantity.toString(),
          unitCost: unitCost.toString(),
        },
      });
      await transaction.inboundLine.create({
        data: {
          id: lineId,
          inboundOrderId: orderId,
          itemId: input.itemId,
          batchId,
          quantity: quantity.toString(),
          unitCost: unitCost.toString(),
          amount: quantity.mul(unitCost).toFixed(2),
        },
      });
      await transaction.inventoryLedgerEntry.create({
        data: {
          id: ledgerId,
          warehouseId: input.warehouseId,
          itemId: input.itemId,
          batchId,
          type: input.ledgerType,
          quantity: quantity.toString(),
          unitCost: unitCost.toString(),
          amount: quantity.mul(unitCost).toFixed(2),
          referenceType: input.referenceType,
          referenceId: orderId,
          occurredAt: receivedAt,
        },
      });
    });

    return { orderId, batchId };
  }
}
