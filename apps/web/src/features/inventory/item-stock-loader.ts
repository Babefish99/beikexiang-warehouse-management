export type StockedItemRow = {
  id: string;
  code: string;
  name: string;
  specification?: string;
  aliases?: string[];
  unit: string;
  categoryId: string;
  weComOptionKey?: string;
  minimumStock?: string | null;
  stockQuantity: string;
  isActive: boolean;
};

type LegacyItemRow = Omit<StockedItemRow, "stockQuantity"> & { stockQuantity?: string };
type InventorySearchRow = { itemId: string; code: string; totalQuantity: string };
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const fallbackConcurrency = 6;

async function readJson<T>(response: Response, errorMessage: string): Promise<T> {
  if (!response.ok) throw new Error(errorMessage);
  return response.json() as Promise<T>;
}

export async function loadItemsWithStock(input: {
  apiBaseUrl: string;
  fetcher?: Fetcher;
  includeInactive: boolean;
  warehouseId: string;
}): Promise<StockedItemRow[]> {
  const fetcher = input.fetcher ?? fetch;
  const itemQuery = new URLSearchParams();
  if (input.includeInactive) itemQuery.set("includeInactive", "true");
  if (input.warehouseId !== "all") itemQuery.set("warehouseId", input.warehouseId);
  const itemSuffix = itemQuery.size ? `?${itemQuery.toString()}` : "";
  const items = await readJson<LegacyItemRow[]>(
    await fetcher(`${input.apiBaseUrl}/admin/items${itemSuffix}`, { credentials: "include" }),
    "item query failed",
  );
  if (items.every((item) => typeof item.stockQuantity === "string")) return items as StockedItemRow[];

  const resolved = [...items];
  for (let start = 0; start < items.length; start += fallbackConcurrency) {
    const chunk = items.slice(start, start + fallbackConcurrency);
    await Promise.all(chunk.map(async (item, offset) => {
      if (typeof item.stockQuantity === "string") return;
      const query = new URLSearchParams({ query: item.code, warehouseId: input.warehouseId });
      const results = await readJson<InventorySearchRow[]>(
        await fetcher(`${input.apiBaseUrl}/admin/reports/inventory-search?${query.toString()}`, { credentials: "include" }),
        "inventory quantity query failed",
      );
      const match = results.find((result) => result.itemId === item.id || result.code === item.code);
      resolved[start + offset] = { ...item, stockQuantity: match?.totalQuantity ?? "0" };
    }));
  }
  return resolved as StockedItemRow[];
}
