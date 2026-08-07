import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../../apps/api/src/server.js";

async function createAdminSessionCookie(app: ReturnType<typeof buildServer>): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: "/auth/local?returnTo=/admin/reports",
    remoteAddress: "127.0.0.1",
    headers: { host: "localhost:3001" },
  });
  return response.headers["set-cookie"] as string;
}

describe("report export integration", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
    vi.stubEnv("API_BASE_URL", "http://localhost:3001");
    vi.stubEnv("WEB_BASE_URL", "http://localhost:5174");
    vi.stubEnv("SESSION_SECRET", "local-development-session-secret");
    vi.stubEnv("WE_COM_CORP_ID", "wx-test-corp");
    vi.stubEnv("WE_COM_AGENT_ID", "1000001");
    vi.stubEnv("WE_COM_SECRET", "test-secret");
    vi.stubEnv("WE_COM_CALLBACK_TOKEN", "test-token");
    vi.stubEnv("WE_COM_ENCODING_AES_KEY", "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("wires the report summary to the current in-memory stock ledger", async () => {
    const app = buildServer();

    try {
      const cookie = await createAdminSessionCookie(app);
      const createdItem = await app.inject({
        method: "POST",
        url: "/admin/items",
        headers: { cookie },
        payload: { code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea" },
      });
      const itemId = createdItem.json<{ id: string }>().id;

      const openingStock = await app.inject({
        method: "POST",
        url: "/admin/opening-stock",
        headers: { cookie },
        payload: {
          verifiedBy: "admin",
          rows: [{ warehouseId: "warehouse-1", itemId, batchNo: "B-001", quantity: "8", unitCost: "20", remark: "opening count" }],
        },
      });
      expect(openingStock.statusCode).toBe(201);

      const summary = await app.inject({
        method: "GET",
        url: "/admin/reports/summary?period=2026-08",
        headers: { cookie },
      });

      expect(summary.statusCode).toBe(200);
      expect(summary.json()).toEqual([{ itemId, quantity: "8", amount: "160.00" }]);
    } finally {
      await app.close();
    }
  });

  it("calculates month-end summary cumulatively while keeping transaction details in the requested month", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const app = buildServer();

    try {
      const cookie = await createAdminSessionCookie(app);
      const createdItem = await app.inject({
        method: "POST",
        url: "/admin/items",
        headers: { cookie },
        payload: { code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea" },
      });
      const itemId = createdItem.json<{ id: string }>().id;

      vi.setSystemTime(new Date("2026-07-31T10:00:00.000Z"));
      const openingStock = await app.inject({
        method: "POST",
        url: "/admin/opening-stock",
        headers: { cookie },
        payload: {
          verifiedBy: "admin",
          rows: [{ warehouseId: "warehouse-1", itemId, batchNo: "JULY-OPEN", quantity: "8", unitCost: "20", remark: "opening count" }],
        },
      });
      expect(openingStock.statusCode).toBe(201);

      vi.setSystemTime(new Date("2026-08-02T10:00:00.000Z"));
      const inbound = await app.inject({
        method: "POST",
        url: "/admin/inbound",
        headers: { cookie },
        payload: {
          warehouseId: "warehouse-1",
          itemId,
          batchNo: "AUG-001",
          quantity: "5",
          unitCost: "20",
          purchasedAt: "2026-08-02",
          purchaser: "buyer",
        },
      });
      expect(inbound.statusCode).toBe(201);

      const [summary, transactions] = await Promise.all([
        app.inject({
          method: "GET",
          url: "/admin/reports/summary?period=2026-08",
          headers: { cookie },
        }),
        app.inject({
          method: "GET",
          url: "/admin/reports/transactions?period=2026-08&type=all",
          headers: { cookie },
        }),
      ]);

      expect(summary.statusCode).toBe(200);
      expect(summary.json()).toEqual([{ itemId, quantity: "13", amount: "260.00" }]);
      expect(transactions.statusCode).toBe(200);
      expect(transactions.json()).toEqual([
        expect.objectContaining({ type: "INBOUND", quantity: "5", amount: "100.00" }),
      ]);
    } finally {
      await app.close();
    }
  });

  it("downloads an Excel-compatible UTF-8 BOM CSV export when workbook libraries are unavailable", async () => {
    const app = buildServer();

    try {
      const cookie = await createAdminSessionCookie(app);
      const createdItem = await app.inject({
        method: "POST",
        url: "/admin/items",
        headers: { cookie },
        payload: { code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea" },
      });
      const itemId = createdItem.json<{ id: string }>().id;

      await app.inject({
        method: "POST",
        url: "/admin/opening-stock",
        headers: { cookie },
        payload: {
          verifiedBy: "admin",
          rows: [{ warehouseId: "warehouse-1", itemId, batchNo: "B-001", quantity: "8", unitCost: "20", remark: "opening count" }],
        },
      });

      const response = await app.inject({
        method: "GET",
        url: "/admin/reports/export?period=2026-08&type=all",
        headers: { cookie },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/csv; charset=utf-8");
      expect(response.headers["content-disposition"]).toContain('attachment; filename="inventory-report-2026-08-all.csv"');
      expect(response.body.charCodeAt(0)).toBe(0xfeff);
      expect(response.body).toContain("类型");
      expect(response.body).toContain("数量");
      expect(response.body).toContain("金额");
      expect(response.body).toContain(itemId);
    } finally {
      await app.close();
    }
  });
});
