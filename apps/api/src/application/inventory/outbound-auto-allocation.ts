import { Decimal } from "decimal.js";

import { parsePositiveIntegerQuantity } from "../../domain/approvals/approval-intent.js";

export interface AutoAllocationBatch {
  id: string;
  batchNo?: string;
  purchasedAt: string;
  warehouseId: string;
  itemId: string;
  remainingQuantity: string;
}

export interface GeneratedOutboundAllocation {
  warehouseId: string;
  batchId: string;
  quantity: string;
}

function compareBatches(left: AutoAllocationBatch, right: AutoAllocationBatch): number {
  return left.purchasedAt.localeCompare(right.purchasedAt)
    || (left.batchNo ?? "").localeCompare(right.batchNo ?? "")
    || left.warehouseId.localeCompare(right.warehouseId)
    || left.id.localeCompare(right.id);
}

export function allocateOutboundBatches(input: {
  itemId: string;
  quantity: string;
  batches: readonly AutoAllocationBatch[];
}): GeneratedOutboundAllocation[] {
  let unallocated = new Decimal(parsePositiveIntegerQuantity(input.quantity));
  const allocations: GeneratedOutboundAllocation[] = [];
  const candidates = input.batches
    .filter((batch) => batch.itemId === input.itemId && new Decimal(batch.remainingQuantity).gt(0))
    .sort(compareBatches);

  for (const batch of candidates) {
    if (unallocated.isZero()) break;
    const available = new Decimal(batch.remainingQuantity);
    const quantity = Decimal.min(available, unallocated);
    if (quantity.gt(0)) {
      allocations.push({ warehouseId: batch.warehouseId, batchId: batch.id, quantity: quantity.toString() });
      unallocated = unallocated.minus(quantity);
    }
  }

  if (unallocated.gt(0)) throw new Error("insufficient stock for automatic allocation");
  return allocations;
}
