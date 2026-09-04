import type { LowStockItem } from "./alert-service.js";

export type InventoryNotificationKind = "PENDING_OUTBOUND" | "APPROVAL_EXCEPTION" | "LOW_STOCK" | "STOCKTAKE" | "PERIOD_CLOSE" | "ANOMALY";

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
  getApprovalExceptionCount(): Promise<number>;
}

export class NotificationService {
  constructor(private readonly dependencies: NotificationDependencies) {}

  async list(): Promise<InventoryNotification[]> {
    const [pendingOutboundCount, lowStockItems, period, stocktakeNotice, anomalyCount, approvalExceptionCount] = await Promise.all([
      this.dependencies.getPendingOutboundCount(),
      this.dependencies.listLowStock(),
      this.dependencies.getPeriodStatus(),
      this.dependencies.getStocktakeNotice(),
      this.dependencies.getAnomalyCount(),
      this.dependencies.getApprovalExceptionCount(),
    ]);

    const notifications: InventoryNotification[] = [];

    if (pendingOutboundCount > 0) {
      notifications.push({
        id: "pending-outbound",
        kind: "PENDING_OUTBOUND",
        title: "待出库审批",
        description: `${pendingOutboundCount} 条已通过的领用审批待管理员确认出库。`,
        href: "/admin/outbound",
        priority: 1,
      });
    }

    if (approvalExceptionCount > 0) {
      notifications.push({
        id: "approval-exception",
        kind: "APPROVAL_EXCEPTION",
        title: "审批撤销异常",
        description: `${approvalExceptionCount} 条已结案审批在企业微信被撤销，需要核查并按正式退库流程处理。`,
        href: "/admin/outbound",
        priority: 1,
      });
    }

    for (const item of lowStockItems) {
      notifications.push({
        id: `low-stock-${item.itemId}`,
        kind: "LOW_STOCK",
        title: `库存预警：${item.itemName}`,
        description: `${item.itemName} 当前库存 ${item.totalQuantity}，低于最低库存 ${item.minimumStock}。`,
        href: `/admin/inventory?query=${encodeURIComponent(item.itemCode)}`,
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
