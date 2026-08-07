import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isLocalAuthEnabled } from "../../../apps/api/src/application/auth/local-auth.js";
import { SessionService } from "../../../apps/api/src/application/auth/session-service.js";
import { buildServer } from "../../../apps/api/src/server.js";
import { InMemoryAuditService } from "../../../apps/api/src/infrastructure/audit/audit-service.js";
import { registerLocalAuthRoutes } from "../../../apps/api/src/routes/auth/local-auth.js";

describe("local auth routes", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("API_BASE_URL", "http://localhost:3001");
    vi.stubEnv("WEB_BASE_URL", "http://localhost:5174");
    vi.stubEnv("WE_COM_CORP_ID", "wx-test-corp");
    vi.stubEnv("WE_COM_AGENT_ID", "1000001");
    vi.stubEnv("WE_COM_SECRET", "test-secret");
    vi.stubEnv("WE_COM_CALLBACK_TOKEN", "test-token");
    vi.stubEnv("WE_COM_ENCODING_AES_KEY", "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
    vi.stubEnv("SESSION_SECRET", "local-development-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates an ADMIN session and redirects for a loopback local login", async () => {
    vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
    const app = buildServer();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/auth/local?returnTo=/admin/items",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "localhost:3001",
        },
      });
      const setCookie = Array.isArray(response.headers["set-cookie"])
        ? response.headers["set-cookie"]
        : [response.headers["set-cookie"]];

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("http://localhost:5174/admin/items");
      expect(setCookie).toEqual(expect.arrayContaining([expect.stringContaining("warehouse_session=")]));
    } finally {
      await app.close();
    }
  });

  it.each([
    ["FINANCE", "/admin/reports"],
    ["APPLICANT", "/admin/items"],
  ] as const)(
    "creates a %s session when explicitly requested from a loopback local login",
    async (role, returnTo) => {
      vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
      const app = buildServer();

      try {
        const response = await app.inject({
          method: "GET",
          url: `/auth/local?returnTo=${encodeURIComponent(returnTo)}&role=${role}`,
          remoteAddress: "127.0.0.1",
          headers: {
            host: "localhost:3001",
          },
        });
        const cookie = Array.isArray(response.headers["set-cookie"])
          ? response.headers["set-cookie"][0]
          : response.headers["set-cookie"];
        const session = await app.inject({
          method: "GET",
          url: "/auth/session",
          headers: {
            cookie,
          },
        });

        expect(response.statusCode).toBe(302);
        expect(session.statusCode).toBe(200);
        expect(session.json()).toMatchObject({ user: { role } });
      } finally {
        await app.close();
      }
    },
  );

  it.each(["localhost:3001", "127.0.0.1:3001"])(
    "allows loopback local login from %s",
    async (host) => {
      vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
      const app = buildServer();

      try {
        const response = await app.inject({
          method: "GET",
          url: "/auth/local?returnTo=/admin/items",
          remoteAddress: "127.0.0.1",
          headers: {
            host,
          },
        });

        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe("http://localhost:5174/admin/items");
        expect(response.headers["set-cookie"]).toEqual(expect.stringContaining("warehouse_session="));
      } finally {
        await app.close();
      }
    },
  );

  it("does not expose or execute local login when the flag is disabled", async () => {
    vi.stubEnv("LOCAL_AUTH_BYPASS", "false");
    const app = buildServer();

    try {
      const metadata = await app.inject({ method: "GET", url: "/auth/wecom/authorize?returnTo=/" });
      const local = await app.inject({ method: "GET", url: "/auth/local", remoteAddress: "127.0.0.1" });

      expect(metadata.statusCode).toBe(200);
      expect(metadata.json()).toHaveProperty("authorizeUrl", expect.stringContaining("https://open.work.weixin.qq.com/wwopen/sso/qrConnect?"));
      expect(metadata.json()).not.toHaveProperty("localAuthUrl");
      expect(local.statusCode).toBe(404);
      expect(local.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("does not expose local auth in production even when the flag is true", async () => {
    const app = Fastify();
    registerLocalAuthRoutes(app, {
      enabled: isLocalAuthEnabled({ bypassEnabled: true, nodeEnv: "production" }),
      apiBaseUrl: "https://warehouse.example.com",
      webBaseUrl: "https://warehouse-web.example.com",
      sessionService: new SessionService("test-session-secret"),
      auditService: new InMemoryAuditService(),
    });

    try {
      const local = await app.inject({
        method: "GET",
        url: "/auth/local",
        remoteAddress: "127.0.0.1",
        headers: { host: "warehouse.example.com" },
      });

      expect(local.statusCode).toBe(404);
      expect(local.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("rejects non-loopback local login attempts", async () => {
    vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
    const app = buildServer();

    try {
      const metadata = await app.inject({ method: "GET", url: "/auth/wecom/authorize?returnTo=/reports" });
      const response = await app.inject({
        method: "GET",
        url: "/auth/local?returnTo=/admin/items",
        remoteAddress: "192.168.1.20",
      });

      expect(metadata.statusCode).toBe(200);
      expect(metadata.json()).toHaveProperty("localAuthUrl", "http://localhost:3001/auth/local?returnTo=%2Freports");
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "local_auth_unavailable" });
      expect(response.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("allows finance to read reports but blocks maintenance routes", async () => {
    vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
    const app = buildServer();

    try {
      const login = await app.inject({
        method: "GET",
        url: "/auth/local?returnTo=/admin/reports&role=FINANCE",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "localhost:3001",
        },
      });
      const cookie = Array.isArray(login.headers["set-cookie"])
        ? login.headers["set-cookie"][0]
        : login.headers["set-cookie"];
      const summary = await app.inject({
        method: "GET",
        url: "/admin/reports/summary?period=2026-08",
        headers: {
          cookie,
        },
      });
      const createItem = await app.inject({
        method: "POST",
        url: "/admin/items",
        headers: {
          cookie,
        },
        payload: {
          categoryId: "category-bj",
          categoryPrefix: "BJ",
          name: "Finance should not create this item",
          unit: "盒",
        },
      });

      expect(summary.statusCode).toBe(200);
      expect(createItem.statusCode).toBe(403);
      expect(createItem.json()).toEqual({ error: "forbidden" });
    } finally {
      await app.close();
    }
  });

  it("does not allow an applicant session to enter report or maintenance routes", async () => {
    vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
    const app = buildServer();

    try {
      const login = await app.inject({
        method: "GET",
        url: "/auth/local?returnTo=/admin/items&role=APPLICANT",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "localhost:3001",
        },
      });
      const cookie = Array.isArray(login.headers["set-cookie"])
        ? login.headers["set-cookie"][0]
        : login.headers["set-cookie"];
      const reports = await app.inject({
        method: "GET",
        url: "/admin/reports/summary?period=2026-08",
        headers: {
          cookie,
        },
      });
      const items = await app.inject({
        method: "GET",
        url: "/admin/items",
        headers: {
          cookie,
        },
      });

      expect(reports.statusCode).toBe(403);
      expect(items.statusCode).toBe(403);
      expect(reports.json()).toEqual({ error: "forbidden" });
      expect(items.json()).toEqual({ error: "forbidden" });
    } finally {
      await app.close();
    }
  });

  it("rejects loopback local login when Host is not allowed", async () => {
    vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
    const app = buildServer();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/auth/local?returnTo=/admin/items",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "attacker.example",
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "local_auth_unavailable" });
      expect(response.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
