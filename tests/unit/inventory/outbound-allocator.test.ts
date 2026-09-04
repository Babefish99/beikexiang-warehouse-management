import { describe, expect, it } from "vitest";

import {
  OutboundAllocator,
  type AllocationBatch,
  type AllocationLine,
  type OutboundDecisionInput,
  type SelectableOutboundItem,
} from "../../../apps/api/src/application/inventory/outbound-allocator.js";

const lines: AllocationLine[] = [
  { id: "line-wine", requestedQuantity: "2", unit: "瓶", legacyResolutionStatus: "NOT_APPLICABLE" },
  { id: "line-tea", requestedQuantity: "1", unit: "盒", legacyResolutionStatus: "NOT_APPLICABLE" },
];

const items: SelectableOutboundItem[] = [
  { id: "item-maotai", code: "BJ0002", name: "飞天茅台", unit: "　瓶　", isActive: true },
  { id: "item-brandy", code: "BJ0003", name: "白兰地", unit: "瓶", isActive: true },
  { id: "item-tea", code: "CY0001", name: "茶叶", unit: "盒", isActive: true },
  { id: "item-inactive", code: "OLD0001", name: "停用品", unit: "瓶", isActive: false },
];

const batches: AllocationBatch[] = [
  { id: "batch-a", warehouseId: "wh-1", itemId: "item-maotai", remainingQuantity: "1", unitCost: "20" },
  { id: "batch-b", warehouseId: "wh-2", itemId: "item-maotai", remainingQuantity: "1", unitCost: "22" },
  { id: "batch-tea", warehouseId: "wh-1", itemId: "item-tea", remainingQuantity: "1", unitCost: "8" },
];

function decision(input: Partial<OutboundDecisionInput> & Pick<OutboundDecisionInput, "approvalLineId">): OutboundDecisionInput {
  return { allocations: [], ...input };
}

function fullDecisions(): OutboundDecisionInput[] {
  return [
    decision({
      approvalLineId: "line-wine",
      selectedItemId: "item-maotai",
      allocations: [
        { warehouseId: "wh-1", batchId: "batch-a", quantity: "1" },
        { warehouseId: "wh-2", batchId: "batch-b", quantity: "1" },
      ],
    }),
    decision({
      approvalLineId: "line-tea",
      selectedItemId: "item-tea",
      allocations: [{ warehouseId: "wh-1", batchId: "batch-tea", quantity: "1" }],
    }),
  ];
}

