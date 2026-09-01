import type { WeComApprovalField, WeComApprovalPayload, WeComApprovalTable } from "./approval-parser.js";

export interface ApprovalGateway {
  fetchDetail(spNo: string): Promise<WeComApprovalPayload>;
}

interface ApprovalGatewayOptions {
  corpId: string;
  secret: string;
  fetcher?: typeof fetch;
}

interface LocalizedText {
  text?: string;
  lang?: string;
}

type RawApprovalContent =
  | Omit<WeComApprovalField, "title"> & { title?: string | LocalizedText[] }
  | Omit<WeComApprovalTable, "title"> & { title?: string | LocalizedText[] };

interface RawApprovalInfo {
  sp_no: string;
  template_id?: string;
  sp_status: number | string;
  apply_time: number | string;
  applyer: { userid: string; name?: string; partyid?: string | number; department?: string };
  department?: string;
  contents?: RawApprovalContent[];
  apply_data?: { contents?: RawApprovalContent[] };
}

function localizedTitle(title?: string | LocalizedText[]): string | undefined {
  if (typeof title === "string") return title;
  return title?.find((entry) => entry.lang === "zh_CN")?.text?.trim()
    || title?.find((entry) => entry.text?.trim())?.text?.trim();
}

function normalizeContent(content: RawApprovalContent): WeComApprovalField | WeComApprovalTable {
  return { ...content, title: localizedTitle(content.title) } as WeComApprovalField | WeComApprovalTable;
}

function normalizeDetail(info: RawApprovalInfo): WeComApprovalPayload {
  const department = info.department ?? info.applyer.department
    ?? (info.applyer.partyid === undefined ? undefined : String(info.applyer.partyid));
  return {
    sp_no: info.sp_no,
    template_id: info.template_id,
    sp_status: info.sp_status,
    apply_time: info.apply_time,
    applyer: {
      userid: info.applyer.userid,
      name: info.applyer.name?.trim() || info.applyer.userid,
      department,
    },
    department,
    contents: (info.contents ?? info.apply_data?.contents ?? []).map(normalizeContent),
  };
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
    const detailData = await detailResponse.json() as { info?: RawApprovalInfo };
    if (!detailResponse.ok || !detailData.info?.sp_no) throw new Error("enterprise WeChat approval detail request failed");
    return normalizeDetail(detailData.info);
  }
}
