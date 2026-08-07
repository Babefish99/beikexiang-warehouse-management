import { describe, expect, it, vi } from "vitest";

import { WeComOAuthClient } from "../../../apps/api/src/infrastructure/wecom/oauth-client.js";

describe("enterprise WeChat OAuth client", () => {
  it("rejects authorization URL generation when the Corp ID is missing", () => {
    const client = new WeComOAuthClient({ corpId: "", agentId: "agent-1", secret: "secret", redirectUri: "https://warehouse.example.com/auth/callback" });

    expect(() => client.getAuthorizeUrl("/"))
      .toThrow("enterprise WeChat OAuth is not configured");
  });

  it("builds a browser QR authorization URL with a return state", () => {
    const client = new WeComOAuthClient({ corpId: "corp-1", agentId: "agent-1", secret: "secret", redirectUri: "https://warehouse.example.com/auth/callback" });
    const url = new URL(client.getAuthorizeUrl("/admin/reports"));

    expect(url.origin).toBe("https://open.work.weixin.qq.com");
    expect(url.pathname).toBe("/wwopen/sso/qrConnect");
    expect(url.searchParams.get("appid")).toBe("corp-1");
    expect(url.searchParams.get("agentid")).toBe("agent-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://warehouse.example.com/auth/callback");
    expect(url.searchParams.get("state")).toBe(Buffer.from("/admin/reports").toString("base64url"));
  });

  it("rejects external and backslash-based return paths", () => {
    const client = new WeComOAuthClient({ corpId: "corp-1", agentId: "agent-1", secret: "secret", redirectUri: "https://warehouse.example.com/auth/callback" });

    expect(new URL(client.getAuthorizeUrl("//evil.example.com")).searchParams.get("state")).toBe(Buffer.from("/").toString("base64url"));
    expect(client.decodeReturnTo(Buffer.from("/\\evil.example.com").toString("base64url"))).toBe("/");
  });

  it("exchanges a code through token and user lookup", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ UserId: "wx-1" }), { status: 200 }));
    const client = new WeComOAuthClient({ corpId: "corp-1", agentId: "agent-1", secret: "secret", redirectUri: "https://warehouse.example.com/auth/callback", fetcher });

    await expect(client.exchangeCode("code-1")).resolves.toEqual({ weComUserId: "wx-1", name: "wx-1" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
