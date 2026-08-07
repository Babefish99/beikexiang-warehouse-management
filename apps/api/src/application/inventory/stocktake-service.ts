import { Decimal } from "decimal.js";
import type { AccountingPeriod } from "../../domain/periods/accounting-period.js";
import { InMemoryAccountingPeriodStore, type AccountingPeriodStore } from "../periods/period-close-service.js";
import { createInventoryMemoryState, inventoryBalanceKey, type InventoryMemoryState, type InventoryStocktakeAdjustmentState } from "./inventory-memory-state.js";

export interface StocktakeBalance {
  warehouseId: string;
  itemId: string;
  batchId: string;
  bookQuantity: string;
  unitCost: string;
}

export interface StocktakeAdjustment {
  stocktakeId: string;
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

export class InMemoryStocktakeStore {
  private readonly state: InventoryMemoryState;

  constructor(state: InventoryMemoryState = createInventoryMemoryState()) {
    this.state = state;
  }

  seedBalance(balance: StocktakeBalance): void {
    this.state.balances.set(inventoryBalanceKey(balance.warehouseId, balance.batchId), {
      warehouseId: balance.warehouseId,
      itemId: balance.itemId,
      batchId: balance.batchId,
      remainingQuantity: balance.bookQuantity,
      unitCost: balance.unitCost,
    });
  }

  balance(warehouseId: string, batchId: string): StocktakeBalance | undefined {
    const balance = this.state.balances.get(inventoryBalanceKey(warehouseId, batchId));
    return balance ? { warehouseId: balance.warehouseId, itemId: balance.itemId, batchId: balance.batchId, bookQuantity: balance.remainingQuantity, unitCost: balance.unitCost } : undefined;
  }

  listBalances(): StocktakeBalance[] {
    return [...this.state.balances.values()].map((balance) => ({
      warehouseId: balance.warehouseId,
      itemId: balance.itemId,
      batchId: balance.batchId,
      bookQuantity: balance.remainingQuantity,
      unitCost: balance.unitCost,
    }));
  }

  record(adjustment: StocktakeAdjustment): void {
    const key = inventoryBalanceKey(adjustment.warehouseId, adjustment.batchId);
    const current = this.state.balances.get(key);
    if (!current || current.itemId !== adjustment.itemId) throw new Error("stocktake balance not found");
    this.state.stocktakeAdjustments.push(structuredClone(adjustment));
    this.state.balances.set(key, { ...current, remainingQuantity: adjustment.actualQuantity });
    this.state.ledger.push({
      id: crypto.randomUUID(),
      warehouseId: adjustment.warehouseId,
      itemId: adjustment.itemId,
      batchId: adjustment.batchId,
      type: "STOCKTAKE_ADJUSTMENT",
      quantity: adjustment.quantityDelta,
      unitCost: adjustment.unitCost,
      amount: new Decimal(adjustment.quantityDelta).abs().mul(adjustment.unitCost).toFixed(2),
      referenceType: "STOCKTAKE",
      referenceId: adjustment.stocktakeId,
      occurredAt: adjustment.occurredAt,
    });
  }

  adjustments(): StocktakeAdjustment[] {
    return this.state.stocktakeAdjustments.map((record) => ({ ...record }));
  }
}

export class StocktakeService {
  constructor(private readonly store: InMemoryStocktakeStore, private readonly periodStore: AccountingPeriodStore = new InMemoryAccountingPeriodStore()) {}

  async listOptions(): Promise<{ balances: StocktakeBalance[] }> {
    return { balances: this.store.listBalances() };
  }

  async record(input: { periodCode?: string; period?: Pick<AccountingPeriod, "code">; operatorId?: string; warehouseId: string; itemId: string; batchId: string; bookQuantity: string; actualQuantity: string; reason?: string }): Promise<{ stocktakeId: string; difference: string }> {
    const periodCode = input.periodCode?.trim() || input.period?.code.trim();
    if (!periodCode) throw new Error("period code is required");
    const period = this.periodStore.getOrCreate(periodCode);
    if (period.status !== "OPEN") throw new Error(`closed period: ${period.code}`);
    if (!input.warehouseId.trim() || !input.itemId.trim() || !input.batchId.trim()) throw new Error("warehouse, item, and batch are required");
    const difference = new Decimal(input.actualQuantity).minus(input.bookQuantity);
    if (!difference.isFinite()) throw new Error("stocktake quantity is invalid");
    if (!difference.isZero() && !input.reason?.trim()) throw new Error("reason is required");
    const balance = this.store.balance(input.warehouseId, input.batchId);
    if (!balance || balance.itemId !== input.itemId) throw new Error("stocktake balance not found");
    if (balance.bookQuantity !== input.bookQuantity) throw new Error("stocktake balance changed; reload options");
    const stocktakeId = crypto.randomUUID();
    this.store.record({
      stocktakeId,
      operatorId: input.operatorId?.trim() || "admin",
      occurredAt: new Date().toISOString(),
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      batchId: input.batchId,
      bookQuantity: input.bookQuantity,
      actualQuantity: input.actualQuantity,
      quantityDelta: difference.toString(),
      unitCost: balance.unitCost,
      reason: input.reason,
    });
    return { stocktakeId, difference: difference.toString() };
  }
}
