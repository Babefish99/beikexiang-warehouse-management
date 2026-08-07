import { describe, expect, it } from "vitest";

import { InMemoryMovementStore, TransferService } from "../../../apps/api/src/application/inventory/transfer-service.js";
import { ReturnService } from "../../../apps/api/src/application/inventory/return-service.js";

describe("transfer and return services", () => {
  it("completes a one-click transfer at the same batch cost", async () => {
    const store = new InMemoryMovementStore();
    store.seedBalance({ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "10", unitCost: "20" });
    const service = new TransferService(store);

    await expect(service.complete({ itemId: "item-1", batchId: "batch-1", sourceWarehouseId: "wh-1", destinationWarehouseId: "wh-2", quantity: "3" })).resolves.toMatchObject({ status: "COMPLETED", unitCost: "20" });
    expect(store.balance("wh-1", "batch-1")?.remainingQuantity).toBe("7");
    expect(store.balance("wh-2", "batch-1")?.remainingQuantity).toBe("3");
    expect(store.ledger()).toHaveLength(2);
  });

  it("requires an original outbound allocation and limits return quantity", async () => {
    const store = new InMemoryMovementStore();
    store.seedBalance({ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "6", unitCost: "20" });
    store.seedIssuedAllocation({ id: "allocation-1", outboundOrderId: "out-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", issuedQuantity: "4", unitCost: "20" });
    const service = new ReturnService(store);

    await expect(service.create({ outboundAllocationId: "allocation-1", quantity: "2", reason: "未使用" })).resolves.toMatchObject({ status: "COMPLETED", unitCost: "20" });
    await expect(service.create({ outboundAllocationId: "allocation-1", quantity: "3", reason: "再次退回" })).rejects.toThrow("return quantity exceeds original issued quantity");
    expect(store.balance("wh-1", "batch-1")?.remainingQuantity).toBe("8");
  });
});
