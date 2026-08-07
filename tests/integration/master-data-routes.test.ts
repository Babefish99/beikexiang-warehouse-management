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

    const created = await app.inject({ method: "POST", url: "/admin/items", payload: { name: "茶叶", specification: "铁观音", unit: "盒", categoryId: "cat-tea", categoryPrefix: "CY", weComOptionKey: "opt-tea" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty("stockQuantity");

    const list = await app.inject({ method: "GET", url: "/admin/items?search=茶叶" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject([{ name: "茶叶", weComOptionKey: "opt-tea" }]);
  });

  it("lists active warehouses for selectors", async () => {
    const app = Fastify();
    const warehouseService = new WarehouseService(new InMemoryWarehouseRepository([
      { id: "wh-1", code: "WH-01", name: "招待物资库", isActive: true },
      { id: "wh-2", code: "WH-02", name: "综合仓库", isActive: true },
      { id: "wh-3", code: "WH-03", name: "历史仓库", isActive: false },
    ]));
    registerWarehouseRoutes(app, { warehouseService });

    const response = await app.inject({ method: "GET", url: "/admin/warehouses" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(2);
  });
});
