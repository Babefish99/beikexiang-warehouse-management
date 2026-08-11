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

  async recordOpeningStock(input: Parameters<InventoryEntryStore["recordOpeningStock"]>[0]): Promise<{ orderIds: string[]; batchIds: string[] }> {
    if (!input.rows.length) throw new Error("opening stock rows are required");
    const receivedAt = new Date(input.occurredAt);
    const orderIdsByWarehouse = new Map<string, string>();
    for (const row of input.rows) {
      if (!orderIdsByWarehouse.has(row.warehouseId)) {
        const suffix = orderIdsByWarehouse.size === 0 ? "" : `-${orderIdsByWarehouse.size + 1}`;
        orderIdsByWarehouse.set(row.warehouseId, `${input.referenceId}${suffix}`);
      }
    }
    const rows = input.rows.map((row) => ({
      row,
      orderId: orderIdsByWarehouse.get(row.warehouseId)!,
      batchId: crypto.randomUUID(),
      lineId: crypto.randomUUID(),
      ledgerId: crypto.randomUUID(),
      quantity: new Decimal(row.quantity),
      unitCost: new Decimal(row.unitCost),
    }));

    await runInventoryTransaction(this.prisma, async (transaction) => {
      await assertPrismaPeriodOpen(transaction, receivedAt);
      for (const [warehouseId, orderId] of orderIdsByWarehouse) {
        await transaction.inboundOrder.create({
          data: { id: orderId, warehouseId, orderNo: `OPEN-${orderId}`, source: "OPENING_STOCK", receivedAt, operatorId: input.operatorId },
        });
      }
      for (const { row, orderId, batchId, lineId, ledgerId, quantity, unitCost } of rows) {
        await transaction.procurementBatch.create({
          data: {
            id: batchId,
            warehouseId: row.warehouseId,
            itemId: row.itemId,
            batchNo: row.batchNo,
            quantity: quantity.toString(),
            remainingQuantity: quantity.toString(),
            unitCost: unitCost.toString(),
            purchasedAt: new Date(row.purchasedAt),
            productionDate: row.productionDate ? new Date(row.productionDate) : undefined,
            expiryDate: row.expiryDate ? new Date(row.expiryDate) : undefined,
            purchaser: row.purchaser,
          },
        });
        await transaction.stockBalance.create({
          data: { warehouseId: row.warehouseId, itemId: row.itemId, batchId, remainingQuantity: quantity.toString(), unitCost: unitCost.toString() },
        });
        await transaction.inboundLine.create({
          data: { id: lineId, inboundOrderId: orderId, itemId: row.itemId, batchId, quantity: quantity.toString(), unitCost: unitCost.toString(), amount: quantity.mul(unitCost).toFixed(2) },
        });
        await transaction.inventoryLedgerEntry.create({
          data: { id: ledgerId, warehouseId: row.warehouseId, itemId: row.itemId, batchId, type: "OPENING_BALANCE", quantity: quantity.toString(), unitCost: unitCost.toString(), amount: quantity.mul(unitCost).toFixed(2), referenceType: "OPENING_STOCK", referenceId: orderId, occurredAt: receivedAt },
        });
      }
    });

    return { orderIds: [...orderIdsByWarehouse.values()], batchIds: rows.map(({ batchId }) => batchId) };
  }
}
