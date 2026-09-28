import { describe, expect, it } from "vitest";

import { allocateOutboundBatches } from "../../../apps/api/src/application/inventory/outbound-auto-allocation.js";

const batches = [
  { id: "batch-new", batchNo: "20260902-B", purchasedAt: "2026-09-02T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-wine", remainingQuantity: "5", unitCost: "20" },
  { id: "batch-old-b", batchNo: "20260901-B", purchasedAt: "2026-09-01T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-wine", remainingQuantity: "3", unitCost: "18" },
  { id: "batch-old-a", batchNo: "20260901-A", purchasedAt: "2026-09-01T00:00:00.000Z", warehouseId: "wh-2", itemId: "item-wine", remainingQuantity: "2", unitCost: "19" },
];

describe("automatic outbound batch allocation", () => {
  it("allocates FIFO and splits across batches without exposing a warehouse choice", () => {
    expect(allocateOutboundBatches({ itemId: "item-wine", quantity: "4", batches })).toEqual([
      { warehouseId: "wh-2", batchId: "batch-old-a", quantity: "2" },
      { warehouseId: "wh-1", batchId: "batch-old-b", quantity: "2" },
    ]);
  });

  it("uses stable tie breakers for batches purchased on the same day", () => {
    expect(allocateOutboundBatches({ itemId: "item-wine", quantity: "1", batches })[0]).toEqual({
      warehouseId: "wh-2",
      batchId: "batch-old-a",
      quantity: "1",
    });
  });

  it("rejects insufficient total stock before confirmation", () => {
    expect(() => allocateOutboundBatches({ itemId: "item-wine", quantity: "11", batches }))
      .toThrow("insufficient stock for automatic allocation");
  });
});
