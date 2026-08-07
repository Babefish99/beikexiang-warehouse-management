import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../../apps/api/src/server.js";

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
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
    const app = buildServer();

    try {
      const metadata = await app.inject({ method: "GET", url: "/auth/wecom/authorize?returnTo=/" });
      const local = await app.inject({ method: "GET", url: "/auth/local", remoteAddress: "127.0.0.1" });

      expect(metadata.statusCode).toBe(200);
      expect(metadata.json()).not.toHaveProperty("localAuthUrl");
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
