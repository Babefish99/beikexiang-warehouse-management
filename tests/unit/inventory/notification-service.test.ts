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
        id: "low-stock-item-1",
        kind: "LOW_STOCK",
        title: "Low stock: Tea",
        description: "Tea is below minimum stock: 1 / 3 remaining.",
        href: "/admin/items",
        priority: 1,
      },
      {
        id: "pending-outbound",
        kind: "PENDING_OUTBOUND",
        title: "Pending outbound approvals",
        description: "2 pending outbound approvals require confirmation.",
        href: "/admin/outbound/pending",
        priority: 1,
      },
      {
        id: "anomaly",
        kind: "ANOMALY",
        title: "Stocktake anomalies detected",
        description: "1 stocktake anomaly requires review.",
        href: "/admin/stocktake",
        priority: 1,
      },
      {
        id: "stocktake",
        kind: "STOCKTAKE",
        title: "Stocktake adjustments pending review",
        description: "1 stocktake adjustment is waiting for review.",
        href: "/admin/stocktake",
        priority: 2,
      },
      {
        id: "period-close-2026-08",
        kind: "PERIOD_CLOSE",
        title: "Current period ready to close",
        description: "Accounting period 2026-08 is open and should be reviewed for close.",
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
        description: expect.stringMatching(/1\s*\/\s*3/),
      }),
    ]);
  });
});
