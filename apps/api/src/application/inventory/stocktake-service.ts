import { Decimal } from "decimal.js";
import type { InventoryLedgerEntry } from "../../domain/inventory/ledger.js";
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

export interface StocktakeStore {
  balance(warehouseId: string, batchId: string): StocktakeBalance | undefined | Promise<StocktakeBalance | undefined>;
  listBalances(): StocktakeBalance[] | Promise<StocktakeBalance[]>;
  record(adjustment: StocktakeAdjustment): void | Promise<void>;
}

export class InMemoryStocktakeStore implements StocktakeStore {
  private readonly state: InventoryMemoryState;

  constructor(state: InventoryMemoryState = createInventoryMemoryState()) {
    this.state = state;
  }

  seedBalance(balance: StocktakeBalance): void {
    const key = inventoryBalanceKey(balance.warehouseId, balance.batchId);
    const previous = this.state.balances.get(key);
    const batch = this.state.batches.get(balance.batchId);
    const nextBatchRemaining = new Decimal(batch?.remainingQuantity ?? "0")
      .minus(previous?.remainingQuantity ?? "0")
      .plus(balance.bookQuantity)
      .toString();
    this.state.balances.set(key, {
      warehouseId: balance.warehouseId,
      itemId: balance.itemId,
      batchId: balance.batchId,
      remainingQuantity: balance.bookQuantity,
      unitCost: balance.unitCost,
    });
    this.state.batches.set(balance.batchId, batch
      ? { ...batch, remainingQuantity: nextBatchRemaining }
      : {
          id: balance.batchId,
          warehouseId: balance.warehouseId,
          itemId: balance.itemId,
          batchNo: balance.batchId,
          quantity: balance.bookQuantity,
          remainingQuantity: nextBatchRemaining,
          unitCost: balance.unitCost,
          purchasedAt: new Date(0).toISOString(),
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
    const batch = this.state.batches.get(adjustment.batchId);
    if (!batch || batch.itemId !== adjustment.itemId) throw new Error("stocktake batch not found");
    const quantityDelta = new Decimal(adjustment.quantityDelta);
    const balanceTotal = [...this.state.balances.values()]
      .filter((candidate) => candidate.batchId === adjustment.batchId)
      .reduce((total, candidate) => total.plus(candidate.remainingQuantity), new Decimal(0));
    if (
      current.remainingQuantity !== adjustment.bookQuantity
      || !new Decimal(adjustment.actualQuantity).minus(adjustment.bookQuantity).eq(quantityDelta)
      || !balanceTotal.eq(batch.remainingQuantity)
    ) {
      throw new Error("stocktake balance changed; retry transaction");
    }
    const nextBatchRemaining = new Decimal(batch.remainingQuantity).plus(quantityDelta);
    if (nextBatchRemaining.isNegative()) throw new Error("batch balance cannot become negative");
    const nextBalance = { ...current, remainingQuantity: adjustment.actualQuantity };
    const nextBatch = { ...batch, remainingQuantity: nextBatchRemaining.toString() };
    const ledgerEntry: InventoryLedgerEntry = {
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
    };
    this.state.stocktakeAdjustments.push(structuredClone(adjustment));
    this.state.balances.set(key, nextBalance);
    this.state.batches.set(batch.id, nextBatch);
    this.state.ledger.push(ledgerEntry);
  }

  adjustments(): StocktakeAdjustment[] {
    return this.state.stocktakeAdjustments.map((record) => ({ ...record }));
  }
}

export class StocktakeService {
  constructor(private readonly store: StocktakeStore, private readonly periodStore: AccountingPeriodStore = new InMemoryAccountingPeriodStore()) {}

  async listOptions(): Promise<{ balances: StocktakeBalance[] }> {
    return { balances: await this.store.listBalances() };
  }

  async record(input: { periodCode?: string; period?: Pick<AccountingPeriod, "code">; operatorId?: string; warehouseId: string; itemId: string; batchId: string; bookQuantity: string; actualQuantity: string; reason?: string }): Promise<{ stocktakeId: string; difference: string }> {
    const periodCode = input.periodCode?.trim() || input.period?.code.trim();
    if (!periodCode) throw new Error("period code is required");
    const period = await this.periodStore.getOrCreate(periodCode);
    if (period.status !== "OPEN") throw new Error(`closed period: ${period.code}`);
    if (!input.warehouseId.trim() || !input.itemId.trim() || !input.batchId.trim()) throw new Error("warehouse, item, and batch are required");
    const actualQuantity = new Decimal(input.actualQuantity);
    if (!actualQuantity.isFinite() || actualQuantity.isNegative()) throw new Error("stocktake quantity is invalid");
    const difference = actualQuantity.minus(input.bookQuantity);
    if (!difference.isZero() && !input.reason?.trim()) throw new Error("reason is required");
    const balance = await this.store.balance(input.warehouseId, input.batchId);
    if (!balance || balance.itemId !== input.itemId) throw new Error("stocktake balance not found");
    if (balance.bookQuantity !== input.bookQuantity) throw new Error("stocktake balance changed; reload options");
    const stocktakeId = crypto.randomUUID();
    await this.store.record({
      stocktakeId,
      periodCode,
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
