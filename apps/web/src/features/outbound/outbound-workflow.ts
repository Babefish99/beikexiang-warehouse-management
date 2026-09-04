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
export type CandidateItem = { id: string; code: string; name: string; unit: string; isActive: boolean; availableQuantity: string };
export type BatchOption = { batchId: string; warehouseId: string; itemId: string; remainingQuantity: string; unitCost: string };
export type OutboundOptions = { approvalId: string; lines: readonly { approvalLineId: string; items: readonly CandidateItem[] }[]; batches: readonly BatchOption[] };
export type AllocationRow = { id: string; warehouseId: string; batchId: string; quantity: string };
export type DecisionDraft = { approvalLineId: string; selectedItemId: string; zeroIssue: boolean; varianceReason: string; allocations: AllocationRow[] };
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
  for (const decision of decisions) {
    if (decision.zeroIssue) continue;
    for (const allocation of decision.allocations) {
      const quantity = parsePositiveInteger(allocation.quantity);
      const option = options.batches.find((candidate) => candidate.warehouseId === allocation.warehouseId && candidate.batchId === allocation.batchId && candidate.itemId === decision.selectedItemId);
      if (quantity && option) amount = amount.plus(quantity.mul(option.unitCost).toFixed(2));
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

export function validateDecisionStep(approval: PendingApproval, decisions: readonly DecisionDraft[], options: OutboundOptions): Record<string, string> {
  const errors: Record<string, string> = {};
  const decisionsByLine = new Map<string, DecisionDraft>();
  for (const decision of decisions) {
    if (decisionsByLine.has(decision.approvalLineId)) errors[`line:${decision.approvalLineId}`] = "每个审批意向只能有一个出库决定";
    decisionsByLine.set(decision.approvalLineId, decision);
  }
  for (const line of approval.lines) {
    const decision = decisionsByLine.get(line.id);
    if (!decision) { errors[`line:${line.id}`] = "每个审批意向都需要出库决定"; continue; }
    const requested = parsePositiveInteger(line.requestedQuantity) ?? new Decimal(0);
    if (decision.zeroIssue) {
      if (decision.selectedItemId || decision.allocations.length) errors[`line:${line.id}`] = "零出库不能选择标准物品或填写批次分配";
      if (!decision.varianceReason.trim()) errors[`reason:${line.id}`] = "少出或零出必须填写原因";
      continue;
    }
    const candidates = options.lines.find((candidate) => candidate.approvalLineId === line.id)?.items ?? [];
    if (!decision.selectedItemId) errors[`line:${line.id}`] = "请选择标准物品";
    else if (!candidates.some((candidate) => candidate.id === decision.selectedItemId)) errors[`line:${line.id}`] = "所选标准物品已失效";
    if (!decision.allocations.length) errors[`line:${line.id}`] ??= "每个标准物品至少需要一条分配";
    let actual = new Decimal(0);
    for (const allocation of decision.allocations) {
      const quantity = parsePositiveInteger(allocation.quantity);
      if (!allocation.warehouseId || !allocation.batchId) { errors[allocation.id] = "请选择仓库、批次并填写数量"; continue; }
      if (!quantity) { errors[allocation.id] = "数量必须为 1 到 14 位正整数"; continue; }
      const batch = options.batches.find((candidate) => candidate.warehouseId === allocation.warehouseId && candidate.batchId === allocation.batchId && candidate.itemId === decision.selectedItemId);
      if (!batch) { errors[allocation.id] = "所选仓库或批次已失效"; continue; }
      actual = actual.plus(quantity);
    }
    if (actual.gt(requested)) for (const allocation of decision.allocations) errors[allocation.id] = "同一审批意向的实际数量合计不能超过审批数量";
    if (actual.lt(requested) && !decision.varianceReason.trim()) errors[`reason:${line.id}`] = "少出或零出必须填写原因";
  }
  const batchTotals = new Map<string, { total: Decimal; rows: AllocationRow[]; remaining: Decimal }>();
  for (const decision of decisions) for (const allocation of decision.allocations) {
    if (decision.zeroIssue) continue;
    const quantity = parsePositiveInteger(allocation.quantity);
    const batch = options.batches.find((candidate) => candidate.warehouseId === allocation.warehouseId && candidate.batchId === allocation.batchId && candidate.itemId === decision.selectedItemId);
    if (!quantity || !batch) continue;
    const key = `${batch.warehouseId}:${batch.batchId}`;
    const group = batchTotals.get(key) ?? { total: new Decimal(0), rows: [], remaining: new Decimal(batch.remainingQuantity) };
    group.total = group.total.plus(quantity); group.rows.push(allocation); batchTotals.set(key, group);
  }
  for (const group of batchTotals.values()) if (group.total.gt(group.remaining)) for (const row of group.rows) errors[row.id] = "同一批次的实际数量合计不能超过可用库存";
  return errors;
}

export function changeDecisionItem(decision: DecisionDraft, selectedItemId: string): DecisionDraft {
  return decision.selectedItemId === selectedItemId ? decision : { ...decision, selectedItemId, zeroIssue: false, allocations: [] };
}

export function reconcileOutboundOptions(draft: OutboundDraft, options: OutboundOptions): ReconciledOutboundDraft {
  const staleSelectedItemLineIds: string[] = [];
  const staleAllocationIds: string[] = [];
  const allocationsByBatch = new Map<string, { rows: AllocationRow[]; total: Decimal; remaining: Decimal }>();
  for (const decision of draft.decisions) {
    if (decision.zeroIssue) continue;
    const candidates = options.lines.find((line) => line.approvalLineId === decision.approvalLineId)?.items ?? [];
    if (decision.selectedItemId && !candidates.some((candidate) => candidate.id === decision.selectedItemId)) staleSelectedItemLineIds.push(decision.approvalLineId);
    for (const allocation of decision.allocations) {
      if (!allocation.batchId) continue;
      const batch = options.batches.find((candidate) => candidate.warehouseId === allocation.warehouseId && candidate.batchId === allocation.batchId && candidate.itemId === decision.selectedItemId);
      const quantity = parsePositiveInteger(allocation.quantity);
      if (!batch) { staleAllocationIds.push(allocation.id); continue; }
      if (!quantity) continue;
      const key = `${batch.warehouseId}:${batch.batchId}`;
      const group = allocationsByBatch.get(key) ?? { rows: [], total: new Decimal(0), remaining: new Decimal(batch.remainingQuantity) };
      group.rows.push(allocation);
      group.total = group.total.plus(quantity);
      allocationsByBatch.set(key, group);
    }
  }
  for (const group of allocationsByBatch.values()) if (group.total.gt(group.remaining)) staleAllocationIds.push(...group.rows.map((row) => row.id));
  return { draft: { ...draft }, staleSelectedItemLineIds, staleAllocationIds };
}

function normalizedSearchValue(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function candidateRank(item: CandidateItem, search: string): number {
  const requested = normalizedSearchValue(search);
  if (!requested) return 3;
  const name = normalizedSearchValue(item.name);
  const code = normalizedSearchValue(item.code);
  if (name === requested) return 0;
  if (name.includes(requested) || requested.includes(name)) return 1;
  const terms = requested.split(/\s+/).filter(Boolean);
  return code.includes(requested) || requested.includes(code) || terms.some((term) => code.includes(term) || name.includes(term)) ? 2 : 3;
}

export function searchCandidateItems<T extends CandidateItem>(items: readonly T[], search: string): T[] {
  return [...items].sort((left, right) => candidateRank(left, search) - candidateRank(right, search)
    || (left.code === right.code ? left.id.localeCompare(right.id) : left.code.localeCompare(right.code)));
}

export function normalizeDecisions(decisions: readonly DecisionDraft[]): NormalizedDecision[] {
  return decisions.map((decision) => {
    const varianceReason = decision.varianceReason.trim();
    if (decision.zeroIssue) return { approvalLineId: decision.approvalLineId, allocations: [], ...(varianceReason ? { varianceReason } : {}) };
    return {
      approvalLineId: decision.approvalLineId,
      ...(decision.selectedItemId ? { selectedItemId: decision.selectedItemId } : {}),
      allocations: decision.allocations.flatMap(({ id: _id, warehouseId, batchId, quantity }) => {
        const parsed = parsePositiveInteger(quantity);
        return parsed ? [{ warehouseId, batchId, quantity: parsed.toString() }] : [];
      }),
      ...(varianceReason ? { varianceReason } : {}),
    };
  });
}
