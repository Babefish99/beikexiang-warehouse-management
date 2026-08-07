import { describe, expect, it } from "vitest";

import { OutboundService, InMemoryOutboundStore } from "../../../apps/api/src/application/inventory/outbound-service.js";

function makeService() {
  const store = new InMemoryOutboundStore();
  store.seedApproval({ id: "approval-1", weComSpNo: "202607230021", status: "PENDING_OUTBOUND", lines: [{ id: "line-1", itemId: "item-1", requestedQuantity: "10" }] });
  store.seedBatch({ id: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" });
  return { store, service: new OutboundService(store) };
}

describe("outbound service", () => {
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
