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
        title: "Pending outbound approvals",
        description: `${pendingOutboundCount} pending outbound approval${pendingOutboundCount === 1 ? "" : "s"} require confirmation.`,
        href: "/admin/outbound/pending",
        priority: 1,
      });
    }

    for (const item of lowStockItems) {
      notifications.push({
        id: `low-stock-${item.itemId}`,
        kind: "LOW_STOCK",
        title: `Low stock: ${item.itemName}`,
        description: `${item.itemName} is below minimum stock: ${item.totalQuantity} / ${item.minimumStock} remaining.`,
        href: "/admin/items",
        priority: 1,
      });
    }

    if (anomalyCount > 0) {
      notifications.push({
        id: "anomaly",
        kind: "ANOMALY",
        title: "Stocktake anomalies detected",
        description: `${anomalyCount} stocktake anomal${anomalyCount === 1 ? "y requires" : "ies require"} review.`,
        href: stocktakeNotice.href,
        priority: 1,
      });
    }

    if (stocktakeNotice.count > 0) {
      notifications.push({
        id: "stocktake",
        kind: "STOCKTAKE",
        title: "Stocktake adjustments pending review",
        description: `${stocktakeNotice.count} stocktake adjustment${stocktakeNotice.count === 1 ? " is" : "s are"} waiting for review.`,
        href: stocktakeNotice.href,
        priority: 2,
      });
    }

    if (period.status === "OPEN") {
      notifications.push({
        id: `period-close-${period.code}`,
        kind: "PERIOD_CLOSE",
        title: "Current period ready to close",
        description: `Accounting period ${period.code} is open and should be reviewed for close.`,
        href: "/admin/period-close",
        priority: 3,
      });
    }

    return notifications.sort((left, right) => left.priority - right.priority || left.title.localeCompare(right.title));
  }
}
