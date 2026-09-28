import Decimal from "decimal.js";

import { readSessionDraft, writeSessionDraft } from "../drafts/session-draft";

export type OutboundStep = "select" | "allocate" | "review" | "complete";
export type ApprovalLine = {
  id: string;
  requestedItemName: string;
  requestedQuantity: string;
  unit: string;
  note?: string;
  itemId?: string;
  legacyResolutionStatus?: "NOT_APPLICABLE" | "EXACT_LOCKED" | "REAPPLY_REQUIRED";
};
export type PendingApproval = { id: string; weComSpNo: string; status: string; lines: readonly ApprovalLine[] };
export type CandidateItem = { id: string; code: string; name: string; specification?: string; aliases?: string[]; unit: string; isActive: boolean; availableQuantity: string; recommendationScore?: number; recommendationConfidence?: "HIGH" | "MEDIUM" | "LOW"; recommendationReasons?: string[] };
export type BatchOption = { batchId: string; batchNo?: string; purchasedAt?: string; warehouseId: string; warehouseName?: string; itemId: string; remainingQuantity: string; unitCost: string };
export type OutboundOptions = { approvalId: string; lines: readonly { approvalLineId: string; recommendedItemId?: string; items: readonly CandidateItem[] }[]; batches: readonly BatchOption[] };
export type AllocationRow = { id: string; warehouseId: string; batchId: string; quantity: string };
export type DecisionDraft = { approvalLineId: string; selectedItemId: string; zeroIssue: boolean; varianceReason: string; recommendationDismissed?: boolean; allocations: AllocationRow[] };
export type OutboundDraft = { approvalId: string; step: OutboundStep; decisions: DecisionDraft[] };
export type OutboundSummary = {
  requestedQuantity: string;
  actualQuantity: string;
  amount: string;
  lines: Array<{
    approvalLineId: string;
    requestedItemName: string;
    requestedQuantity: string;
    unit: string;
    note?: string;
    selectedItemId?: string;
    actualQuantity: string;
    difference: string;
  }>;
};
export type ReconciledOutboundDraft = { draft: OutboundDraft; staleSelectedItemLineIds: string[]; staleAllocationIds: string[] };
export type OutboundDraftIndexEntry = { approvalId: string; weComSpNo: string };
export type IndexedOutboundDraft = { entry: OutboundDraftIndexEntry; draft: OutboundDraft };
export type NormalizedDecision = {
  approvalLineId: string;
  selectedItemId?: string;
  actualQuantity?: string;
  allocations: Array<{ warehouseId: string; batchId: string; quantity: string }>;
  varianceReason?: string;
};

const outboundDraftVersion = 2;
const steps = new Set<OutboundStep>(["select", "allocate", "review", "complete"]);
const positiveIntegerPattern = /^[1-9]\d{0,13}$/;

function parsePositiveInteger(value: string): Decimal | null {
  const normalized = value.trim();
  if (!positiveIntegerPattern.test(normalized)) return null;
  return new Decimal(normalized);
}

function isAllocationRow(value: unknown): value is AllocationRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return ["id", "warehouseId", "batchId", "quantity"].every((field) => typeof row[field] === "string");
}

function isDecisionDraft(value: unknown): value is DecisionDraft {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const decision = value as Record<string, unknown>;
  return typeof decision.approvalLineId === "string"
    && typeof decision.selectedItemId === "string"
    && typeof decision.zeroIssue === "boolean"
    && typeof decision.varianceReason === "string"
    && (decision.recommendationDismissed === undefined || typeof decision.recommendationDismissed === "boolean")
    && Array.isArray(decision.allocations)
    && decision.allocations.every(isAllocationRow);
}

export function isOutboundDraft(value: unknown): value is OutboundDraft {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.approvalId === "string"
    && typeof draft.step === "string"
    && steps.has(draft.step as OutboundStep)
    && Array.isArray(draft.decisions)
    && draft.decisions.every(isDecisionDraft);
}

export function outboundDraftKey(userId: string, approvalId: string): string {
  return `warehouse.outbound.v2.${encodeURIComponent(userId)}.${encodeURIComponent(approvalId)}`;
}

export function outboundDraftIndexKey(userId: string): string {
  return `warehouse.outbound.index.v2.${encodeURIComponent(userId)}`;
}

export function isOutboundDraftIndex(value: unknown): value is OutboundDraftIndexEntry[] {
  return Array.isArray(value) && value.every((entry) => entry !== null
    && typeof entry === "object"
    && !Array.isArray(entry)
    && typeof (entry as Record<string, unknown>).approvalId === "string"
    && typeof (entry as Record<string, unknown>).weComSpNo === "string");
}

function readOutboundDraftIndex(storage: Storage, userId: string): OutboundDraftIndexEntry[] {
  return readSessionDraft(storage, outboundDraftIndexKey(userId), userId, outboundDraftVersion, isOutboundDraftIndex) ?? [];
}

