import { describe, expect, it, vi } from "vitest";

import { HttpApprovalGateway } from "../../../apps/api/src/infrastructure/wecom/approval-gateway.js";

describe("enterprise WeChat approval gateway", () => {
  it("gets a server-side access token and fetches approval detail", async () => {
    const detail = {
      sp_no: "202607230021",
      template_id: "tpl-approved-requisition",
      sp_status: 2,
      apply_time: 1784773140,
      applyer: { userid: "wx-1", partyid: 42 },
      apply_data: {
        contents: [
          { control: "Text", title: [{ text: "Purpose", lang: "en" }, { text: "用途", lang: "zh_CN" }], value: { text: "联调" } },
        ],
      },
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ info: detail }), { status: 200 }));
    const gateway = new HttpApprovalGateway({ corpId: "corp-1", secret: "secret-1", fetcher });

    await expect(gateway.fetchDetail("202607230021")).resolves.toEqual({
      sp_no: "202607230021",
      template_id: "tpl-approved-requisition",
      sp_status: 2,
      apply_time: 1784773140,
      applyer: { userid: "wx-1", name: "wx-1", department: "42" },
      department: "42",
      contents: [{ control: "Text", title: "用途", value: { text: "联调" } }],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("getapprovaldetail");
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ sp_no: "202607230021" }) });
  });

  it("does not expose access tokens in upstream error messages", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ errmsg: "invalid secret" }), { status: 401 }));
    const gateway = new HttpApprovalGateway({ corpId: "corp-1", secret: "secret-1", fetcher });

    await expect(gateway.fetchDetail("202607230021")).rejects.toThrow("enterprise WeChat token request failed");
  });
});
