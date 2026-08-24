import type { InventoryLedgerEntry } from "../../domain/inventory/ledger.js";
import type { OpeningStockImportResult } from "./opening-stock-import-contract.js";

export interface InventoryBatchState {
  id: string;
  warehouseId: string;
  itemId: string;
  batchNo: string;
  quantity: string;
  remainingQuantity: string;
  unitCost: string;
  purchasedAt: string;
  productionDate?: string;
  expiryDate?: string;
  purchaser?: string;
}

export interface InventoryBalanceState {
  warehouseId: string;
  itemId: string;
  batchId: string;
  remainingQuantity: string;
  unitCost: string;
}

export type InventoryApprovalSyncStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED" | "CANCELED" | "DELETED" | "UNKNOWN";
export type InventoryApprovalOutboundStatus = "NONE" | "PENDING_OUTBOUND" | "COMPLETED" | "PARTIALLY_ISSUED" | "UNAVAILABLE" | "VOIDED";

export interface InventoryApprovalLineState {
  id: string;
  itemId: string;
  requestedQuantity: string;
  unit: string;
  itemOptionKey?: string;
  itemName?: string;
}

export interface InventoryApprovalState {
  id: string;
  weComSpNo: string;
  syncStatus: InventoryApprovalSyncStatus;
  outboundStatus: InventoryApprovalOutboundStatus;
  applicantUserId: string;
  applicantName: string;
  department?: string;
  purpose: string;
  submittedAt: string;
  lines: InventoryApprovalLineState[];
}

export interface InventoryIssuedAllocationState {
  id: string;
  outboundOrderId: string;
  warehouseId: string;
  itemId: string;
  batchId: string;
  issuedQuantity: string;
  unitCost: string;
}

export interface InventoryStocktakeAdjustmentState {
  stocktakeId: string;
  periodCode: string;
  operatorId: string;
  occurredAt: string;
  warehouseId: string;
  itemId: string;
  batchId: string;
  bookQuantity: string;
  actualQuantity: string;
  quantityDelta: string;
  unitCost: string;
  reason?: string;
}

export interface InventoryMemoryState {
  batches: Map<string, InventoryBatchState>;
  balances: Map<string, InventoryBalanceState>;
  ledger: InventoryLedgerEntry[];
  approvals: Map<string, InventoryApprovalState>;
  approvalsBySpNo: Map<string, string>;
  issuedAllocations: Map<string, InventoryIssuedAllocationState>;
  returnedQuantities: Map<string, string>;
  stocktakeAdjustments: InventoryStocktakeAdjustmentState[];
  stockEntrySequence: number;
  openingStockImport?: OpeningStockImportResult;
}

export function inventoryBalanceKey(warehouseId: string, batchId: string): string {
  return `${warehouseId}:${batchId}`;
}

export function createInventoryMemoryState(): InventoryMemoryState {
  return {
    batches: new Map(),
    balances: new Map(),
    ledger: [],
    approvals: new Map(),
    approvalsBySpNo: new Map(),
    issuedAllocations: new Map(),
    returnedQuantities: new Map(),
    stocktakeAdjustments: [],
    stockEntrySequence: 1,
  };
}
