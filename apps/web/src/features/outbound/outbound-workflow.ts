import Decimal from "decimal.js";

export type OutboundStep = "select" | "allocate" | "review" | "complete";

export type ApprovalLine = { id: string; itemId: string; requestedQuantity: string };
export type PendingApproval = { id: string; weComSpNo: string; status: string; lines: ApprovalLine[] };
export type BatchOption = { batchId: string; warehouseId: string; itemId: string; remainingQuantity: string; unitCost: string };
export type AllocationRow = { id: string; approvalLineId: string; warehouseId: string; batchId: string; quantity: string };
export type OutboundDraft = { approvalId: string; step: OutboundStep; allocations: AllocationRow[]; reason: string };
export type OutboundSummary = {
  requestedQuantity: string;
  actualQuantity: string;
  amount: string;
  lines: Array<{ approvalLineId: string; itemId: string; requestedQuantity: string; actualQuantity: string; difference: string }>;
};
export type ReconciledOutboundDraft = { draft: OutboundDraft; invalidAllocationIds: string[] };

const steps = new Set<OutboundStep>(["select", "allocate", "review", "complete"]);
const plainDecimalPattern = /^\d+(?:\.\d{1,4})?$/;

function parseDecimal(value: string): Decimal | null {
  const normalized = value.trim();
  if (!plainDecimalPattern.test(normalized)) return null;
  const [integerPart] = normalized.split(".");
  if ((integerPart?.replace(/^0+(?=\d)/, "").length ?? 0) > 14) return null;
  try {
    const decimal = new Decimal(normalized);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

function isAllocationRow(value: unknown): value is AllocationRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return ["id", "approvalLineId", "warehouseId", "batchId", "quantity"].every((field) => typeof row[field] === "string");
}

export function isOutboundDraft(value: unknown): value is OutboundDraft {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.approvalId === "string"
    && typeof draft.step === "string"
    && steps.has(draft.step as OutboundStep)
    && typeof draft.reason === "string"
    && Array.isArray(draft.allocations)
    && draft.allocations.every(isAllocationRow);
}

export function outboundDraftKey(userId: string, approvalId: string): string {
  return `warehouse.outbound.v1.${encodeURIComponent(userId)}.${encodeURIComponent(approvalId)}`;
}

export function summarizeOutbound(approval: PendingApproval, allocations: readonly AllocationRow[], options: readonly BatchOption[]): OutboundSummary {
  const actualByLine = new Map<string, Decimal>();
  let amount = new Decimal(0);
  for (const allocation of allocations) {
    const quantity = parseDecimal(allocation.quantity);
    if (!quantity) continue;
    actualByLine.set(allocation.approvalLineId, (actualByLine.get(allocation.approvalLineId) ?? new Decimal(0)).plus(quantity));
    const option = options.find((candidate) => candidate.warehouseId === allocation.warehouseId && candidate.batchId === allocation.batchId);
    const unitCost = option ? parseDecimal(option.unitCost) : null;
    if (unitCost) amount = amount.plus(quantity.mul(unitCost));
  }
  const lines = approval.lines.map((line) => {
    const requested = parseDecimal(line.requestedQuantity) ?? new Decimal(0);
    const actual = actualByLine.get(line.id) ?? new Decimal(0);
    return { approvalLineId: line.id, itemId: line.itemId, requestedQuantity: requested.toString(), actualQuantity: actual.toString(), difference: requested.minus(actual).toString() };
  });
  const requestedQuantity = lines.reduce((sum, line) => sum.plus(line.requestedQuantity), new Decimal(0));
  const actualQuantity = lines.reduce((sum, line) => sum.plus(line.actualQuantity), new Decimal(0));
  return { requestedQuantity: requestedQuantity.toString(), actualQuantity: actualQuantity.toString(), amount: amount.toFixed(2), lines };
}

export function validateAllocationStep(approval: PendingApproval, allocations: readonly AllocationRow[], options: readonly BatchOption[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const rowsByLine = new Map(approval.lines.map((line) => [line.id, allocations.filter((row) => row.approvalLineId === line.id)]));
  for (const line of approval.lines) {
    const rows = rowsByLine.get(line.id) ?? [];
    if (!rows.length) errors[`line:${line.id}`] = "每个物品至少需要一条分配";
    let total = new Decimal(0);
    for (const row of rows) {
      if (!row.warehouseId || !row.batchId || !row.quantity.trim()) {
        errors[row.id] = "请选择仓库、批次并填写数量";
        continue;
      }
      const quantity = parseDecimal(row.quantity);
      if (!quantity) {
        errors[row.id] = "数量必须为最多 14 位整数和 4 位小数的非负普通十进制数";
        continue;
      }
      const option = options.find((candidate) => candidate.warehouseId === row.warehouseId && candidate.batchId === row.batchId && candidate.itemId === line.itemId);
      if (!option) {
        errors[row.id] = "所选仓库或批次已失效";
        continue;
      }
      total = total.plus(quantity);
    }
    const requested = parseDecimal(line.requestedQuantity) ?? new Decimal(0);
    if (total.gt(requested)) for (const row of rows) errors[row.id] = "同一审批行的实际数量合计不能超过审批数量";
  }
  const grouped = new Map<string, { quantity: Decimal; rows: AllocationRow[]; remaining: Decimal }>();
  for (const row of allocations) {
    const quantity = parseDecimal(row.quantity);
    const option = options.find((candidate) => candidate.warehouseId === row.warehouseId && candidate.batchId === row.batchId);
    if (!quantity || !option) continue;
    const key = `${row.warehouseId}:${row.batchId}`;
    const group = grouped.get(key) ?? { quantity: new Decimal(0), rows: [], remaining: parseDecimal(option.remainingQuantity) ?? new Decimal(0) };
    group.quantity = group.quantity.plus(quantity);
    group.rows.push(row);
    grouped.set(key, group);
  }
  for (const group of grouped.values()) if (group.quantity.gt(group.remaining)) for (const row of group.rows) errors[row.id] = "同一批次的实际数量合计不能超过可用库存";
  return errors;
}

export function validateReviewStep(summary: Pick<OutboundSummary, "requestedQuantity" | "actualQuantity" | "amount">, reason: string): { reason?: string } {
  const requested = parseDecimal(summary.requestedQuantity) ?? new Decimal(0);
  const actual = parseDecimal(summary.actualQuantity) ?? new Decimal(0);
  return actual.lt(requested) && !reason.trim() ? { reason: "少出或零出必须填写原因" } : {};
}

export function reconcileBatchOptions(draft: OutboundDraft, options: readonly BatchOption[]): ReconciledOutboundDraft {
  const byBatch = new Map(options.map((option) => [`${option.warehouseId}:${option.batchId}`, option]));
  const totals = new Map<string, Decimal>();
  for (const row of draft.allocations) {
    const quantity = parseDecimal(row.quantity);
    const key = `${row.warehouseId}:${row.batchId}`;
    if (quantity) totals.set(key, (totals.get(key) ?? new Decimal(0)).plus(quantity));
  }
  return {
    draft: { ...draft, step: "review" },
    invalidAllocationIds: draft.allocations.filter((row) => {
      if (!row.batchId) return false;
      const key = `${row.warehouseId}:${row.batchId}`;
      const option = byBatch.get(key);
      const remaining = option ? parseDecimal(option.remainingQuantity) : null;
      return !remaining || (totals.get(key)?.gt(remaining) ?? false);
    }).map((row) => row.id),
  };
}

export function normalizeAllocations(allocations: readonly AllocationRow[]): Array<Omit<AllocationRow, "id">> {
  return allocations.flatMap(({ id: _id, quantity, ...row }) => {
    const parsed = parseDecimal(quantity);
    return parsed?.gt(0) ? [{ ...row, quantity: parsed.toString() }] : [];
  });
}
