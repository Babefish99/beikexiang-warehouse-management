import { Decimal } from "decimal.js";
import type { ApprovalLine } from "../approvals/approval.js";
import type { AccountingPeriod, AccountingPeriodService } from "../periods/accounting-period.js";
import type { BatchBalance, StockBalanceRepository } from "./batch.js";
import { assertPositive, decimal } from "./invariants.js";

export interface InventoryLedgerEntry {
  id: string;
  warehouseId: string;
  itemId: string;
  batchId?: string;
  type: string;
  quantity: string;
  unitCost: string;
  amount: string;
  referenceType: string;
  referenceId: string;
  occurredAt: string;
}

export interface OutboundAllocationInput {
  warehouseId: string;
  itemId: string;
  batchId: string;
  quantity: string;
  remainingQuantity: string;
  unitCost: string;
}

class LocalStockBalanceRepository implements StockBalanceRepository {
  private readonly balances = new Map<string, BatchBalance>();

  seed(balance: BatchBalance): void { this.balances.set(`${balance.warehouseId}:${balance.batchId}`, { ...balance }); }
  get(warehouseId: string, batchId: string): BatchBalance | undefined { return this.balances.get(`${warehouseId}:${batchId}`); }
  decrementMany(input: Array<{ warehouseId: string; itemId: string; batchId: string; quantity: string; expectedRemainingQuantity: string }>): void {
    const next = new Map(this.balances);
    for (const allocation of input) {
      const key = `${allocation.warehouseId}:${allocation.batchId}`;
      const current = next.get(key);
      if (!current || current.itemId !== allocation.itemId) throw new Error("stock balance batch not found");
      if (!decimal(current.remainingQuantity).eq(allocation.expectedRemainingQuantity)) throw new Error("stock balance changed; retry transaction");
      const remaining = decimal(current.remainingQuantity).minus(allocation.quantity);
      if (remaining.lt(0)) throw new Error("batch balance cannot become negative");
      next.set(key, { ...current, remainingQuantity: remaining.toString() });
    }
    this.balances.clear();
    for (const [key, value] of next) this.balances.set(key, value);
  }
  transfer(input: { sourceWarehouseId: string; destinationWarehouseId: string; itemId: string; batchId: string; quantity: string; unitCost: string }): void {
    const sourceKey = `${input.sourceWarehouseId}:${input.batchId}`;
    const destinationKey = `${input.destinationWarehouseId}:${input.batchId}`;
    const source = this.balances.get(sourceKey);
    if (!source || source.itemId !== input.itemId) throw new Error("source stock balance not found");
    const quantity = decimal(input.quantity);
    const remaining = decimal(source.remainingQuantity).minus(quantity);
    if (remaining.lt(0)) throw new Error("batch balance cannot become negative");
    const destination = this.balances.get(destinationKey) ?? { batchId: input.batchId, warehouseId: input.destinationWarehouseId, itemId: input.itemId, remainingQuantity: "0", unitCost: input.unitCost };
    if (destination.unitCost !== input.unitCost) throw new Error("transferred batch cost cannot change");
    this.balances.set(sourceKey, { ...source, remainingQuantity: remaining.toString() });
    this.balances.set(destinationKey, { ...destination, remainingQuantity: decimal(destination.remainingQuantity).plus(quantity).toString() });
  }
}

export interface InventoryTransactionService {
  recordInbound(input: { period: AccountingPeriod; warehouseId: string; itemId: string; batchId: string; quantity: string; unitCost: string; referenceId: string }): InventoryLedgerEntry[];
  recordOutbound(input: { period: AccountingPeriod; approvalLine: ApprovalLine; allocations: OutboundAllocationInput[]; reason?: string }): InventoryLedgerEntry[];
  recordTransfer(input: { period: AccountingPeriod; referenceId: string; itemId: string; batchId: string; sourceWarehouseId: string; destinationWarehouseId: string; sourceQuantity: string; destinationQuantity: string; unitCost: string; reason: string }): InventoryLedgerEntry[];
  recordReturn(input: { period: AccountingPeriod; originalAllocation: { outboundAllocationId: string; warehouseId: string; itemId: string; batchId: string; issuedQuantity: string; unitCost: string }; returnQuantity: string; reason: string }): InventoryLedgerEntry;
  recordAdjustment(input: { period: AccountingPeriod; warehouseId: string; itemId: string; batchId: string; quantityDelta: string; unitCost: string; reason: string }): InventoryLedgerEntry;
  assertRecordDeletionAllowed(input: { confirmed: boolean; referenceType: string }): void;
}

function amount(quantity: Decimal, unitCost: Decimal): string {
  return quantity.mul(unitCost).toFixed(2);
}

