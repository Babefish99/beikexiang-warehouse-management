import { describe, expect, it, vi } from "vitest";

import { loadItemsWithStock, type StockedItemRow } from "../../../apps/web/src/features/inventory/item-stock-loader";

const baseItem: Omit<StockedItemRow, "stockQuantity"> = {
  id: "item-1",
  code: "BJ0003",
  name: "茅台30年",
  specification: "500ml/瓶",
  unit: "瓶",
  categoryId: "category-bj",
  minimumStock: "6",
  isActive: true,
};

describe("item stock loader", () => {
  it("uses the stock quantity already returned by the current item API", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ ...baseItem, stockQuantity: "12" }]), { status: 200 }));

    await expect(loadItemsWithStock({ apiBaseUrl: "https://warehouse.example", fetcher, includeInactive: true, warehouseId: "all" }))
      .resolves.toMatchObject([{ id: "item-1", stockQuantity: "12" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fills a missing stock field from the existing read-only inventory search API", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/admin/items?")) return new Response(JSON.stringify([baseItem]), { status: 200 });
      return new Response(JSON.stringify([{ itemId: "item-1", code: "BJ0003", totalQuantity: "12" }]), { status: 200 });
    });

    await expect(loadItemsWithStock({ apiBaseUrl: "https://warehouse.example", fetcher, includeInactive: true, warehouseId: "all" }))
      .resolves.toMatchObject([{ id: "item-1", stockQuantity: "12" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("/admin/reports/inventory-search?query=BJ0003&warehouseId=all");
  });

  it("does not turn a failed fallback query into a misleading zero", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).includes("/admin/items?")
      ? new Response(JSON.stringify([baseItem]), { status: 200 })
      : new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }));

    await expect(loadItemsWithStock({ apiBaseUrl: "https://warehouse.example", fetcher, includeInactive: true, warehouseId: "all" }))
      .rejects.toThrow("inventory quantity query failed");
  });
});
