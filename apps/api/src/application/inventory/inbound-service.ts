import { assertNonNegative, decimal } from "../../domain/inventory/invariants.js";
import type { InventoryLedgerEntry } from "../../domain/inventory/ledger.js";
import { createInventoryMemoryState, inventoryBalanceKey, type InventoryBalanceState, type InventoryBatchState, type InventoryMemoryState } from "./inventory-memory-state.js";

export interface InboundInput {
  warehouseId: string;
  itemId: string;
  batchNo: string;
  quantity: string;
  unitCost: string;
  purchasedAt: string;
  productionDate?: string;
  expiryDate?: string;
  purchaser?: string;
  remark?: string;
}

export interface StoredBatch {
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

interface StockEntryInput extends InboundInput {
  ledgerType: "INBOUND" | "OPENING_BALANCE";
  referenceType: "INBOUND_ORDER" | "OPENING_STOCK";
  referenceId: string;
  occurredAt: string;
}

export interface InventoryEntryStore {
  recordStockEntry(input: StockEntryInput): Promise<{ orderId: string; batchId: string }>;
}

export interface ActiveMasterDataLookup {
  list(includeInactive?: boolean): Promise<Array<{ id: string; isActive: boolean }>>;
}

export interface InventoryMasterDataServices {
  warehouseService: ActiveMasterDataLookup;
  itemService: ActiveMasterDataLookup;
}

export async function assertActiveMasterData(services: InventoryMasterDataServices, warehouseId: string, itemId: string): Promise<void> {
  const [warehouses, items] = await Promise.all([
    services.warehouseService.list(true),
    services.itemService.list(true),
  ]);
  if (!warehouses.some((warehouse) => warehouse.id === warehouseId && warehouse.isActive)) {
    throw new Error("warehouse is inactive or not found");
  }
  if (!items.some((item) => item.id === itemId && item.isActive)) {
    throw new Error("item is inactive or not found");
  }
}

export class InMemoryInventoryEntryStore implements InventoryEntryStore {
  private readonly state: InventoryMemoryState;

  constructor(stateOrOptions: InventoryMemoryState | { onRecordStockEntry?: (input: { itemId: string }) => void } = {}, maybeOptions: { onRecordStockEntry?: (input: { itemId: string }) => void } = {}) {
    const hasState = "batches" in stateOrOptions;
    this.state = hasState ? stateOrOptions : createInventoryMemoryState();
    this.options = hasState ? maybeOptions : stateOrOptions;
  }

  private readonly options: { onRecordStockEntry?: (input: { itemId: string }) => void };

  async recordStockEntry(input: StockEntryInput): Promise<{ orderId: string; batchId: string }> {
    const batchId = `batch-${String(this.state.stockEntrySequence).padStart(4, "0")}`;
    const orderId = `${input.referenceType.toLowerCase()}-${String(this.state.stockEntrySequence).padStart(4, "0")}`;
    this.state.stockEntrySequence += 1;
    const batch: InventoryBatchState = { id: batchId, warehouseId: input.warehouseId, itemId: input.itemId, batchNo: input.batchNo, quantity: input.quantity, remainingQuantity: input.quantity, unitCost: input.unitCost, purchasedAt: input.purchasedAt, productionDate: input.productionDate, expiryDate: input.expiryDate, purchaser: input.purchaser };
    const balance: InventoryBalanceState = { warehouseId: input.warehouseId, itemId: input.itemId, batchId, remainingQuantity: input.quantity, unitCost: input.unitCost };
    this.state.batches.set(batchId, batch);
    this.state.balances.set(inventoryBalanceKey(input.warehouseId, batchId), balance);
    const quantity = decimal(input.quantity);
    const unitCost = decimal(input.unitCost);
    this.state.ledger.push({ id: crypto.randomUUID(), warehouseId: input.warehouseId, itemId: input.itemId, batchId, type: input.ledgerType, quantity: quantity.toString(), unitCost: unitCost.toString(), amount: quantity.mul(unitCost).toFixed(2), referenceType: input.referenceType, referenceId: input.referenceId, occurredAt: input.occurredAt });
    this.options.onRecordStockEntry?.({ itemId: input.itemId });
    return { orderId, batchId };
  }

  batches(): StoredBatch[] { return [...this.state.batches.values()].map((batch) => ({ ...batch })); }
  balances(): Array<{ warehouseId: string; itemId: string; batchId: string; remainingQuantity: string; unitCost: string }> { return [...this.state.balances.values()].map((balance) => ({ ...balance })); }
  ledger(): InventoryLedgerEntry[] { return this.state.ledger.map((entry) => ({ ...entry })); }
}

function assertDate(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
  return date.toISOString();
}

export class InboundService {
  constructor(private readonly store: InventoryEntryStore, private readonly masterData: InventoryMasterDataServices) {}

  async create(input: InboundInput): Promise<{ inboundId: string; batchIds: string[] }> {
    if (!input.warehouseId.trim()) throw new Error("warehouse is required");
    if (!input.itemId.trim()) throw new Error("item is required");
    await assertActiveMasterData(this.masterData, input.warehouseId, input.itemId);
    if (!input.batchNo.trim()) throw new Error("batch number is required");
    const quantity = assertNonNegative(input.quantity, "quantity");
    const unitCost = assertNonNegative(input.unitCost, "unit cost");
    if (unitCost.isZero() && !input.remark?.trim()) throw new Error("remark is required when unit cost is zero");
    const purchasedAt = assertDate(input.purchasedAt, "purchasedAt");
    const result = await this.store.recordStockEntry({ ...input, quantity: quantity.toString(), unitCost: unitCost.toString(), purchasedAt, productionDate: input.productionDate ? assertDate(input.productionDate, "productionDate") : undefined, expiryDate: input.expiryDate ? assertDate(input.expiryDate, "expiryDate") : undefined, ledgerType: "INBOUND", referenceType: "INBOUND_ORDER", referenceId: `inbound-${Date.now()}`, occurredAt: new Date().toISOString() });
    return { inboundId: result.orderId, batchIds: [result.batchId] };
  }
}
