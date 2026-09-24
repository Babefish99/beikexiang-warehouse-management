import { describe, expect, it } from "vitest";

import {
  filterDashboardInventoryItems,
  getDashboardInventoryCategory,
  getDashboardInventoryStatus,
  summariseDashboardMovements,
  type DashboardInventoryItem,
} from "../../../apps/web/src/features/dashboard/inventory-overview";

const items: DashboardInventoryItem[] = [
  { id: "baijiu", name: "茅台30年", specification: "500ml/瓶", unit: "瓶", categoryId: "category-bj", minimumStock: "6", stockQuantity: "12", isActive: true },
  { id: "tea", name: "普洱茶饼", specification: "357g/饼", unit: "饼", categoryId: "category-cy", minimumStock: "10", stockQuantity: "0", isActive: true },
  { id: "noodles", name: "盒装粉条", specification: "500g/盒", unit: "盒", categoryId: "category-wp", minimumStock: "3", stockQuantity: "5", isActive: true },
  { id: "other", name: "香烟", specification: "条", unit: "条", categoryId: "category-wp", minimumStock: null, stockQuantity: "2", isActive: true },
];

describe("dashboard inventory overview", () => {
  it("maps wine, tea and noodles without treating every other item as noodles", () => {
    expect(items.map(getDashboardInventoryCategory)).toEqual(["alcohol", "tea", "noodles", "other"]);
  });

  it("computes stockout and low-stock states while hiding inactive items", () => {
    expect(getDashboardInventoryStatus(items[0])).toBe("normal");
    expect(getDashboardInventoryStatus(items[1])).toBe("out");
    expect(getDashboardInventoryStatus({ ...items[2], stockQuantity: "2" })).toBe("low");
    expect(filterDashboardInventoryItems([...items, { ...items[0], id: "inactive", isActive: false }], { category: "all", status: "all", query: "" })).toHaveLength(4);
  });

  it("filters by category, status and item name or specification", () => {
    expect(filterDashboardInventoryItems(items, { category: "alcohol", status: "all", query: "" }).map((item) => item.id)).toEqual(["baijiu"]);
    expect(filterDashboardInventoryItems(items, { category: "noodles", status: "all", query: "" }).map((item) => item.id)).toEqual(["noodles"]);
    expect(filterDashboardInventoryItems(items, { category: "all", status: "out", query: "" }).map((item) => item.id)).toEqual(["tea"]);
    expect(filterDashboardInventoryItems(items, { category: "all", status: "all", query: "357g" }).map((item) => item.id)).toEqual(["tea"]);
  });

  it("sorts the full list and category results by current stock descending", () => {
    expect(filterDashboardInventoryItems(items, { category: "all", status: "all", query: "" }).map((item) => item.id)).toEqual([
      "baijiu",
      "noodles",
      "other",
      "tea",
    ]);
    expect(filterDashboardInventoryItems([
      ...items,
      { ...items[0], id: "baijiu-low", name: "低库存酒", stockQuantity: "3" },
    ], { category: "alcohol", status: "all", query: "" }).map((item) => item.id)).toEqual([
      "baijiu",
      "baijiu-low",
    ]);
  });

  it("summarises monthly inbound and outbound quantities by item", () => {
    expect(summariseDashboardMovements(
      [{ itemId: "tea", quantity: "12" }, { itemId: "tea", quantity: "3" }],
      [{ itemId: "tea", quantity: "-4" }, { itemId: "baijiu", quantity: "-2" }],
    )).toEqual({
      tea: { inbound: 15, outbound: 4 },
      baijiu: { inbound: 0, outbound: 2 },
    });
  });
});