function writeOutboundDraftIndex(storage: Storage, userId: string, entries: OutboundDraftIndexEntry[]): void {
  writeSessionDraft(storage, outboundDraftIndexKey(userId), { version: outboundDraftVersion, userId, value: entries });
}

export function addOutboundDraftIndexEntry(storage: Storage, userId: string, entry: OutboundDraftIndexEntry): void {
  const current = readOutboundDraftIndex(storage, userId);
  writeOutboundDraftIndex(storage, userId, current.some((candidate) => candidate.approvalId === entry.approvalId) ? current : [...current, entry]);
}

export function removeOutboundDraftIndexEntry(storage: Storage, userId: string, approvalId: string): void {
  writeOutboundDraftIndex(storage, userId, readOutboundDraftIndex(storage, userId).filter((entry) => entry.approvalId !== approvalId));
}

export function readIndexedOutboundDrafts(storage: Storage, userId: string): IndexedOutboundDraft[] {
  return readOutboundDraftIndex(storage, userId).flatMap((entry) => {
    const draft = readSessionDraft<OutboundDraft>(storage, outboundDraftKey(userId, entry.approvalId), userId, outboundDraftVersion, isOutboundDraft);
    return draft?.approvalId === entry.approvalId && draft.step !== "complete" ? [{ entry, draft }] : [];
  });
}

export function pruneOutboundDraftIndex(storage: Storage, userId: string, indexed: readonly IndexedOutboundDraft[]): void {
  const entries = readOutboundDraftIndex(storage, userId);
  if (indexed.length !== entries.length) writeOutboundDraftIndex(storage, userId, indexed.map(({ entry }) => entry));
}

function decisionTotal(decision: DecisionDraft): Decimal {
  return decision.allocations.reduce((total, allocation) => total.plus(parsePositiveInteger(allocation.quantity) ?? 0), new Decimal(0));
}

export function summarizeOutbound(approval: PendingApproval, decisions: readonly DecisionDraft[], options: OutboundOptions): OutboundSummary {
  const decisionsByLine = new Map(decisions.map((decision) => [decision.approvalLineId, decision]));
  let amount = new Decimal(0);
  const remainingByBatch = new Map(options.batches.map((batch) => [`${batch.warehouseId}:${batch.batchId}`, new Decimal(batch.remainingQuantity)]));
  const sortedBatches = [...options.batches].sort((left, right) => (left.purchasedAt ?? "").localeCompare(right.purchasedAt ?? "")
    || (left.batchNo ?? "").localeCompare(right.batchNo ?? "")
    || left.warehouseId.localeCompare(right.warehouseId)
    || left.batchId.localeCompare(right.batchId));
  for (const decision of decisions) {
    if (decision.zeroIssue) continue;
    let quantity = decisionTotal(decision);
    for (const batch of sortedBatches.filter((candidate) => candidate.itemId === decision.selectedItemId)) {
      if (quantity.isZero()) break;
      const key = `${batch.warehouseId}:${batch.batchId}`;
      const remaining = remainingByBatch.get(key) ?? new Decimal(0);
      const allocated = Decimal.min(quantity, remaining);
      if (allocated.gt(0)) {
        amount = amount.plus(allocated.mul(batch.unitCost).toFixed(2));
        remainingByBatch.set(key, remaining.minus(allocated));
        quantity = quantity.minus(allocated);
      }
    }
  }
  const lines = approval.lines.map((line) => {
    const decision = decisionsByLine.get(line.id);
    const requested = parsePositiveInteger(line.requestedQuantity) ?? new Decimal(0);
    const actual = decision?.zeroIssue ? new Decimal(0) : decision ? decisionTotal(decision) : new Decimal(0);
    return {
      approvalLineId: line.id,
      requestedItemName: line.requestedItemName,
      requestedQuantity: requested.toString(),
      unit: line.unit,
      ...(line.note === undefined ? {} : { note: line.note }),
      ...(decision?.zeroIssue || !decision?.selectedItemId ? {} : { selectedItemId: decision.selectedItemId }),
      actualQuantity: actual.toString(),
      difference: requested.minus(actual).toString(),
    };
  });
  return {
    requestedQuantity: lines.reduce((total, line) => total.plus(line.requestedQuantity), new Decimal(0)).toString(),
    actualQuantity: lines.reduce((total, line) => total.plus(line.actualQuantity), new Decimal(0)).toString(),
    amount: amount.toFixed(2),
    lines,
  };
}

function validateExactDecisionLineSet(approval: PendingApproval, decisions: readonly DecisionDraft[], errors: Record<string, string>): void {
  const approvalLineIds = new Set(approval.lines.map((line) => line.id));
  const decisionCounts = new Map<string, number>();
  for (const decision of decisions) {
    decisionCounts.set(decision.approvalLineId, (decisionCounts.get(decision.approvalLineId) ?? 0) + 1);
    if (!approvalLineIds.has(decision.approvalLineId)) errors[`line:${decision.approvalLineId}`] = "出库决定不属于当前审批";
  }
  for (const line of approval.lines) {
    const count = decisionCounts.get(line.id) ?? 0;
    if (count === 0) errors[`line:${line.id}`] = "每个审批意向都需要出库决定";
    if (count > 1) errors[`line:${line.id}`] = "每个审批意向只能有一个出库决定";
  }
}

