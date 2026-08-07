import { describe, expect, it } from "vitest";

import { OutboundAllocator, type AllocationBatch, type AllocationLine } from "../../../apps/api/src/application/inventory/outbound-allocator.js";

const lines: AllocationLine[] = [{ id: "line-1", itemId: "item-1", requestedQuantity: "10" }];
const batches: AllocationBatch[] = [
  { id: "batch-a", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "6", unitCost: "20" },
  { id: "batch-b", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "8", unitCost: "22" },
];

describe("outbound allocator", () => {
  it("validates one line split across warehouses and batches", () => {
    const result = new OutboundAllocator().validate({ lines, batches, allocations: [
      { approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-a", quantity: "6" },
      { approvalLineId: "line-1", warehouseId: "wh-2", batchId: "batch-b", quantity: "4" },
    ] });

    expect(result).toMatchObject({ status: "FULL", totalQuantity: "10", amount: "208.00" });
  });

  it("allows partial and zero issue only with a reason", () => {
    const allocator = new OutboundAllocator();
    expect(allocator.validate({ lines, batches, allocations: [{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-a", quantity: "4" }], reason: "实际库存不足" }).status).toBe("PARTIAL");
    expect(allocator.validate({ lines, batches, allocations: [], reason: "本次暂不领用" }).status).toBe("ZERO");
    expect(() => allocator.validate({ lines, batches, allocations: [{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-a", quantity: "4" }] })).toThrow("reason is required");
  });

  it("rejects over-issue, unavailable batches, and item substitution", () => {
    const allocator = new OutboundAllocator();
    expect(() => allocator.validate({ lines, batches, allocations: [{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-a", quantity: "11" }] })).toThrow("actual quantity exceeds approved quantity");
    expect(() => allocator.validate({ lines, batches, allocations: [{ approvalLineId: "line-1", warehouseId: "wh-9", batchId: "batch-a", quantity: "1" }] })).toThrow("batch does not belong to warehouse");
    expect(() => allocator.validate({ lines, batches: [{ ...batches[0], itemId: "item-2" }], allocations: [{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-a", quantity: "1" }] })).toThrow("item substitution is not allowed");
  });
});
