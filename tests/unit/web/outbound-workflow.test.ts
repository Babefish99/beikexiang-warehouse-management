import { describe, expect, it } from "vitest";

import {
  changeDecisionItem,
  isOutboundDraft,
  normalizeDecisions,
  outboundDraftIndexKey,
  outboundDraftKey,
  reconcileOutboundOptions,
  searchCandidateItems,
  summarizeOutbound,
  validateDecisionStep,
  type OutboundDraft,
} from "../../../apps/web/src/features/outbound/outbound-workflow";
import { readSessionDraft } from "../../../apps/web/src/features/drafts/session-draft";

const approval = {
  id: "approval-1", weComSpNo: "202609040001", status: "PENDING_OUTBOUND",
  lines: [{ id: "line-wine", requestedItemName: "飞天茅台", requestedQuantity: "2", unit: "瓶", note: "宴请" }],
} as const;

const options = {
  approvalId: "approval-1",
  lines: [{ approvalLineId: "line-wine", items: [
    { id: "item-maotai", code: "W-001", name: "飞天茅台", unit: "瓶", isActive: true, availableQuantity: "8" },
    { id: "item-wine", code: "W-002", name: "普通白酒", unit: "瓶", isActive: true, availableQuantity: "4" },
  ] }],
  batches: [
    { batchId: "b1", warehouseId: "wh-1", itemId: "item-maotai", remainingQuantity: "4", unitCost: "100.005" },
    { batchId: "b2", warehouseId: "wh-2", itemId: "item-maotai", remainingQuantity: "4", unitCost: "10.005" },
  ],
} as const;

function draft(overrides: Partial<OutboundDraft> = {}): OutboundDraft {
  return {
    approvalId: "approval-1", step: "allocate",
    decisions: [{
      approvalLineId: "line-wine", selectedItemId: "item-maotai", zeroIssue: false, varianceReason: "",
      allocations: [
        { id: "a1", warehouseId: "wh-1", batchId: "b1", quantity: "1" },
        { id: "a2", warehouseId: "wh-2", batchId: "b2", quantity: "1" },
      ],
    }],
    ...overrides,
  };
}

function createStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); },
    clear: () => entries.clear(),
    key: (index) => [...entries.keys()][index] ?? null,
    get length() { return entries.size; },
  };
}

