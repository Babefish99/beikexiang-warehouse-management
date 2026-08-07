import { Decimal } from "decimal.js";

export interface AllocationLine {
  id: string;
  itemId: string;
  requestedQuantity: string;
}

export interface AllocationBatch {
  id: string;
  warehouseId: string;
  itemId: string;
  remainingQuantity: string;
  unitCost: string;
}

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

export interface AllocationValidationResult {
  status: "FULL" | "PARTIAL" | "ZERO";
  totalQuantity: string;
  amount: string;
  allocations: ValidatedAllocation[];
}

export class OutboundAllocator {
  validate(input: { lines: AllocationLine[]; batches: AllocationBatch[]; allocations: OutboundAllocationInput[]; reason?: string }): AllocationValidationResult {
    const linesById = new Map(input.lines.map((line) => [line.id, line]));
    const batchesById = new Map(input.batches.map((batch) => [`${batch.warehouseId}:${batch.id}`, batch]));
    const totalsByLine = new Map<string, Decimal>();
    const totalsByBatch = new Map<string, Decimal>();
    const allocations: ValidatedAllocation[] = [];
    let amount = new Decimal(0);

    for (const allocation of input.allocations) {
      const line = linesById.get(allocation.approvalLineId);
      if (!line) throw new Error(`approval line not found: ${allocation.approvalLineId}`);
      const batchKey = `${allocation.warehouseId}:${allocation.batchId}`;
      const batch = batchesById.get(batchKey);
      const batchWithSameId = input.batches.find((candidate) => candidate.id === allocation.batchId);
      if (!batch && batchWithSameId) throw new Error("batch does not belong to warehouse");
      if (!batch) throw new Error(`batch not found: ${allocation.batchId}`);
      if (batch.warehouseId !== allocation.warehouseId) throw new Error("batch does not belong to warehouse");
      if (batch.itemId !== line.itemId) throw new Error("item substitution is not allowed");
      const quantity = new Decimal(allocation.quantity);
      if (!quantity.isFinite() || !quantity.gt(0)) throw new Error("allocation quantity must be positive");
      const lineTotal = (totalsByLine.get(line.id) ?? new Decimal(0)).plus(quantity);
      if (lineTotal.gt(new Decimal(line.requestedQuantity))) throw new Error("actual quantity exceeds approved quantity");
      const batchTotal = (totalsByBatch.get(batchKey) ?? new Decimal(0)).plus(quantity);
      if (batchTotal.gt(new Decimal(batch.remainingQuantity))) throw new Error("batch balance cannot become negative");
      totalsByLine.set(line.id, lineTotal);
      totalsByBatch.set(batchKey, batchTotal);
      const unitCost = new Decimal(batch.unitCost);
      amount = amount.plus(quantity.mul(unitCost));
      allocations.push({ ...allocation, quantity: quantity.toString(), itemId: line.itemId, unitCost: unitCost.toString(), expectedRemainingQuantity: batch.remainingQuantity });
    }

    const totalQuantity = [...totalsByLine.values()].reduce((sum, value) => sum.plus(value), new Decimal(0));
    const full = input.lines.every((line) => (totalsByLine.get(line.id) ?? new Decimal(0)).eq(new Decimal(line.requestedQuantity)));
    if (!full && !input.reason?.trim()) throw new Error("reason is required for partial or zero issue");
    return { status: totalQuantity.isZero() ? "ZERO" : full ? "FULL" : "PARTIAL", totalQuantity: totalQuantity.toString(), amount: amount.toFixed(2), allocations };
  }
}
