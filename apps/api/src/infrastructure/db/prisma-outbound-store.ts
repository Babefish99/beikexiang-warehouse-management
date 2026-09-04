import { Prisma, type PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";

import {
  OutboundAllocator,
  type AllocationValidationResult,
  type OutboundDecisionInput,
} from "../../application/inventory/outbound-allocator.js";
import type {
  OutboundOrderResult,
  OutboundStore,
  PendingApproval,
} from "../../application/inventory/outbound-service.js";
import {
  assertPrismaPeriodOpen,
  runInventoryTransaction,
  type InventoryTransactionClient,
} from "./prisma-inventory-transaction.js";

const pendingApprovalInclude = {
  lines: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.ApprovalRequestInclude;

type ApprovalWithLines = Prisma.ApprovalRequestGetPayload<{ include: typeof pendingApprovalInclude }>;

function toPendingApproval(approval: ApprovalWithLines): PendingApproval {
  return {
    id: approval.id,
    weComSpNo: approval.weComSpNo,
    status: approval.outboundStatus as PendingApproval["status"],
    lines: approval.lines.map((line) => ({
      id: line.id,
      requestedItemName: line.requestedItemName,
      requestedQuantity: line.requestedQuantity.toString(),
      unit: line.unit,
      note: line.note ?? undefined,
      itemId: line.itemId ?? undefined,
      legacyResolutionStatus: line.legacyResolutionStatus as PendingApproval["lines"][number]["legacyResolutionStatus"],
    })),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

async function lockRowsForConfirmation(
  transaction: InventoryTransactionClient,
  approvalId: string,
  selectedItemIds: string[],
  allocationReferences: Array<{ warehouseId: string; batchId: string }>,
): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ApprovalRequest"
    WHERE "id" = ${approvalId}
    FOR UPDATE
  `);
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ApprovalLine"
    WHERE "approvalRequestId" = ${approvalId}
    ORDER BY "id"
    FOR UPDATE
  `);

  if (selectedItemIds.length > 0) {
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "Item"
      WHERE "id" IN (${Prisma.join(selectedItemIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  if (allocationReferences.length === 0) return;
  const uniqueReferences = new Map<string, { warehouseId: string; batchId: string }>();
  for (const reference of allocationReferences) {
    uniqueReferences.set(`${reference.warehouseId}:${reference.batchId}`, reference);
  }
  const references = [...uniqueReferences.values()].sort((left, right) =>
    left.warehouseId.localeCompare(right.warehouseId) || left.batchId.localeCompare(right.batchId));
  const balancePredicates = references.map((reference) => Prisma.sql`
    ("warehouseId" = ${reference.warehouseId} AND "batchId" = ${reference.batchId})
  `);
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "StockBalance"
    WHERE ${Prisma.join(balancePredicates, " OR ")}
    ORDER BY "warehouseId", "batchId", "id"
    FOR UPDATE
  `);

  const batchIds = uniqueSorted(references.map((reference) => reference.batchId));
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ProcurementBatch"
    WHERE "id" IN (${Prisma.join(batchIds)})
    ORDER BY "id"
    FOR UPDATE
  `);
}

export class PrismaOutboundStore implements OutboundStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getApproval(approvalId: string): Promise<PendingApproval | undefined> {
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: pendingApprovalInclude,
    });
    return approval ? toPendingApproval(approval) : undefined;
  }

  async listPending(): Promise<PendingApproval[]> {
    const approvals = await this.prisma.approvalRequest.findMany({
      where: { outboundStatus: { in: ["PENDING_OUTBOUND", "REAPPLY_REQUIRED"] } },
      include: pendingApprovalInclude,
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    });
    return approvals.map(toPendingApproval);
  }

  async listCandidateItems() {
    const stockedItems = await this.prisma.stockBalance.groupBy({
      by: ["itemId"],
      where: { remainingQuantity: { gt: "0" } },
      _sum: { remainingQuantity: true },
    });
    const itemIds = stockedItems
      .filter((stock) => stock._sum.remainingQuantity?.gt(0))
      .map((stock) => stock.itemId);
    if (itemIds.length === 0) return [];
    return this.prisma.item.findMany({
      where: { id: { in: itemIds }, isActive: true },
      select: { id: true, code: true, name: true, unit: true, isActive: true },
      orderBy: [{ code: "asc" }, { id: "asc" }],
    });
  }

  async listBatches(itemIds: string[]) {
    const selectedItemIds = uniqueSorted(itemIds);
    if (selectedItemIds.length === 0) return [];
    const balances = await this.prisma.stockBalance.findMany({
      where: { itemId: { in: selectedItemIds }, remainingQuantity: { gt: "0" } },
      include: { batch: { select: { id: true, itemId: true, unitCost: true } } },
      orderBy: [{ warehouseId: "asc" }, { batchId: "asc" }],
    });
    return balances.map((balance) => ({
      id: balance.batch.id,
      warehouseId: balance.warehouseId,
      itemId: balance.batch.itemId,
      remainingQuantity: balance.remainingQuantity.toString(),
      unitCost: balance.batch.unitCost.toString(),
    }));
  }

  async commitOutbound(
    approval: PendingApproval,
    validation: AllocationValidationResult,
    operatorId: string,
  ): Promise<OutboundOrderResult> {
    const actorId = operatorId.trim();
    if (!actorId || actorId.toLocaleLowerCase() === "system") {
      throw new Error("outbound operator must identify an administrator");
    }
    const orderId = crypto.randomUUID();
    const occurredAt = new Date();
    const submittedDecisions: OutboundDecisionInput[] = validation.decisions.map((decision) => ({
      approvalLineId: decision.approvalLineId,
      selectedItemId: decision.selectedItemId,
      allocations: decision.allocations.map((allocation) => ({
        warehouseId: allocation.warehouseId,
        batchId: allocation.batchId,
        quantity: allocation.quantity,
      })),
      varianceReason: decision.varianceReason,
    }));
    const selectedItemIds = uniqueSorted(submittedDecisions.flatMap((decision) =>
      decision.selectedItemId ? [decision.selectedItemId] : []));
    const allocationReferences = submittedDecisions.flatMap((decision) => decision.allocations.map((allocation) => ({
      warehouseId: allocation.warehouseId,
      batchId: allocation.batchId,
    })));

    return runInventoryTransaction(this.prisma, async (transaction) => {
      await assertPrismaPeriodOpen(transaction, occurredAt);
      await lockRowsForConfirmation(transaction, approval.id, selectedItemIds, allocationReferences);

      const currentApproval = await transaction.approvalRequest.findUnique({
        where: { id: approval.id },
        include: pendingApprovalInclude,
      });
      if (!currentApproval) throw new Error(`approval not found: ${approval.id}`);
      if (currentApproval.outboundStatus !== "PENDING_OUTBOUND") throw new Error("approval is already closed");

      const [currentItems, currentBalances, currentBatches] = await Promise.all([
        selectedItemIds.length === 0
          ? Promise.resolve([])
          : transaction.item.findMany({
              where: { id: { in: selectedItemIds } },
              select: { id: true, code: true, name: true, unit: true, isActive: true },
            }),
        allocationReferences.length === 0
          ? Promise.resolve([])
          : transaction.stockBalance.findMany({
              where: { OR: allocationReferences },
              orderBy: [{ warehouseId: "asc" }, { batchId: "asc" }, { id: "asc" }],
            }),
        allocationReferences.length === 0
          ? Promise.resolve([])
          : transaction.procurementBatch.findMany({
              where: { id: { in: uniqueSorted(allocationReferences.map((reference) => reference.batchId)) } },
              orderBy: { id: "asc" },
            }),
      ]);
      const batchesById = new Map(currentBatches.map((batch) => [batch.id, batch]));
      const currentAllocationBatches = currentBalances.map((balance) => {
        const batch = batchesById.get(balance.batchId);
        if (!batch || batch.itemId !== balance.itemId) throw new Error("stock balance changed; retry transaction");
        return {
          id: batch.id,
          warehouseId: balance.warehouseId,
          itemId: batch.itemId,
          remainingQuantity: balance.remainingQuantity.toString(),
          unitCost: batch.unitCost.toString(),
        };
      });
      const freshApproval = toPendingApproval(currentApproval);
      const freshValidation = new OutboundAllocator().validate({
        lines: freshApproval.lines,
        items: currentItems,
        batches: currentAllocationBatches,
        decisions: submittedDecisions,
      });
      const status: OutboundOrderResult["status"] = freshValidation.status === "FULL"
        ? "COMPLETED"
        : freshValidation.status === "ZERO"
          ? "UNAVAILABLE"
          : "PARTIALLY_ISSUED";
      const closed = await transaction.approvalRequest.updateMany({
        where: { id: approval.id, outboundStatus: "PENDING_OUTBOUND" },
        data: { outboundStatus: status },
      });
      if (closed.count !== 1) throw new Error("approval is already closed");

      const balanceGroups = new Map<string, {
        warehouseId: string;
        itemId: string;
        batchId: string;
        expectedRemainingQuantity: string;
        quantity: Decimal;
      }>();
      const batchGroups = new Map<string, { itemId: string; quantity: Decimal }>();
      for (const allocation of freshValidation.allocations) {
        const balanceKey = `${allocation.warehouseId}:${allocation.batchId}`;
        const balanceGroup = balanceGroups.get(balanceKey) ?? {
          warehouseId: allocation.warehouseId,
          itemId: allocation.itemId,
          batchId: allocation.batchId,
          expectedRemainingQuantity: allocation.expectedRemainingQuantity,
          quantity: new Decimal(0),
        };
        if (
          balanceGroup.itemId !== allocation.itemId
          || balanceGroup.expectedRemainingQuantity !== allocation.expectedRemainingQuantity
        ) {
          throw new Error("stock balance changed; retry transaction");
        }
        balanceGroup.quantity = balanceGroup.quantity.plus(allocation.quantity);
        balanceGroups.set(balanceKey, balanceGroup);

        const batchGroup = batchGroups.get(allocation.batchId) ?? {
          itemId: allocation.itemId,
          quantity: new Decimal(0),
        };
        if (batchGroup.itemId !== allocation.itemId) throw new Error("batch item does not match selected item");
        batchGroup.quantity = batchGroup.quantity.plus(allocation.quantity);
        batchGroups.set(allocation.batchId, batchGroup);
      }

      for (const group of balanceGroups.values()) {
        const updated = await transaction.stockBalance.updateMany({
          where: {
            warehouseId: group.warehouseId,
            itemId: group.itemId,
            batchId: group.batchId,
            remainingQuantity: { equals: group.expectedRemainingQuantity, gte: group.quantity.toString() },
          },
          data: { remainingQuantity: { decrement: group.quantity.toString() } },
        });
        if (updated.count !== 1) throw new Error("stock balance changed; retry transaction");
      }
      for (const [batchId, group] of batchGroups) {
        const currentBatch = batchesById.get(batchId);
        if (!currentBatch || currentBatch.itemId !== group.itemId) {
          throw new Error("stock balance changed; retry transaction");
        }
        const updated = await transaction.procurementBatch.updateMany({
          where: {
            id: batchId,
            itemId: group.itemId,
            remainingQuantity: { equals: currentBatch.remainingQuantity, gte: group.quantity.toString() },
          },
          data: { remainingQuantity: { decrement: group.quantity.toString() } },
        });
        if (updated.count !== 1) throw new Error("stock balance changed; retry transaction");
      }

      const persistedAllocations = freshValidation.allocations.map((allocation) => ({
        ...allocation,
        amount: new Decimal(allocation.quantity).mul(allocation.unitCost).toFixed(2),
      }));
      const amount = persistedAllocations
        .reduce((total, allocation) => total.plus(allocation.amount), new Decimal(0))
        .toFixed(2);
      const decisionRows = freshValidation.decisions.map((decision) => ({
        id: crypto.randomUUID(),
        outboundOrderId: orderId,
        approvalLineId: decision.approvalLineId,
        selectedItemId: decision.selectedItemId ?? null,
        actualQuantity: decision.actualQuantity,
        varianceReason: decision.varianceReason ?? null,
        decidedBy: actorId,
        decidedAt: occurredAt,
      }));
      const decisionIdsByLine = new Map(decisionRows.map((decision) => [decision.approvalLineId, decision.id]));
      const requestedQuantitiesByLine = new Map(freshApproval.lines.map((line) => [line.id, line.requestedQuantity]));

      await transaction.outboundOrder.create({
        data: {
          id: orderId,
          approvalRequestId: approval.id,
          orderNo: `OUT-${orderId}`,
          status,
          actualQuantity: freshValidation.totalQuantity,
          amount,
          issuedAt: occurredAt,
          operatorId: actorId,
        },
      });
      if (decisionRows.length > 0) await transaction.outboundDecisionLine.createMany({ data: decisionRows });
      if (persistedAllocations.length > 0) {
        await transaction.outboundAllocation.createMany({
          data: persistedAllocations.map((allocation) => ({
            id: crypto.randomUUID(),
            outboundOrderId: orderId,
            outboundDecisionLineId: decisionIdsByLine.get(allocation.approvalLineId)!,
            warehouseId: allocation.warehouseId,
            itemId: allocation.itemId,
            batchId: allocation.batchId,
            originalQuantity: requestedQuantitiesByLine.get(allocation.approvalLineId)!,
            quantity: allocation.quantity,
            unitCost: allocation.unitCost,
            amount: allocation.amount,
          })),
        });
        await transaction.inventoryLedgerEntry.createMany({
          data: persistedAllocations.map((allocation) => ({
            id: crypto.randomUUID(),
            warehouseId: allocation.warehouseId,
            itemId: allocation.itemId,
            batchId: allocation.batchId,
            type: "OUTBOUND",
            quantity: new Decimal(allocation.quantity).negated().toString(),
            unitCost: allocation.unitCost,
            amount: allocation.amount,
            referenceType: "OUTBOUND_ORDER",
            referenceId: orderId,
            occurredAt,
          })),
        });
      }

      return {
        id: orderId,
        approvalId: approval.id,
        status,
        actualQuantity: freshValidation.totalQuantity,
        amount,
      };
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
