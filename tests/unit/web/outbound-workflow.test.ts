import { describe, expect, it } from "vitest";

import {
  isOutboundDraft,
  normalizeAllocations,
  outboundDraftKey,
  reconcileBatchOptions,
  summarizeOutbound,
  validateAllocationStep,
  validateReviewStep,
  type OutboundDraft,
} from "../../../apps/web/src/features/outbound/outbound-workflow";

const approval = {
  id: "approval-1",
  weComSpNo: "202608130001",
  status: "PENDING_OUTBOUND",
  lines: [{ id: "line-1", itemId: "item-1", requestedQuantity: "0.3" }],
} as const;

describe("outbound workflow", () => {
  it("supports multiple warehouses and batches with Decimal totals", () => {
    const summary = summarizeOutbound(approval, [
      { id: "a1", approvalLineId: "line-1", warehouseId: "wh-1", batchId: "b1", quantity: "0.1" },
      { id: "a2", approvalLineId: "line-1", warehouseId: "wh-2", batchId: "b2", quantity: "0.2" },
    ], [
      { batchId: "b1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "1", unitCost: "0.2" },
      { batchId: "b2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "1", unitCost: "0.3" },
    ]);

    expect(summary.actualQuantity).toBe("0.3");
    expect(summary.amount).toBe("0.08");
  });

  it("requires complete Decimal(18,4)-safe allocations without exceeding a line or batch", () => {
    expect(validateAllocationStep(approval, [
      { id: "a1", approvalLineId: "line-1", warehouseId: "", batchId: "", quantity: "" },
    ], [])).toEqual({ a1: "请选择仓库、批次并填写数量" });

    expect(validateAllocationStep(approval, [
      { id: "a1", approvalLineId: "line-1", warehouseId: "wh-1", batchId: "b1", quantity: "0.30001" },
    ], [{ batchId: "b1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "1", unitCost: "1" }])).toEqual({ a1: "数量必须为最多 14 位整数和 4 位小数的非负普通十进制数" });

    expect(validateAllocationStep(approval, [
      { id: "a1", approvalLineId: "line-1", warehouseId: "wh-1", batchId: "b1", quantity: "0.1" },
      { id: "a2", approvalLineId: "line-1", warehouseId: "wh-1", batchId: "b1", quantity: "0.3" },
    ], [{ batchId: "b1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "1", unitCost: "1" }])).toEqual({
      a1: "同一审批行的实际数量合计不能超过审批数量",
      a2: "同一审批行的实际数量合计不能超过审批数量",
    });

    expect(validateAllocationStep({ ...approval, lines: [{ ...approval.lines[0], requestedQuantity: "1" }] }, [
      { id: "a1", approvalLineId: "line-1", warehouseId: "wh-1", batchId: "b1", quantity: "0.2" },
      { id: "a2", approvalLineId: "line-1", warehouseId: "wh-1", batchId: "b1", quantity: "0.2" },
    ], [{ batchId: "b1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "0.35", unitCost: "1" }])).toEqual({
      a1: "同一批次的实际数量合计不能超过可用库存",
      a2: "同一批次的实际数量合计不能超过可用库存",
    });
  });

  it("requires a reason for partial and zero issue", () => {
    expect(validateReviewStep({ requestedQuantity: "2", actualQuantity: "1", amount: "20.00" }, "")).toEqual({ reason: "少出或零出必须填写原因" });
    expect(validateReviewStep({ requestedQuantity: "2", actualQuantity: "0", amount: "0.00" }, "")).toEqual({ reason: "少出或零出必须填写原因" });
    expect(validateReviewStep({ requestedQuantity: "2", actualQuantity: "2", amount: "40.00" }, "")).toEqual({});
  });

  it("omits zero rows from the server payload while preserving Decimal normalization", () => {
    expect(normalizeAllocations([
      { id: "zero", approvalLineId: "line-1", warehouseId: "wh-1", batchId: "b1", quantity: "0.0000" },
      { id: "issued", approvalLineId: "line-1", warehouseId: "wh-1", batchId: "b1", quantity: "01.2000" },
    ])).toEqual([{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "b1", quantity: "1.2" }]);
  });

  it("marks removed or reduced batches invalid without deleting other input", () => {
    const draft: OutboundDraft = {
      approvalId: "approval-1",
      step: "review",
      reason: "保留原因",
      allocations: [
        { id: "allocation-stale", approvalLineId: "line-1", warehouseId: "wh-1", batchId: "old-batch", quantity: "1" },
        { id: "allocation-over", approvalLineId: "line-1", warehouseId: "wh-2", batchId: "batch-2", quantity: "5" },
        { id: "allocation-valid", approvalLineId: "line-1", warehouseId: "wh-3", batchId: "batch-3", quantity: "1" },
      ],
    };
    const reconciled = reconcileBatchOptions(draft, [
      { batchId: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "4", unitCost: "20" },
      { batchId: "batch-3", warehouseId: "wh-3", itemId: "item-1", remainingQuantity: "4", unitCost: "20" },
    ]);

    expect(reconciled.invalidAllocationIds).toEqual(["allocation-stale", "allocation-over"]);
    expect(reconciled.draft.allocations).toEqual(draft.allocations);
    expect(reconciled.draft.reason).toBe("保留原因");
    expect(reconciled.draft.step).toBe("review");
  });

  it("isolates draft keys by encoded user and approval and rejects malformed runtime shapes", () => {
    expect(outboundDraftKey("user/a", "approval b")).toBe("warehouse.outbound.v1.user%2Fa.approval%20b");
    expect(isOutboundDraft({ approvalId: "a", step: "allocate", reason: "", allocations: [] })).toBe(true);
    expect(isOutboundDraft({ approvalId: "a", step: "forged", reason: "", allocations: [] })).toBe(false);
    expect(isOutboundDraft({ approvalId: "a", step: "review", reason: "", allocations: [{ id: "x" }] })).toBe(false);
  });
});
