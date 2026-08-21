import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { InMemoryItemRepository, ItemService } from "../../apps/api/src/application/items/item-service.js";
import { InMemoryWarehouseRepository, WarehouseService } from "../../apps/api/src/application/warehouses/warehouse-service.js";
import { registerItemRoutes } from "../../apps/api/src/routes/admin/items.js";
import { registerWarehouseRoutes } from "../../apps/api/src/routes/admin/warehouses.js";

describe("master data admin routes", () => {
  it("creates and searches standard items without returning stock balances", async () => {
    const app = Fastify();
    const itemService = new ItemService(new InMemoryItemRepository());
    registerItemRoutes(app, { itemService });

    const created = await app.inject({
      method: "POST",
      url: "/admin/items",
      payload: {
        name: "Tea leaves",
        specification: "Iron Goddess",
        unit: "box",
        categoryId: "cat-tea",
        categoryPrefix: "TEA",
        weComOptionKey: "opt-tea",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty("stockQuantity");

    const list = await app.inject({ method: "GET", url: "/admin/items?search=tea" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject([{ name: "Tea leaves", weComOptionKey: "opt-tea" }]);
  });

  it("updates and deactivates items while keeping the code immutable after ledger activity", async () => {
    const app = Fastify();
    const repository = new InMemoryItemRepository();
    const itemService = new ItemService(repository);
    registerItemRoutes(app, { itemService });

    const created = await app.inject({
      method: "POST",
      url: "/admin/items",
      payload: { code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea" },
    });
    const itemId = created.json<{ id: string }>().id;

    const updated = await app.inject({
      method: "PATCH",
      url: `/admin/items/${itemId}`,
      payload: { code: "TEA-0001", name: "Tea leaves premium", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: itemId, code: "TEA-0001", name: "Tea leaves premium" });

    repository.markLedgerActivity(itemId);
    const rejected = await app.inject({
      method: "PATCH",
      url: `/admin/items/${itemId}`,
      payload: { code: "TEA-0099", name: "Tea leaves premium", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({ error: "item code cannot change after ledger activity" });

    const deactivated = await app.inject({ method: "POST", url: `/admin/items/${itemId}/deactivate` });
    expect(deactivated.statusCode).toBe(204);

    const reactivated = await app.inject({ method: "POST", url: `/admin/items/${itemId}/activate` });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json()).toMatchObject({ id: itemId, code: "TEA-0001", isActive: true });

    const list = await app.inject({ method: "GET", url: "/admin/items?includeInactive=true" });
    expect(list.json()).toEqual([
      expect.objectContaining({ id: itemId, isActive: true }),
    ]);
  });

  it("lists active warehouses for selectors", async () => {
    const app = Fastify();
    const warehouseService = new WarehouseService(new InMemoryWarehouseRepository([
      { id: "wh-1", code: "WH-01", name: "Supplies", isActive: true },
      { id: "wh-2", code: "WH-02", name: "Finished goods", isActive: true },
      { id: "wh-3", code: "WH-03", name: "Archive", isActive: false },
    ]));
    registerWarehouseRoutes(app, { warehouseService });

    const response = await app.inject({ method: "GET", url: "/admin/warehouses" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(2);
  });

  it("lists all warehouses for admin maintenance and updates supported fields", async () => {
    const app = Fastify();
    const warehouseService = new WarehouseService(new InMemoryWarehouseRepository([
      { id: "wh-1", code: "WH-01", name: "Placeholder one", isActive: true, isPlaceholder: true },
      { id: "wh-2", code: "WH-02", name: "Warehouse two", isActive: true },
      { id: "wh-3", code: "WH-03", name: "Warehouse three", isActive: false },
    ]));
    registerWarehouseRoutes(app, { warehouseService });

    const list = await app.inject({ method: "GET", url: "/admin/warehouses?includeInactive=true" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(3);

    const updated = await app.inject({
      method: "PATCH",
      url: "/admin/warehouses/wh-1",
      payload: { name: "Main warehouse", isActive: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: "wh-1", code: "WH-01", name: "Main warehouse", isActive: false, isPlaceholder: false });

    const activeOnly = await app.inject({ method: "GET", url: "/admin/warehouses" });
    expect(activeOnly.statusCode).toBe(200);
    expect(activeOnly.json()).toEqual([
      expect.objectContaining({ id: "wh-2", isActive: true }),
    ]);
  });
});
