import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { InMemoryStocktakeStore, StocktakeService } from "../../../apps/api/src/application/inventory/stocktake-service.js";
import { InMemoryAccountingPeriodStore, PeriodCloseService } from "../../../apps/api/src/application/periods/period-close-service.js";
import { createAccountingPeriod } from "../../../apps/api/src/domain/periods/accounting-period.js";
import { registerStocktakeRoutes } from "../../../apps/api/src/routes/admin/stocktake.js";
import { registerPeriodCloseRoutes } from "../../../apps/api/src/routes/admin/period-close.js";
import { buildServer } from "../../../apps/api/src/server.js";

describe("stocktake and period close", () => {
  it("lists selectable stocktake balances and records an audited adjustment", async () => {
    const store = new InMemoryStocktakeStore();
    store.seedBalance({ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", unitCost: "20" });
    store.seedBalance({ warehouseId: "wh-2", itemId: "item-2", batchId: "batch-2", bookQuantity: "0", unitCost: "30" });
    const service = new StocktakeService(store);
    const period = createAccountingPeriod({ code: "2026-08" });

    await expect(service.listOptions()).resolves.toEqual({
      balances: [
        { warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", unitCost: "20" },
        { warehouseId: "wh-2", itemId: "item-2", batchId: "batch-2", bookQuantity: "0", unitCost: "30" },
      ],
    });
    await expect(service.record({ period, operatorId: "admin-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", actualQuantity: "8", reason: "盘亏破损" })).resolves.toMatchObject({ difference: "-2" });
    expect(store.balance("wh-1", "batch-1")?.bookQuantity).toBe("8");
    expect(store.adjustments()).toMatchObject([{ quantityDelta: "-2", bookQuantity: "10", actualQuantity: "8", reason: "盘亏破损" }]);
    await expect(service.record({ period, operatorId: "admin-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", actualQuantity: "8" })).rejects.toThrow("reason is required");
  });

  it("refuses to close with unresolved work and closes a clean period", async () => {
    const service = new PeriodCloseService();
    const period = createAccountingPeriod({ code: "2026-08" });

    await expect(service.close({ period, pendingOutboundCount: 1, unpostedAdjustmentCount: 0 })).rejects.toThrow("pending outbound items must be resolved");
    await expect(service.close({ period, pendingOutboundCount: 0, unpostedAdjustmentCount: 0 })).resolves.toMatchObject({ status: "CLOSED", code: "2026-08" });
  });

  it("rejects stocktake after closing the period even when the request claims it is open", async () => {
    const app = Fastify();
    const stocktakeStore = new InMemoryStocktakeStore();
    stocktakeStore.seedBalance({ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", unitCost: "20" });
    const periodStore = new InMemoryAccountingPeriodStore();
    const periodCloseService = new PeriodCloseService(periodStore);
    registerPeriodCloseRoutes(app, { periodCloseService });
    registerStocktakeRoutes(app, { stocktakeService: new StocktakeService(stocktakeStore, periodStore) });

    try {
      const closeResponse = await app.inject({
        method: "POST",
        url: "/admin/period-close",
        payload: { period: { code: "2026-08", status: "OPEN" }, pendingOutboundCount: 0, unpostedAdjustmentCount: 0 },
      });
      expect(closeResponse.statusCode).toBe(200);
      expect(closeResponse.json()).toMatchObject({ code: "2026-08", status: "CLOSED" });

      const stocktakeResponse = await app.inject({
        method: "POST",
        url: "/admin/stocktake",
        payload: {
          periodCode: "2026-08",
          period: { code: "2026-08", status: "OPEN" },
          warehouseId: "wh-1",
          itemId: "item-1",
          batchId: "batch-1",
          bookQuantity: "10",
          actualQuantity: "9",
          reason: "closed period attempt",
        },
      });

      expect(stocktakeResponse.statusCode).toBe(400);
      expect(stocktakeResponse.json()).toEqual({ error: "closed period: 2026-08" });
      expect(stocktakeStore.balance("wh-1", "batch-1")?.bookQuantity).toBe("10");
    } finally {
      await app.close();
    }
  });
});

describe("stocktake routes", () => {
  it("returns stocktake balances from the read endpoint", async () => {
    const app = Fastify();
    const store = new InMemoryStocktakeStore();
    store.seedBalance({ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", unitCost: "20" });
    registerStocktakeRoutes(app, { stocktakeService: new StocktakeService(store) });

    try {
      const response = await app.inject({ method: "GET", url: "/admin/stocktake/options" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        balances: [
          { warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", unitCost: "20" },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("rejects unauthenticated access to the stocktake read endpoint", async () => {
    const app = buildServer();

    try {
      const response = await app.inject({ method: "GET", url: "/admin/stocktake/options" });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    } finally {
      await app.close();
    }
  });
});
