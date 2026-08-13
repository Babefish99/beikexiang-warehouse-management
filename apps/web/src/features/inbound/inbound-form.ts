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

const inboundFields = ["warehouseId", "itemId", "batchNo", "quantity", "unitCost", "purchasedAt", "purchaser", "remark"] as const;
const plainDecimalPattern = /^-?\d+(?:\.\d{1,4})?$/;
const decimalFormatError = "必须为最多 14 位整数和 4 位小数的普通十进制数";

export function isInboundDraft(value: unknown): value is InboundDraft {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && inboundFields.every((field) => typeof (value as Record<string, unknown>)[field] === "string");
}

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
  const normalized = value.trim();
  if (!plainDecimalPattern.test(normalized)) return null;
  const unsigned = normalized.startsWith("-") ? normalized.slice(1) : normalized;
  const [integerPart] = unsigned.split(".");
  const integerDigits = integerPart.replace(/^0+(?=\d)/, "").length;
  if (integerDigits > 14) return null;
  try {
    const decimal = new Decimal(normalized);
    return decimal.isFinite() && !(normalized.startsWith("-") && decimal.isZero()) ? decimal : null;
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
  if (!quantity) errors.quantity = draft.quantity.trim() ? `数量${decimalFormatError}` : "数量必须为正数";
  else if (!quantity.greaterThan(0)) errors.quantity = "数量必须为正数";
  if (!unitCost) errors.unitCost = draft.unitCost.trim() ? `单价${decimalFormatError}` : "单价必须为非负数";
  else if (unitCost.isNegative()) errors.unitCost = "单价必须为非负数";
  if (!draft.purchasedAt.trim()) errors.purchasedAt = "请选择采购日期";
  if (unitCost?.isZero() && !draft.remark.trim()) errors.remark = "单价为 0 时必须填写备注";

  return errors;
}

export function createInboundPayload(draft: InboundDraft): InboundDraft {
  const quantity = parseDecimal(draft.quantity);
  const unitCost = parseDecimal(draft.unitCost);
  if (!quantity || !unitCost) throw new Error("inbound draft must be validated before creating a payload");
  return {
    ...draft,
    batchNo: draft.batchNo.trim(),
    quantity: quantity.toString(),
    unitCost: unitCost.toString(),
    purchasedAt: draft.purchasedAt.trim(),
    purchaser: draft.purchaser.trim(),
    remark: draft.remark.trim(),
  };
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
