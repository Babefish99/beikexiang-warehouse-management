import { describe, expect, it } from "vitest";

import { InMemoryInventoryEntryStore } from "../../../apps/api/src/application/inventory/inbound-service.js";
import { OpeningStockService } from "../../../apps/api/src/application/inventory/opening-stock-service.js";

const masterData = {
  warehouseService: {
    list: async () => [
      { id: "wh-1", code: "WH-01", name: "Supplies", isActive: true },
      { id: "wh-2", code: "WH-02", name: "Consumables", isActive: true },
    ],
  },
  itemService: {
    list: async () => [{ id: "item-1", code: "IT-0001", name: "Tea leaves", unit: "box", categoryId: "cat-tea", isActive: true }],
  },
};

describe("opening stock service", () => {
  it("records physically verified opening balances as opening ledger entries", async () => {
    const store = new InMemoryInventoryEntryStore();
    const service = new OpeningStockService(store, masterData);

    const result = await service.create({
      verifiedBy: "admin-1",
      rows: [{ warehouseId: "wh-1", itemId: "item-1", batchNo: "OPEN-01", quantity: "8", unitCost: "20", remark: "physical count" }],
    });

    expect(result.batchIds).toHaveLength(1);
    expect(store.ledger()).toMatchObject([{ type: "OPENING_BALANCE", referenceType: "OPENING_STOCK", quantity: "8" }]);
    expect(store.ledger()[0]).not.toHaveProperty("historicalDate");
  });

  it("uses a separate order reference for each warehouse while preserving the public response", async () => {
    const store = new InMemoryInventoryEntryStore();
    const service = new OpeningStockService(store, masterData);

    const result = await service.create({
      verifiedBy: "admin-1",
      rows: [
        { warehouseId: "wh-1", itemId: "item-1", batchNo: "OPEN-WH-1", quantity: "8", unitCost: "20" },
        { warehouseId: "wh-2", itemId: "item-1", batchNo: "OPEN-WH-2", quantity: "3", unitCost: "10" },
      ],
    });

    expect(result).toEqual({ batchIds: ["batch-0001", "batch-0002"] });
    const ledger = store.ledger();
    expect(ledger.map((entry) => entry.warehouseId)).toEqual(["wh-1", "wh-2"]);
    expect(new Set(ledger.map((entry) => entry.referenceId)).size).toBe(2);
  });
});
