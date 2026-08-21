export type InventorySearchLocation = {
  warehouseId: string;
  warehouseName: string;
  batchId: string;
  batchNo: string;
  quantity: string;
  unitCost: string;
  amount: string;
};

export type InventorySearchResult = {
  itemId: string;
  code: string;
  name: string;
  specification?: string;
  unit: string;
  totalQuantity: string;
  totalAmount: string;
  locations: InventorySearchLocation[];
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export async function searchInventory(input: {
  query: string;
  warehouseId: string;
  signal?: AbortSignal;
}): Promise<InventorySearchResult[]> {
  const params = new URLSearchParams({ query: input.query.trim(), warehouseId: input.warehouseId });
  const response = await fetch(`${apiBaseUrl}/admin/reports/inventory-search?${params}`, {
    credentials: "include",
    signal: input.signal,
  });
  if (!response.ok) throw new Error("库存查询加载失败");
  return response.json() as Promise<InventorySearchResult[]>;
}
