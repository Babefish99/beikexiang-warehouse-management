import type { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";

import type { IssuedAllocation, MovementStore } from "../../application/inventory/transfer-service.js";
import { assertPrismaPeriodOpen, runInventoryTransaction } from "./prisma-inventory-transaction.js";

export class PrismaMovementStore implements MovementStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listBalances() {
    const balances = await this.prisma.stockBalance.findMany({ orderBy: [{ warehouseId: "asc" }, { batchId: "asc" }] });
    return balances.map((balance) => ({
      warehouseId: balance.warehouseId,
      itemId: balance.itemId,
      batchId: balance.batchId,
      remainingQuantity: balance.remainingQuantity.toString(),
      unitCost: balance.unitCost.toString(),
    }));
  }

  async listIssuedAllocations(): Promise<IssuedAllocation[]> {
    const allocations = await this.prisma.outboundAllocation.findMany({ orderBy: { id: "asc" } });
    return allocations.map(toIssuedAllocation);
  }

  async getAllocation(id: string): Promise<IssuedAllocation | undefined> {
    const allocation = await this.prisma.outboundAllocation.findUnique({ where: { id } });
    return allocation ? toIssuedAllocation(allocation) : undefined;
  }

  async getReturnedQuantity(allocationId: string): Promise<string> {
    const result = await this.prisma.returnLine.aggregate({ where: { outboundAllocationId: allocationId }, _sum: { quantity: true } });
    return result._sum.quantity?.toString() ?? "0";
  }

  async transfer(input: { itemId: string; batchId: string; sourceWarehouseId: string; destinationWarehouseId: string; quantity: string; reason: string }): Promise<{ transferId: string; unitCost: string }> {
    if (input.sourceWarehouseId === input.destinationWarehouseId) throw new Error("source and destination warehouses must differ");
    if (!input.reason.trim()) throw new Error("reason is required");
    const quantity = new Decimal(input.quantity);
    if (!quantity.isFinite() || !quantity.gt(0)) throw new Error("quantity must be positive");
    const transferId = crypto.randomUUID();
    const occurredAt = new Date();

    return runInventoryTransaction(this.prisma, async (transaction) => {
      await assertPrismaPeriodOpen(transaction, occurredAt);
      const source = await transaction.stockBalance.findUnique({
        where: { warehouseId_itemId_batchId: { warehouseId: input.sourceWarehouseId, itemId: input.itemId, batchId: input.batchId } },
      });
      if (!source) throw new Error("source stock balance not found");
      if (quantity.gt(source.remainingQuantity.toString())) throw new Error("batch balance cannot become negative");
      const sourceUpdated = await transaction.stockBalance.updateMany({
        where: { id: source.id, remainingQuantity: source.remainingQuantity },
        data: { remainingQuantity: { decrement: quantity.toString() } },
      });
      if (sourceUpdated.count !== 1) throw new Error("stock balance changed; retry transaction");

      const destination = await transaction.stockBalance.findUnique({
        where: { warehouseId_itemId_batchId: { warehouseId: input.destinationWarehouseId, itemId: input.itemId, batchId: input.batchId } },
      });
      if (destination) {
        if (!destination.unitCost.equals(source.unitCost)) throw new Error("transferred batch cost cannot change");
        const destinationUpdated = await transaction.stockBalance.updateMany({
          where: { id: destination.id, remainingQuantity: destination.remainingQuantity, unitCost: source.unitCost },
          data: { remainingQuantity: { increment: quantity.toString() } },
        });
        if (destinationUpdated.count !== 1) throw new Error("stock balance changed; retry transaction");
      } else {
        await transaction.stockBalance.create({
          data: {
            warehouseId: input.destinationWarehouseId,
            itemId: input.itemId,
            batchId: input.batchId,
            remainingQuantity: quantity.toString(),
            unitCost: source.unitCost,
          },
        });
      }

      const unitCost = source.unitCost.toString();
      const amount = quantity.mul(unitCost).toFixed(2);
      await transaction.transferOrder.create({
        data: {
          id: transferId,
          transferNo: `TRF-${transferId}`,
          sourceWarehouseId: input.sourceWarehouseId,
          destinationWarehouseId: input.destinationWarehouseId,
          status: "COMPLETED",
          reason: input.reason,
          operatorId: "system",
          completedAt: occurredAt,
          lines: { create: { id: crypto.randomUUID(), itemId: input.itemId, batchId: input.batchId, quantity: quantity.toString(), unitCost, amount } },
        },
      });
      await transaction.inventoryLedgerEntry.createMany({
        data: [
          { id: crypto.randomUUID(), warehouseId: input.sourceWarehouseId, itemId: input.itemId, batchId: input.batchId, type: "TRANSFER_OUT", quantity: quantity.negated().toString(), unitCost, amount, referenceType: "TRANSFER_ORDER", referenceId: transferId, occurredAt },
          { id: crypto.randomUUID(), warehouseId: input.destinationWarehouseId, itemId: input.itemId, batchId: input.batchId, type: "TRANSFER_IN", quantity: quantity.toString(), unitCost, amount, referenceType: "TRANSFER_ORDER", referenceId: transferId, occurredAt },
        ],
      });
      return { transferId, unitCost };
    });
  }

  async returnStock(input: { allocation: IssuedAllocation; quantity: string; reason: string }): Promise<{ returnId: string; unitCost: string }> {
    if (!input.reason.trim()) throw new Error("reason is required");
    const quantity = new Decimal(input.quantity);
    if (!quantity.isFinite() || !quantity.gt(0)) throw new Error("quantity must be positive");
    const returnId = crypto.randomUUID();
    const occurredAt = new Date();

    return runInventoryTransaction(this.prisma, async (transaction) => {
      await assertPrismaPeriodOpen(transaction, occurredAt);
      const allocation = await transaction.outboundAllocation.findUnique({ where: { id: input.allocation.id } });
      if (!allocation) throw new Error(`outbound allocation not found: ${input.allocation.id}`);
      const returned = await transaction.returnLine.aggregate({ where: { outboundAllocationId: allocation.id }, _sum: { quantity: true } });
      const alreadyReturned = new Decimal(returned._sum.quantity?.toString() ?? "0");
      if (alreadyReturned.plus(quantity).gt(allocation.quantity.toString())) throw new Error("return quantity exceeds original issued quantity");
      const balance = await transaction.stockBalance.findUnique({
        where: { warehouseId_itemId_batchId: { warehouseId: allocation.warehouseId, itemId: allocation.itemId, batchId: allocation.batchId } },
      });
      if (!balance) throw new Error("return stock balance not found");
      if (!balance.unitCost.equals(allocation.unitCost)) throw new Error("return stock balance cost mismatch");
      const balanceUpdated = await transaction.stockBalance.updateMany({
        where: { id: balance.id, remainingQuantity: balance.remainingQuantity },
        data: { remainingQuantity: { increment: quantity.toString() } },
      });
      if (balanceUpdated.count !== 1) throw new Error("stock balance changed; retry transaction");
      await transaction.procurementBatch.update({ where: { id: allocation.batchId }, data: { remainingQuantity: { increment: quantity.toString() } } });

      const unitCost = allocation.unitCost.toString();
      const amount = quantity.mul(unitCost).toFixed(2);
      await transaction.returnOrder.create({
        data: {
          id: returnId,
          returnNo: `RET-${returnId}`,
          originalOutboundId: allocation.outboundOrderId,
          warehouseId: allocation.warehouseId,
          reason: input.reason,
          operatorId: "system",
          returnedAt: occurredAt,
          lines: {
            create: { id: crypto.randomUUID(), outboundAllocationId: allocation.id, itemId: allocation.itemId, batchId: allocation.batchId, quantity: quantity.toString(), unitCost, amount },
          },
        },
      });
      await transaction.inventoryLedgerEntry.create({
        data: { id: crypto.randomUUID(), warehouseId: allocation.warehouseId, itemId: allocation.itemId, batchId: allocation.batchId, type: "RETURN", quantity: quantity.toString(), unitCost, amount, referenceType: "OUTBOUND_ALLOCATION", referenceId: allocation.id, occurredAt },
      });
      return { returnId, unitCost };
    });
  }
}

function toIssuedAllocation(allocation: { id: string; outboundOrderId: string; warehouseId: string; itemId: string; batchId: string; quantity: { toString(): string }; unitCost: { toString(): string } }): IssuedAllocation {
  return {
    id: allocation.id,
    outboundOrderId: allocation.outboundOrderId,
    warehouseId: allocation.warehouseId,
    itemId: allocation.itemId,
    batchId: allocation.batchId,
    issuedQuantity: allocation.quantity.toString(),
    unitCost: allocation.unitCost.toString(),
  };
}
