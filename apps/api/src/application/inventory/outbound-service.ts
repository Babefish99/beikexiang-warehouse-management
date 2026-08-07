import { Decimal } from "decimal.js";
import type { InventoryLedgerEntry } from "../../domain/inventory/ledger.js";
import { OutboundAllocator, type AllocationBatch, type AllocationLine, type OutboundAllocationInput, type AllocationValidationResult } from "./outbound-allocator.js";
import { createInventoryMemoryState, inventoryBalanceKey, type InventoryApprovalOutboundStatus, type InventoryApprovalState, type InventoryBalanceState, type InventoryMemoryState } from "./inventory-memory-state.js";

export interface PendingApproval {
  id: string;
  weComSpNo: string;
  status: "PENDING_OUTBOUND" | "COMPLETED" | "PARTIALLY_ISSUED" | "UNAVAILABLE" | "VOIDED";
  lines: AllocationLine[];
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

export interface OutboundOptions {
  approvalId: string;
  batches: OutboundBatchOption[];
}

export interface OutboundStore {
  getApproval(approvalId: string): Promise<PendingApproval | undefined>;
  listPending(): Promise<PendingApproval[]>;
  listBatches(itemIds: string[]): Promise<AllocationBatch[]>;
  commitOutbound(approval: PendingApproval, validation: AllocationValidationResult, reason?: string): Promise<OutboundOrderResult>;
  cancelApproval(approvalId: string, reason: string): Promise<void>;
}

export class InMemoryOutboundStore implements OutboundStore {
  private readonly state: InventoryMemoryState;
  private readonly orders: OutboundOrderResult[] = [];

  constructor(state: InventoryMemoryState = createInventoryMemoryState()) {
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
      lines: approval.lines.map((line) => ({ id: line.id, itemId: line.itemId, requestedQuantity: line.requestedQuantity, unit: "" })),
    });
    this.state.approvalsBySpNo.set(approval.weComSpNo, approval.id);
  }

  seedBatch(batch: AllocationBatch): void {
    const storedBalance: InventoryBalanceState = { warehouseId: batch.warehouseId, itemId: batch.itemId, batchId: batch.id, remainingQuantity: batch.remainingQuantity, unitCost: batch.unitCost };
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
    return value ? { id: value.batchId, warehouseId: value.warehouseId, itemId: value.itemId, remainingQuantity: value.remainingQuantity, unitCost: value.unitCost } : undefined;
  }

  ledger(): InventoryLedgerEntry[] { return this.state.ledger.map((entry) => ({ ...entry })); }

  async getApproval(approvalId: string): Promise<PendingApproval | undefined> {
    const value = this.state.approvals.get(approvalId);
    return value ? toPendingApproval(value) : undefined;
  }

  async listPending(): Promise<PendingApproval[]> {
    return [...this.state.approvals.values()]
      .filter((approval) => approval.outboundStatus === "PENDING_OUTBOUND")
      .map((approval) => toPendingApproval(approval));
  }

  async listBatches(itemIds: string[]): Promise<AllocationBatch[]> {
    return [...this.state.balances.values()]
      .filter((batch) => itemIds.includes(batch.itemId))
      .map((batch) => ({ id: batch.batchId, warehouseId: batch.warehouseId, itemId: batch.itemId, remainingQuantity: batch.remainingQuantity, unitCost: batch.unitCost }));
  }

  async commitOutbound(approval: PendingApproval, validation: AllocationValidationResult, reason?: string): Promise<OutboundOrderResult> {
    const nextBalances = new Map([...this.state.balances].map(([key, batch]) => [key, structuredClone(batch)]));
    for (const allocation of validation.allocations) {
      const current = nextBalances.get(inventoryBalanceKey(allocation.warehouseId, allocation.batchId));
      if (!current || current.remainingQuantity !== allocation.expectedRemainingQuantity) throw new Error("stock balance changed; retry transaction");
      const remaining = new Decimal(current.remainingQuantity).minus(allocation.quantity);
      if (remaining.lt(0)) throw new Error("batch balance cannot become negative");
      nextBalances.set(inventoryBalanceKey(current.warehouseId, current.batchId), { ...current, remainingQuantity: remaining.toString() });
    }
    this.state.balances.clear();
    for (const [key, batch] of nextBalances) this.state.balances.set(key, batch);
    const status = validation.status === "FULL" ? "COMPLETED" : validation.status === "ZERO" ? "UNAVAILABLE" : "PARTIALLY_ISSUED";
    const order: OutboundOrderResult = { id: crypto.randomUUID(), approvalId: approval.id, status, actualQuantity: validation.totalQuantity, amount: validation.amount, reason };
    this.orders.push(order);
    const currentApproval = this.state.approvals.get(approval.id);
    if (currentApproval) {
      this.state.approvals.set(approval.id, { ...currentApproval, outboundStatus: status });
    }
    for (const allocation of validation.allocations) {
      this.state.ledger.push({ id: crypto.randomUUID(), warehouseId: allocation.warehouseId, itemId: allocation.itemId, batchId: allocation.batchId, type: "OUTBOUND", quantity: new Decimal(allocation.quantity).negated().toString(), unitCost: allocation.unitCost, amount: new Decimal(allocation.quantity).mul(allocation.unitCost).toFixed(2), referenceType: "OUTBOUND_ORDER", referenceId: order.id, occurredAt: new Date().toISOString() });
      const allocationId = crypto.randomUUID();
      this.state.issuedAllocations.set(allocationId, {
        id: allocationId,
        outboundOrderId: order.id,
        warehouseId: allocation.warehouseId,
        itemId: allocation.itemId,
        batchId: allocation.batchId,
        issuedQuantity: allocation.quantity,
        unitCost: allocation.unitCost,
      });
    }
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
    status: approval.outboundStatus as Exclude<InventoryApprovalOutboundStatus, "NONE">,
    lines: approval.lines.map((line) => ({ id: line.id, itemId: line.itemId, requestedQuantity: line.requestedQuantity })),
  };
}