describe("outbound decision allocator", () => {
  it("derives a partial order from two line decisions and emits no allocation for a zero decision", () => {
    const decisions = [
      decision({
        approvalLineId: "line-wine",
        selectedItemId: "item-maotai",
        allocations: [
          { warehouseId: "wh-1", batchId: "batch-a", quantity: "1" },
          { warehouseId: "wh-2", batchId: "batch-b", quantity: "1" },
        ],
      }),
      decision({ approvalLineId: "line-tea", varianceReason: "本项不再领用" }),
    ];

    const result = new OutboundAllocator().validate({ lines, items, batches, decisions });

    expect(result).toMatchObject({ status: "PARTIAL", totalQuantity: "2", amount: "42.00" });
    expect(result.decisions).toMatchObject([
      { approvalLineId: "line-wine", selectedItemId: "item-maotai", actualQuantity: "2" },
      { approvalLineId: "line-tea", actualQuantity: "0", varianceReason: "本项不再领用", allocations: [] },
    ]);
    expect(result.allocations).toHaveLength(2);
  });

  it("requires the decisions to contain the exact approval line ID set", () => {
    const allocator = new OutboundAllocator();
    expect(() => allocator.validate({ lines, items, batches, decisions: fullDecisions().slice(0, 1) })).toThrow("approval decision lines must exactly match approval lines");
    expect(() => allocator.validate({ lines, items, batches, decisions: [...fullDecisions(), decision({ approvalLineId: "line-foreign", varianceReason: "不出库" })] })).toThrow("approval decision lines must exactly match approval lines");
    expect(() => allocator.validate({ lines, items, batches, decisions: [fullDecisions()[0]!, fullDecisions()[0]!] })).toThrow("approval decision lines must exactly match approval lines");
  });

  it("rejects non-integer approved and allocation quantities", () => {
    const allocator = new OutboundAllocator();
    expect(() => allocator.validate({ lines: [{ ...lines[0]!, requestedQuantity: "1.5" }, lines[1]!], items, batches, decisions: fullDecisions() })).toThrow("approval quantity must be a positive integer");
    const decisions = fullDecisions();
    decisions[0]!.allocations[0]!.quantity = "0.5";
    expect(() => allocator.validate({ lines, items, batches, decisions })).toThrow("approval quantity must be a positive integer");
  });

  it("requires one active selected item for every positive decision", () => {
    const allocator = new OutboundAllocator();
    const withoutItem = fullDecisions();
    withoutItem[0]!.selectedItemId = undefined;
    expect(() => allocator.validate({ lines, items, batches, decisions: withoutItem })).toThrow("selected item is required for positive issue");
    const inactive = fullDecisions();
    inactive[0]!.selectedItemId = "item-inactive";
    expect(() => allocator.validate({ lines, items, batches, decisions: inactive })).toThrow("selected item must be active");
  });

  it("rejects batch items and units that do not match the selected item and approval unit", () => {
    const allocator = new OutboundAllocator();
    const mixedItems = fullDecisions();
    mixedItems[0]!.allocations[1] = { warehouseId: "wh-1", batchId: "batch-tea", quantity: "1" };
    expect(() => allocator.validate({ lines, items, batches, decisions: mixedItems })).toThrow("batch item does not match selected item");
    expect(() => allocator.validate({ lines: [{ ...lines[0]!, unit: "盒" }, lines[1]!], items, batches, decisions: fullDecisions() })).toThrow("selected item unit does not match approval unit");
  });

  it("rejects quantities above the approved line total or aggregated batch balance", () => {
    const allocator = new OutboundAllocator();
    const overIssued = fullDecisions();
    overIssued[0]!.allocations[0]!.quantity = "2";
    expect(() => allocator.validate({ lines, items, batches: [{ ...batches[0]!, remainingQuantity: "2" }, ...batches.slice(1)], decisions: overIssued })).toThrow("actual quantity exceeds approved quantity");
    const exhausted = fullDecisions();
    exhausted[0]!.allocations = [
      { warehouseId: "wh-1", batchId: "batch-a", quantity: "1" },
      { warehouseId: "wh-1", batchId: "batch-a", quantity: "1" },
    ];
    expect(() => allocator.validate({ lines, items, batches, decisions: exhausted })).toThrow("batch balance cannot become negative");
  });

  it("requires a variance reason for each short decision", () => {
    const decisions = fullDecisions();
    decisions[0]!.allocations = [{ warehouseId: "wh-1", batchId: "batch-a", quantity: "1" }];

    expect(() => new OutboundAllocator().validate({ lines, items, batches, decisions })).toThrow("variance reason is required for partial or zero issue");
  });

  it("rejects selected items, allocations, or omitted reasons on zero decisions", () => {
    const allocator = new OutboundAllocator();
    const selectedOnZero = fullDecisions();
    selectedOnZero[1] = decision({ approvalLineId: "line-tea", selectedItemId: "item-tea", varianceReason: "无库存" });
    expect(() => allocator.validate({ lines, items, batches, decisions: selectedOnZero })).toThrow("zero issue cannot select an item");
    const allocationOnZero = fullDecisions();
    allocationOnZero[1] = decision({ approvalLineId: "line-tea", allocations: [{ warehouseId: "wh-1", batchId: "batch-tea", quantity: "1" }], varianceReason: "无库存" });
    expect(() => allocator.validate({ lines, items, batches, decisions: allocationOnZero })).toThrow("selected item is required for positive issue");
    const noReason = fullDecisions();
    noReason[1] = decision({ approvalLineId: "line-tea" });
    expect(() => allocator.validate({ lines, items, batches, decisions: noReason })).toThrow("variance reason is required for partial or zero issue");
  });

  it("rejects locked legacy substitutions and batches that are missing or in another warehouse", () => {
    const allocator = new OutboundAllocator();
    const lockedLines = [{ ...lines[0]!, itemId: "item-maotai", legacyResolutionStatus: "EXACT_LOCKED" }, lines[1]!];
    const substituted = fullDecisions();
    substituted[0]!.selectedItemId = "item-brandy";
    expect(() => allocator.validate({ lines: lockedLines, items, batches, decisions: substituted })).toThrow("legacy approval line item cannot be substituted");
    const missing = fullDecisions();
    missing[0]!.allocations[0]!.batchId = "batch-missing";
    expect(() => allocator.validate({ lines, items, batches, decisions: missing })).toThrow("batch not found: batch-missing");
    const wrongWarehouse = fullDecisions();
    wrongWarehouse[0]!.allocations[0]!.warehouseId = "wh-9";
    expect(() => allocator.validate({ lines, items, batches, decisions: wrongWarehouse })).toThrow("batch does not belong to warehouse");
  });
});
