import { describe, expect, it } from "vitest";

import { InMemoryInventoryEntryStore, InboundService } from "../../../apps/api/src/application/inventory/inbound-service.js";

const validInput = { warehouseId: "wh-1", itemId: "item-1", batchNo: "B-2026-01", quantity: "12", unitCost: "35.50", purchasedAt: "2026-08-01", purchaser: "采购部" };

describe("inbound service", () => {
  it("creates one inbound order, batch, balance, and ledger entry", async () => {
    const store = new InMemoryInventoryEntryStore();
    const service = new InboundService(store);

    const result = await service.create(validInput);

    expect(result.batchIds).toHaveLength(1);
    expect(store.batches()).toMatchObject([{ batchNo: "B-2026-01", quantity: "12", remainingQuantity: "12", unitCost: "35.5" }]);
    expect(store.ledger()).toMatchObject([{ type: "INBOUND", quantity: "12", amount: "426.00" }]);
  });

  it("rejects negative quantities and zero-cost inbound without a remark", async () => {
    const service = new InboundService(new InMemoryInventoryEntryStore());

    await expect(service.create({ ...validInput, quantity: "-1" })).rejects.toThrow("quantity cannot be negative");
    await expect(service.create({ ...validInput, unitCost: "0" })).rejects.toThrow("remark is required when unit cost is zero");
  });
});