export function createInventoryTransactionService({ periodService, stockBalanceRepository = new LocalStockBalanceRepository() }: { periodService: AccountingPeriodService; stockBalanceRepository?: StockBalanceRepository }): InventoryTransactionService {
  return {
    recordInbound(input) {
      periodService.assertOpen(input.period);
      const quantity = assertPositive(input.quantity, "quantity");
      const unitCost = decimal(input.unitCost);
      return [{ id: crypto.randomUUID(), warehouseId: input.warehouseId, itemId: input.itemId, batchId: input.batchId, type: "INBOUND", quantity: quantity.toString(), unitCost: unitCost.toString(), amount: amount(quantity, unitCost), referenceType: "INBOUND_ORDER", referenceId: input.referenceId, occurredAt: new Date().toISOString() }];
    },
    recordOutbound(input) {
      periodService.assertOpen(input.period);
      const requested = assertPositive(input.approvalLine.requestedQuantity, "approved quantity");
      const total = input.allocations.reduce((sum, allocation) => sum.plus(decimal(allocation.quantity)), new Decimal(0));
      if (total.gt(requested)) throw new Error("actual quantity exceeds approved quantity");
      if (!total.eq(requested) && !input.reason?.trim()) throw new Error("reason is required for partial or zero issue");
      if (total.eq(0) && !input.reason?.trim()) throw new Error("reason is required when nothing is issued");
      const entries: InventoryLedgerEntry[] = [];
      for (const allocation of input.allocations) {
        if (allocation.itemId !== input.approvalLine.itemId) throw new Error("item substitution is not allowed");
        const quantity = assertPositive(allocation.quantity, "quantity");
        const remaining = decimal(allocation.remainingQuantity);
        if (quantity.gt(remaining)) throw new Error("batch balance cannot become negative");
        const unitCost = decimal(allocation.unitCost);
        entries.push({ id: crypto.randomUUID(), warehouseId: allocation.warehouseId, itemId: allocation.itemId, batchId: allocation.batchId, type: "OUTBOUND", quantity: quantity.negated().toString(), unitCost: unitCost.toString(), amount: amount(quantity, unitCost), referenceType: "OUTBOUND_ORDER", referenceId: input.approvalLine.approvalId, occurredAt: new Date().toISOString() });
      }
      for (const allocation of input.allocations) {
        if (!stockBalanceRepository.get(allocation.warehouseId, allocation.batchId)) throw new Error("stock balance batch not found");
      }
      stockBalanceRepository.decrementMany(input.allocations.map((allocation) => ({ ...allocation, expectedRemainingQuantity: allocation.remainingQuantity })));
      return entries;
    },
    recordTransfer(input) {
      periodService.assertOpen(input.period);
      const source = assertPositive(input.sourceQuantity, "source quantity");
      const destination = assertPositive(input.destinationQuantity, "destination quantity");
      if (!source.eq(destination)) throw new Error("source and destination quantities must be equal");
      if (input.sourceWarehouseId === input.destinationWarehouseId) throw new Error("source and destination warehouses must differ");
      const unitCost = decimal(input.unitCost);
      if (!stockBalanceRepository.get(input.sourceWarehouseId, input.batchId)) throw new Error("source stock balance not found");
      stockBalanceRepository.transfer({ sourceWarehouseId: input.sourceWarehouseId, destinationWarehouseId: input.destinationWarehouseId, itemId: input.itemId, batchId: input.batchId, quantity: source.toString(), unitCost: unitCost.toString() });
      return [
        { id: crypto.randomUUID(), warehouseId: input.sourceWarehouseId, itemId: input.itemId, batchId: input.batchId, type: "TRANSFER_OUT", quantity: source.negated().toString(), unitCost: unitCost.toString(), amount: amount(source, unitCost), referenceType: "TRANSFER_ORDER", referenceId: input.referenceId, occurredAt: new Date().toISOString() },
        { id: crypto.randomUUID(), warehouseId: input.destinationWarehouseId, itemId: input.itemId, batchId: input.batchId, type: "TRANSFER_IN", quantity: destination.toString(), unitCost: unitCost.toString(), amount: amount(destination, unitCost), referenceType: "TRANSFER_ORDER", referenceId: input.referenceId, occurredAt: new Date().toISOString() },
      ];
    },
    recordReturn(input) {
      periodService.assertOpen(input.period);
      const returned = assertPositive(input.returnQuantity, "return quantity");
      if (returned.gt(decimal(input.originalAllocation.issuedQuantity))) throw new Error("return quantity exceeds original issued quantity");
      if (!input.reason.trim()) throw new Error("reason is required");
      const unitCost = decimal(input.originalAllocation.unitCost);
      return { id: crypto.randomUUID(), warehouseId: input.originalAllocation.warehouseId, itemId: input.originalAllocation.itemId, batchId: input.originalAllocation.batchId, type: "RETURN", quantity: returned.toString(), unitCost: unitCost.toString(), amount: amount(returned, unitCost), referenceType: "OUTBOUND_ALLOCATION", referenceId: input.originalAllocation.outboundAllocationId, occurredAt: new Date().toISOString() };
    },
    recordAdjustment(input) {
      periodService.assertOpen(input.period);
      if (!input.reason.trim()) throw new Error("reason is required");
      const delta = decimal(input.quantityDelta);
      const unitCost = decimal(input.unitCost);
      return { id: crypto.randomUUID(), warehouseId: input.warehouseId, itemId: input.itemId, batchId: input.batchId, type: "ADJUSTMENT", quantity: delta.toString(), unitCost: unitCost.toString(), amount: amount(delta.abs(), unitCost), referenceType: "STOCK_ADJUSTMENT", referenceId: input.batchId, occurredAt: new Date().toISOString() };
    },
    assertRecordDeletionAllowed(input) {
      if (input.confirmed) throw new Error(`confirmed records cannot be deleted: ${input.referenceType}`);
    },
  };
}
