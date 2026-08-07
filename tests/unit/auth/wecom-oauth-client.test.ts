import { describe, expect, it, vi } from "vitest";

import { WeComOAuthClient } from "../../../apps/api/src/infrastructure/wecom/oauth-client.js";

describe("enterprise WeChat OAuth client", () => {
  it("builds an authorization URL with a return state", () => {
    const client = new WeComOAuthClient({ corpId: "corp-1", agentId: "agent-1", secret: "secret", redirectUri: "https://warehouse.example.com/auth/callback" });
    const url = new URL(client.getAuthorizeUrl("/admin/reports"));

    expect(url.searchParams.get("appid")).toBe("corp-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://warehouse.example.com/auth/callback");
    expect(url.searchParams.get("state")).toBe(Buffer.from("/admin/reports").toString("base64url"));
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
