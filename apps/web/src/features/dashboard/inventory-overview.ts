export type DashboardInventoryCategory = "all" | "alcohol" | "tea" | "noodles" | "other";
export type DashboardInventoryStatus = "all" | "normal" | "low" | "out";

export type DashboardInventoryItem = {
  id: string;
  name: string;
  specification: string;
  unit: string;
  categoryId: string;
  minimumStock: string | null;
  stockQuantity: string;
  isActive: boolean;
};

export type DashboardMovement = { inbound: number; outbound: number };
export type DashboardMovements = Record<string, DashboardMovement>;

export const dashboardCategoryLabels: Record<DashboardInventoryCategory, string> = {
  all: "全部品类",
  alcohol: "酒水",
  tea: "茶叶",
  noodles: "粉条",
  other: "其他",
};

export const dashboardStatusLabels: Record<DashboardInventoryStatus, string> = {
  all: "全部",
  normal: "正常",
  low: "低库存",
  out: "已缺货",
};

export function getDashboardInventoryCategory(item: Pick<DashboardInventoryItem, "categoryId" | "name">): Exclude<DashboardInventoryCategory, "all"> {
  if (item.categoryId === "category-bj" || item.categoryId === "category-hj") return "alcohol";
  if (item.categoryId === "category-cy") return "tea";
  if (/粉条/u.test(item.name)) return "noodles";
  return "other";
}

export function getDashboardInventoryStatus(item: Pick<DashboardInventoryItem, "stockQuantity" | "minimumStock">): Exclude<DashboardInventoryStatus, "all"> {
  const quantity = Number(item.stockQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return "out";
  const minimumStock = item.minimumStock == null ? 0 : Number(item.minimumStock);
  if (Number.isFinite(minimumStock) && minimumStock > 0 && quantity <= minimumStock) return "low";
  return "normal";
}

export function filterDashboardInventoryItems(
  items: DashboardInventoryItem[],
  filter: { category: DashboardInventoryCategory; status: DashboardInventoryStatus; query: string },
): DashboardInventoryItem[] {
  const query = filter.query.trim().toLocaleLowerCase("zh-CN");
  return items
    .filter((item) => item.isActive)
    .filter((item) => filter.category === "all" || getDashboardInventoryCategory(item) === filter.category)
    .filter((item) => filter.status === "all" || getDashboardInventoryStatus(item) === filter.status)
    .filter((item) => !query || `${item.name} ${item.specification}`.toLocaleLowerCase("zh-CN").includes(query))
    .sort((left, right) => {
      const statusPriority = { out: 0, low: 1, normal: 2 } as const;
      const statusDifference = statusPriority[getDashboardInventoryStatus(left)] - statusPriority[getDashboardInventoryStatus(right)];
      return statusDifference || left.name.localeCompare(right.name, "zh-CN");
    });
}

export function summariseDashboardMovements(
  inboundRows: Array<{ itemId: string; quantity: string }>,
  outboundRows: Array<{ itemId: string; quantity: string }>,
): DashboardMovements {
  const result: DashboardMovements = {};
  for (const row of inboundRows) {
    const current = result[row.itemId] ?? { inbound: 0, outbound: 0 };
    current.inbound += Math.abs(Number(row.quantity) || 0);
    result[row.itemId] = current;
  }
  for (const row of outboundRows) {
    const current = result[row.itemId] ?? { inbound: 0, outbound: 0 };
    current.outbound += Math.abs(Number(row.quantity) || 0);
    result[row.itemId] = current;
  }
  return result;
}
