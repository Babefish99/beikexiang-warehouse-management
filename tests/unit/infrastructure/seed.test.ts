import { describe, expect, it, vi } from "vitest";

import { getStructuralSeedData, seedStructuralData } from "../../../prisma/seed.ts";

describe("structural database seed", () => {
  it("upserts stable roles, warehouses, and categories by id", async () => {
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
    expect(roleUpsert.mock.calls.map(([call]) => call.where.id)).toEqual(["role-admin", "role-finance", "role-applicant"]);
    expect(warehouseUpsert.mock.calls.map(([call]) => call.where.id)).toEqual(["warehouse-1", "warehouse-2", "warehouse-3"]);
    expect(categoryUpsert.mock.calls.map(([call]) => call.where.id)).toEqual(["category-bj", "category-cy", "category-wp"]);
    expect(warehouseUpsert.mock.calls.every(([call]) => call.create.isPlaceholder)).toBe(true);
  });
});
