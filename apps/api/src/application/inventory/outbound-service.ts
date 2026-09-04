import { Decimal } from "decimal.js";

import { approvalUnitsMatch } from "../../domain/approvals/approval-intent.js";
import type { InventoryLedgerEntry } from "../../domain/inventory/ledger.js";
import {
  OutboundAllocator,
  type AllocationBatch,
  type AllocationLine,
  type AllocationValidationResult,
  type OutboundAllocationInput,
  type OutboundDecisionInput,
  type SelectableOutboundItem,
} from "./outbound-allocator.js";
import {
  createInventoryMemoryState,
  inventoryBalanceKey,
  type InventoryApprovalOutboundStatus,
  type InventoryApprovalState,
  type InventoryBalanceState,
  type InventoryMemoryState,
  type InventoryOutboundDecisionState,
} from "./inventory-memory-state.js";

export interface PendingApprovalLine extends AllocationLine {
  requestedItemName: string;
  note?: string;
}

export interface PendingApproval {
  id: string;
  weComSpNo: string;
  status: Exclude<InventoryApprovalOutboundStatus, "NONE">;
  lines: PendingApprovalLine[];
}

export interface OutboundOrderResult {
  id: string;
  approvalId: string;
  status: "COMPLETED" | "PARTIALLY_ISSUED" | "UNAVAILABLE";
  actualQuantity: string;
  amount: string;
  reason?: string;
}

export interface OutboundBatchOption {
  batchId: string;
  warehouseId: string;
  itemId: string;
  remainingQuantity: string;
  unitCost: string;
}

export interface OutboundItemOption extends SelectableOutboundItem {
  availableQuantity: string;
}

export interface OutboundOptions {
  approvalId: string;
  lines: Array<{ approvalLineId: string; items: OutboundItemOption[] }>;
  batches: OutboundBatchOption[];
}

export interface ConfirmOutboundInput {
  approvalId: string;
  operatorId: string;
  decisions: OutboundDecisionInput[];
}

interface LegacyConfirmOutboundInput {
  approvalId: string;
  allocations: OutboundAllocationInput[];
  reason?: string;
}

export interface OutboundStore {
  getApproval(approvalId: string): Promise<PendingApproval | undefined>;
  listPending(): Promise<PendingApproval[]>;
  listCandidateItems(): Promise<SelectableOutboundItem[]>;
  listBatches(itemIds: string[]): Promise<AllocationBatch[]>;
  commitOutbound(approval: PendingApproval, validation: AllocationValidationResult, operatorId: string): Promise<OutboundOrderResult>;
  cancelApproval(approvalId: string, reason: string): Promise<void>;
}

type CandidateItemLoader = () => Promise<SelectableOutboundItem[]>;

export class InMemoryOutboundStore implements OutboundStore {
  private readonly state: InventoryMemoryState;
  private readonly orders: OutboundOrderResult[] = [];
  private readonly seededItems = new Map<string, SelectableOutboundItem>();

  constructor(
    state: InventoryMemoryState = createInventoryMemoryState(),
    private readonly candidateItemLoader?: CandidateItemLoader,
  ) {
    this.state = state;
  }

  seedApproval(approval: PendingApproval): void {
    this.state.approvals.set(approval.id, {
      id: approval.id,
      weComSpNo: approval.weComSpNo,
      syncStatus: "APPROVED",
      outboundStatus: approval.status,
      applicantUserId: "",
      applicantName: "",
      purpose: "",
      submittedAt: new Date(0).toISOString(),
      lines: approval.lines.map((line) => ({
        id: line.id,
        requestedItemName: line.requestedItemName,
        itemId: line.itemId,
        requestedQuantity: line.requestedQuantity,
        unit: line.unit,
        note: line.note,
        legacyResolutionStatus: line.legacyResolutionStatus,
      })),
    });
    this.state.approvalsBySpNo.set(approval.weComSpNo, approval.id);
  }

  seedItem(item: SelectableOutboundItem): void {
    this.seededItems.set(item.id, structuredClone(item));
  }

  seedBatch(batch: AllocationBatch): void {
    const storedBalance: InventoryBalanceState = {
      warehouseId: batch.warehouseId,
      itemId: batch.itemId,
      batchId: batch.id,
      remainingQuantity: batch.remainingQuantity,
      unitCost: batch.unitCost,
    };
    this.state.balances.set(inventoryBalanceKey(batch.warehouseId, batch.id), storedBalance);
    if (!this.state.batches.has(batch.id)) {
      this.state.batches.set(batch.id, {
        id: batch.id,
        warehouseId: batch.warehouseId,
        itemId: batch.itemId,
        batchNo: batch.id,
        quantity: batch.remainingQuantity,
        remainingQuantity: batch.remainingQuantity,
        unitCost: batch.unitCost,
        purchasedAt: new Date(0).toISOString(),
      });
    }
  }

