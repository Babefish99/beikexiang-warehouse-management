import { describe, expect, it } from "vitest";

import { createInventoryMemoryState } from "../../../apps/api/src/application/inventory/inventory-memory-state.js";
import { InMemoryOutboundStore, OutboundService } from "../../../apps/api/src/application/inventory/outbound-service.js";
import { ApprovalSyncService, InMemoryApprovalSyncStore } from "../../../apps/api/src/application/wecom/approval-sync-service.js";
import { HttpApprovalGateway } from "../../../apps/api/src/infrastructure/wecom/approval-gateway.js";
import { ApprovalParser } from "../../../apps/api/src/infrastructure/wecom/approval-parser.js";

describe("combined quantity approval synchronization", () => {
  it("exposes both unbound intent lines for outbound only after approval, without issuing stock", async () => {
    let approvalStatus = 1;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/gettoken")) return new Response(JSON.stringify({ access_token: "test-token" }));
      if (!url.pathname.endsWith("/getapprovaldetail")) throw new Error("unexpected upstream request");
      return new Response(JSON.stringify({ info: {
        sp_no: "202609070001", template_id: "tpl-intent-v2", sp_status: approvalStatus,
        apply_time: 1788760800, applyer: { userid: "test-applicant" },
        apply_data: { contents: [
          { control: "Textarea", title: [{ text: "用途", lang: "zh_CN" }], value: { text: "新流程验收，请勿实际出库" } },
          { control: "Table", title: [{ text: "物品明细", lang: "zh_CN" }], value: { children: [
            { list: [
              { control: "Text", title: [{ text: "意向物品名称", lang: "zh_CN" }], value: { text: "白酒" } },
              { control: "Text", title: [{ text: "审批数量及单位", lang: "zh_CN" }], value: { text: "2瓶" } },
              { control: "Text", title: [{ text: "补充要求", lang: "zh_CN" }], value: { text: "" } },
            ] },
            { list: [
              { control: "Text", title: [{ text: "意向物品名称", lang: "zh_CN" }], value: { text: "茶叶" } },
              { control: "Text", title: [{ text: "审批数量及单位", lang: "zh_CN" }], value: { text: "1盒" } },
              { control: "Text", title: [{ text: "补充要求", lang: "zh_CN" }], value: { text: "" } },
            ] },
          ] } },
        ] },
      } }));
    };
    const state = createInventoryMemoryState();
    const store = new InMemoryApprovalSyncStore(state);
    const outboundStore = new InMemoryOutboundStore(state);
    const outbound = new OutboundService(outboundStore);
    const service = new ApprovalSyncService({
      gateway: new HttpApprovalGateway({ corpId: "test-corp", secret: "test-secret", fetcher }),
      parser: new ApprovalParser(() => { throw new Error("intent must not bind an item"); }, "tpl-intent-v2"),
      store,
      approvalTemplateIds: ["tpl-intent-v2", "tpl-legacy"],
    });

    await expect(service.sync("202609070001")).resolves.toMatchObject({ created: true, status: "PENDING" });
    await expect(outbound.listPending()).resolves.toEqual([]);

    approvalStatus = 2;
    await expect(service.sync("202609070001")).resolves.toMatchObject({ created: false, status: "PENDING_OUTBOUND" });
    expect((await outbound.listPending())).toMatchObject([{
      weComSpNo: "202609070001", status: "PENDING_OUTBOUND", lines: [
        { requestedItemName: "白酒", requestedQuantity: "2", unit: "瓶", legacyResolutionStatus: "NOT_APPLICABLE" },
        { requestedItemName: "茶叶", requestedQuantity: "1", unit: "盒", legacyResolutionStatus: "NOT_APPLICABLE" },
      ],
    }]);
    const record = await store.findBySpNo("202609070001");
    expect(record?.lines.map((line) => line.itemId)).toEqual([undefined, undefined]);
    expect(outboundStore.ledger()).toEqual([]);
    expect(outboundStore.decisions()).toEqual([]);
  });
});
