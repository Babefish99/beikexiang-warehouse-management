import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../../apps/api/src/server.js";

function firstSetCookie(response: { headers: Record<string, unknown> }): string | undefined {
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? String(value[0]) : typeof value === "string" ? value : undefined;
}

function cookiePair(header: string | undefined, name: string): string {
  const pair = header?.split(";").find((part) => part.trim().startsWith(`${name}=`))?.trim();
  if (!pair) throw new Error(`missing ${name} cookie`);
  return pair;
}

describe("enterprise WeChat OAuth routes", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PERSISTENCE_DRIVER", "memory");
    vi.stubEnv("LOCAL_AUTH_BYPASS", "false");
    vi.stubEnv("API_BASE_URL", "https://warehouse-api.example.com");
    vi.stubEnv("WEB_BASE_URL", "https://warehouse-web.example.com");
    vi.stubEnv("WE_COM_CORP_ID", "wx-test-corp");
    vi.stubEnv("WE_COM_AGENT_ID", "1000001");
    vi.stubEnv("WE_COM_SECRET", "test-secret");
    vi.stubEnv("SESSION_SECRET", "local-development-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("binds the callback to the browser state and secures the HTTPS session cookie", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ UserId: "wx-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const app = buildServer();

    try {
      const authorize = await app.inject({ method: "GET", url: "/auth/wecom/authorize?returnTo=%2Fadmin%2Freports" });
      const pendingCookie = firstSetCookie(authorize);
      const state = new URL(authorize.json().authorizeUrl).searchParams.get("state");

      expect(authorize.statusCode).toBe(200);
      expect(state).toBeTruthy();
      expect(pendingCookie).toContain("wecom_oauth_state=");
      expect(pendingCookie).toContain("Secure");

      const callback = await app.inject({
        method: "GET",
        url: `/auth/wecom/callback?code=code-1&state=${encodeURIComponent(state ?? "")}`,
        headers: { cookie: cookiePair(pendingCookie, "wecom_oauth_state") },
      });
      const sessionCookie = firstSetCookie(callback);

      expect(callback.statusCode).toBe(302);
      expect(callback.headers.location).toBe("https://warehouse-web.example.com/admin/reports");
      expect(sessionCookie).toContain("warehouse_session=");
      expect(sessionCookie).toContain("Secure");
    } finally {
      await app.close();
    }
  });

  it("rejects a callback without the matching browser state", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const app = buildServer();

    try {
      const authorize = await app.inject({ method: "GET", url: "/auth/wecom/authorize?returnTo=%2F" });
      const state = new URL(authorize.json().authorizeUrl).searchParams.get("state");
      const callback = await app.inject({
        method: "GET",
        url: `/auth/wecom/callback?code=attacker-code&state=${encodeURIComponent(state ?? "")}`,
      });

      expect(callback.statusCode).toBe(400);
      expect(callback.json()).toEqual({ error: "invalid_oauth_state" });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
