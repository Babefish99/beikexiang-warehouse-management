import { describe, expect, it } from "vitest";
import {
  calculateInboundAmount,
  createInboundDraft,
  createInboundPayload,
  isInboundDraft,
  mapInboundServerError,
  previewInboundBatchNo,
  reconcileInboundDraft,
  resetInboundAfterSuccess,
  validateInboundDraft,
  type InboundDraft,
} from "../../../apps/web/src/features/inbound/inbound-form";

const validInbound: InboundDraft = {
  warehouseId: "wh-1",
  itemId: "item-1",
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

  it("accepts only current inbound drafts without a client batch number", () => {
    expect(isInboundDraft(validInbound)).toBe(true);
    for (const value of [
      null,
      [],
      {},
      { ...validInbound, batchNo: "B-001" },
      { ...validInbound, remark: undefined },
      { ...validInbound, quantity: 2 },
    ]) {
      expect(isInboundDraft(value)).toBe(false);
    }
  });

  it("rejects non-plain or Decimal(18,4)-overflow numeric inputs", () => {
    for (const quantity of ["1e3", "0x10", "-0", "1.00001", "123456789012345", "99999999999999.9999"]) {
      const errors = validateInboundDraft({ ...validInbound, quantity });
      if (quantity === "99999999999999.9999") expect(errors.quantity).toBeUndefined();
      else expect(errors.quantity).toBe("数量必须为最多 14 位整数和 4 位小数的普通十进制数");
    }
    for (const unitCost of ["1e3", "0x10", "-0", "1.00001", "123456789012345"]) {
      expect(validateInboundDraft({ ...validInbound, unitCost }).unitCost).toBe("单价必须为最多 14 位整数和 4 位小数的普通十进制数");
    }
  });

  it("normalizes Decimal fields without sending a client batch number", () => {
    expect(createInboundPayload({
      ...validInbound,
      quantity: "01.2300",
      unitCost: "0002.5000",
      purchasedAt: "2026-08-13",
      purchaser: " 仓库管理员 ",
      remark: " 采购入库 ",
    })).toEqual({
      ...validInbound,
      quantity: "1.23",
      unitCost: "2.5",
      purchasedAt: "2026-08-13",
      purchaser: "仓库管理员",
      remark: "采购入库",
    });
  });

  it("does not calculate amounts for rejected numeric formats", () => {
    expect(calculateInboundAmount("1e1000000", "2")).toBeNull();
    expect(calculateInboundAmount("1.00001", "2")).toBeNull();
  });

  it("requires every required field with precise validation errors", () => {
    expect(validateInboundDraft(createInboundDraft(""))).toEqual({
      warehouseId: "请选择仓库",
      itemId: "请选择物品",
      quantity: "数量必须为正数",
      unitCost: "单价必须为非负数",
      purchasedAt: "请选择采购日期",
    });
  });

  it("rejects non-positive quantities and negative or non-numeric costs", () => {
    expect(validateInboundDraft({ ...validInbound, quantity: "0" })).toEqual({ quantity: "数量必须为正数" });
    expect(validateInboundDraft({ ...validInbound, quantity: "abc" })).toEqual({ quantity: "数量必须为最多 14 位整数和 4 位小数的普通十进制数" });
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
      quantity: "",
      unitCost: "",
      purchasedAt: validInbound.purchasedAt,
      purchaser: validInbound.purchaser,
      remark: "",
    });
  });

  it("maps automatic batch conflicts to the generated batch field", () => {
    expect(mapInboundServerError("batch number already exists")).toEqual({
      message: "批次号自动生成冲突，请稍后重试",
      fieldErrors: { batchNo: "批次号自动生成冲突，请稍后重试" },
    });
  });

  it("previews the first server-style batch number from the selected purchase date", () => {
    expect(previewInboundBatchNo("2026-08-14")).toBe("20260814-001");
    expect(previewInboundBatchNo("")).toBe("");
    expect(previewInboundBatchNo("2026/08/14")).toBe("");
  });

  it("keeps unknown server errors as dialog-only messages", () => {
    expect(mapInboundServerError("closed period: 2026-08")).toEqual({
      message: "closed period: 2026-08",
      fieldErrors: {},
    });
  });
});
