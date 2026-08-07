import type { WeComApprovalPayload } from "./approval-parser.js";

export interface ApprovalGateway {
  fetchDetail(spNo: string): Promise<WeComApprovalPayload>;
}

interface ApprovalGatewayOptions {
  corpId: string;
  secret: string;
  fetcher?: typeof fetch;
}

export class HttpApprovalGateway implements ApprovalGateway {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: ApprovalGatewayOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async fetchDetail(spNo: string): Promise<WeComApprovalPayload> {
    if (!/^\d{8,32}$/.test(spNo)) throw new Error("enterprise WeChat approval number is invalid");
    const tokenUrl = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
    tokenUrl.searchParams.set("corpid", this.options.corpId);
    tokenUrl.searchParams.set("corpsecret", this.options.secret);
    const tokenResponse = await this.fetcher(tokenUrl);
    const tokenData = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error("enterprise WeChat token request failed");

    const detailUrl = new URL("https://qyapi.weixin.qq.com/cgi-bin/oa/getapprovaldetail");
    detailUrl.searchParams.set("access_token", tokenData.access_token);
    const detailResponse = await this.fetcher(detailUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sp_no: spNo }),
    });
    const detailData = await detailResponse.json() as { info?: WeComApprovalPayload; sp_no?: string; sp_status?: number | string };
    if (!detailResponse.ok || !detailData.info?.sp_no) throw new Error("enterprise WeChat approval detail request failed");
    return detailData.info;
  }
}
