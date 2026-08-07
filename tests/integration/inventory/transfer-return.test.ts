import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { ReturnService } from "../../../apps/api/src/application/inventory/return-service.js";
import { InMemoryMovementStore, TransferService } from "../../../apps/api/src/application/inventory/transfer-service.js";
import { registerReturnRoutes } from "../../../apps/api/src/routes/admin/returns.js";
import { registerTransferRoutes } from "../../../apps/api/src/routes/admin/transfers.js";
import { buildServer } from "../../../apps/api/src/server.js";

describe("transfer and return services", () => {
  it("lists selectable transfer balances and requires a reason before completion", async () => {
    const store = new InMemoryMovementStore();
    store.seedBalance({ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "10", unitCost: "20" });
    store.seedBalance({ warehouseId: "wh-2", itemId: "item-1", batchId: "batch-empty", remainingQuantity: "0", unitCost: "20" });
    store.seedBalance({ warehouseId: "wh-3", itemId: "item-2", batchId: "batch-2", remainingQuantity: "5", unitCost: "30" });
    const service = new TransferService(store);

    await expect(service.listOptions()).resolves.toEqual({
      balances: [
        { warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "10", unitCost: "20" },
        { warehouseId: "wh-3", itemId: "item-2", batchId: "batch-2", remainingQuantity: "5", unitCost: "30" },
      ],
    });
    await expect(service.complete({ itemId: "item-1", batchId: "batch-1", sourceWarehouseId: "wh-1", destinationWarehouseId: "wh-2", quantity: "3", reason: "" })).rejects.toThrow("reason is required");
  });

  it("completes a one-click transfer at the same batch cost", async () => {
    const store = new InMemoryMovementStore();
    store.seedBalance({ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "10", unitCost: "20" });
    const service = new TransferService(store);

    await expect(service.complete({ itemId: "item-1", batchId: "batch-1", sourceWarehouseId: "wh-1", destinationWarehouseId: "wh-2", quantity: "3", reason: "调拨补货" })).resolves.toMatchObject({ status: "COMPLETED", unitCost: "20" });
    expect(store.balance("wh-1", "batch-1")?.remainingQuantity).toBe("7");
    expect(store.balance("wh-2", "batch-1")?.remainingQuantity).toBe("3");
    expect(store.ledger()).toHaveLength(2);
  });

  it("lists returnable allocations and limits return quantity", async () => {
    const store = new InMemoryMovementStore();
    store.seedBalance({ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "6", unitCost: "20" });
    store.seedIssuedAllocation({ id: "allocation-1", outboundOrderId: "out-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", issuedQuantity: "4", unitCost: "20" });
    store.seedIssuedAllocation({ id: "allocation-2", outboundOrderId: "out-2", warehouseId: "wh-2", itemId: "item-2", batchId: "batch-2", issuedQuantity: "3", unitCost: "11" });
    const service = new ReturnService(store);

    await expect(service.listOptions()).resolves.toEqual({
      allocations: [
        { id: "allocation-1", outboundOrderId: "out-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", issuedQuantity: "4", remainingReturnableQuantity: "4", unitCost: "20" },
        { id: "allocation-2", outboundOrderId: "out-2", warehouseId: "wh-2", itemId: "item-2", batchId: "batch-2", issuedQuantity: "3", remainingReturnableQuantity: "3", unitCost: "11" },
      ],
    });
    await expect(service.create({ outboundAllocationId: "allocation-1", quantity: "2", reason: "未使用退回" })).resolves.toMatchObject({ status: "COMPLETED", unitCost: "20" });
    await expect(service.listOptions()).resolves.toEqual({
      allocations: [
        { id: "allocation-1", outboundOrderId: "out-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", issuedQuantity: "4", remainingReturnableQuantity: "2", unitCost: "20" },
        { id: "allocation-2", outboundOrderId: "out-2", warehouseId: "wh-2", itemId: "item-2", batchId: "batch-2", issuedQuantity: "3", remainingReturnableQuantity: "3", unitCost: "11" },
      ],
    });
    await expect(service.create({ outboundAllocationId: "allocation-1", quantity: "3", reason: "再次退回" })).rejects.toThrow("return quantity exceeds original issued quantity");
    expect(store.balance("wh-1", "batch-1")?.remainingQuantity).toBe("8");
  });
});

describe("transfer and return routes", () => {
  it("returns transfer balance options from the read endpoint", async () => {
    const app = Fastify();
    const store = new InMemoryMovementStore();
    store.seedBalance({ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "10", unitCost: "20" });
    store.seedBalance({ warehouseId: "wh-2", itemId: "item-1", batchId: "batch-empty", remainingQuantity: "0", unitCost: "20" });
    registerTransferRoutes(app, { transferService: new TransferService(store) });

    try {
      const response = await app.inject({ method: "GET", url: "/admin/transfers/options" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        balances: [
          { warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "10", unitCost: "20" },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("returns returnable allocations from the read endpoint", async () => {
    const app = Fastify();
    const store = new InMemoryMovementStore();
    store.seedBalance({ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "6", unitCost: "20" });
    store.seedIssuedAllocation({ id: "allocation-1", outboundOrderId: "out-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", issuedQuantity: "4", unitCost: "20" });
    registerReturnRoutes(app, { returnService: new ReturnService(store) });

    try {
      const response = await app.inject({ method: "GET", url: "/admin/returns/options" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        allocations: [
          { id: "allocation-1", outboundOrderId: "out-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", issuedQuantity: "4", remainingReturnableQuantity: "4", unitCost: "20" },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("rejects unauthenticated access to transfer and return read endpoints", async () => {
    const app = buildServer();

    try {
      const [transferResponse, returnResponse] = await Promise.all([
        app.inject({ method: "GET", url: "/admin/transfers/options" }),
        app.inject({ method: "GET", url: "/admin/returns/options" }),
      ]);

      expect(transferResponse.statusCode).toBe(401);
      expect(returnResponse.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
