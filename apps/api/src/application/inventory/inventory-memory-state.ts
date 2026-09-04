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
export type InventoryApprovalOutboundStatus = "NONE" | "PENDING_OUTBOUND" | "REAPPLY_REQUIRED" | "COMPLETED" | "PARTIALLY_ISSUED" | "UNAVAILABLE" | "VOIDED" | "REVOCATION_EXCEPTION";

export interface InventoryApprovalLineState {
  id: string;
  requestedItemName: string;
  requestedQuantity: string;
  unit: string;
  note?: string;
  itemId?: string;
  itemOptionKey?: string;
  legacyResolutionStatus: "NOT_APPLICABLE" | "EXACT_LOCKED" | "REAPPLY_REQUIRED";
}

export interface InventoryApprovalState {
  id: string;
  weComSpNo: string;
  sourceTemplateId?: string;
  syncStatus: InventoryApprovalSyncStatus;
  outboundStatus: InventoryApprovalOutboundStatus;
  applicantUserId: string;
  applicantName: string;
  department?: string;
  purpose: string;
  submittedAt: string;
  hasOutboundDecision?: boolean;
  lines: InventoryApprovalLineState[];
}

export interface InventoryIssuedAllocationState {
  id: string;
  outboundOrderId: string;
  outboundDecisionLineId: string;
  warehouseId: string;
  itemId: string;
  batchId: string;
  issuedQuantity: string;
  unitCost: string;
  amount: string;
}

export interface InventoryOutboundDecisionState {
  id: string;
  outboundOrderId: string;
  approvalLineId: string;
  selectedItemId?: string;
  actualQuantity: string;
  varianceReason?: string;
  decidedBy: string;
  decidedAt: string;
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
  outboundDecisions: Map<string, InventoryOutboundDecisionState>;
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
    outboundDecisions: new Map(),
    issuedAllocations: new Map(),
    returnedQuantities: new Map(),
    stocktakeAdjustments: [],
    stockEntrySequence: 1,
  };
}
