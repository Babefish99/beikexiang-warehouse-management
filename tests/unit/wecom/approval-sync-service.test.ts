import { describe, expect, it, vi } from "vitest";

import { createInventoryMemoryState } from "../../../apps/api/src/application/inventory/inventory-memory-state.js";
import { InMemoryOutboundStore, OutboundService } from "../../../apps/api/src/application/inventory/outbound-service.js";
import { ApprovalParser, type WeComApprovalPayload } from "../../../apps/api/src/infrastructure/wecom/approval-parser.js";
import { ApprovalSyncService, InMemoryApprovalSyncStore, deriveOutboundStatus } from "../../../apps/api/src/application/wecom/approval-sync-service.js";

function makeDetail(status: number, templateId = "tpl-approved-requisition"): WeComApprovalPayload {
  return {
    sp_no: "202607230021",
    template_id: templateId,
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

function makeService(detail: WeComApprovalPayload, approvalTemplateId = "tpl-approved-requisition") {
  const gateway = { fetchDetail: vi.fn().mockResolvedValue(detail) };
  const store = new InMemoryApprovalSyncStore();
  const parser = new ApprovalParser(
    (optionKey) => optionKey === "opt-tea" ? { id: "item-tea", name: "茶叶", unit: "盒", isActive: true } : undefined,
    "tpl-intent-v2",
  );
  return { gateway, store, service: new ApprovalSyncService({ gateway, parser, store, approvalTemplateIds: [approvalTemplateId] }) };
}

function makeIntentDetail(status = 2): WeComApprovalPayload {
  return {
    ...makeDetail(status, "tpl-intent-v2"),
    contents: [
      { control: "Text", title: "用途", value: { text: "外出考察" } },
      {
        control: "Table",
        value: {
          children: [{ list: [
            { control: "Text", title: "意向物品名称", value: { text: "户外茶具" } },
            { control: "Number", title: "审批数量", value: { new_number: { value: "2" } } },
            { control: "Text", title: "单位", value: { text: "套" } },
            { control: "Text", title: "补充要求", value: { text: "轻便" } },
          ] }],
        },
      },
    ],
  };
}

function parsedApproval(overrides: Partial<ReturnType<ApprovalParser["parse"]>> = {}): ReturnType<ApprovalParser["parse"]> {
  return {
    weComSpNo: "202607230021",
    status: "APPROVED",
    applicantUserId: "wx-1",
    applicantName: "Applicant",
    purpose: "Field visit",
    submittedAt: "2026-07-23T00:00:00.000Z",
    sourceTemplateId: "tpl-intent-v2",
    lines: [{
      requestedItemName: "Tea leaves",
      requestedQuantity: "2",
      unit: "box",
      note: "Green tea",
      legacyResolutionStatus: "NOT_APPLICABLE",
    }],
    ...overrides,
  };
}

describe("approval synchronization service", () => {
  it("persists a primary-template intent without binding a standard item", async () => {
    const detail = makeIntentDetail();
    const gateway = { fetchDetail: vi.fn().mockResolvedValue(detail) };
    const store = new InMemoryApprovalSyncStore();
    const parser = new ApprovalParser(() => undefined, "tpl-intent-v2");
    const service = new ApprovalSyncService({ gateway, parser, store, approvalTemplateIds: ["tpl-intent-v2", "tpl-selector-v1"] });

    await expect(service.sync(detail.sp_no)).resolves.toMatchObject({ status: "PENDING_OUTBOUND" });
    expect(store.records()[0]).toMatchObject({
      sourceTemplateId: "tpl-intent-v2",
      lines: [{
        requestedItemName: "户外茶具",
        requestedQuantity: "2",
        unit: "套",
        note: "轻便",
        legacyResolutionStatus: "NOT_APPLICABLE",
      }],
    });
    expect(store.records()[0]?.lines[0]?.itemId).toBeUndefined();
  });

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
    const parser = { parse: vi.fn().mockRejectedValue(new Error("approval form is malformed")) };
    const service = new ApprovalSyncService({ gateway, parser, store });

    await expect(service.sync("202607230021")).rejects.toThrow("approval form is malformed");
    expect(store.attempts()[0]).toMatchObject({ status: "FAILED", payload: detail });
  });

  it("rejects a fetched detail with a different template before parsing or saving", async () => {
    const detail = makeDetail(2, "tpl-unapproved");
    const gateway = { fetchDetail: vi.fn().mockResolvedValue(detail) };
    const parser = { parse: vi.fn() };
    const store = new InMemoryApprovalSyncStore();
    const service = new ApprovalSyncService({ gateway, parser, store, approvalTemplateIds: ["tpl-approved-requisition", "tpl-selector-v1"] });

    await expect(service.sync("202607230021")).rejects.toThrow("enterprise WeChat approval template is not allowed");

    expect(parser.parse).not.toHaveBeenCalled();
    expect(store.records()).toEqual([]);
    expect(store.attempts()).toMatchObject([{ status: "FAILED" }]);
    expect(store.attempts()[0]?.payload).toBeUndefined();
  });

  it("applies the template guard when a callback is synchronized", async () => {
    const detail = makeDetail(2, "tpl-unapproved");
    const { parser, store, service } = (() => {
      const gateway = { fetchDetail: vi.fn().mockResolvedValue(detail) };
      const parser = { parse: vi.fn() };
      const store = new InMemoryApprovalSyncStore();
      return { parser, store, service: new ApprovalSyncService({ gateway, parser, store, approvalTemplateIds: ["tpl-approved-requisition", "tpl-selector-v1"] }) };
    })();

    await expect(service.handleCallback({ spNo: "202607230021" })).rejects.toThrow("enterprise WeChat approval template is not allowed");

    expect(parser.parse).not.toHaveBeenCalled();
    expect(store.records()).toEqual([]);
    expect(store.attempts()[0]?.payload).toBeUndefined();
  });

  it("applies the template guard when an administrator re-synchronizes", async () => {
    const detail = makeDetail(2, "tpl-unapproved");
    const { parser, store, service } = (() => {
      const gateway = { fetchDetail: vi.fn().mockResolvedValue(detail) };
      const parser = { parse: vi.fn() };
      const store = new InMemoryApprovalSyncStore();
      return { parser, store, service: new ApprovalSyncService({ gateway, parser, store, approvalTemplateIds: ["tpl-approved-requisition", "tpl-selector-v1"] }) };
    })();

    await expect(service.sync("202607230021")).rejects.toThrow("enterprise WeChat approval template is not allowed");

    expect(parser.parse).not.toHaveBeenCalled();
    expect(store.records()).toEqual([]);
  });

  it("stores the callback payload alongside the fetched detail", async () => {
    const detail = makeDetail(2);
    const { store, service } = makeService(detail);
    const callbackPayload = { Event: "open_approval_change", SpNo: "202607230021" };

    await service.handleCallback({ spNo: "202607230021", rawPayload: callbackPayload });

    expect(store.attempts()[0]?.payload).toEqual({ callback: callbackPayload, detail });
  });

  it("makes an approved saved record visible to outbound pending when both stores share memory state", async () => {
    const sharedState = createInventoryMemoryState();
    const approvalStore = new InMemoryApprovalSyncStore(sharedState);
    const outboundService = new OutboundService(new InMemoryOutboundStore(sharedState));

    await approvalStore.save({
      id: "approval-202607230021",
      weComSpNo: "202607230021",
      status: "APPROVED",
      outboundStatus: "PENDING_OUTBOUND",
      applicantUserId: "wx-1",
      applicantName: "Tea Applicant",
      department: "ops",
      purpose: "field visit",
      submittedAt: "2026-08-07T00:00:00.000Z",
      lines: [
        {
          itemId: "item-tea",
          itemOptionKey: "opt-tea",
          requestedItemName: "Tea leaves",
          requestedQuantity: "2",
          unit: "box",
          legacyResolutionStatus: "EXACT_LOCKED",
        },
      ],
    });

    await expect(outboundService.listPending()).resolves.toEqual([
      {
        id: "approval-202607230021",
        weComSpNo: "202607230021",
        status: "PENDING_OUTBOUND",
        lines: [{
          id: "approval-202607230021-line-1",
          requestedItemName: "Tea leaves",
          itemId: "item-tea",
          requestedQuantity: "2",
          unit: "box",
          note: undefined,
          legacyResolutionStatus: "EXACT_LOCKED",
        }],
      },
    ]);
  });

  it.each(["COMPLETED", "PARTIALLY_ISSUED", "UNAVAILABLE", "VOIDED"] as const)("preserves the closed outbound status %s when an approved approval is re-synchronized", async (outboundStatus) => {
    const sharedState = createInventoryMemoryState();
    const outboundStore = new InMemoryOutboundStore(sharedState);
    outboundStore.seedApproval({
      id: "approval-202607230021",
      weComSpNo: "202607230021",
      status: outboundStatus,
      lines: [{ id: "line-1", itemId: "item-tea", requestedQuantity: "2" }],
    });
    const gateway = { fetchDetail: vi.fn().mockResolvedValue(makeDetail(2)) };
    const parser = new ApprovalParser((optionKey) => optionKey === "opt-tea" ? { id: "item-tea", name: "Tea leaves", unit: "盒", isActive: true } : undefined);
    const store = new InMemoryApprovalSyncStore(sharedState);
    const service = new ApprovalSyncService({ gateway, parser, store });

    await expect(service.sync("202607230021")).resolves.toMatchObject({ created: false, status: outboundStatus });
    await expect(store.findBySpNo("202607230021")).resolves.toMatchObject({ outboundStatus });
  });

  it("accepts a listed legacy template and persists its source template and exact-lock evidence", async () => {
    const detail = makeDetail(2, "tpl-selector-v1");
    const gateway = { fetchDetail: vi.fn().mockResolvedValue(detail) };
    const store = new InMemoryApprovalSyncStore();
    const parser = new ApprovalParser(
      (optionKey) => optionKey === "opt-tea" ? { id: "item-tea", name: "茶叶", unit: "盒", isActive: true } : undefined,
      "tpl-intent-v2",
    );
    const service = new ApprovalSyncService({
      gateway,
      parser,
      store,
      approvalTemplateIds: ["tpl-intent-v2", "tpl-selector-v1", "tpl-fixed-v1"],
    });

    await expect(service.sync(detail.sp_no)).resolves.toMatchObject({ status: "PENDING_OUTBOUND" });
    expect(store.records()[0]).toMatchObject({
      sourceTemplateId: "tpl-selector-v1",
      lines: [{
        requestedItemName: "茶叶",
        requestedQuantity: "2",
        unit: "盒",
        itemId: "item-tea",
        itemOptionKey: "opt-tea",
        legacyResolutionStatus: "EXACT_LOCKED",
      }],
    });
  });

  it("marks an approved legacy approval for reapplication when any line lacks exact evidence", async () => {
    const detail = makeDetail(2, "tpl-selector-v1");
    const gateway = { fetchDetail: vi.fn().mockResolvedValue(detail) };
    const store = new InMemoryApprovalSyncStore();
    const parser = new ApprovalParser(() => undefined, "tpl-intent-v2");
    const service = new ApprovalSyncService({ gateway, parser, store, approvalTemplateIds: ["tpl-intent-v2", "tpl-selector-v1"] });

    await expect(service.sync(detail.sp_no)).resolves.toMatchObject({ status: "REAPPLY_REQUIRED" });
    expect(store.records()[0]).toMatchObject({
      outboundStatus: "REAPPLY_REQUIRED",
      lines: [{ legacyResolutionStatus: "REAPPLY_REQUIRED" }],
    });
  });

  it("does not promote a legacy line when an exact-lock claim lacks selector evidence", async () => {
    const detail = makeDetail(2, "tpl-selector-v1");
    const gateway = { fetchDetail: vi.fn().mockResolvedValue(detail) };
    const store = new InMemoryApprovalSyncStore();
    const parser = { parse: vi.fn().mockResolvedValue(parsedApproval({
      sourceTemplateId: "tpl-selector-v1",
      lines: [{
        requestedItemName: "Tea leaves",
        requestedQuantity: "2",
        unit: "box",
        itemId: "item-tea",
        legacyResolutionStatus: "EXACT_LOCKED",
      }],
    })) };
    const service = new ApprovalSyncService({ gateway, parser, store, approvalTemplateIds: ["tpl-intent-v2", "tpl-selector-v1"] });

    await expect(service.sync(detail.sp_no)).resolves.toMatchObject({ status: "REAPPLY_REQUIRED" });
    expect(store.records()[0]?.lines[0]).toMatchObject({ legacyResolutionStatus: "REAPPLY_REQUIRED" });
    expect(store.records()[0]?.lines[0]?.itemId).toBeUndefined();
  });

  it("voids an unissued approval when Enterprise WeChat reports it revoked", async () => {
    const sharedState = createInventoryMemoryState();
    const store = new InMemoryApprovalSyncStore(sharedState);
    const parser = { parse: vi.fn()
      .mockResolvedValueOnce(parsedApproval())
      .mockResolvedValueOnce(parsedApproval({
        status: "REVOKED",
        lines: [{ requestedItemName: "Changed after revoke", requestedQuantity: "5", unit: "case", legacyResolutionStatus: "NOT_APPLICABLE" }],
      })) };
    const gateway = { fetchDetail: vi.fn().mockResolvedValue(makeDetail(2, "tpl-intent-v2")) };
    const service = new ApprovalSyncService({ gateway, parser, store, approvalTemplateIds: ["tpl-intent-v2"] });

    await service.sync("202607230021");
    await expect(service.sync("202607230021")).resolves.toMatchObject({ status: "VOIDED" });
    await expect(store.findBySpNo("202607230021")).resolves.toMatchObject({
      outboundStatus: "VOIDED",
      lines: [{ requestedItemName: "Tea leaves", requestedQuantity: "2", unit: "box", note: "Green tea" }],
    });
  });

  it("records a revocation exception after issue without rewriting immutable approval lines", async () => {
    const sharedState = createInventoryMemoryState();
    const originalLine = {
      id: "line-1",
      requestedItemName: "Original intent",
      requestedQuantity: "2",
      unit: "box",
      note: "Original note",
      itemId: "item-tea",
      itemOptionKey: "opt-tea",
      legacyResolutionStatus: "EXACT_LOCKED" as const,
    };
    sharedState.approvals.set("approval-202607230021", {
      id: "approval-202607230021",
      weComSpNo: "202607230021",
      sourceTemplateId: "tpl-selector-v1",
      syncStatus: "APPROVED",
      outboundStatus: "COMPLETED",
      applicantUserId: "wx-1",
      applicantName: "Applicant",
      purpose: "Field visit",
      submittedAt: "2026-07-23T00:00:00.000Z",
      lines: [originalLine],
    });
    sharedState.approvalsBySpNo.set("202607230021", "approval-202607230021");
    sharedState.issuedAllocations.set("allocation-1", {
      id: "allocation-1",
      outboundOrderId: "order-1",
      warehouseId: "warehouse-1",
      itemId: "item-tea",
      batchId: "batch-1",
      issuedQuantity: "2",
      unitCost: "10",
    });
    const parser = { parse: vi.fn().mockResolvedValue(parsedApproval({
      status: "REVOKED",
      sourceTemplateId: "tpl-selector-v1",
      lines: [{ requestedItemName: "Changed", requestedQuantity: "5", unit: "case", legacyResolutionStatus: "NOT_APPLICABLE" }],
    })) };
    const gateway = { fetchDetail: vi.fn().mockResolvedValue(makeDetail(4, "tpl-selector-v1")) };
    const store = new InMemoryApprovalSyncStore(sharedState);
    const service = new ApprovalSyncService({ gateway, parser, store, approvalTemplateIds: ["tpl-intent-v2", "tpl-selector-v1"] });

    await expect(service.sync("202607230021")).resolves.toMatchObject({ status: "REVOCATION_EXCEPTION" });
    expect(sharedState.approvals.get("approval-202607230021")).toMatchObject({
      outboundStatus: "REVOCATION_EXCEPTION",
      sourceTemplateId: "tpl-selector-v1",
      lines: [originalLine],
    });
    expect(sharedState.issuedAllocations.get("allocation-1")).toBeDefined();
  });

  it("preserves line IDs by index while an approval is still unprocessed", async () => {
    const sharedState = createInventoryMemoryState();
    const store = new InMemoryApprovalSyncStore(sharedState);
    const parser = { parse: vi.fn()
      .mockResolvedValueOnce(parsedApproval())
      .mockResolvedValueOnce(parsedApproval({ lines: [{ requestedItemName: "Updated intent", requestedQuantity: "3", unit: "box", legacyResolutionStatus: "NOT_APPLICABLE" }] })) };
    const gateway = { fetchDetail: vi.fn().mockResolvedValue(makeDetail(2, "tpl-intent-v2")) };
    const service = new ApprovalSyncService({ gateway, parser, store, approvalTemplateIds: ["tpl-intent-v2"] });

    await service.sync("202607230021");
    const originalLineId = sharedState.approvals.get("approval-202607230021")!.lines[0]!.id;
    await service.sync("202607230021");

    expect(sharedState.approvals.get("approval-202607230021")!.lines).toEqual([
      expect.objectContaining({ id: originalLineId, requestedItemName: "Updated intent", requestedQuantity: "3" }),
    ]);
  });

  it("rejects a duplicate approval number from a different allowed source template", async () => {
    const sharedState = createInventoryMemoryState();
    const store = new InMemoryApprovalSyncStore(sharedState);
    const parser = { parse: vi.fn()
      .mockResolvedValueOnce(parsedApproval())
      .mockResolvedValueOnce(parsedApproval({ sourceTemplateId: "tpl-selector-v1" })) };
    const gateway = { fetchDetail: vi.fn()
      .mockResolvedValueOnce(makeIntentDetail())
      .mockResolvedValueOnce(makeDetail(2, "tpl-selector-v1")) };
    const service = new ApprovalSyncService({ gateway, parser, store, approvalTemplateIds: ["tpl-intent-v2", "tpl-selector-v1"] });

    await service.sync("202607230021");
    await expect(service.sync("202607230021")).rejects.toThrow("approval source template does not match the existing record");
    await expect(store.findBySpNo("202607230021")).resolves.toMatchObject({
      sourceTemplateId: "tpl-intent-v2",
      lines: [{ requestedItemName: "Tea leaves" }],
    });
  });

  it("applies revocation status and line freezing at the default memory store save boundary", async () => {
    const store = new InMemoryApprovalSyncStore();
    await store.save({
      id: "approval-202607230021",
      ...parsedApproval(),
      outboundStatus: "COMPLETED",
    });

    await store.save({
      id: "approval-202607230021",
      ...parsedApproval({
        status: "REVOKED",
        lines: [{ requestedItemName: "Stale revoke line", requestedQuantity: "5", unit: "case", legacyResolutionStatus: "NOT_APPLICABLE" }],
      }),
      outboundStatus: "VOIDED",
    });

    expect(store.records()).toMatchObject([{
      outboundStatus: "REVOCATION_EXCEPTION",
      lines: [{ requestedItemName: "Tea leaves", requestedQuantity: "2", unit: "box", note: "Green tea" }],
    }]);
  });

  it("rejects source-template mixing at the default memory store save boundary", async () => {
    const store = new InMemoryApprovalSyncStore();
    await store.save({ id: "approval-202607230021", ...parsedApproval(), outboundStatus: "PENDING_OUTBOUND" });

    await expect(store.save({
      id: "approval-202607230021",
      ...parsedApproval({
        sourceTemplateId: "tpl-selector-v1",
        lines: [{
          requestedItemName: "Legacy exact item",
          requestedQuantity: "2",
          unit: "box",
          itemId: "item-tea",
          itemOptionKey: "opt-tea",
          legacyResolutionStatus: "EXACT_LOCKED",
        }],
      }),
      outboundStatus: "PENDING_OUTBOUND",
    })).rejects.toThrow("approval source template does not match the existing record");

    expect(store.records()).toMatchObject([{
      sourceTemplateId: "tpl-intent-v2",
      lines: [{ requestedItemName: "Tea leaves", legacyResolutionStatus: "NOT_APPLICABLE" }],
    }]);
  });
});

