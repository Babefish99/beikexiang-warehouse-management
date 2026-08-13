import { describe, expect, it } from "vitest";
import {
  calculateInboundAmount,
  createInboundDraft,
  reconcileInboundDraft,
  resetInboundAfterSuccess,
  validateInboundDraft,
  type InboundDraft,
} from "../../../apps/web/src/features/inbound/inbound-form";

const validInbound: InboundDraft = {
  warehouseId: "wh-1",
  itemId: "item-1",
  batchNo: "B-001",
  quantity: "2",
  unitCost: "20",
  purchasedAt: "2026-08-13",
  purchaser: "仓库管理员",
  remark: "",
};

describe("inbound form", () => {
  it("creates an empty draft for today", () => {
    expect(createInboundDraft("2026-08-13")).toEqual({
      warehouseId: "",
      itemId: "",
      batchNo: "",
      quantity: "",
      unitCost: "",
      purchasedAt: "2026-08-13",
      purchaser: "",
      remark: "",
    });
  });

  it("uses Decimal for expected amount", () => {
    expect(calculateInboundAmount("0.1", "0.2")).toBe("0.02");
    expect(calculateInboundAmount("", "20")).toBeNull();
    expect(calculateInboundAmount("not-a-number", "20")).toBeNull();
  });

  it("requires every required field with precise validation errors", () => {
    expect(validateInboundDraft(createInboundDraft(""))).toEqual({
      warehouseId: "请选择仓库",
      itemId: "请选择物品",
      batchNo: "请输入批次号",
      quantity: "数量必须为正数",
      unitCost: "单价必须为非负数",
      purchasedAt: "请选择采购日期",
    });
  });

  it("rejects non-positive quantities and negative or non-numeric costs", () => {
    expect(validateInboundDraft({ ...validInbound, quantity: "0" })).toEqual({ quantity: "数量必须为正数" });
    expect(validateInboundDraft({ ...validInbound, quantity: "abc" })).toEqual({ quantity: "数量必须为正数" });
    expect(validateInboundDraft({ ...validInbound, unitCost: "-0.01" })).toEqual({ unitCost: "单价必须为非负数" });
  });

  it("requires a remark when cost is zero after numeric normalization", () => {
    expect(validateInboundDraft({ ...validInbound, unitCost: "0.00", remark: "  " })).toEqual({
      remark: "单价为 0 时必须填写备注",
    });
  });

  it("clears only invalid master-data references and preserves other fields", () => {
    expect(reconcileInboundDraft(validInbound, { warehouseIds: ["wh-2"], itemIds: ["item-1"] })).toEqual({
      draft: { ...validInbound, warehouseId: "" },
      staleFields: ["warehouseId"],
    });
    expect(reconcileInboundDraft(validInbound, { warehouseIds: ["wh-1"], itemIds: ["item-2"] })).toEqual({
      draft: { ...validInbound, itemId: "" },
      staleFields: ["itemId"],
    });
  });

  it("retains only warehouse, purchase date and purchaser after success", () => {
    expect(resetInboundAfterSuccess(validInbound)).toEqual({
      warehouseId: validInbound.warehouseId,
      itemId: "",
      batchNo: "",
      quantity: "",
      unitCost: "",
      purchasedAt: validInbound.purchasedAt,
      purchaser: validInbound.purchaser,
      remark: "",
    });
  });
});
