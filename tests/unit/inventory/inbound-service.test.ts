import { describe, expect, it } from "vitest";

import { InMemoryInventoryEntryStore, InboundService } from "../../../apps/api/src/application/inventory/inbound-service.js";

const validInput = { warehouseId: "wh-1", itemId: "item-1", quantity: "12", unitCost: "35.50", purchasedAt: "2026-08-01", purchaser: "purchasing" };

const masterData = {
  warehouseService: {
    list: async () => [{ id: "wh-1", code: "WH-01", name: "Supplies", isActive: true }],
  },
  itemService: {
    list: async () => [{ id: "item-1", code: "IT-0001", name: "Tea leaves", unit: "box", categoryId: "cat-tea", isActive: true }],
  },
};

describe("inbound service", () => {
  it("creates one inbound order, batch, balance, and ledger entry", async () => {
    const store = new InMemoryInventoryEntryStore();
    const service = new InboundService(store, masterData);

    const result = await service.create(validInput);

    expect(result).toMatchObject({ batchNo: "20260801-001" });
    expect(result.batchIds).toHaveLength(1);
    expect(store.batches()).toMatchObject([{ batchNo: "20260801-001", quantity: "12", remainingQuantity: "12", unitCost: "35.5" }]);
    expect(store.ledger()).toMatchObject([{ type: "INBOUND", quantity: "12", amount: "426.00" }]);
  });

  it("rejects negative quantities and zero-cost inbound without a remark", async () => {
    const service = new InboundService(new InMemoryInventoryEntryStore(), masterData);

    await expect(service.create({ ...validInput, quantity: "-1" })).rejects.toThrow("quantity cannot be negative");
    await expect(service.create({ ...validInput, unitCost: "0" })).rejects.toThrow("remark is required when unit cost is zero");
  });

  it("rejects inactive or forged master data before recording stock", async () => {
    const store = new InMemoryInventoryEntryStore();
    const service = new InboundService(store, {
      warehouseService: {
        list: async () => [
          { id: "wh-1", code: "WH-01", name: "Supplies", isActive: true },
          { id: "wh-inactive", code: "WH-02", name: "Inactive", isActive: false },
        ],
      },
      itemService: masterData.itemService,
    });

    await expect(service.create({ ...validInput, warehouseId: "wh-inactive" })).rejects.toThrow("warehouse is inactive or not found");
    await expect(service.create({ ...validInput, warehouseId: "wh-forged" })).rejects.toThrow("warehouse is inactive or not found");
    expect(store.batches()).toHaveLength(0);
  });
});
