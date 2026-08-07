import { describe, expect, it } from "vitest";

import { InMemoryWarehouseRepository, WarehouseService } from "../../../apps/api/src/application/warehouses/warehouse-service.js";

describe("warehouse service", () => {
  it("lists only active warehouses for operational selectors", async () => {
    const repository = new InMemoryWarehouseRepository([
      { id: "wh-1", code: "WH-01", name: "招待物资库", isActive: true },
      { id: "wh-2", code: "WH-02", name: "综合仓库", isActive: true },
      { id: "wh-3", code: "WH-03", name: "历史仓库", isActive: false },
    ]);
    const service = new WarehouseService(repository);

    await expect(service.listActive()).resolves.toEqual([
      { id: "wh-1", code: "WH-01", name: "招待物资库", isActive: true },
      { id: "wh-2", code: "WH-02", name: "综合仓库", isActive: true },
    ]);
  });
});
