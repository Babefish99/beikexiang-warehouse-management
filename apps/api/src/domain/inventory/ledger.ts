import { Decimal } from "decimal.js";
import type { ApprovalLine } from "../approvals/approval.js";
import type { AccountingPeriod, AccountingPeriodService } from "../periods/accounting-period.js";
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

export function createInventoryTransactionService({ periodService }: { periodService: AccountingPeriodService }): InventoryTransactionService {
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
      return entries;
    },
    recordTransfer(input) {
      periodService.assertOpen(input.period);
      const source = assertPositive(input.sourceQuantity, "source quantity");
      const destination = assertPositive(input.destinationQuantity, "destination quantity");
      if (!source.eq(destination)) throw new Error("source and destination quantities must be equal");
      if (input.sourceWarehouseId === input.destinationWarehouseId) throw new Error("source and destination warehouses must differ");
      const unitCost = decimal(input.unitCost);
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
