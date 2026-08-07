import { describe, expect, it, vi } from "vitest";

import { getStructuralSeedData, seedStructuralData } from "../../../prisma/seed.ts";

describe("structural database seed", () => {
  it("upserts exactly the three warehouses and three categories", async () => {
    const warehouseUpsert = vi.fn().mockResolvedValue({});
    const categoryUpsert = vi.fn().mockResolvedValue({});

    await seedStructuralData({
      warehouse: { upsert: warehouseUpsert },
      itemCategory: { upsert: categoryUpsert },
    });

    const seedData = getStructuralSeedData();
    expect(warehouseUpsert).toHaveBeenCalledTimes(seedData.warehouses.length);
    expect(categoryUpsert).toHaveBeenCalledTimes(seedData.categories.length);
    expect(warehouseUpsert.mock.calls.every(([call]) => call.create.isPlaceholder)).toBe(true);
  });
});