export class OutboundService {
  private readonly allocator = new OutboundAllocator();

  constructor(private readonly store: OutboundStore, private readonly assertPeriodOpen?: () => void | Promise<void>) {}

  listPending(): Promise<PendingApproval[]> { return this.store.listPending(); }

  async listOptions(approvalId: string): Promise<OutboundOptions> {
    const approval = await this.store.getApproval(approvalId);
    if (!approval) throw new Error(`approval not found: ${approvalId}`);
    if (approval.status !== "PENDING_OUTBOUND") throw new Error("approval is already closed");
    const batches = await this.store.listBatches(approval.lines.map((line) => line.itemId));
    return {
      approvalId,
      batches: batches
        .filter((batch) => new Decimal(batch.remainingQuantity).gt(0))
        .map(({ id: batchId, ...batch }) => ({ batchId, ...batch })),
    };
  }

  async confirm(input: { approvalId: string; allocations: OutboundAllocationInput[]; reason?: string }): Promise<OutboundOrderResult> {
    const approval = await this.store.getApproval(input.approvalId);
    if (!approval) throw new Error(`approval not found: ${input.approvalId}`);
    if (approval.status !== "PENDING_OUTBOUND") throw new Error("approval is already closed");
    const batches = await this.store.listBatches(approval.lines.map((line) => line.itemId));
    const validation = this.allocator.validate({ lines: approval.lines, batches, allocations: input.allocations, reason: input.reason });
    await this.assertPeriodOpen?.();
    return this.store.commitOutbound(approval, validation, input.reason);
  }

  async cancelBeforeIssue(input: { approvalId: string; reason: string }): Promise<{ approvalId: string; status: "VOIDED" }> {
    await this.assertPeriodOpen?.();
    await this.store.cancelApproval(input.approvalId, input.reason);
    return { approvalId: input.approvalId, status: "VOIDED" };
  }
}
