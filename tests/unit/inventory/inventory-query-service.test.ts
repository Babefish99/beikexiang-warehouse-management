import { describe, expect, it } from "vitest";

import { InventoryQueryService } from "../../../apps/api/src/application/inventory/inventory-query-service.js";

const items = [
  { id: "item-1", code: "IT-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea", weComOptionKey: "opt-tea", isActive: true },
  { id: "item-2", code: "IT-0002", name: "Sugar", specification: "Brown", unit: "bag", categoryId: "cat-sugar", weComOptionKey: "opt-sugar", isActive: true },
];

const warehouses = [
  { id: "wh-1", code: "MAIN", name: "Main warehouse", isActive: true },
  { id: "wh-2", code: "AUX", name: "Aux warehouse", isActive: true },
];

const batches = [
  { id: "batch-1", warehouseId: "wh-1", itemId: "item-1", batchNo: "B-001", quantity: "8", remainingQuantity: "8", unitCost: "20", purchasedAt: "2026-08-01T00:00:00.000Z" },
  { id: "batch-2", warehouseId: "wh-2", itemId: "item-1", batchNo: "B-002", quantity: "3", remainingQuantity: "3", unitCost: "22", purchasedAt: "2026-08-02T00:00:00.000Z" },
  { id: "batch-3", warehouseId: "wh-1", itemId: "item-2", batchNo: "S-001", quantity: "5", remainingQuantity: "5", unitCost: "10", purchasedAt: "2026-08-03T00:00:00.000Z" },
];

const balances = [
  { warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "8", unitCost: "20" },
  { warehouseId: "wh-2", itemId: "item-1", batchId: "batch-2", remainingQuantity: "3", unitCost: "22" },
  { warehouseId: "wh-1", itemId: "item-2", batchId: "batch-3", remainingQuantity: "5", unitCost: "10" },
];

describe("inventory query service", () => {
  it("matches batch and returns the warehouse, batch, quantity and amount", async () => {
    const service = new InventoryQueryService({
      listItems: async () => items,
      listWarehouses: async () => warehouses,
      listBatches: () => batches,
      listBalances: () => balances,
    });

    await expect(service.search("B-002")).resolves.toEqual([
      {
        itemId: "item-1",
        code: "IT-0001",
        name: "Tea leaves",
        specification: "Iron Goddess",
        unit: "box",
        totalQuantity: "3",
        totalAmount: "66.00",
        locations: [
          {
            warehouseId: "wh-2",
            warehouseName: "Aux warehouse",
            batchId: "batch-2",
            batchNo: "B-002",
            quantity: "3",
            unitCost: "22",
            amount: "66.00",
          },
        ],
      },
    ]);
  });

  it("excludes locations outside the explicit warehouse filter", async () => {
    const service = new InventoryQueryService({
      listItems: async () => items,
      listWarehouses: async () => warehouses,
      listBatches: () => batches,
      listBalances: () => balances,
    });

    await expect(service.search("main", "wh-2")).resolves.toEqual([]);
  });

  it("returns no results for an empty query", async () => {
    const service = new InventoryQueryService({
      listItems: async () => items,
      listWarehouses: async () => warehouses,
      listBatches: () => batches,
      listBalances: () => balances,
    });

    await expect(service.search("   ")).resolves.toEqual([]);
  });
});
