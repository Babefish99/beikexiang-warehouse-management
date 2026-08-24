import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAccountingPeriod } from "../../../apps/api/src/domain/periods/accounting-period.js";
import { buildServer } from "../../../apps/api/src/server.js";
import { InMemoryAuditService } from "../../../apps/api/src/infrastructure/audit/audit-service.js";
import { multipartPayload } from "../../helpers/multipart.js";
import { buildOpeningStockWorkbook } from "../../helpers/opening-stock-workbook.js";

async function createAdminSessionCookie(app: ReturnType<typeof buildServer>): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: "/auth/local?returnTo=/admin/items",
    remoteAddress: "127.0.0.1",
    headers: { host: "localhost:3001" },
  });
  return response.headers["set-cookie"] as string;
}

async function createSessionCookie(app: ReturnType<typeof buildServer>, role: "ADMIN" | "FINANCE" = "ADMIN"): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: `/auth/local?returnTo=/admin/notifications&role=${role}`,
    remoteAddress: "127.0.0.1",
    headers: { host: "localhost:3001" },
  });
  return response.headers["set-cookie"] as string;
}

async function configureFormalWarehouses(app: ReturnType<typeof buildServer>, cookie: string): Promise<void> {
  for (const [id, name] of [
    ["warehouse-1", "集团二楼仓库"],
    ["warehouse-2", "内区1号仓库"],
    ["warehouse-3", "1区车库后仓库"],
  ] as const) {
    const response = await app.inject({
      method: "PATCH",
      url: `/admin/warehouses/${id}`,
      headers: { cookie },
      payload: { name, isActive: true },
    });
    expect(response.statusCode).toBe(200);
  }
}

