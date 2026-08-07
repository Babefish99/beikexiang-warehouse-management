import { describe, expect, it } from "vitest";

import { AlertService } from "../../../apps/api/src/application/inventory/alert-service.js";

describe("low-stock alert service", () => {
  it("uses the combined quantity across all three warehouses", async () => {
    const service = new AlertService({
      listBalances: async () => [
        { itemId: "item-1", warehouseId: "wh-1", remainingQuantity: "2" },
        { itemId: "item-1", warehouseId: "wh-2", remainingQuantity: "3" },
        { itemId: "item-1", warehouseId: "wh-3", remainingQuantity: "4" },
        { itemId: "item-2", warehouseId: "wh-1", remainingQuantity: "1" },
      ],
      listItems: async () => [
        { id: "item-1", name: "茶叶", minimumStock: "10", isActive: true },
        { id: "item-2", name: "酒水", minimumStock: "0", isActive: true },
      ],
    });

    await expect(service.listLowStock()).resolves.toEqual([{ itemId: "item-1", itemName: "茶叶", totalQuantity: "9", minimumStock: "10" }]);
  });
});
