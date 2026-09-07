import { describe, expect, it, vi } from "vitest";

import { HttpApprovalGateway } from "../../../apps/api/src/infrastructure/wecom/approval-gateway.js";

describe("enterprise WeChat approval gateway", () => {
  it("normalizes localized titles inside every approval detail row", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "test-token" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ info: {
        sp_no: "202609070001", template_id: "tpl-intent-v2", sp_status: 1,
        apply_time: 1788760800, applyer: { userid: "test-applicant" },
        apply_data: { contents: [{
          control: "Table", title: [{ text: "物品明细", lang: "zh_CN" }],
          value: { children: [
            { list: [
              { control: "Text", title: [{ text: "Item", lang: "en" }, { text: "意向物品名称", lang: "zh_CN" }], value: { text: "白酒" } },
              { control: "Text", title: [{ text: "审批数量及单位", lang: "zh_CN" }], value: { text: "2瓶" } },
            ] },
            { list: [
              { control: "Text", title: "意向物品名称", value: { text: "茶叶" } },
              { control: "Text", title: [{ text: "审批数量及单位", lang: "zh_CN" }], value: { text: "1盒" } },
            ] },
          ] },
        }] },
      } })));
    const gateway = new HttpApprovalGateway({ corpId: "test-corp", secret: "test-secret", fetcher });

    expect((await gateway.fetchDetail("202609070001")).contents).toEqual([{
      control: "Table", title: "物品明细", value: { children: [
        { list: [
          { control: "Text", title: "意向物品名称", value: { text: "白酒" } },
          { control: "Text", title: "审批数量及单位", value: { text: "2瓶" } },
        ] },
        { list: [
          { control: "Text", title: "意向物品名称", value: { text: "茶叶" } },
          { control: "Text", title: "审批数量及单位", value: { text: "1盒" } },
        ] },
      ] },
    }]);
  });

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