export function validateDecisionStep(approval: PendingApproval, decisions: readonly DecisionDraft[], options: OutboundOptions): Record<string, string> {
  const errors: Record<string, string> = {};
  validateExactDecisionLineSet(approval, decisions, errors);
  const decisionsByLine = new Map<string, DecisionDraft>(decisions.map((decision) => [decision.approvalLineId, decision]));
  for (const line of approval.lines) {
    const decision = decisionsByLine.get(line.id);
    if (!decision) continue;
    const requested = parsePositiveInteger(line.requestedQuantity) ?? new Decimal(0);
    if (decision.zeroIssue) {
      if (decision.selectedItemId || decisionTotal(decision).gt(0)) errors[`line:${line.id}`] = "零出库不能选择标准物品或填写实际数量";
      if (!decision.varianceReason.trim()) errors[`reason:${line.id}`] = "少出或零出必须填写原因";
      continue;
    }
    const candidates = options.lines.find((candidate) => candidate.approvalLineId === line.id)?.items ?? [];
    if (!decision.selectedItemId) errors[`line:${line.id}`] = "请选择标准物品";
    else if (!candidates.some((candidate) => candidate.id === decision.selectedItemId)) errors[`line:${line.id}`] = "所选标准物品已失效";
    const quantityRow = decision.allocations[0];
    const actual = decisionTotal(decision);
    if (!quantityRow || !parsePositiveInteger(quantityRow.quantity)) errors[`quantity:${line.id}`] = "数量必须为 1 到 14 位正整数";
    if (actual.gt(requested)) errors[`quantity:${line.id}`] = "实际数量不能超过审批数量";
    const available = candidates.find((candidate) => candidate.id === decision.selectedItemId)?.availableQuantity;
    if (available !== undefined && actual.gt(available)) errors[`quantity:${line.id}`] = "实际数量不能超过当前可用库存";
    if (actual.lt(requested) && !decision.varianceReason.trim()) errors[`reason:${line.id}`] = "少出或零出必须填写原因";
  }
  return errors;
}

export function changeDecisionItem(decision: DecisionDraft, selectedItemId: string): DecisionDraft {
  return decision.selectedItemId === selectedItemId ? decision : { ...decision, selectedItemId, zeroIssue: false, recommendationDismissed: !selectedItemId };
}

export function reconcileOutboundOptions(draft: OutboundDraft, options: OutboundOptions): ReconciledOutboundDraft {
  const staleSelectedItemLineIds: string[] = [];
  const staleAllocationIds: string[] = [];
  const decisions = draft.decisions.map((decision) => {
    if (decision.zeroIssue) return decision;
    const lineOptions = options.lines.find((line) => line.approvalLineId === decision.approvalLineId);
    const candidates = lineOptions?.items ?? [];
    if (decision.selectedItemId && !candidates.some((candidate) => candidate.id === decision.selectedItemId)) staleSelectedItemLineIds.push(decision.approvalLineId);
    if (!decision.selectedItemId && !decision.recommendationDismissed && lineOptions?.recommendedItemId) {
      return { ...decision, selectedItemId: lineOptions.recommendedItemId };
    }
    return decision;
  }).filter((decision): decision is DecisionDraft => Boolean(decision));
  return { draft: { ...draft, decisions }, staleSelectedItemLineIds, staleAllocationIds };
}

function normalizedSearchValue(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function searchCandidateItems<T extends CandidateItem>(items: readonly T[], search: string): T[] {
  const terms = normalizedSearchValue(search).split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const fields = [item.name, item.code, item.specification ?? "", ...(item.aliases ?? [])].map(normalizedSearchValue);
    return terms.every((term) => fields.some((field) => field.includes(term)));
  });
}

export function normalizeDecisions(decisions: readonly DecisionDraft[], approval?: PendingApproval): NormalizedDecision[] {
  return decisions.map((decision) => {
    const varianceReason = decision.varianceReason.trim();
    if (decision.zeroIssue) return { approvalLineId: decision.approvalLineId, actualQuantity: "0", allocations: [], ...(varianceReason ? { varianceReason } : {}) };
    const approvalLine = approval?.lines.find((line) => line.id === decision.approvalLineId);
    const requested = approvalLine ? parsePositiveInteger(approvalLine.requestedQuantity) : null;
    const includeVarianceReason = !requested || decisionTotal(decision).lt(requested);
    return {
      approvalLineId: decision.approvalLineId,
      ...(decision.selectedItemId ? { selectedItemId: decision.selectedItemId } : {}),
      ...(decisionTotal(decision).gt(0) ? { actualQuantity: decisionTotal(decision).toString() } : {}),
      allocations: [],
      ...(varianceReason && includeVarianceReason ? { varianceReason } : {}),
    };
  });
}
