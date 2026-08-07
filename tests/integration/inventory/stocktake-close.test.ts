import { describe, expect, it } from "vitest";

import { createAccountingPeriod } from "../../../apps/api/src/domain/periods/accounting-period.js";
import { PeriodCloseService } from "../../../apps/api/src/application/periods/period-close-service.js";
import { InMemoryStocktakeStore, StocktakeService } from "../../../apps/api/src/application/inventory/stocktake-service.js";

describe("stocktake and period close", () => {
  it("records a reasoned stocktake adjustment without overwriting book quantity", async () => {
    const store = new InMemoryStocktakeStore();
    const service = new StocktakeService(store);
    const period = createAccountingPeriod({ code: "2026-08" });

    await expect(service.record({ period, operatorId: "admin-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", actualQuantity: "8", reason: "破损" })).resolves.toMatchObject({ difference: "-2" });
    expect(store.adjustments()).toMatchObject([{ quantityDelta: "-2", reason: "破损" }]);
    await expect(service.record({ period, operatorId: "admin-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", actualQuantity: "8" })).rejects.toThrow("reason is required");
  });

  it("refuses to close with unresolved work and closes a clean period", async () => {
    const service = new PeriodCloseService();
    const period = createAccountingPeriod({ code: "2026-08" });

    await expect(service.close({ period, pendingOutboundCount: 1, unpostedAdjustmentCount: 0 })).rejects.toThrow("pending outbound items must be resolved");
    await expect(service.close({ period, pendingOutboundCount: 0, unpostedAdjustmentCount: 0 })).resolves.toMatchObject({ status: "CLOSED", code: "2026-08" });
  });
});
