import { describe, expect, it, vi } from "vitest";

import { getStructuralSeedData, seedStructuralData } from "../../../prisma/seed.ts";

describe("structural database seed", () => {
  it("preserves operator-managed warehouse settings when structural data is reseeded", async () => {
    const warehouses = new Map([
      [
        "WH-01",
        {
          id: "legacy-warehouse-1",
          code: "WH-01",
          name: "集团二楼仓库",
          isPlaceholder: false,
          isActive: false,
        },
      ],
    ]);
    const warehouseUpsert = vi.fn(async ({
      where,
      update,
      create,
    }: {
      where: { code: string };
      update: Partial<{ id: string; code: string; name: string; isPlaceholder: boolean; isActive: boolean }>;
      create: { id: string; code: string; name: string; isPlaceholder: boolean; isActive: boolean };
    }) => {
      const existing = warehouses.get(where.code);
      warehouses.set(where.code, existing ? { ...existing, ...update } : create);
    });

    await seedStructuralData({
      role: { upsert: vi.fn().mockResolvedValue({}) },
      warehouse: { upsert: warehouseUpsert },
      itemCategory: { upsert: vi.fn().mockResolvedValue({}) },
    });

    expect(warehouses.get("WH-01")).toEqual({
      id: "warehouse-1",
      code: "WH-01",
      name: "集团二楼仓库",
      isPlaceholder: false,
      isActive: false,
    });
    expect(warehouses.get("WH-02")).toEqual({
      id: "warehouse-2",
      code: "WH-02",
      name: "待配置仓库二",
      isPlaceholder: true,
      isActive: true,
    });
  });

  it("matches structural rows by unique code while normalizing their stable ids", async () => {
    const roleUpsert = vi.fn().mockResolvedValue({});
    const warehouseUpsert = vi.fn().mockResolvedValue({});
    const categoryUpsert = vi.fn().mockResolvedValue({});

    await seedStructuralData({
      role: { upsert: roleUpsert },
      warehouse: { upsert: warehouseUpsert },
      itemCategory: { upsert: categoryUpsert },
    });

    const seedData = getStructuralSeedData();
    expect(roleUpsert).toHaveBeenCalledTimes(seedData.roles.length);
    expect(warehouseUpsert).toHaveBeenCalledTimes(seedData.warehouses.length);
    expect(categoryUpsert).toHaveBeenCalledTimes(seedData.categories.length);
    expect(roleUpsert.mock.calls.map(([call]) => call.where.code)).toEqual(["ADMIN", "FINANCE", "APPLICANT"]);
    expect(warehouseUpsert.mock.calls.map(([call]) => call.where.code)).toEqual(["WH-01", "WH-02", "WH-03"]);
    expect(categoryUpsert.mock.calls.map(([call]) => call.where.code)).toEqual([
      "CATEGORY_BJ",
      "CATEGORY_HJ",
      "CATEGORY_CY",
      "CATEGORY_WP",
    ]);
    expect(roleUpsert.mock.calls.map(([call]) => call.update.id)).toEqual(["role-admin", "role-finance", "role-applicant"]);
    expect(warehouseUpsert.mock.calls.map(([call]) => call.update.id)).toEqual(["warehouse-1", "warehouse-2", "warehouse-3"]);
    expect(categoryUpsert.mock.calls.map(([call]) => call.update.id)).toEqual([
      "category-bj",
      "category-hj",
      "category-cy",
      "category-wp",
    ]);
    expect(seedData.categories).toEqual([
      { id: "category-bj", code: "CATEGORY_BJ", prefix: "BJ", name: "白酒" },
      { id: "category-hj", code: "CATEGORY_HJ", prefix: "HJ", name: "红酒" },
      { id: "category-cy", code: "CATEGORY_CY", prefix: "CY", name: "茶饮" },
      { id: "category-wp", code: "CATEGORY_WP", prefix: "WP", name: "其他物品" },
    ]);
    expect(warehouseUpsert.mock.calls.every(([call]) => call.create.isPlaceholder)).toBe(true);
  });
});
