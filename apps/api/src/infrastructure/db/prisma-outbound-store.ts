import type { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";

import { OutboundAllocator, type AllocationValidationResult } from "../../application/inventory/outbound-allocator.js";
import type { OutboundOrderResult, OutboundStore, PendingApproval } from "../../application/inventory/outbound-service.js";
import { assertPrismaPeriodOpen, runInventoryTransaction } from "./prisma-inventory-transaction.js";

const pendingApprovalInclude = { lines: { orderBy: { createdAt: "asc" as const } } };

function toPendingApproval(approval: Awaited<ReturnType<PrismaClient["approvalRequest"]["findFirstOrThrow"]>> & { lines: Array<{ id: string; itemId: string; requestedQuantity: { toString(): string } }> }): PendingApproval {
  return {
    id: approval.id,
    weComSpNo: approval.weComSpNo,
    status: approval.outboundStatus as PendingApproval["status"],
    lines: approval.lines.map((line) => ({ id: line.id, itemId: line.itemId, requestedQuantity: line.requestedQuantity.toString() })),
  };
}

export class PrismaOutboundStore implements OutboundStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getApproval(approvalId: string): Promise<PendingApproval | undefined> {
    const approval = await this.prisma.approvalRequest.findUnique({ where: { id: approvalId }, include: pendingApprovalInclude });
    return approval ? toPendingApproval(approval) : undefined;
  }

  async listPending(): Promise<PendingApproval[]> {
    const approvals = await this.prisma.approvalRequest.findMany({
      where: { outboundStatus: "PENDING_OUTBOUND" },
      include: pendingApprovalInclude,
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    });
    return approvals.map(toPendingApproval);
  }

  async listBatches(itemIds: string[]) {
    const balances = await this.prisma.stockBalance.findMany({
      where: { itemId: { in: itemIds } },
      orderBy: [{ warehouseId: "asc" }, { batchId: "asc" }],
    });
    return balances.map((balance) => ({
      id: balance.batchId,
      warehouseId: balance.warehouseId,
      itemId: balance.itemId,
      remainingQuantity: balance.remainingQuantity.toString(),
      unitCost: balance.unitCost.toString(),
    }));
  }

  async commitOutbound(approval: PendingApproval, validation: AllocationValidationResult, reason?: string): Promise<OutboundOrderResult> {
    const orderId = crypto.randomUUID();
    const occurredAt = new Date();

    return runInventoryTransaction(this.prisma, async (transaction) => {
      await assertPrismaPeriodOpen(transaction, occurredAt);
      const currentApproval = await transaction.approvalRequest.findUnique({ where: { id: approval.id }, include: pendingApprovalInclude });
      if (!currentApproval) throw new Error(`approval not found: ${approval.id}`);
      if (currentApproval.outboundStatus !== "PENDING_OUTBOUND") throw new Error("approval is already closed");

      const currentLines = currentApproval.lines.map((line) => ({ id: line.id, itemId: line.itemId, requestedQuantity: line.requestedQuantity.toString() }));
      const currentBalances = await transaction.stockBalance.findMany({
        where: { OR: validation.allocations.map((allocation) => ({ warehouseId: allocation.warehouseId, batchId: allocation.batchId })) },
      });
      for (const allocation of validation.allocations) {
        const current = currentBalances.find((balance) => balance.warehouseId === allocation.warehouseId && balance.batchId === allocation.batchId);
        if (!current || !current.remainingQuantity.equals(allocation.expectedRemainingQuantity)) {
          throw new Error("stock balance changed; retry transaction");
        }
      }
      const freshValidation = new OutboundAllocator().validate({
        lines: currentLines,
        batches: currentBalances.map((balance) => ({
          id: balance.batchId,
          warehouseId: balance.warehouseId,
          itemId: balance.itemId,
          remainingQuantity: balance.remainingQuantity.toString(),
          unitCost: balance.unitCost.toString(),
        })),
        allocations: validation.allocations.map(({ approvalLineId, warehouseId, batchId, quantity }) => ({ approvalLineId, warehouseId, batchId, quantity })),
        reason,
      });
      const status: OutboundOrderResult["status"] = freshValidation.status === "FULL" ? "COMPLETED" : freshValidation.status === "ZERO" ? "UNAVAILABLE" : "PARTIALLY_ISSUED";
      const closed = await transaction.approvalRequest.updateMany({
        where: { id: approval.id, outboundStatus: "PENDING_OUTBOUND" },
        data: { outboundStatus: status },
      });
      if (closed.count !== 1) throw new Error("approval is already closed");

      const balanceGroups = new Map<string, { warehouseId: string; itemId: string; batchId: string; expectedRemainingQuantity: string; quantity: Decimal }>();
      const batchTotals = new Map<string, Decimal>();
      for (const allocation of freshValidation.allocations) {
        const key = `${allocation.warehouseId}:${allocation.itemId}:${allocation.batchId}`;
        const group = balanceGroups.get(key) ?? { warehouseId: allocation.warehouseId, itemId: allocation.itemId, batchId: allocation.batchId, expectedRemainingQuantity: allocation.expectedRemainingQuantity, quantity: new Decimal(0) };
        if (group.expectedRemainingQuantity !== allocation.expectedRemainingQuantity) throw new Error("stock balance changed; retry transaction");
        group.quantity = group.quantity.plus(allocation.quantity);
        balanceGroups.set(key, group);
        batchTotals.set(allocation.batchId, (batchTotals.get(allocation.batchId) ?? new Decimal(0)).plus(allocation.quantity));
      }
      for (const group of balanceGroups.values()) {
        const updatedBalance = await transaction.stockBalance.updateMany({
          where: {
            warehouseId: group.warehouseId,
            itemId: group.itemId,
            batchId: group.batchId,
            remainingQuantity: group.expectedRemainingQuantity,
          },
          data: { remainingQuantity: { decrement: group.quantity.toString() } },
        });
        if (updatedBalance.count !== 1) throw new Error("stock balance changed; retry transaction");
      }
      for (const [batchId, quantity] of batchTotals) {
        const updatedBatch = await transaction.procurementBatch.updateMany({
          where: { id: batchId, remainingQuantity: { gte: quantity.toString() } },
          data: { remainingQuantity: { decrement: quantity.toString() } },
        });
        if (updatedBatch.count !== 1) throw new Error("stock balance changed; retry transaction");
      }

      await transaction.outboundOrder.create({
        data: {
          id: orderId,
          approvalRequestId: approval.id,
          orderNo: `OUT-${orderId}`,
          status,
          actualQuantity: freshValidation.totalQuantity,
          amount: freshValidation.amount,
          reason,
          issuedAt: occurredAt,
          operatorId: "system",
          allocations: {
            create: freshValidation.allocations.map((allocation) => ({
              id: crypto.randomUUID(),
              approvalLineId: allocation.approvalLineId,
              warehouseId: allocation.warehouseId,
              itemId: allocation.itemId,
              batchId: allocation.batchId,
              originalQuantity: currentLines.find((line) => line.id === allocation.approvalLineId)!.requestedQuantity,
              quantity: allocation.quantity,
              unitCost: allocation.unitCost,
              amount: new Decimal(allocation.quantity).mul(allocation.unitCost).toFixed(2),
            })),
          },
        },
      });
      if (freshValidation.allocations.length > 0) await transaction.inventoryLedgerEntry.createMany({
        data: freshValidation.allocations.map((allocation) => ({
          id: crypto.randomUUID(),
          warehouseId: allocation.warehouseId,
          itemId: allocation.itemId,
          batchId: allocation.batchId,
          type: "OUTBOUND",
          quantity: new Decimal(allocation.quantity).negated().toString(),
          unitCost: allocation.unitCost,
          amount: new Decimal(allocation.quantity).mul(allocation.unitCost).toFixed(2),
          referenceType: "OUTBOUND_ORDER",
          referenceId: orderId,
          occurredAt,
        })),
      });
      return { id: orderId, approvalId: approval.id, status, actualQuantity: freshValidation.totalQuantity, amount: freshValidation.amount, reason };
    });
  }

  async cancelApproval(approvalId: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error("reason is required");
    await runInventoryTransaction(this.prisma, async (transaction) => {
      await assertPrismaPeriodOpen(transaction, new Date());
      const result = await transaction.approvalRequest.updateMany({
        where: { id: approvalId, outboundStatus: "PENDING_OUTBOUND" },
        data: { outboundStatus: "VOIDED", cancelReason: reason },
      });
      if (result.count !== 1) {
        const exists = await transaction.approvalRequest.count({ where: { id: approvalId } });
        if (!exists) throw new Error(`approval not found: ${approvalId}`);
        throw new Error("approval is already closed");
      }
    });
  }
}
