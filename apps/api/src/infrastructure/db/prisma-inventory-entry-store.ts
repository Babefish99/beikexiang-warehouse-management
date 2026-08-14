import type { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";

import { nextInboundBatchNo } from "../../application/inventory/batch-number.js";
import type { InventoryEntryStore } from "../../application/inventory/inbound-service.js";
import { assertPrismaPeriodOpen, RetryableInventoryTransactionError, runInventoryTransaction, type InventoryTransactionClient } from "./prisma-inventory-transaction.js";

export class PrismaInventoryEntryStore implements InventoryEntryStore {
  constructor(private readonly prisma: PrismaClient) {}

  async recordStockEntry(input: Parameters<InventoryEntryStore["recordStockEntry"]>[0]): Promise<{ orderId: string; batchId: string; batchNo: string }> {
    const orderPrefix = input.referenceType === "OPENING_STOCK" ? "OPEN" : "IN";
    const source = input.referenceType === "OPENING_STOCK" ? "OPENING_STOCK" : "INBOUND";
    const receivedAt = new Date(input.occurredAt);
    const quantity = new Decimal(input.quantity);
    const unitCost = new Decimal(input.unitCost);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const orderId = crypto.randomUUID();
      const batchId = crypto.randomUUID();
      const lineId = crypto.randomUUID();
      const ledgerId = crypto.randomUUID();
      try {
        const batchNo = await runInventoryTransaction(this.prisma, async (transaction) => {
          await assertPrismaPeriodOpen(transaction, receivedAt);
          const batchNo = input.autoGenerateBatchNo
            ? await claimInboundBatchNo(transaction, input.purchasedAt)
            : input.batchNo;
          if (!batchNo) throw new Error("batch number is required");
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
          batchNo,
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
          return batchNo;
        });
        return { orderId, batchId, batchNo };
      } catch (error) {
        if (!input.autoGenerateBatchNo || !isRetryableBatchNumberError(error) || attempt === 2) throw error;
      }
    }

    throw new Error("unreachable");
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

async function claimInboundBatchNo(transaction: InventoryTransactionClient, purchasedAt: string): Promise<string> {
  const date = new Date(purchasedAt);
  const prefix = date.toISOString().slice(0, 10).replaceAll("-", "");
  const sequence = await transaction.inboundBatchSequence.findUnique({ where: { purchasedDate: prefix } });

  if (sequence) {
    const next = await transaction.inboundBatchSequence.update({
      where: { purchasedDate: prefix },
      data: { lastSequence: { increment: 1 } },
      select: { lastSequence: true },
    });
    return `${prefix}-${String(next.lastSequence).padStart(3, "0")}`;
  }

  const existingBatchNos = await transaction.procurementBatch.findMany({
    where: { batchNo: { startsWith: `${prefix}-` } },
    select: { batchNo: true },
  });
  const batchNo = nextInboundBatchNo(purchasedAt, existingBatchNos.map((batch) => batch.batchNo));
  const lastSequence = Number(batchNo.slice(prefix.length + 1));
  await transaction.inboundBatchSequence.create({ data: { purchasedDate: prefix, lastSequence } });
  return batchNo;
}

function isRetryableBatchNumberError(error: unknown): boolean {
  return error instanceof RetryableInventoryTransactionError
    || (typeof error === "object" && error !== null && "code" in error && error.code === "P2002");
}
