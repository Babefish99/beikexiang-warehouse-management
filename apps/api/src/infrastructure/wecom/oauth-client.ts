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

export class WeComOAuthClient {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: WeComOAuthClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  getAuthorizeUrl(returnTo = "/"): string {
    const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
    url.searchParams.set("appid", this.options.corpId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "snsapi_base");
    url.searchParams.set("state", Buffer.from(safeReturnTo(returnTo), "utf8").toString("base64url"));
    return `${url.toString()}#wechat_redirect`;
  }

  decodeReturnTo(state?: string): string {
    if (!state) return "/";
    try {
      const returnTo = Buffer.from(state, "base64url").toString("utf8");
      return safeReturnTo(returnTo);
    } catch {
      return "/";
    }
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
