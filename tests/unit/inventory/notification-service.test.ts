import { describe, expect, it } from "vitest";

import { NotificationService } from "../../../apps/api/src/application/inventory/notification-service.js";

describe("inventory notification service", () => {
  it("aggregates the administrator's actionable inventory notices", async () => {
    const service = new NotificationService({
      getPendingOutboundCount: async () => 2,
      listLowStock: async () => [{ itemId: "item-1", itemName: "Tea", totalQuantity: "1", minimumStock: "3" }],
      getPeriodStatus: async () => ({ code: "2026-08", status: "OPEN" }),
      getStocktakeNotice: async () => ({ count: 1, href: "/admin/stocktake" }),
      getAnomalyCount: async () => 1,
    });

    await expect(service.list()).resolves.toEqual([
      {
        id: "pending-outbound",
        kind: "PENDING_OUTBOUND",
        title: "待出库审批",
        description: "2 条已通过的领用审批待管理员确认出库。",
        href: "/admin/outbound/pending",
        priority: 1,
      },
      {
        id: "low-stock-item-1",
        kind: "LOW_STOCK",
        title: "库存预警：Tea",
        description: "Tea 当前库存 1，低于最低库存 3。",
        href: "/admin/items",
        priority: 1,
      },
      {
        id: "anomaly",
        kind: "ANOMALY",
        title: "盘点差异待处理",
        description: "1 条盘点差异需要处理。",
        href: "/admin/stocktake",
        priority: 1,
      },
      {
        id: "stocktake",
        kind: "STOCKTAKE",
        title: "盘点调整待复核",
        description: "1 条盘点调整记录等待复核。",
        href: "/admin/stocktake",
        priority: 2,
      },
      {
        id: "period-close-2026-08",
        kind: "PERIOD_CLOSE",
        title: "当前期间待结账",
        description: "记账期间 2026-08 尚未结账，请核对报表后处理。",
        href: "/admin/period-close",
        priority: 3,
      },
    ]);
  });

  it("returns no notices when every source is empty or closed", async () => {
    const service = new NotificationService({
      getPendingOutboundCount: async () => 0,
      listLowStock: async () => [],
      getPeriodStatus: async () => ({ code: "2026-08", status: "CLOSED" }),
      getStocktakeNotice: async () => ({ count: 0, href: "/admin/stocktake" }),
      getAnomalyCount: async () => 0,
    });

    await expect(service.list()).resolves.toEqual([]);
  });

  it("keeps low-stock descriptions explicit about the current and minimum values", async () => {
    const service = new NotificationService({
      getPendingOutboundCount: async () => 0,
      listLowStock: async () => [{ itemId: "item-1", itemName: "Tea", totalQuantity: "1", minimumStock: "3" }],
      getPeriodStatus: async () => ({ code: "2026-08", status: "CLOSED" }),
      getStocktakeNotice: async () => ({ count: 0, href: "/admin/stocktake" }),
      getAnomalyCount: async () => 0,
    });

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        kind: "LOW_STOCK",
        description: expect.stringMatching(/1.*3/),
      }),
    ]);
  });
});