describe("outbound decision workflow", () => {
  it("rejects non-positive, decimal, or overlong allocation quantities", () => {
    for (const quantity of ["", "0", "-1", "1.5", "123456789012345"]) {
      const candidate = draft({ decisions: [{ ...draft().decisions[0]!, allocations: [{ id: "a1", warehouseId: "wh-1", batchId: "b1", quantity }] }] });
      expect(validateDecisionStep(approval, candidate.decisions, options)).toMatchObject({ a1: "数量必须为 1 到 14 位正整数" });
    }
  });

  it("requires one selected candidate item and a per-line reason when issued short", () => {
    const noItem = draft({ decisions: [{ ...draft().decisions[0]!, selectedItemId: "" }] });
    expect(validateDecisionStep(approval, noItem.decisions, options)).toMatchObject({ "line:line-wine": "请选择标准物品" });
    const short = draft({ decisions: [{ ...draft().decisions[0]!, allocations: [{ id: "a1", warehouseId: "wh-1", batchId: "b1", quantity: "1" }] }] });
    expect(validateDecisionStep(approval, short.decisions, options)).toMatchObject({ "reason:line-wine": "少出或零出必须填写原因" });
  });

  it("reports a duplicate decision even when both duplicate decisions are otherwise valid", () => {
    const decision = draft().decisions[0]!;
    expect(validateDecisionStep(approval, [decision, { ...decision, allocations: [...decision.allocations] }], options)).toEqual({
      "line:line-wine": "每个审批意向只能有一个出库决定",
    });
  });

  it("reports a missing decision without relying on an invalid allocation", () => {
    expect(validateDecisionStep(approval, [], options)).toEqual({
      "line:line-wine": "每个审批意向都需要出库决定",
    });
  });

  it("rejects a foreign decision even when every known approval line is valid", () => {
    const decisions = [...draft().decisions, {
      approvalLineId: "foreign-line", selectedItemId: "", zeroIssue: true, varianceReason: "该行不属于本审批", allocations: [],
    }];
    expect(validateDecisionStep(approval, decisions, options)).toEqual({
      "line:foreign-line": "出库决定不属于当前审批",
    });
  });

  it("requires zero issue to have no item or allocations and its own reason", () => {
    const zero = draft({ decisions: [{ ...draft().decisions[0]!, selectedItemId: "", zeroIssue: true, allocations: [], varianceReason: "无库存" }] });
    expect(validateDecisionStep(approval, zero.decisions, options)).toEqual({});
    expect(normalizeDecisions(zero.decisions)).toEqual([{ approvalLineId: "line-wine", allocations: [], varianceReason: "无库存" }]);
    const malformed = draft({ decisions: [{ ...draft().decisions[0]!, zeroIssue: true, varianceReason: "" }] });
    expect(validateDecisionStep(approval, malformed.decisions, options)).toMatchObject({
      "line:line-wine": "零出库不能选择标准物品或填写批次分配",
      "reason:line-wine": "少出或零出必须填写原因",
    });
  });

  it("clears a decision's allocations only when its selected item changes", () => {
    const decision = draft().decisions[0]!;
    expect(changeDecisionItem(decision, "item-maotai")).toEqual(decision);
    expect(changeDecisionItem(decision, "item-wine")).toEqual({ ...decision, selectedItemId: "item-wine", allocations: [] });
  });

  it("preserves text while marking selections and batches that became stale", () => {
    const current = draft({ step: "review", decisions: [{
      ...draft().decisions[0]!, selectedItemId: "item-removed", varianceReason: "保留原因",
      allocations: [{ id: "stale-batch", warehouseId: "wh-1", batchId: "removed", quantity: "1" }],
    }] });
    const reconciled = reconcileOutboundOptions(current, options);
    expect(reconciled.draft).toEqual(current);
    expect(reconciled.staleSelectedItemLineIds).toEqual(["line-wine"]);
    expect(reconciled.staleAllocationIds).toEqual(["stale-batch"]);
    expect(reconciled.draft.decisions[0]!.varianceReason).toBe("保留原因");
  });

  it("clears stale markers after restored options without changing user input", () => {
    const current = draft({ decisions: [{ ...draft().decisions[0]!, varianceReason: "保留原因" }] });
    const reconciled = reconcileOutboundOptions(current, options);
    expect(reconciled).toEqual({ draft: current, staleSelectedItemLineIds: [], staleAllocationIds: [] });
    expect(current.decisions[0]!.varianceReason).toBe("保留原因");
  });

  it("marks every allocation stale when their combined batch quantity no longer fits", () => {
    const current = draft({ decisions: [{ ...draft().decisions[0]!, allocations: [
      { id: "first", warehouseId: "wh-1", batchId: "b1", quantity: "3" },
      { id: "second", warehouseId: "wh-1", batchId: "b1", quantity: "2" },
    ] }] });

    expect(reconcileOutboundOptions(current, options).staleAllocationIds).toEqual(["first", "second"]);
  });

  it("uses the server candidate ranking semantics for local candidate search", () => {
    const candidates = [
      { id: "loose", code: "W-3", name: "茅台酒", unit: "瓶", isActive: true, availableQuantity: "1" },
      { id: "code", code: "FEITIAN-9", name: "白酒", unit: "瓶", isActive: true, availableQuantity: "1" },
      { id: "exact", code: "W-1", name: "飞天茅台", unit: "瓶", isActive: true, availableQuantity: "1" },
      { id: "other", code: "Z-1", name: "红酒", unit: "瓶", isActive: true, availableQuantity: "1" },
    ] as const;
    expect(searchCandidateItems(candidates, " 飞天茅台 ").map((item) => item.id)).toEqual(["exact", "code", "loose", "other"]);
    expect(searchCandidateItems(candidates, "").map((item) => item.id)).toEqual(["code", "exact", "loose", "other"]);
  });

  it("rounds each allocation amount before summing and retains immutable approval display data", () => {
    const summary = summarizeOutbound(approval, draft().decisions, options);
    expect(summary.amount).toBe("110.02");
    expect(summary.lines).toEqual([{
      approvalLineId: "line-wine", requestedItemName: "飞天茅台", requestedQuantity: "2", unit: "瓶", note: "宴请",
      selectedItemId: "item-maotai", actualQuantity: "2", difference: "0",
    }]);
  });

  it("normalizes only the confirm API fields and never accepts a v1 draft", () => {
    expect(normalizeDecisions(draft().decisions)).toEqual([{
      approvalLineId: "line-wine", selectedItemId: "item-maotai",
      allocations: [{ warehouseId: "wh-1", batchId: "b1", quantity: "1" }, { warehouseId: "wh-2", batchId: "b2", quantity: "1" }],
    }]);
    expect(outboundDraftKey("user/a", "approval b")).toBe("warehouse.outbound.v2.user%2Fa.approval%20b");
    expect(outboundDraftIndexKey("user/a")).toBe("warehouse.outbound.index.v2.user%2Fa");
    expect(isOutboundDraft({ approvalId: "a", step: "allocate", reason: "", allocations: [] })).toBe(false);
    expect(isOutboundDraft(draft())).toBe(true);
  });

  it("returns null for wrong-version, partial, corrupt, or prototype-shaped draft envelopes", () => {
    const storage = createStorage();
    const key = outboundDraftKey("admin", "approval-1");
    for (const raw of [
      JSON.stringify({ version: 1, userId: "admin", value: draft() }),
      JSON.stringify({ version: 2, userId: "admin" }),
      "{not json",
      '{"version":2,"userId":"admin","value":{"__proto__":{"polluted":true}}}',
    ]) {
      storage.setItem(key, raw);
      expect(readSessionDraft(storage, key, "admin", 2, isOutboundDraft)).toBeNull();
    }
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
