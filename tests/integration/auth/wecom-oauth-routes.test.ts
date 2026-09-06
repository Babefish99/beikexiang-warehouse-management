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
    vi.stubEnv("WE_COM_ADMIN_IDS", "");
    vi.stubEnv("WE_COM_FINANCE_IDS", "");
    vi.stubEnv("SESSION_SECRET", "local-development-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("binds the callback to state issued when login starts and secures the HTTPS session cookie", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ UserId: "wx-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const app = buildServer();

    try {
      const metadata = await app.inject({ method: "GET", url: "/auth/wecom/authorize?returnTo=%2Fadmin%2Freports" });
      expect(metadata.statusCode).toBe(200);
      expect(metadata.headers["set-cookie"]).toBeUndefined();
      const entry = new URL(metadata.json().authorizeUrl);
      expect(entry.origin).toBe("https://warehouse-api.example.com");
      expect(entry.pathname).toBe("/auth/wecom/start");
      const authorize = await app.inject({ method: "GET", url: `${entry.pathname}${entry.search}` });
      const pendingCookie = firstSetCookie(authorize);
      const state = new URL(authorize.headers.location ?? "").searchParams.get("state");

      expect(authorize.statusCode).toBe(302);
      expect(state).toBeTruthy();
      expect(pendingCookie).toContain("wecom_oauth_state=");
      expect(pendingCookie).toContain("SameSite=Lax");
      expect(pendingCookie).toContain("Max-Age=600");
      expect(pendingCookie).toContain("Secure");
      expect(authorize.headers["cache-control"]).toBe("no-store");

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

  it("keeps the OAuth state cookie browser-compatible on local HTTP", async () => {
    vi.stubEnv("API_BASE_URL", "http://localhost:3001");
    vi.stubEnv("WEB_BASE_URL", "http://localhost:5173");
    const app = buildServer();

    try {
      const authorize = await app.inject({ method: "GET", url: "/auth/wecom/start?returnTo=%2F" });
      const pendingCookie = firstSetCookie(authorize);

      expect(authorize.statusCode).toBe(302);
      expect(pendingCookie).toContain("SameSite=Lax");
      expect(pendingCookie).not.toContain("Secure");
    } finally {
      await app.close();
    }
  });

  it("recognizes an HTTPS scheme regardless of configuration casing", async () => {
    vi.stubEnv("API_BASE_URL", "HTTPS://warehouse-api.example.com");
    const app = buildServer();

    try {
      const authorize = await app.inject({ method: "GET", url: "/auth/wecom/start?returnTo=%2F" });
      const pendingCookie = firstSetCookie(authorize);

      expect(authorize.statusCode).toBe(302);
      expect(pendingCookie).toContain("SameSite=Lax");
      expect(pendingCookie).toContain("Secure");
    } finally {
      await app.close();
    }
  });

  it("re-evaluates an existing session role after its WeCom user becomes an administrator", async () => {
    vi.stubEnv("WE_COM_ADMIN_IDS", "");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ UserId: "wx-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const app = buildServer();

    try {
      const authorize = await app.inject({ method: "GET", url: "/auth/wecom/start?returnTo=%2F" });
      const pendingCookie = firstSetCookie(authorize);
      const state = new URL(authorize.headers.location ?? "").searchParams.get("state");
      const callback = await app.inject({
        method: "GET",
        url: `/auth/wecom/callback?code=code-1&state=${encodeURIComponent(state ?? "")}`,
        headers: { cookie: cookiePair(pendingCookie, "wecom_oauth_state") },
      });
      const sessionCookie = cookiePair(firstSetCookie(callback), "warehouse_session");

      const applicantSession = await app.inject({ method: "GET", url: "/auth/session", headers: { cookie: sessionCookie } });
      expect(applicantSession.json()).toMatchObject({ user: { weComUserId: "wx-1", role: "APPLICANT" } });

      vi.stubEnv("WE_COM_ADMIN_IDS", "wx-1");

      const adminSession = await app.inject({ method: "GET", url: "/auth/session", headers: { cookie: sessionCookie } });
      expect(adminSession.json()).toMatchObject({ user: { weComUserId: "wx-1", role: "ADMIN" } });
    } finally {
      await app.close();
    }
  });

  it("revokes an existing administrator session when its WeCom user leaves the allowlist", async () => {
    vi.stubEnv("WE_COM_ADMIN_IDS", "wx-1");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ UserId: "wx-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const app = buildServer();

    try {
      const authorize = await app.inject({ method: "GET", url: "/auth/wecom/start?returnTo=%2F" });
      const pendingCookie = firstSetCookie(authorize);
      const state = new URL(authorize.headers.location ?? "").searchParams.get("state");
      const callback = await app.inject({
        method: "GET",
        url: `/auth/wecom/callback?code=code-1&state=${encodeURIComponent(state ?? "")}`,
        headers: { cookie: cookiePair(pendingCookie, "wecom_oauth_state") },
      });
      const sessionCookie = cookiePair(firstSetCookie(callback), "warehouse_session");

      vi.stubEnv("WE_COM_ADMIN_IDS", "");

      const revokedSession = await app.inject({ method: "GET", url: "/auth/session", headers: { cookie: sessionCookie } });
      const reports = await app.inject({ method: "GET", url: "/admin/reports/summary?period=2026-08", headers: { cookie: sessionCookie } });

      expect(revokedSession.json()).toMatchObject({ user: { weComUserId: "wx-1", role: "APPLICANT" } });
      expect(reports.statusCode).toBe(403);
      expect(reports.json()).toEqual({ error: "forbidden" });
    } finally {
      await app.close();
    }
  });

  it("rejects a callback without the matching browser state", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const app = buildServer();

    try {
      const authorize = await app.inject({ method: "GET", url: "/auth/wecom/start?returnTo=%2F" });
      const state = new URL(authorize.headers.location ?? "").searchParams.get("state");
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

  it("does not replace an in-flight login cookie when another tab loads login metadata", async () => {
    const app = buildServer();
    try {
      const start = await app.inject({ method: "GET", url: "/auth/wecom/start?returnTo=%2Fadmin%2Foutbound" });
      const pendingCookie = cookiePair(firstSetCookie(start), "wecom_oauth_state");
      const metadata = await app.inject({ method: "GET", url: "/auth/wecom/authorize?returnTo=%2F", headers: { cookie: pendingCookie } });
      expect(metadata.statusCode).toBe(200);
      expect(metadata.headers["set-cookie"]).toBeUndefined();
      expect(metadata.headers["cache-control"]).toBe("no-store");
      expect(new URL(metadata.json().authorizeUrl).searchParams.has("state")).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("issues a new state on every login start and rejects the superseded state", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const app = buildServer();
    try {
      const first = await app.inject({ method: "GET", url: "/auth/wecom/start" });
      const second = await app.inject({ method: "GET", url: "/auth/wecom/start" });
      const oldState = new URL(first.headers.location ?? "").searchParams.get("state");
      const newState = new URL(second.headers.location ?? "").searchParams.get("state");
      expect(oldState).toBeTruthy();
      expect(newState).not.toBe(oldState);
      const callback = await app.inject({
        method: "GET", url: `/auth/wecom/callback?code=stale-code&state=${encodeURIComponent(oldState ?? "")}`,
        headers: { cookie: cookiePair(firstSetCookie(second), "wecom_oauth_state") },
      });
      expect(callback.statusCode).toBe(400);
      expect(callback.json()).toEqual({ error: "invalid_oauth_state" });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("does not redirect or issue state when WeCom is not configured", async () => {
    vi.stubEnv("WE_COM_CORP_ID", "");
    const app = buildServer();
    try {
      const start = await app.inject({ method: "GET", url: "/auth/wecom/start" });
      expect(start.statusCode).toBe(503);
      expect(start.json()).toMatchObject({ error: "wecom_not_configured" });
      expect(start.headers["set-cookie"]).toBeUndefined();
      expect(start.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
