import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../../apps/api/src/server.js";

async function createSessionCookie(app: ReturnType<typeof buildServer>, role: "ADMIN" | "FINANCE" | "APPLICANT" = "ADMIN"): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: `/auth/local?returnTo=/admin/reports&role=${role}`,
    remoteAddress: "127.0.0.1",
    headers: { host: "localhost:3001" },
  });
  return response.headers["set-cookie"] as string;
}

describe("inventory query report routes", () => {
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
    vi.unstubAllEnvs();
  });

  it("returns inventory search results for admin after creating opening stock", async () => {
    const app = buildServer();

    try {
      const cookie = await createSessionCookie(app, "ADMIN");
      const createdItem = await app.inject({
        method: "POST",
        url: "/admin/items",
        headers: { cookie },
        payload: { code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea" },
      });
      expect(createdItem.statusCode).toBe(201);
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
      const batchId = openingStock.json<{ batchIds: string[] }>().batchIds[0];

      const response = await app.inject({
        method: "GET",
        url: "/admin/reports/inventory-search?query=B-001&warehouseId=all",
        headers: { cookie },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        {
          itemId,
          code: "TEA-0001",
          name: "Tea leaves",
          specification: "Iron Goddess",
          unit: "box",
          totalQuantity: "8",
          totalAmount: "160.00",
          locations: [
            {
              warehouseId: "warehouse-1",
              warehouseName: "待配置仓库一",
              batchId,
              batchNo: "B-001",
              quantity: "8",
              unitCost: "20",
              amount: "160.00",
            },
          ],
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it("allows finance and rejects applicants for read-only inventory report endpoints", async () => {
    const app = buildServer();

    try {
      const financeCookie = await createSessionCookie(app, "FINANCE");
      const applicantCookie = await createSessionCookie(app, "APPLICANT");

      const [financeWarehouses, financeSearch, applicantWarehouses, applicantSearch] = await Promise.all([
        app.inject({ method: "GET", url: "/admin/reports/warehouses", headers: { cookie: financeCookie } }),
        app.inject({ method: "GET", url: "/admin/reports/inventory-search?query=warehouse&warehouseId=all", headers: { cookie: financeCookie } }),
        app.inject({ method: "GET", url: "/admin/reports/warehouses", headers: { cookie: applicantCookie } }),
        app.inject({ method: "GET", url: "/admin/reports/inventory-search?query=warehouse&warehouseId=all", headers: { cookie: applicantCookie } }),
      ]);

      expect(financeWarehouses.statusCode).toBe(200);
      expect(financeWarehouses.json()).toEqual([
        expect.objectContaining({ id: "warehouse-1", code: "WH-01", name: "待配置仓库一" }),
        expect.objectContaining({ id: "warehouse-2", code: "WH-02", name: "待配置仓库二" }),
        expect.objectContaining({ id: "warehouse-3", code: "WH-03", name: "待配置仓库三" }),
      ]);
      expect(financeSearch.statusCode).toBe(200);
      expect(financeSearch.json()).toEqual([]);
      expect(applicantWarehouses.statusCode).toBe(403);
      expect(applicantSearch.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
