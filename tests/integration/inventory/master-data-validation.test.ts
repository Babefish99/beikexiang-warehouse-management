import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { InMemoryInventoryEntryStore, InboundService } from "../../../apps/api/src/application/inventory/inbound-service.js";
import { OpeningStockService } from "../../../apps/api/src/application/inventory/opening-stock-service.js";
import { InMemoryItemRepository, ItemService } from "../../../apps/api/src/application/items/item-service.js";
import { InMemoryWarehouseRepository, WarehouseService } from "../../../apps/api/src/application/warehouses/warehouse-service.js";
import { registerInboundRoutes } from "../../../apps/api/src/routes/admin/inbound.js";
import { registerOpeningStockRoutes } from "../../../apps/api/src/routes/admin/opening-stock.js";

async function createFixture() {
  const itemService = new ItemService(new InMemoryItemRepository());
  const activeItem = await itemService.create({ code: "TEA-0001", name: "Tea leaves", unit: "box", categoryId: "cat-tea" });
  const inactiveItem = await itemService.create({ code: "TEA-0002", name: "Inactive tea", unit: "box", categoryId: "cat-tea" });
  await itemService.deactivate(inactiveItem.id);

  const warehouseService = new WarehouseService(new InMemoryWarehouseRepository([
    { id: "wh-1", code: "WH-01", name: "Supplies", isActive: true },
    { id: "wh-inactive", code: "WH-02", name: "Inactive", isActive: false },
  ]));
  const store = new InMemoryInventoryEntryStore();
  const app = Fastify();
  registerInboundRoutes(app, { inboundService: new InboundService(store, { warehouseService, itemService }) });
  registerOpeningStockRoutes(app, { openingStockService: new OpeningStockService(store, { warehouseService, itemService }) });

  return { app, store, activeItem, inactiveItem };
}

describe("inventory master data validation", () => {
  it("rejects forged warehouses and inactive items for inbound", async () => {
    const { app, store, activeItem, inactiveItem } = await createFixture();

    const forgedWarehouse = await app.inject({
      method: "POST",
      url: "/admin/inbound",
      payload: { warehouseId: "wh-forged", itemId: activeItem.id, batchNo: "B-01", quantity: "1", unitCost: "10", purchasedAt: "2026-08-08" },
    });
    expect(forgedWarehouse.statusCode).toBe(400);
    expect(forgedWarehouse.json()).toEqual({ error: "warehouse is inactive or not found" });

    const inactiveItemResponse = await app.inject({
      method: "POST",
      url: "/admin/inbound",
      payload: { warehouseId: "wh-1", itemId: inactiveItem.id, batchNo: "B-02", quantity: "1", unitCost: "10", purchasedAt: "2026-08-08" },
    });
    expect(inactiveItemResponse.statusCode).toBe(400);
    expect(inactiveItemResponse.json()).toEqual({ error: "item is inactive or not found" });
    expect(store.batches()).toHaveLength(0);
    await app.close();
  });

  it("rejects inactive warehouses and forged items for opening stock", async () => {
    const { app, store, activeItem } = await createFixture();

    const inactiveWarehouse = await app.inject({
      method: "POST",
      url: "/admin/opening-stock",
      payload: { verifiedBy: "admin-1", rows: [{ warehouseId: "wh-inactive", itemId: activeItem.id, batchNo: "OPEN-01", quantity: "1", unitCost: "10" }] },
    });
    expect(inactiveWarehouse.statusCode).toBe(400);
    expect(inactiveWarehouse.json()).toEqual({ error: "warehouse is inactive or not found" });

    const forgedItem = await app.inject({
      method: "POST",
      url: "/admin/opening-stock",
      payload: { verifiedBy: "admin-1", rows: [{ warehouseId: "wh-1", itemId: "item-forged", batchNo: "OPEN-02", quantity: "1", unitCost: "10" }] },
    });
    expect(forgedItem.statusCode).toBe(400);
    expect(forgedItem.json()).toEqual({ error: "item is inactive or not found" });
    expect(store.batches()).toHaveLength(0);
    await app.close();
  });
});