describe("approval outbound status derivation", () => {
  const intentLines = parsedApproval().lines;
  const exactLines = [{
    requestedItemName: "Tea leaves",
    requestedQuantity: "2",
    unit: "box",
    itemId: "item-tea",
    itemOptionKey: "opt-tea",
    legacyResolutionStatus: "EXACT_LOCKED" as const,
  }];

  it.each([[intentLines], [exactLines]])("makes an approved fully-resolved approval pending outbound", (lines) => {
    expect(deriveOutboundStatus({ approvalStatus: "APPROVED", existingOutboundStatus: "NONE", lines })).toBe("PENDING_OUTBOUND");
  });

  it("requires reapplication when any approved line is unresolved", () => {
    expect(deriveOutboundStatus({
      approvalStatus: "APPROVED",
      existingOutboundStatus: "NONE",
      lines: [...intentLines, { requestedItemName: "Unknown", requestedQuantity: "1", unit: "box", legacyResolutionStatus: "REAPPLY_REQUIRED" }],
    })).toBe("REAPPLY_REQUIRED");
  });

  it.each(["COMPLETED", "PARTIALLY_ISSUED", "UNAVAILABLE"] as const)("turns post-issue revocation from %s into an exception", (existingOutboundStatus) => {
    expect(deriveOutboundStatus({ approvalStatus: "REVOKED", existingOutboundStatus, lines: intentLines })).toBe("REVOCATION_EXCEPTION");
  });

  it.each(["VOIDED", "REVOCATION_EXCEPTION"] as const)("does not reopen terminal status %s", (existingOutboundStatus) => {
    expect(deriveOutboundStatus({ approvalStatus: "APPROVED", existingOutboundStatus, lines: intentLines })).toBe(existingOutboundStatus);
  });
});