  batch(id: string): AllocationBatch | undefined {
    const value = [...this.state.balances.values()].find((balance) => balance.batchId === id);
    return value
      ? {
          id: value.batchId,
          warehouseId: value.warehouseId,
          itemId: value.itemId,
          remainingQuantity: value.remainingQuantity,
          unitCost: value.unitCost,
        }
      : undefined;
  }

  ledger(): InventoryLedgerEntry[] {
    return this.state.ledger.map((entry) => ({ ...entry }));
  }

  decisions(): InventoryOutboundDecisionState[] {
    return [...this.state.outboundDecisions.values()].map((decision) => structuredClone(decision));
  }

  async getApproval(approvalId: string): Promise<PendingApproval | undefined> {
    const value = this.state.approvals.get(approvalId);
    return value ? toPendingApproval(value) : undefined;
  }

  async listPending(): Promise<PendingApproval[]> {
    return [...this.state.approvals.values()]
      .filter((approval) => approval.outboundStatus === "PENDING_OUTBOUND" || approval.outboundStatus === "REAPPLY_REQUIRED")
      .map((approval) => toPendingApproval(approval));
  }

  async listCandidateItems(): Promise<SelectableOutboundItem[]> {
    const items = new Map<string, SelectableOutboundItem>();
    for (const item of await this.candidateItemLoader?.() ?? []) items.set(item.id, structuredClone(item));
    for (const item of this.seededItems.values()) items.set(item.id, structuredClone(item));
    return [...items.values()];
  }

  async listBatches(itemIds: string[]): Promise<AllocationBatch[]> {
    const selectedIds = new Set(itemIds);
    return [...this.state.balances.values()]
      .filter((batch) => selectedIds.has(batch.itemId))
      .map((batch) => ({
        id: batch.batchId,
        warehouseId: batch.warehouseId,
        itemId: batch.itemId,
        remainingQuantity: batch.remainingQuantity,
        unitCost: batch.unitCost,
      }));
  }

  async commitOutbound(
    approval: PendingApproval,
    validation: AllocationValidationResult,
    operatorId: string,
  ): Promise<OutboundOrderResult> {
    const currentApproval = this.state.approvals.get(approval.id);
    if (!currentApproval) throw new Error(`approval not found: ${approval.id}`);
    if (currentApproval.outboundStatus !== "PENDING_OUTBOUND") throw new Error("approval is already closed");

    const nextBalances = new Map([...this.state.balances].map(([key, batch]) => [key, structuredClone(batch)]));
    const nextBatches = new Map([...this.state.batches].map(([key, batch]) => [key, structuredClone(batch)]));
    const groupedAllocations = new Map<string, { allocation: AllocationValidationResult["allocations"][number]; quantity: Decimal }>();
    for (const allocation of validation.allocations) {
      const key = inventoryBalanceKey(allocation.warehouseId, allocation.batchId);
      const group = groupedAllocations.get(key) ?? { allocation, quantity: new Decimal(0) };
      if (group.allocation.itemId !== allocation.itemId || group.allocation.expectedRemainingQuantity !== allocation.expectedRemainingQuantity) {
        throw new Error("stock balance changed; retry transaction");
      }
      group.quantity = group.quantity.plus(allocation.quantity);
      groupedAllocations.set(key, group);
    }

    for (const [key, group] of groupedAllocations) {
      const current = nextBalances.get(key);
      if (
        !current
        || current.itemId !== group.allocation.itemId
        || !new Decimal(current.remainingQuantity).eq(group.allocation.expectedRemainingQuantity)
      ) {
        throw new Error("stock balance changed; retry transaction");
      }
      const remaining = new Decimal(current.remainingQuantity).minus(group.quantity);
      if (remaining.lt(0)) throw new Error("batch balance cannot become negative");
      nextBalances.set(key, { ...current, remainingQuantity: remaining.toString() });

      const batch = nextBatches.get(group.allocation.batchId);
      if (!batch || batch.itemId !== group.allocation.itemId) {
        throw new Error("stock balance changed; retry transaction");
      }
      const batchRemaining = new Decimal(batch.remainingQuantity).minus(group.quantity);
      if (batchRemaining.lt(0)) throw new Error("batch balance cannot become negative");
      nextBatches.set(batch.id, { ...batch, remainingQuantity: batchRemaining.toString() });
    }

    const status = validation.status === "FULL"
      ? "COMPLETED"
      : validation.status === "ZERO"
        ? "UNAVAILABLE"
        : "PARTIALLY_ISSUED";
    const persistedAllocationAmounts = validation.allocations.map((allocation) =>
      new Decimal(allocation.quantity).mul(allocation.unitCost).toFixed(2));
    const order: OutboundOrderResult = {
      id: crypto.randomUUID(),
      approvalId: approval.id,
      status,
      actualQuantity: validation.totalQuantity,
      amount: persistedAllocationAmounts
        .reduce((total, amount) => total.plus(amount), new Decimal(0))
        .toFixed(2),
    };
    const decidedAt = new Date().toISOString();
    const stagedDecisions = validation.decisions.map((decision) => ({
      id: crypto.randomUUID(),
      outboundOrderId: order.id,
      approvalLineId: decision.approvalLineId,
      selectedItemId: decision.selectedItemId,
      actualQuantity: decision.actualQuantity,
      varianceReason: decision.varianceReason,
      decidedBy: operatorId,
      decidedAt,
    } satisfies InventoryOutboundDecisionState));
    const decisionsByLineId = new Map(stagedDecisions.map((decision) => [decision.approvalLineId, decision]));
    const stagedAllocations = validation.allocations.map((allocation, index) => {
      const decision = decisionsByLineId.get(allocation.approvalLineId);
      if (!decision) throw new Error(`outbound decision not found: ${allocation.approvalLineId}`);
      return {
        id: crypto.randomUUID(),
        outboundOrderId: order.id,
        outboundDecisionLineId: decision.id,
        warehouseId: allocation.warehouseId,
        itemId: allocation.itemId,
        batchId: allocation.batchId,
        issuedQuantity: allocation.quantity,
        unitCost: allocation.unitCost,
        amount: persistedAllocationAmounts[index]!,
      };
    });
    const stagedLedger = validation.allocations.map((allocation, index) => ({
      id: crypto.randomUUID(),
      warehouseId: allocation.warehouseId,
      itemId: allocation.itemId,
      batchId: allocation.batchId,
      type: "OUTBOUND" as const,
      quantity: new Decimal(allocation.quantity).negated().toString(),
      unitCost: allocation.unitCost,
      amount: persistedAllocationAmounts[index]!,
      referenceType: "OUTBOUND_ORDER",
      referenceId: order.id,
      occurredAt: decidedAt,
    }));

    this.state.balances.clear();
    for (const [key, balance] of nextBalances) this.state.balances.set(key, balance);
    this.state.batches.clear();
    for (const [key, batch] of nextBatches) this.state.batches.set(key, batch);
    this.state.approvals.set(approval.id, { ...currentApproval, outboundStatus: status, hasOutboundDecision: true });
    this.orders.push(order);
    for (const decision of stagedDecisions) this.state.outboundDecisions.set(decision.id, decision);
    for (const allocation of stagedAllocations) this.state.issuedAllocations.set(allocation.id, allocation);
    this.state.ledger.push(...stagedLedger);
    return structuredClone(order);
  }

