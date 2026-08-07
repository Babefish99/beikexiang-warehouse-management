import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../../apps/api/src/server.js";
import type { WeComApprovalPayload } from "../../../apps/api/src/infrastructure/wecom/approval-parser.js";

async function createAdminSessionCookie(app: ReturnType<typeof buildServer>): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: "/auth/local?returnTo=/admin/inbound",
    remoteAddress: "127.0.0.1",
    headers: { host: "localhost:3001" },
  });
  return response.headers["set-cookie"] as string;
}

async function createItem(app: ReturnType<typeof buildServer>, cookie: string, payload: { code: string; name: string; unit: string; categoryId: string; weComOptionKey?: string }) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/items",
    headers: { cookie },
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>();
}

function mockApprovalDetail(detail: WeComApprovalPayload): void {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string"
      ? new URL(input)
      : input instanceof URL
        ? input
        : new URL(input.url);
    if (url.pathname.endsWith("/gettoken")) {
      return new Response(JSON.stringify({ access_token: "token-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname.endsWith("/getapprovaldetail")) {
      return new Response(JSON.stringify({ info: detail }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url.toString()}`);
  }));
}

function approvalDetail(): WeComApprovalPayload {
  return {
    sp_no: "202607230021",
    sp_status: 2,
    apply_time: 1784773140,
    applyer: { userid: "wx-1", name: "Tea Applicant", department: "Operations" },
    contents: [
      {
        control: "Table",
        value: {
          children: [
            {
              list: [
                { control: "Selector", value: { selector: { options: [{ key: "opt-tea", value: "Tea leaves" }] } } },
                { control: "Number", value: { new_number: { value: "2", unit: "box" } } },
              ],
            },
          ],
        },
      },
    ],
  };
}

describe("shared inventory memory state", () => {
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
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shows a synchronized approved approval in outbound pending and reuses opening stock in transfer, stocktake, and outbound options", async () => {
    mockApprovalDetail(approvalDetail());
    const app = buildServer();

    try {
      const cookie = await createAdminSessionCookie(app);
      const item = await createItem(app, cookie, {
        code: "TEA-0001",
        name: "Tea leaves",
        unit: "box",
        categoryId: "cat-tea",
        weComOptionKey: "opt-tea",
      });

      const openingStock = await app.inject({
        method: "POST",
        url: "/admin/opening-stock",
        headers: { cookie },
        payload: {
          verifiedBy: "admin",
          rows: [{ warehouseId: "warehouse-1", itemId: item.id, batchNo: "OPEN-01", quantity: "8", unitCost: "20", remark: "opening count" }],
        },
      });
      expect(openingStock.statusCode).toBe(201);

      const resync = await app.inject({
        method: "POST",
        url: "/admin/approvals/202607230021/resync",
        headers: { cookie },
      });
      expect(resync.statusCode).toBe(200);
      const approvalId = resync.json<{ approvalId: string }>().approvalId;

      const [pending, transfers, stocktake, outboundOptions] = await Promise.all([
        app.inject({ method: "GET", url: "/admin/outbound/pending", headers: { cookie } }),
        app.inject({ method: "GET", url: "/admin/transfers/options", headers: { cookie } }),
        app.inject({ method: "GET", url: "/admin/stocktake/options", headers: { cookie } }),
        app.inject({ method: "GET", url: `/admin/outbound/${approvalId}/options`, headers: { cookie } }),
      ]);

      expect(pending.statusCode).toBe(200);
      expect(pending.json()).toEqual([
        {
          id: approvalId,
          weComSpNo: "202607230021",
          status: "PENDING_OUTBOUND",
          lines: [{ id: `${approvalId}-line-1`, itemId: item.id, requestedQuantity: "2" }],
        },
      ]);
      expect(transfers.json()).toEqual({
        balances: [
          { warehouseId: "warehouse-1", itemId: item.id, batchId: openingStock.json<{ batchIds: string[] }>().batchIds[0], remainingQuantity: "8", unitCost: "20" },
        ],
      });
      expect(stocktake.json()).toEqual({
        balances: [
          { warehouseId: "warehouse-1", itemId: item.id, batchId: openingStock.json<{ batchIds: string[] }>().batchIds[0], bookQuantity: "8", unitCost: "20" },
        ],
      });
      expect(outboundOptions.statusCode).toBe(200);
      expect(outboundOptions.json()).toEqual({
        approvalId,
        batches: [
          { batchId: openingStock.json<{ batchIds: string[] }>().batchIds[0], warehouseId: "warehouse-1", itemId: item.id, remainingQuantity: "8", unitCost: "20" },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("shows outbound allocations in return options immediately after confirmation", async () => {
    mockApprovalDetail(approvalDetail());
    const app = buildServer();

    try {
      const cookie = await createAdminSessionCookie(app);
      const item = await createItem(app, cookie, {
        code: "TEA-0001",
        name: "Tea leaves",
        unit: "box",
        categoryId: "cat-tea",
        weComOptionKey: "opt-tea",
      });

      const openingStock = await app.inject({
        method: "POST",
        url: "/admin/opening-stock",
        headers: { cookie },
        payload: {
          verifiedBy: "admin",
          rows: [{ warehouseId: "warehouse-1", itemId: item.id, batchNo: "OPEN-01", quantity: "8", unitCost: "20", remark: "opening count" }],
        },
      });
      const batchId = openingStock.json<{ batchIds: string[] }>().batchIds[0];
      const resync = await app.inject({
        method: "POST",
        url: "/admin/approvals/202607230021/resync",
        headers: { cookie },
      });
      const approvalId = resync.json<{ approvalId: string }>().approvalId;
      const pending = await app.inject({ method: "GET", url: "/admin/outbound/pending", headers: { cookie } });
      const approvalLineId = pending.json<Array<{ lines: Array<{ id: string }> }>>()[0]?.lines[0]?.id;

      const confirm = await app.inject({
        method: "POST",
        url: "/admin/outbound/confirm",
        headers: { cookie },
        payload: {
          approvalId,
          allocations: [{ approvalLineId, warehouseId: "warehouse-1", batchId, quantity: "2" }],
        },
      });
      expect(confirm.statusCode).toBe(200);

      const returns = await app.inject({
        method: "GET",
        url: "/admin/returns/options",
        headers: { cookie },
      });

      expect(returns.statusCode).toBe(200);
      expect(returns.json()).toEqual({
        allocations: [
          {
            id: expect.any(String),
            outboundOrderId: expect.any(String),
            warehouseId: "warehouse-1",
            itemId: item.id,
            batchId,
            issuedQuantity: "2",
            remainingReturnableQuantity: "2",
            unitCost: "20",
          },
        ],
      });
    } finally {
      await app.close();
    }
  });
});
