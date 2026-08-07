import { describe, expect, it } from "vitest";

import { InventoryReportService, TransactionReportService, type ReportEntry } from "../../../apps/api/src/application/reports/report-query-service.js";

const entries: ReportEntry[] = [
  { id: "1", occurredAt: "2026-08-01T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-1", type: "OPENING_BALANCE", quantity: "10", unitCost: "20", amount: "200.00", referenceType: "OPENING_STOCK" },
  { id: "2", occurredAt: "2026-08-02T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-1", type: "INBOUND", quantity: "5", unitCost: "22", amount: "110.00", referenceType: "INBOUND_ORDER" },
  { id: "3", occurredAt: "2026-08-03T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-1", type: "OUTBOUND", quantity: "-4", unitCost: "20", amount: "80.00", referenceType: "OUTBOUND_ORDER" },
  { id: "4", occurredAt: "2026-08-04T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-1", type: "TRANSFER_OUT", quantity: "-2", unitCost: "20", amount: "40.00", referenceType: "TRANSFER_ORDER" },
  { id: "5", occurredAt: "2026-08-04T00:00:00.000Z", warehouseId: "wh-2", itemId: "item-1", type: "TRANSFER_IN", quantity: "2", unitCost: "20", amount: "40.00", referenceType: "TRANSFER_ORDER" },
  { id: "6", occurredAt: "2026-08-05T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-1", type: "RETURN", quantity: "1", unitCost: "20", amount: "20.00", referenceType: "OUTBOUND_ALLOCATION" },
  { id: "7", occurredAt: "2026-08-06T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-1", type: "ADJUSTMENT", quantity: "-1", unitCost: "20", amount: "20.00", referenceType: "STOCK_ADJUSTMENT" },
];

describe("inventory report queries", () => {
  it("keeps quantity and amount separate and makes transfers net-neutral at group level", async () => {
    const service = new InventoryReportService(async () => entries);

    await expect(service.getSummary("2026-08")).resolves.toEqual([{ itemId: "item-1", quantity: "11", amount: "230.00" }]);
  });

  it("keeps transfer, return, and adjustment rows separately", async () => {
    const service = new TransactionReportService(async () => entries);

    await expect(service.getTransfers("2026-08")).resolves.toHaveLength(2);
    await expect(service.getReturns("2026-08")).resolves.toHaveLength(1);
    await expect(service.getAdjustments("2026-08")).resolves.toHaveLength(1);
  });
});
