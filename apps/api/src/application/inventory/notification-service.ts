import type { LowStockItem } from "./alert-service.js";

export type InventoryNotificationKind = "PENDING_OUTBOUND" | "LOW_STOCK" | "STOCKTAKE" | "PERIOD_CLOSE" | "ANOMALY";

export interface InventoryNotification {
  id: string;
  kind: InventoryNotificationKind;
  title: string;
  description: string;
  href: string;
  priority: number;
}

interface NotificationDependencies {
  getPendingOutboundCount(): Promise<number>;
  listLowStock(): Promise<LowStockItem[]>;
  getPeriodStatus(): Promise<{ code: string; status: "OPEN" | "CLOSED" }>;
  getStocktakeNotice(): Promise<{ count: number; href: string }>;
  getAnomalyCount(): Promise<number>;
}

export class NotificationService {
  constructor(private readonly dependencies: NotificationDependencies) {}

  async list(): Promise<InventoryNotification[]> {
    const [pendingOutboundCount, lowStockItems, period, stocktakeNotice, anomalyCount] = await Promise.all([
      this.dependencies.getPendingOutboundCount(),
      this.dependencies.listLowStock(),
      this.dependencies.getPeriodStatus(),
      this.dependencies.getStocktakeNotice(),
      this.dependencies.getAnomalyCount(),
    ]);

    const notifications: InventoryNotification[] = [];

    if (pendingOutboundCount > 0) {
      notifications.push({
        id: "pending-outbound",
        kind: "PENDING_OUTBOUND",
        title: "待出库审批",
        description: `${pendingOutboundCount} 条已通过的领用审批待管理员确认出库。`,
        href: "/admin/outbound/pending",
        priority: 1,
      });
    }

    for (const item of lowStockItems) {
      notifications.push({
        id: `low-stock-${item.itemId}`,
        kind: "LOW_STOCK",
        title: `库存预警：${item.itemName}`,
        description: `${item.itemName} 当前库存 ${item.totalQuantity}，低于最低库存 ${item.minimumStock}。`,
        href: "/admin/items",
        priority: 1,
      });
    }

    if (anomalyCount > 0) {
      notifications.push({
        id: "anomaly",
        kind: "ANOMALY",
        title: "盘点差异待处理",
        description: `${anomalyCount} 条盘点差异需要处理。`,
        href: stocktakeNotice.href,
        priority: 1,
      });
    }

    if (stocktakeNotice.count > 0) {
      notifications.push({
        id: "stocktake",
        kind: "STOCKTAKE",
        title: "盘点调整待复核",
        description: `${stocktakeNotice.count} 条盘点调整记录等待复核。`,
        href: stocktakeNotice.href,
        priority: 2,
      });
    }

    if (period.status === "OPEN") {
      notifications.push({
        id: `period-close-${period.code}`,
        kind: "PERIOD_CLOSE",
        title: "当前期间待结账",
        description: `记账期间 ${period.code} 尚未结账，请核对报表后处理。`,
        href: "/admin/period-close",
        priority: 3,
      });
    }

    return notifications.sort((left, right) => left.priority - right.priority || left.title.localeCompare(right.title));
  }
}
