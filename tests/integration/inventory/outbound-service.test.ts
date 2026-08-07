import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { OutboundService, InMemoryOutboundStore } from "../../../apps/api/src/application/inventory/outbound-service.js";
import { registerOutboundRoutes } from "../../../apps/api/src/routes/admin/outbound.js";
import { buildServer } from "../../../apps/api/src/server.js";

function makeService() {
  const store = new InMemoryOutboundStore();
  store.seedApproval({ id: "approval-1", weComSpNo: "202607230021", status: "PENDING_OUTBOUND", lines: [{ id: "line-1", itemId: "item-1", requestedQuantity: "10" }] });
  store.seedBatch({ id: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" });
  return { store, service: new OutboundService(store) };
}

describe("outbound service", () => {
  it("lists available batches for a pending approval", async () => {
    const { store, service } = makeService();

    store.seedBatch({ id: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "3", unitCost: "25" });
    store.seedBatch({ id: "batch-empty", warehouseId: "wh-4", itemId: "item-1", remainingQuantity: "0", unitCost: "15" });
    store.seedBatch({ id: "batch-other-item", warehouseId: "wh-3", itemId: "item-2", remainingQuantity: "8", unitCost: "30" });

    await expect(service.listOptions("approval-1")).resolves.toEqual({
      approvalId: "approval-1",
      batches: [
        { batchId: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" },
        { batchId: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "3", unitCost: "25" },
      ],
    });
  });

  it("rejects when listing batches for an unknown approval", async () => {
    const { service } = makeService();

    await expect(service.listOptions("missing-approval")).rejects.toThrow("approval not found: missing-approval");
  });

  it.each(["COMPLETED", "VOIDED"] as const)("rejects when listing batches for a %s approval", async (status) => {
    const { store, service } = makeService();
    store.seedApproval({ id: "approval-1", weComSpNo: "202607230021", status, lines: [{ id: "line-1", itemId: "item-1", requestedQuantity: "10" }] });

    await expect(service.listOptions("approval-1")).rejects.toThrow("approval is already closed");
  });

  it("confirms a batch-aware issue and posts one negative ledger entry", async () => {
    const { store, service } = makeService();

    await expect(service.confirm({ approvalId: "approval-1", allocations: [{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-1", quantity: "10" }] })).resolves.toMatchObject({ status: "COMPLETED", amount: "200.00" });
    expect(store.batch("batch-1")?.remainingQuantity).toBe("0");
    expect(store.ledger()).toMatchObject([{ type: "OUTBOUND", quantity: "-10", unitCost: "20", amount: "200.00" }]);
  });

  it("closes a partial issue and prevents a later top-up on the same approval", async () => {
    const { service } = makeService();

    await expect(service.confirm({ approvalId: "approval-1", allocations: [{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-1", quantity: "4" }], reason: "按实际需要少出" })).resolves.toMatchObject({ status: "PARTIALLY_ISSUED" });
    await expect(service.confirm({ approvalId: "approval-1", allocations: [{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-1", quantity: "6" }] })).rejects.toThrow("approval is already closed");
  });

  it("cancels an unissued approval with a required reason and no ledger entry", async () => {
    const { store, service } = makeService();

    await expect(service.cancelBeforeIssue({ approvalId: "approval-1", reason: "申请人取消领用" })).resolves.toMatchObject({ status: "VOIDED" });
    expect(store.ledger()).toHaveLength(0);
  });
});

describe("outbound options route", () => {
  it("uses the approvalId path parameter and returns options", async () => {
    const app = Fastify();
    const { store, service } = makeService();
    store.seedBatch({ id: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "3", unitCost: "25" });
    store.seedBatch({ id: "batch-empty", warehouseId: "wh-4", itemId: "item-1", remainingQuantity: "0", unitCost: "15" });
    registerOutboundRoutes(app, { outboundService: service });

    try {
      const response = await app.inject({ method: "GET", url: "/admin/outbound/approval-1/options" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        approvalId: "approval-1",
        batches: [
          { batchId: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" },
          { batchId: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "3", unitCost: "25" },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("returns the service error for an unknown approval", async () => {
    const app = Fastify();
    registerOutboundRoutes(app, { outboundService: new OutboundService(new InMemoryOutboundStore()) });

    try {
      const response = await app.inject({ method: "GET", url: "/admin/outbound/missing-approval/options" });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ message: "approval not found: missing-approval" });
    } finally {
      await app.close();
    }
  });

  it("rejects unauthenticated access to the options route", async () => {
    const app = buildServer();

    try {
      const response = await app.inject({ method: "GET", url: "/admin/outbound/approval-1/options" });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    } finally {
      await app.close();
    }
  });
});
