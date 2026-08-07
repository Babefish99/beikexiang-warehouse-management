import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../../apps/api/src/server.js";
import { InMemoryAuditService } from "../../../apps/api/src/infrastructure/audit/audit-service.js";

async function createAdminSessionCookie(app: ReturnType<typeof buildServer>): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: "/auth/local?returnTo=/admin/items",
    remoteAddress: "127.0.0.1",
    headers: { host: "localhost:3001" },
  });
  return response.headers["set-cookie"] as string;
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
});
