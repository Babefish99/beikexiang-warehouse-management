import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { createInventoryMemoryState } from "../../../apps/api/src/application/inventory/inventory-memory-state.js";
import { InMemoryOutboundStore, OutboundService } from "../../../apps/api/src/application/inventory/outbound-service.js";
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

  it("issues stock from the destination warehouse after transferring the batch", async () => {
    const state = createInventoryMemoryState();
    const movementStore = new InMemoryMovementStore(state);
    const outboundStore = new InMemoryOutboundStore(state);
    outboundStore.seedItem({ id: "item-1", code: "ITEM-1", name: "Transfer item", unit: "box", isActive: true });
    outboundStore.seedBatch({ id: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "2", unitCost: "20" });
    outboundStore.seedApproval({
      id: "approval-1",
      weComSpNo: "transfer-outbound-1",
      status: "PENDING_OUTBOUND",
      lines: [{
        id: "line-1",
        requestedItemName: "Transfer item",
        requestedQuantity: "2",
        unit: "box",
        legacyResolutionStatus: "NOT_APPLICABLE",
      }],
    });
    const transferService = new TransferService(movementStore);
    const outboundService = new OutboundService(outboundStore);

    await transferService.complete({
      itemId: "item-1",
      batchId: "batch-1",
      sourceWarehouseId: "wh-1",
      destinationWarehouseId: "wh-2",
      quantity: "2",
      reason: "move before issue",
    });
    await expect(outboundService.listOptions("approval-1")).resolves.toMatchObject({
      batches: [{ batchId: "batch-1", warehouseId: "wh-2", remainingQuantity: "2" }],
    });
    await expect(outboundService.confirm({
      approvalId: "approval-1",
      operatorId: "admin-1",
      decisions: [{
        approvalLineId: "line-1",
        selectedItemId: "item-1",
        allocations: [{ warehouseId: "wh-2", batchId: "batch-1", quantity: "2" }],
      }],
    })).resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("rejects a transfer into a same-batch balance for another item", async () => {
    const store = new InMemoryMovementStore();
    store.seedBalance({ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "10", unitCost: "20" });
    store.seedBalance({ warehouseId: "wh-2", itemId: "item-2", batchId: "batch-1", remainingQuantity: "4", unitCost: "20" });
    const service = new TransferService(store);

    await expect(service.complete({ itemId: "item-1", batchId: "batch-1", sourceWarehouseId: "wh-1", destinationWarehouseId: "wh-2", quantity: "3", reason: "batch correction" })).rejects.toThrow("destination stock balance item mismatch");
    expect(store.balance("wh-1", "batch-1")?.remainingQuantity).toBe("10");
    expect(store.balance("wh-2", "batch-1")).toMatchObject({ itemId: "item-2", remainingQuantity: "4" });
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

  it("restores the batch total on return so the stock can be issued again", async () => {
    const state = createInventoryMemoryState();
    const movementStore = new InMemoryMovementStore(state);
    const outboundStore = new InMemoryOutboundStore(state);
    outboundStore.seedItem({ id: "item-1", code: "ITEM-1", name: "Return item", unit: "box", isActive: true });
    outboundStore.seedBatch({ id: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "1", unitCost: "20" });
    outboundStore.seedApproval({
      id: "approval-1",
      weComSpNo: "return-outbound-1",
      status: "PENDING_OUTBOUND",
      lines: [{ id: "line-1", requestedItemName: "Return item", requestedQuantity: "1", unit: "box", legacyResolutionStatus: "NOT_APPLICABLE" }],
    });
    const outboundService = new OutboundService(outboundStore);
    await outboundService.confirm({
      approvalId: "approval-1",
      operatorId: "admin-1",
      decisions: [{ approvalLineId: "line-1", selectedItemId: "item-1", allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1" }] }],
    });
    const allocationId = [...state.issuedAllocations.keys()][0];
    expect(allocationId).toBeDefined();

    await new ReturnService(movementStore).create({
      outboundAllocationId: allocationId!,
      quantity: "1",
      reason: "unused stock",
    });
    outboundStore.seedApproval({
      id: "approval-2",
      weComSpNo: "return-outbound-2",
      status: "PENDING_OUTBOUND",
      lines: [{ id: "line-2", requestedItemName: "Return item", requestedQuantity: "1", unit: "box", legacyResolutionStatus: "NOT_APPLICABLE" }],
    });

    await expect(outboundService.confirm({
      approvalId: "approval-2",
      operatorId: "admin-2",
      decisions: [{ approvalLineId: "line-2", selectedItemId: "item-1", allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1" }] }],
    })).resolves.toMatchObject({ status: "COMPLETED" });
    expect(state.batches.get("batch-1")?.remainingQuantity).toBe("0");
    expect(state.balances.get("wh-1:batch-1")?.remainingQuantity).toBe("0");
  });

  it("rejects a return when the current balance belongs to another item", async () => {
    const store = new InMemoryMovementStore();
    store.seedBalance({ warehouseId: "wh-1", itemId: "item-2", batchId: "batch-1", remainingQuantity: "6", unitCost: "20" });
    store.seedIssuedAllocation({ id: "allocation-1", outboundOrderId: "out-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", issuedQuantity: "4", unitCost: "20" });
    const service = new ReturnService(store);

    await expect(service.create({ outboundAllocationId: "allocation-1", quantity: "2", reason: "item mismatch" })).rejects.toThrow("return stock balance item mismatch");
    expect(store.balance("wh-1", "batch-1")?.remainingQuantity).toBe("6");
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
