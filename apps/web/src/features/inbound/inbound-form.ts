import Decimal from "decimal.js";

export type InboundDraft = {
  warehouseId: string;
  itemId: string;
  batchNo: string;
  quantity: string;
  unitCost: string;
  purchasedAt: string;
  purchaser: string;
  remark: string;
};

export type InboundFieldErrors = Partial<Record<keyof InboundDraft, string>>;

export function createInboundDraft(today: string): InboundDraft {
  return {
    warehouseId: "",
    itemId: "",
    batchNo: "",
    quantity: "",
    unitCost: "",
    purchasedAt: today,
    purchaser: "",
    remark: "",
  };
}

function parseDecimal(value: string): Decimal | null {
  if (!value.trim()) return null;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

export function calculateInboundAmount(quantity: string, unitCost: string): string | null {
  const parsedQuantity = parseDecimal(quantity);
  const parsedUnitCost = parseDecimal(unitCost);
  if (!parsedQuantity || !parsedUnitCost) return null;
  return parsedQuantity.mul(parsedUnitCost).toFixed(2);
}

export function validateInboundDraft(draft: InboundDraft): InboundFieldErrors {
  const errors: InboundFieldErrors = {};
  const quantity = parseDecimal(draft.quantity);
  const unitCost = parseDecimal(draft.unitCost);

  if (!draft.warehouseId) errors.warehouseId = "请选择仓库";
  if (!draft.itemId) errors.itemId = "请选择物品";
  if (!draft.batchNo.trim()) errors.batchNo = "请输入批次号";
  if (!quantity || !quantity.greaterThan(0)) errors.quantity = "数量必须为正数";
  if (!unitCost || unitCost.isNegative()) errors.unitCost = "单价必须为非负数";
  if (!draft.purchasedAt.trim()) errors.purchasedAt = "请选择采购日期";
  if (unitCost?.isZero() && !draft.remark.trim()) errors.remark = "单价为 0 时必须填写备注";

  return errors;
}

export function reconcileInboundDraft(
  draft: InboundDraft,
  masterData: { warehouseIds: string[]; itemIds: string[] },
): { draft: InboundDraft; staleFields: Array<"warehouseId" | "itemId"> } {
  const reconciled = { ...draft };
  const staleFields: Array<"warehouseId" | "itemId"> = [];

  if (draft.warehouseId && !masterData.warehouseIds.includes(draft.warehouseId)) {
    reconciled.warehouseId = "";
    staleFields.push("warehouseId");
  }
  if (draft.itemId && !masterData.itemIds.includes(draft.itemId)) {
    reconciled.itemId = "";
    staleFields.push("itemId");
  }

  return { draft: reconciled, staleFields };
}

export function resetInboundAfterSuccess(draft: InboundDraft): InboundDraft {
  return {
    ...createInboundDraft(draft.purchasedAt),
    warehouseId: draft.warehouseId,
    purchaser: draft.purchaser,
  };
}
