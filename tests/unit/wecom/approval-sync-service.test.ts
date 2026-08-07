import { describe, expect, it, vi } from "vitest";

import { ApprovalParser, type WeComApprovalPayload } from "../../../apps/api/src/infrastructure/wecom/approval-parser.js";
import { ApprovalSyncService, InMemoryApprovalSyncStore } from "../../../apps/api/src/application/wecom/approval-sync-service.js";

function makeDetail(status: number): WeComApprovalPayload {
  return {
    sp_no: "202607230021",
    sp_status: status,
    apply_time: 1784773140,
    applyer: { userid: "wx-1", name: "申请人", department: "行政部" },
    contents: [
      { control: "Text", title: "用途", value: { text: "外出考察" } },
      {
        control: "Table",
        value: {
          children: [{ list: [
            { control: "Selector", value: { selector: { options: [{ key: "opt-tea", value: "茶叶" }] } } },
            { control: "Number", value: { new_number: { value: "2", unit: "盒" } } },
          ] }],
        },
      },
    ],
  };
}

function makeService(detail: WeComApprovalPayload) {
  const gateway = { fetchDetail: vi.fn().mockResolvedValue(detail) };
  const store = new InMemoryApprovalSyncStore();
  const parser = new ApprovalParser((optionKey) => optionKey === "opt-tea" ? { id: "item-tea" } : undefined);
  return { gateway, store, service: new ApprovalSyncService({ gateway, parser, store }) };
}

describe("approval synchronization service", () => {
  it("creates one pending outbound record and reuses it on duplicate sync", async () => {
    const { gateway, store, service } = makeService(makeDetail(2));

    await expect(service.sync("202607230021")).resolves.toMatchObject({ created: true, status: "PENDING_OUTBOUND" });
    await expect(service.sync("202607230021")).resolves.toMatchObject({ created: false, status: "PENDING_OUTBOUND" });

    expect(gateway.fetchDetail).toHaveBeenCalledTimes(2);
    expect(store.records()).toHaveLength(1);
    expect(store.attempts()).toHaveLength(2);
  });

  it("updates rejected approvals without creating a pending outbound record", async () => {
    const { store, service } = makeService(makeDetail(3));

    await expect(service.sync("202607230021")).resolves.toMatchObject({ created: true, status: "REJECTED" });
    expect(store.records()[0]?.outboundStatus).toBe("NONE");
  });

  it("handles a callback by synchronizing its approval number", async () => {
    const { service } = makeService(makeDetail(2));

    await expect(service.handleCallback({ spNo: "202607230021" })).resolves.toBeUndefined();
  });

  it("keeps the fetched detail payload when parsing fails", async () => {
    const detail = makeDetail(2);
    const gateway = { fetchDetail: vi.fn().mockResolvedValue(detail) };
    const store = new InMemoryApprovalSyncStore();
    const parser = new ApprovalParser(() => undefined);
    const service = new ApprovalSyncService({ gateway, parser, store });

    await expect(service.sync("202607230021")).rejects.toThrow("unknown item option key: opt-tea");
    expect(store.attempts()[0]).toMatchObject({ status: "FAILED", payload: detail });
  });

  it("stores the callback payload alongside the fetched detail", async () => {
    const detail = makeDetail(2);
    const { store, service } = makeService(detail);
    const callbackPayload = { Event: "open_approval_change", SpNo: "202607230021" };

    await service.handleCallback({ spNo: "202607230021", rawPayload: callbackPayload });

    expect(store.attempts()[0]?.payload).toEqual({ callback: callbackPayload, detail });
  });
});