  async cancelApproval(approvalId: string, reason: string): Promise<void> {
    const approval = this.state.approvals.get(approvalId);
    if (!approval) throw new Error(`approval not found: ${approvalId}`);
    if (approval.outboundStatus !== "PENDING_OUTBOUND") throw new Error("approval is already closed");
    if (!reason.trim()) throw new Error("reason is required");
    this.state.approvals.set(approvalId, { ...approval, outboundStatus: "VOIDED" });
  }
}

function toPendingApproval(approval: InventoryApprovalState): PendingApproval {
  return {
    id: approval.id,
    weComSpNo: approval.weComSpNo,
    status: approval.outboundStatus as PendingApproval["status"],
    lines: approval.lines.map((line) => ({
      id: line.id,
      requestedItemName: line.requestedItemName,
      requestedQuantity: line.requestedQuantity,
      unit: line.unit,
      note: line.note,
      itemId: line.itemId,
      legacyResolutionStatus: line.legacyResolutionStatus,
    })),
  };
}

function normalizedSearchValue(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function candidateRank(item: SelectableOutboundItem, requestedItemName: string): number {
  const requested = normalizedSearchValue(requestedItemName);
  if (!requested) return 3;
  const name = normalizedSearchValue(item.name);
  const code = normalizedSearchValue(item.code);
  if (name === requested) return 0;
  if (name.includes(requested) || requested.includes(name)) return 1;
  const terms = requested.split(/\s+/).filter(Boolean);
  if (code.includes(requested) || requested.includes(code) || terms.some((term) => code.includes(term) || name.includes(term))) return 2;
  return 3;
}

function compareItemCode(left: SelectableOutboundItem, right: SelectableOutboundItem): number {
  return left.code === right.code ? left.id.localeCompare(right.id) : left.code.localeCompare(right.code);
}

function toLegacyDecisions(approval: PendingApproval, input: LegacyConfirmOutboundInput): OutboundDecisionInput[] {
  const allocationsByLine = new Map<string, OutboundAllocationInput[]>();
  for (const allocation of input.allocations) {
    const allocations = allocationsByLine.get(allocation.approvalLineId) ?? [];
    allocations.push(allocation);
    allocationsByLine.set(allocation.approvalLineId, allocations);
  }
  const decisions: OutboundDecisionInput[] = approval.lines.map((line) => {
    const allocations = allocationsByLine.get(line.id) ?? [];
    allocationsByLine.delete(line.id);
    return {
      approvalLineId: line.id,
      selectedItemId: allocations.length > 0 ? line.itemId : undefined,
      allocations: allocations.map(({ warehouseId, batchId, quantity }) => ({ warehouseId, batchId, quantity })),
      varianceReason: input.reason,
    };
  });
  for (const [approvalLineId, allocations] of allocationsByLine) {
    decisions.push({
      approvalLineId,
      allocations: allocations.map(({ warehouseId, batchId, quantity }) => ({ warehouseId, batchId, quantity })),
      varianceReason: input.reason,
    });
  }
  return decisions;
}

export class OutboundService {
  private readonly allocator = new OutboundAllocator();

  constructor(private readonly store: OutboundStore, private readonly assertPeriodOpen?: () => void | Promise<void>) {}

  listPending(): Promise<PendingApproval[]> {
    return this.store.listPending();
  }

  async listOptions(approvalId: string): Promise<OutboundOptions> {
    const approval = await this.store.getApproval(approvalId);
    if (!approval) throw new Error(`approval not found: ${approvalId}`);
    if (approval.status === "REAPPLY_REQUIRED" || approval.lines.some((line) => line.legacyResolutionStatus === "REAPPLY_REQUIRED")) {
      throw new Error("旧审批信息不完整，需重新申请");
    }
    if (approval.status !== "PENDING_OUTBOUND") throw new Error("approval is already closed");

    const items = await this.store.listCandidateItems();
    const allBatches = await this.store.listBatches(items.map((item) => item.id));
    const positiveBatches = allBatches.filter((batch) => new Decimal(batch.remainingQuantity).gt(0));
    const availableByItem = new Map<string, Decimal>();
    for (const batch of positiveBatches) {
      availableByItem.set(batch.itemId, (availableByItem.get(batch.itemId) ?? new Decimal(0)).plus(batch.remainingQuantity));
    }
    const lines = approval.lines.map((line) => {
      const candidates = items
        .filter((item) => item.isActive && approvalUnitsMatch(line.unit, item.unit) && availableByItem.has(item.id))
        .filter((item) => line.legacyResolutionStatus !== "EXACT_LOCKED" || item.id === line.itemId)
        .sort((left, right) => candidateRank(left, line.requestedItemName) - candidateRank(right, line.requestedItemName) || compareItemCode(left, right))
        .map((item) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          unit: item.unit,
          isActive: item.isActive,
          availableQuantity: availableByItem.get(item.id)!.toString(),
        }));
      return { approvalLineId: line.id, items: candidates };
    });
    const candidateIds = new Set(lines.flatMap((line) => line.items.map((item) => item.id)));
    return {
      approvalId,
      lines,
      batches: positiveBatches
        .filter((batch) => candidateIds.has(batch.itemId))
        .map(({ id: batchId, ...batch }) => ({ batchId, ...batch })),
    };
  }

  async confirm(input: ConfirmOutboundInput): Promise<OutboundOrderResult>;
  /** @deprecated Task 7 will migrate the route to authenticated decision input. */
  async confirm(input: LegacyConfirmOutboundInput): Promise<OutboundOrderResult>;
  async confirm(input: ConfirmOutboundInput | LegacyConfirmOutboundInput): Promise<OutboundOrderResult> {
    const approval = await this.store.getApproval(input.approvalId);
    if (!approval) throw new Error(`approval not found: ${input.approvalId}`);
    if (approval.status !== "PENDING_OUTBOUND") throw new Error("approval is already closed");
    const decisions = "decisions" in input ? input.decisions : toLegacyDecisions(approval, input);
    const operatorId = "decisions" in input ? input.operatorId : "system";
    const selectedItemIds = decisions.flatMap((decision) => decision.selectedItemId ? [decision.selectedItemId] : []);
    const [items, batches] = await Promise.all([
      this.store.listCandidateItems(),
      this.store.listBatches(selectedItemIds),
    ]);
    const validation = this.allocator.validate({ lines: approval.lines, items, batches, decisions });
    await this.assertPeriodOpen?.();
    return this.store.commitOutbound(approval, validation, operatorId);
  }

  async cancelBeforeIssue(input: { approvalId: string; reason: string }): Promise<{ approvalId: string; status: "VOIDED" }> {
    await this.assertPeriodOpen?.();
    await this.store.cancelApproval(input.approvalId, input.reason);
    return { approvalId: input.approvalId, status: "VOIDED" };
  }
}
