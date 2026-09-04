import { Decimal } from "decimal.js";

import {
  approvalUnitsMatch,
  parsePositiveIntegerQuantity,
  type LegacyResolutionStatus,
} from "../../domain/approvals/approval-intent.js";

export interface AllocationLine {
  id: string;
  requestedQuantity: string;
  unit: string;
  itemId?: string;
  legacyResolutionStatus: LegacyResolutionStatus;
}

export interface AllocationBatch {
  id: string;
  warehouseId: string;
  itemId: string;
  remainingQuantity: string;
  unitCost: string;
}

export interface SelectableOutboundItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  isActive: boolean;
}

export interface OutboundDecisionInput {
  approvalLineId: string;
  selectedItemId?: string;
  allocations: Array<{ warehouseId: string; batchId: string; quantity: string }>;
  varianceReason?: string;
}

/** @deprecated The decision-oriented input supersedes flat allocations. */
export interface OutboundAllocationInput {
  approvalLineId: string;
  warehouseId: string;
  batchId: string;
  quantity: string;
}

export interface ValidatedAllocation extends OutboundAllocationInput {
  itemId: string;
  unitCost: string;
  expectedRemainingQuantity: string;
}

export interface ValidatedOutboundDecision {
  approvalLineId: string;
  selectedItemId?: string;
  actualQuantity: string;
  varianceReason?: string;
  allocations: ValidatedAllocation[];
}

export interface AllocationValidationResult {
  status: "FULL" | "PARTIAL" | "ZERO";
  totalQuantity: string;
  amount: string;
  decisions: ValidatedOutboundDecision[];
  allocations: ValidatedAllocation[];
}

function assertExactDecisionLineSet(lines: AllocationLine[], decisions: OutboundDecisionInput[]): void {
  const lineIds = new Set(lines.map((line) => line.id));
  const decisionIds = new Set(decisions.map((decision) => decision.approvalLineId));
  if (
    lineIds.size !== lines.length
    || decisionIds.size !== decisions.length
    || decisions.length !== lines.length
    || [...decisionIds].some((id) => !lineIds.has(id))
  ) {
    throw new Error("approval decision lines must exactly match approval lines");
  }
}

function decimalFromBatchQuantity(value: string): Decimal {
  const quantity = new Decimal(value);
  if (!quantity.isFinite() || quantity.lt(0)) throw new Error("batch remaining quantity must be non-negative");
  return quantity;
}

export class OutboundAllocator {
  validate(input: {
    lines: AllocationLine[];
    items: SelectableOutboundItem[];
    batches: AllocationBatch[];
    decisions: OutboundDecisionInput[];
  }): AllocationValidationResult {
    assertExactDecisionLineSet(input.lines, input.decisions);

    const linesById = new Map(input.lines.map((line) => [line.id, line]));
    const itemsById = new Map(input.items.map((item) => [item.id, item]));
    const batchesByWarehouseAndId = new Map(input.batches.map((batch) => [`${batch.warehouseId}:${batch.id}`, batch]));
    const batchTotals = new Map<string, Decimal>();
    const allocations: ValidatedAllocation[] = [];
    const decisions: ValidatedOutboundDecision[] = [];
    let totalQuantity = new Decimal(0);
    let amount = new Decimal(0);

    for (const decision of input.decisions) {
      const line = linesById.get(decision.approvalLineId)!;
      const approvedQuantity = new Decimal(parsePositiveIntegerQuantity(line.requestedQuantity));
      const decisionAllocations: ValidatedAllocation[] = [];
      let actualQuantity = new Decimal(0);

      for (const allocation of decision.allocations) {
        const quantity = new Decimal(parsePositiveIntegerQuantity(allocation.quantity));
        actualQuantity = actualQuantity.plus(quantity);
      }

      if (actualQuantity.isZero()) {
        if (decision.selectedItemId) throw new Error("zero issue cannot select an item");
        if (!decision.varianceReason?.trim()) throw new Error("variance reason is required for partial or zero issue");
        decisions.push({
          approvalLineId: line.id,
          actualQuantity: "0",
          varianceReason: decision.varianceReason.trim(),
          allocations: [],
        });
        continue;
      }

      if (!decision.selectedItemId) throw new Error("selected item is required for positive issue");
      const item = itemsById.get(decision.selectedItemId);
      if (!item) throw new Error(`selected item not found: ${decision.selectedItemId}`);
      if (!item.isActive) throw new Error("selected item must be active");
      if (!approvalUnitsMatch(line.unit, item.unit)) throw new Error("selected item unit does not match approval unit");
      if (line.legacyResolutionStatus === "EXACT_LOCKED") {
        if (!line.itemId) throw new Error("legacy approval line has no locked item");
        if (line.itemId !== item.id) throw new Error("legacy approval line item cannot be substituted");
      }

      for (const allocation of decision.allocations) {
        const batchKey = `${allocation.warehouseId}:${allocation.batchId}`;
        const batch = batchesByWarehouseAndId.get(batchKey);
        const batchWithSameId = input.batches.find((candidate) => candidate.id === allocation.batchId);
        if (!batch && batchWithSameId) throw new Error("batch does not belong to warehouse");
        if (!batch) throw new Error(`batch not found: ${allocation.batchId}`);
        if (batch.itemId !== item.id) throw new Error("batch item does not match selected item");

        const quantity = new Decimal(parsePositiveIntegerQuantity(allocation.quantity));
        const batchTotal = (batchTotals.get(batchKey) ?? new Decimal(0)).plus(quantity);
        if (batchTotal.gt(decimalFromBatchQuantity(batch.remainingQuantity))) throw new Error("batch balance cannot become negative");
        batchTotals.set(batchKey, batchTotal);

        const unitCost = new Decimal(batch.unitCost);
        amount = amount.plus(quantity.mul(unitCost));
        const validated = {
          approvalLineId: line.id,
          warehouseId: allocation.warehouseId,
          batchId: allocation.batchId,
          quantity: quantity.toString(),
          itemId: item.id,
          unitCost: unitCost.toString(),
          expectedRemainingQuantity: batch.remainingQuantity,
        };
        decisionAllocations.push(validated);
        allocations.push(validated);
      }

      if (actualQuantity.gt(approvedQuantity)) throw new Error("actual quantity exceeds approved quantity");
      if (actualQuantity.lt(approvedQuantity) && !decision.varianceReason?.trim()) {
        throw new Error("variance reason is required for partial or zero issue");
      }

      totalQuantity = totalQuantity.plus(actualQuantity);
      decisions.push({
        approvalLineId: line.id,
        selectedItemId: item.id,
        actualQuantity: actualQuantity.toString(),
        varianceReason: actualQuantity.lt(approvedQuantity) ? decision.varianceReason!.trim() : undefined,
        allocations: decisionAllocations,
      });
    }

    const full = decisions.every((decision) => {
      const line = linesById.get(decision.approvalLineId)!;
      return new Decimal(decision.actualQuantity).eq(parsePositiveIntegerQuantity(line.requestedQuantity));
    });
    return {
      status: totalQuantity.isZero() ? "ZERO" : full ? "FULL" : "PARTIAL",
      totalQuantity: totalQuantity.toString(),
      amount: amount.toFixed(2),
      decisions,
      allocations,
    };
  }
}
