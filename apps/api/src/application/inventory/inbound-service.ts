import { assertNonNegative, decimal } from "../../domain/inventory/invariants.js";
import type { InventoryLedgerEntry } from "../../domain/inventory/ledger.js";
import { nextInboundBatchNo } from "./batch-number.js";
import { createInventoryMemoryState, inventoryBalanceKey, type InventoryBalanceState, type InventoryBatchState, type InventoryMemoryState } from "./inventory-memory-state.js";

export interface InboundInput {
  warehouseId: string;
  itemId: string;
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

export interface StockEntryInput extends InboundInput {
  autoGenerateBatchNo: boolean;
  batchNo?: string;
  ledgerType: "INBOUND" | "OPENING_BALANCE";
  referenceType: "INBOUND_ORDER" | "OPENING_STOCK";
  referenceId: string;
  occurredAt: string;
  operatorId?: string;
}

export interface OpeningStockEntryInput {
  operatorId: string;
  referenceId: string;
  occurredAt: string;
  rows: Array<InboundInput & { batchNo: string }>;
}

export interface InventoryEntryStore {
  recordStockEntry(input: StockEntryInput): Promise<{ orderId: string; batchId: string; batchNo: string }>;
  recordOpeningStock(input: OpeningStockEntryInput): Promise<{ orderIds: string[]; batchIds: string[] }>;
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

  async recordStockEntry(input: StockEntryInput): Promise<{ orderId: string; batchId: string; batchNo: string }> {
    const batchId = `batch-${String(this.state.stockEntrySequence).padStart(4, "0")}`;
    const orderId = `${input.referenceType.toLowerCase()}-${String(this.state.stockEntrySequence).padStart(4, "0")}`;
    this.state.stockEntrySequence += 1;
    const batchNo = input.autoGenerateBatchNo
      ? nextInboundBatchNo(input.purchasedAt, [...this.state.batches.values()].map((batch) => batch.batchNo))
      : input.batchNo;
    if (!batchNo) throw new Error("batch number is required");
    const batch: InventoryBatchState = { id: batchId, warehouseId: input.warehouseId, itemId: input.itemId, batchNo, quantity: input.quantity, remainingQuantity: input.quantity, unitCost: input.unitCost, purchasedAt: input.purchasedAt, productionDate: input.productionDate, expiryDate: input.expiryDate, purchaser: input.purchaser };
    const balance: InventoryBalanceState = { warehouseId: input.warehouseId, itemId: input.itemId, batchId, remainingQuantity: input.quantity, unitCost: input.unitCost };
    this.state.batches.set(batchId, batch);
    this.state.balances.set(inventoryBalanceKey(input.warehouseId, batchId), balance);
    const quantity = decimal(input.quantity);
    const unitCost = decimal(input.unitCost);
    this.state.ledger.push({ id: crypto.randomUUID(), warehouseId: input.warehouseId, itemId: input.itemId, batchId, type: input.ledgerType, quantity: quantity.toString(), unitCost: unitCost.toString(), amount: quantity.mul(unitCost).toFixed(2), referenceType: input.referenceType, referenceId: input.referenceId, occurredAt: input.occurredAt });
    this.options.onRecordStockEntry?.({ itemId: input.itemId });
    return { orderId, batchId, batchNo };
  }

  async recordOpeningStock(input: OpeningStockEntryInput): Promise<{ orderIds: string[]; batchIds: string[] }> {
    const existingBatchKeys = new Set(
      [...this.state.batches.values()].map((batch) => `${batch.warehouseId}\u0000${batch.itemId}\u0000${batch.batchNo}`),
    );
    const requestBatchKeys = new Set<string>();
    for (const row of input.rows) {
      const key = `${row.warehouseId}\u0000${row.itemId}\u0000${row.batchNo}`;
      if (existingBatchKeys.has(key) || requestBatchKeys.has(key)) throw new Error("batch number already exists");
      requestBatchKeys.add(key);
    }

    const orderIdsByWarehouse = new Map<string, string>();
    for (const row of input.rows) {
      if (!orderIdsByWarehouse.has(row.warehouseId)) {
        const suffix = orderIdsByWarehouse.size === 0 ? "" : `-${orderIdsByWarehouse.size + 1}`;
        orderIdsByWarehouse.set(row.warehouseId, `${input.referenceId}${suffix}`);
      }
    }
    const drafts = input.rows.map((row, index) => {
      const batchId = `batch-${String(this.state.stockEntrySequence + index).padStart(4, "0")}`;
      const quantity = decimal(row.quantity);
      const unitCost = decimal(row.unitCost);
      return { row, batchId, orderId: orderIdsByWarehouse.get(row.warehouseId)!, quantity, unitCost };
    });

    for (const { row, batchId, orderId, quantity, unitCost } of drafts) {
      this.state.batches.set(batchId, { id: batchId, warehouseId: row.warehouseId, itemId: row.itemId, batchNo: row.batchNo, quantity: row.quantity, remainingQuantity: row.quantity, unitCost: row.unitCost, purchasedAt: row.purchasedAt, productionDate: row.productionDate, expiryDate: row.expiryDate, purchaser: row.purchaser });
      this.state.balances.set(inventoryBalanceKey(row.warehouseId, batchId), { warehouseId: row.warehouseId, itemId: row.itemId, batchId, remainingQuantity: row.quantity, unitCost: row.unitCost });
      this.state.ledger.push({ id: crypto.randomUUID(), warehouseId: row.warehouseId, itemId: row.itemId, batchId, type: "OPENING_BALANCE", quantity: quantity.toString(), unitCost: unitCost.toString(), amount: quantity.mul(unitCost).toFixed(2), referenceType: "OPENING_STOCK", referenceId: orderId, occurredAt: input.occurredAt });
      this.options.onRecordStockEntry?.({ itemId: row.itemId });
    }
    this.state.stockEntrySequence += drafts.length;
    return { orderIds: [...orderIdsByWarehouse.values()], batchIds: drafts.map(({ batchId }) => batchId) };
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
  constructor(private readonly store: InventoryEntryStore, private readonly masterData: InventoryMasterDataServices, private readonly assertPeriodOpen?: () => void | Promise<void>) {}

  async create(input: InboundInput): Promise<{ inboundId: string; batchIds: string[]; batchNo: string }> {
    if (!input.warehouseId.trim()) throw new Error("warehouse is required");
    if (!input.itemId.trim()) throw new Error("item is required");
    await assertActiveMasterData(this.masterData, input.warehouseId, input.itemId);
    const quantity = assertNonNegative(input.quantity, "quantity");
    const unitCost = assertNonNegative(input.unitCost, "unit cost");
    if (unitCost.isZero() && !input.remark?.trim()) throw new Error("remark is required when unit cost is zero");
    await this.assertPeriodOpen?.();
    const purchasedAt = assertDate(input.purchasedAt, "purchasedAt");
    const result = await this.store.recordStockEntry({ ...input, quantity: quantity.toString(), unitCost: unitCost.toString(), purchasedAt, productionDate: input.productionDate ? assertDate(input.productionDate, "productionDate") : undefined, expiryDate: input.expiryDate ? assertDate(input.expiryDate, "expiryDate") : undefined, autoGenerateBatchNo: true, ledgerType: "INBOUND", referenceType: "INBOUND_ORDER", referenceId: `inbound-${Date.now()}`, occurredAt: new Date().toISOString() });
    return { inboundId: result.orderId, batchIds: [result.batchId], batchNo: result.batchNo };
  }
}