describe("admin mutation audit", () => {
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

  it("records a complete audit event for a successful admin item mutation", async () => {
    const app = buildServer();

    try {
      const cookie = await createAdminSessionCookie(app);
      const response = await app.inject({
        method: "POST",
        url: "/admin/items",
        headers: { cookie },
        payload: {
          code: "TEA-0001",
          name: "Tea leaves",
          unit: "box",
          categoryId: "cat-tea",
        },
      });

      expect(response.statusCode).toBe(201);
      const audit = ((app as unknown as { auditService?: InMemoryAuditService }).auditService?.events ?? []).find((event) => event.action === "ITEM_CREATED");
      expect(audit).toMatchObject({
        actorUserId: "local-admin",
        actorRole: "ADMIN",
        action: "ITEM_CREATED",
        entityType: "ITEM",
        entityId: response.json<{ id: string }>().id,
        requestId: expect.any(String),
        occurredAt: expect.any(String),
        status: "SUCCEEDED",
      });
    } finally {
      await app.close();
    }
  });

  it("returns 400 JSON and records a failed audit event for admin business validation errors", async () => {
    const app = buildServer();

    try {
      const cookie = await createAdminSessionCookie(app);
      const itemResponse = await app.inject({
        method: "POST",
        url: "/admin/items",
        headers: { cookie },
        payload: {
          code: "TEA-0001",
          name: "Tea leaves",
          unit: "box",
          categoryId: "cat-tea",
        },
      });
      const itemId = itemResponse.json<{ id: string }>().id;

      const response = await app.inject({
        method: "POST",
        url: "/admin/inbound",
        headers: { cookie },
        payload: {
          warehouseId: "warehouse-missing",
          itemId,
          batchNo: "B-01",
          quantity: "1",
          unitCost: "10",
          purchasedAt: "2026-08-07",
          session: "session-value",
          secret: "secret-value",
          token: "token-value",
          cookie: "cookie-value",
          password: "password-value",
          metadata: {
            session: "nested-session-value",
            secret: "nested-secret-value",
            token: "nested-token-value",
            cookie: "nested-cookie-value",
            password: "nested-password-value",
            note: "safe-value",
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "warehouse is inactive or not found" });
      const audit = ((app as unknown as { auditService?: InMemoryAuditService }).auditService?.events ?? []).find((event) => event.action === "INBOUND_CREATED" && event.status === "FAILED");
      expect(audit).toMatchObject({
        actorUserId: "local-admin",
        actorRole: "ADMIN",
        action: "INBOUND_CREATED",
        entityType: "INBOUND_ORDER",
        entityId: expect.any(String),
        requestId: expect.any(String),
        occurredAt: expect.any(String),
        status: "FAILED",
        errorMessage: "warehouse is inactive or not found",
      });
      expect(audit?.afterData).toMatchObject({
        warehouseId: "warehouse-missing",
        metadata: { note: "safe-value" },
      });
      for (const sensitiveField of ["session", "secret", "token", "cookie", "password"]) {
        expect(audit?.afterData).not.toHaveProperty(sensitiveField);
        expect(audit?.afterData).not.toHaveProperty(`metadata.${sensitiveField}`);
      }
    } finally {
      await app.close();
    }
  });

  it("returns unknown admin failures as a 500 JSON error", async () => {
    const app = buildServer();

    try {
      app.get("/admin/test-unknown-error", async () => {
        throw new Error("unexpected admin failure");
      });
      const cookie = await createAdminSessionCookie(app);
      const response = await app.inject({
        method: "GET",
        url: "/admin/test-unknown-error",
        headers: { cookie },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "unexpected admin failure" });
    } finally {
      await app.close();
    }
  });

  it("allows admins and rejects finance for inventory notifications", async () => {
    const app = buildServer();

    try {
      const [adminCookie, financeCookie] = await Promise.all([
        createSessionCookie(app, "ADMIN"),
        createSessionCookie(app, "FINANCE"),
      ]);

      const [adminResponse, financeResponse] = await Promise.all([
        app.inject({ method: "GET", url: "/admin/notifications", headers: { cookie: adminCookie } }),
        app.inject({ method: "GET", url: "/admin/notifications", headers: { cookie: financeCookie } }),
      ]);

      expect(adminResponse.statusCode).toBe(200);
      expect(adminResponse.json()).toEqual([
        expect.objectContaining({
          kind: "PERIOD_CLOSE",
          href: "/admin/period-close",
          priority: 3,
        }),
      ]);
      expect(financeResponse.statusCode).toBe(403);
      expect(financeResponse.json()).toEqual({ error: "forbidden" });
    } finally {
      await app.close();
    }
  });

  it("does not create or save a current period when notifications are read", async () => {
    const currentPeriodCode = new Date().toISOString().slice(0, 7);
    const periodStore = {
      get: vi.fn().mockReturnValue(undefined),
      getOrCreate: vi.fn((code: string) => createAccountingPeriod({ code })),
      save: vi.fn(),
    };
    const app = (buildServer as (options?: { periodStore?: typeof periodStore }) => ReturnType<typeof buildServer>)({ periodStore });

    try {
      const cookie = await createSessionCookie(app, "ADMIN");
      const response = await app.inject({
        method: "GET",
        url: "/admin/notifications",
        headers: { cookie },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        expect.objectContaining({
          id: `period-close-${currentPeriodCode}`,
          kind: "PERIOD_CLOSE",
          href: "/admin/period-close",
          priority: 3,
        }),
      ]);
      expect(periodStore.get).toHaveBeenCalledWith(currentPeriodCode);
      expect(periodStore.getOrCreate).not.toHaveBeenCalled();
      expect(periodStore.save).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("audits one successful opening-stock import without workbook or token data", async () => {
    const app = buildServer();

    try {
      const cookie = await createAdminSessionCookie(app);
      await configureFormalWarehouses(app, cookie);
      const file = await buildOpeningStockWorkbook();
      const previewBody = multipartPayload({
        file: {
          fileName: "期初库存.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: file,
        },
      });
      const preview = await app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/preview",
        headers: { cookie, ...previewBody.headers },
        payload: previewBody.payload,
      });
      const commitBody = multipartPayload({
        fields: {
          previewToken: preview.json<{ previewToken: string }>().previewToken,
          financeReviewer: "财务甲",
          confirmed: "true",
        },
        file: {
          fileName: "期初库存.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: file,
        },
      });

      const commit = await app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/commit",
        headers: { cookie, ...commitBody.headers },
        payload: commitBody.payload,
      });

      expect(commit.statusCode).toBe(201);
      const events = (
        (app as unknown as { auditService?: InMemoryAuditService }).auditService?.events ?? []
      ).filter((event) => event.action === "OPENING_STOCK_IMPORTED");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorUserId: "local-admin",
        action: "OPENING_STOCK_IMPORTED",
        entityType: "OPENING_STOCK_IMPORT",
        entityId: "INITIAL_OPENING_STOCK",
        status: "SUCCEEDED",
        afterData: {
          id: "INITIAL_OPENING_STOCK",
          fileSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          itemCount: 81,
          inventoryRowCount: 243,
          positiveRowCount: 1,
          zeroRowCount: 242,
          totalAmount: "20.00",
        },
      });
      const serialized = JSON.stringify(events[0]!.afterData);
      expect(serialized).not.toContain("previewToken");
      expect(serialized).not.toContain("PK");
      expect(serialized).not.toContain("测试物品 BJ0001");
      expect(serialized).not.toContain(file.toString("base64").slice(0, 24));
    } finally {
      await app.close();
    }
  });

  it("audits a failed opening-stock commit without sensitive multipart data", async () => {
    const app = buildServer();

    try {
      const cookie = await createAdminSessionCookie(app);
      await configureFormalWarehouses(app, cookie);
      const file = await buildOpeningStockWorkbook();
      const previewBody = multipartPayload({
        file: {
          fileName: "期初库存.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: file,
        },
      });
      const preview = await app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/preview",
        headers: { cookie, ...previewBody.headers },
        payload: previewBody.payload,
      });
      const commitBody = multipartPayload({
        fields: {
          previewToken: preview.json<{ previewToken: string }>().previewToken,
          financeReviewer: "财务甲",
          confirmed: "true",
        },
        file: {
          fileName: "期初库存.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.concat([file, Buffer.from([0])]),
        },
      });

      const commit = await app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/commit",
        headers: { cookie, ...commitBody.headers },
        payload: commitBody.payload,
      });

      expect(commit.statusCode).toBe(409);
      const events = (
        (app as unknown as { auditService?: InMemoryAuditService }).auditService?.events ?? []
      ).filter((event) => event.action === "OPENING_STOCK_IMPORTED");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        entityType: "OPENING_STOCK_IMPORT",
        status: "FAILED",
        errorMessage: "期初库存文件或系统状态已变化，请重新预览",
      });
      const serialized = JSON.stringify(events[0]!.afterData ?? null);
      expect(serialized).not.toContain("previewToken");
      expect(serialized).not.toContain("PK");
      expect(serialized).not.toContain("测试物品 BJ0001");
      expect(serialized).not.toContain(file.toString("base64").slice(0, 24));
    } finally {
      await app.close();
    }
  });
});
