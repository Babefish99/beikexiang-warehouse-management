import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthenticatedUser } from "../../application/auth/role-service.js";

interface WeComOAuthResponse {
  UserId?: string;
  DeviceId?: string;
  user_info?: { userid?: string; name?: string };
  errcode?: number;
  errmsg?: string;
}

export interface WeComOAuthClientOptions {
  corpId: string;
  agentId: string;
  secret: string;
  redirectUri: string;
  fetcher?: typeof fetch;
}

function safeReturnTo(value: string): string {
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://warehouse.invalid");
    return url.origin === "https://warehouse.invalid" && url.pathname.startsWith("/") ? value : "/";
  } catch {
    return "/";
  }
}

type OAuthStatePayload = { nonce: string; returnTo: string };

function encodeState(returnTo: string): string {
  const payload: OAuthStatePayload = {
    nonce: randomBytes(32).toString("base64url"),
    returnTo: safeReturnTo(returnTo),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeState(state: string): OAuthStatePayload | null {
  try {
    const payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as Partial<OAuthStatePayload>;
    if (typeof payload.nonce !== "string" || payload.nonce.length < 32 || typeof payload.returnTo !== "string") return null;
    return { nonce: payload.nonce, returnTo: safeReturnTo(payload.returnTo) };
  } catch {
    return null;
  }
}

export class WeComOAuthClient {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: WeComOAuthClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  getAuthorizeUrl(returnTo = "/"): string {
    if (!this.options.corpId.trim()) throw new Error("enterprise WeChat OAuth is not configured");
    const url = new URL("https://open.work.weixin.qq.com/wwopen/sso/qrConnect");
    url.searchParams.set("appid", this.options.corpId);
    url.searchParams.set("agentid", this.options.agentId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("state", encodeState(returnTo));
    return url.toString();
  }

  decodeReturnTo(state?: string): string {
    if (!state) return "/";
    const payload = decodeState(state);
    if (payload) return payload.returnTo;
    try {
      const returnTo = Buffer.from(state, "base64url").toString("utf8");
      return safeReturnTo(returnTo);
    } catch {
      return "/";
    }
  }

  validateState(state?: string, expectedState?: string): boolean {
    if (!state || !expectedState || !decodeState(state)) return false;
    const actual = Buffer.from(state, "utf8");
    const expected = Buffer.from(expectedState, "utf8");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async exchangeCode(code: string): Promise<{ weComUserId: string; name: string }> {
    if (!code.trim()) throw new Error("enterprise WeChat code is required");
    const tokenUrl = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
    tokenUrl.searchParams.set("corpid", this.options.corpId);
    tokenUrl.searchParams.set("corpsecret", this.options.secret);
    const tokenResponse = await this.fetcher(tokenUrl);
    const tokenData = await tokenResponse.json() as { access_token?: string; errcode?: number; errmsg?: string };
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.errmsg ?? "enterprise WeChat token request failed");

    const userUrl = new URL("https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo");
    userUrl.searchParams.set("access_token", tokenData.access_token);
    userUrl.searchParams.set("code", code);
    const userResponse = await this.fetcher(userUrl);
    const userData = await userResponse.json() as WeComOAuthResponse;
    const weComUserId = userData.UserId ?? userData.user_info?.userid;
    if (!userResponse.ok || !weComUserId) throw new Error(userData.errmsg ?? "enterprise WeChat user lookup failed");
    return { weComUserId, name: userData.user_info?.name ?? weComUserId };
  }
}

export function toAuthenticatedUser(input: { id: string; weComUserId: string; name: string; role: AuthenticatedUser["role"] }): AuthenticatedUser {
  return input;
}
