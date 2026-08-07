import { Decimal } from "decimal.js";
import type { InventoryLedgerEntry } from "../../domain/inventory/ledger.js";
import { OutboundAllocator, type AllocationBatch, type AllocationLine, type OutboundAllocationInput, type AllocationValidationResult } from "./outbound-allocator.js";

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

export interface OutboundStore {
  getApproval(approvalId: string): Promise<PendingApproval | undefined>;
  listPending(): Promise<PendingApproval[]>;
  listBatches(itemIds: string[]): Promise<AllocationBatch[]>;
  commitOutbound(approval: PendingApproval, validation: AllocationValidationResult, reason?: string): Promise<OutboundOrderResult>;
  cancelApproval(approvalId: string, reason: string): Promise<void>;
}

export class InMemoryOutboundStore implements OutboundStore {
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly batchBalances = new Map<string, AllocationBatch>();
  private readonly entries: InventoryLedgerEntry[] = [];
  private readonly orders: OutboundOrderResult[] = [];

  seedApproval(approval: PendingApproval): void { this.approvals.set(approval.id, structuredClone(approval)); }
  seedBatch(batch: AllocationBatch): void { this.batchBalances.set(batch.id, structuredClone(batch)); }
  batch(id: string): AllocationBatch | undefined { const value = this.batchBalances.get(id); return value ? structuredClone(value) : undefined; }
  ledger(): InventoryLedgerEntry[] { return this.entries.map((entry) => ({ ...entry })); }

  async getApproval(approvalId: string): Promise<PendingApproval | undefined> { const value = this.approvals.get(approvalId); return value ? structuredClone(value) : undefined; }
  async listPending(): Promise<PendingApproval[]> { return [...this.approvals.values()].filter((approval) => approval.status === "PENDING_OUTBOUND").map((approval) => structuredClone(approval)); }
  async listBatches(itemIds: string[]): Promise<AllocationBatch[]> { return [...this.batchBalances.values()].filter((batch) => itemIds.includes(batch.itemId)).map((batch) => structuredClone(batch)); }

  async commitOutbound(approval: PendingApproval, validation: AllocationValidationResult, reason?: string): Promise<OutboundOrderResult> {
    const nextBalances = new Map([...this.batchBalances].map(([id, batch]) => [id, structuredClone(batch)]));
    for (const allocation of validation.allocations) {
      const current = nextBalances.get(allocation.batchId);
      if (!current || current.remainingQuantity !== allocation.expectedRemainingQuantity) throw new Error("stock balance changed; retry transaction");
      const remaining = new Decimal(current.remainingQuantity).minus(allocation.quantity);
      if (remaining.lt(0)) throw new Error("batch balance cannot become negative");
      nextBalances.set(current.id, { ...current, remainingQuantity: remaining.toString() });
    }
    this.batchBalances.clear();
    for (const [id, batch] of nextBalances) this.batchBalances.set(id, batch);
    const status = validation.status === "FULL" ? "COMPLETED" : validation.status === "ZERO" ? "UNAVAILABLE" : "PARTIALLY_ISSUED";
    const order: OutboundOrderResult = { id: crypto.randomUUID(), approvalId: approval.id, status, actualQuantity: validation.totalQuantity, amount: validation.amount, reason };
    this.orders.push(order);
    this.approvals.set(approval.id, { ...approval, status });
    for (const allocation of validation.allocations) {
      this.entries.push({ id: crypto.randomUUID(), warehouseId: allocation.warehouseId, itemId: allocation.itemId, batchId: allocation.batchId, type: "OUTBOUND", quantity: new Decimal(allocation.quantity).negated().toString(), unitCost: allocation.unitCost, amount: new Decimal(allocation.quantity).mul(allocation.unitCost).toFixed(2), referenceType: "OUTBOUND_ORDER", referenceId: order.id, occurredAt: new Date().toISOString() });
    }
    return structuredClone(order);
  }

  async cancelApproval(approvalId: string, reason: string): Promise<void> {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error(`approval not found: ${approvalId}`);
    if (approval.status !== "PENDING_OUTBOUND") throw new Error("approval is already closed");
    if (!reason.trim()) throw new Error("reason is required");
    this.approvals.set(approvalId, { ...approval, status: "VOIDED" });
  }
}

export class OutboundService {
  private readonly allocator = new OutboundAllocator();

  constructor(private readonly store: OutboundStore) {}

  listPending(): Promise<PendingApproval[]> { return this.store.listPending(); }

  async listOptions(approvalId: string): Promise<{ approvalId: string; batches: AllocationBatch[] }> {
    const approval = await this.store.getApproval(approvalId);
    if (!approval) throw new Error(`approval not found: ${approvalId}`);
    if (approval.status !== "PENDING_OUTBOUND") throw new Error("approval is already closed");
    return { approvalId, batches: await this.store.listBatches(approval.lines.map((line) => line.itemId)) };
  }

  async confirm(input: { approvalId: string; allocations: OutboundAllocationInput[]; reason?: string }): Promise<OutboundOrderResult> {
    const approval = await this.store.getApproval(input.approvalId);
    if (!approval) throw new Error(`approval not found: ${input.approvalId}`);
    if (approval.status !== "PENDING_OUTBOUND") throw new Error("approval is already closed");
    const batches = await this.store.listBatches(approval.lines.map((line) => line.itemId));
    const validation = this.allocator.validate({ lines: approval.lines, batches, allocations: input.allocations, reason: input.reason });
    return this.store.commitOutbound(approval, validation, input.reason);
  }

  async cancelBeforeIssue(input: { approvalId: string; reason: string }): Promise<{ approvalId: string; status: "VOIDED" }> {
    await this.store.cancelApproval(input.approvalId, input.reason);
    return { approvalId: input.approvalId, status: "VOIDED" };
  }
}
