import { Decimal } from "decimal.js";
import type { AccountingPeriod } from "../../domain/periods/accounting-period.js";

export interface StocktakeAdjustment { stocktakeId: string; operatorId: string; warehouseId: string; itemId: string; batchId: string; quantityDelta: string; reason?: string }

export class InMemoryStocktakeStore {
  private readonly records: StocktakeAdjustment[] = [];
  record(adjustment: StocktakeAdjustment): void { this.records.push(structuredClone(adjustment)); }
  adjustments(): StocktakeAdjustment[] { return this.records.map((record) => ({ ...record })); }
}

export class StocktakeService {
  constructor(private readonly store: InMemoryStocktakeStore) {}

  async record(input: { period: AccountingPeriod; operatorId: string; warehouseId: string; itemId: string; batchId: string; bookQuantity: string; actualQuantity: string; reason?: string }): Promise<{ stocktakeId: string; difference: string }> {
    if (input.period.status !== "OPEN") throw new Error(`closed period: ${input.period.code}`);
    const difference = new Decimal(input.actualQuantity).minus(input.bookQuantity);
    if (!difference.isFinite()) throw new Error("stocktake quantity is invalid");
    if (!difference.isZero() && !input.reason?.trim()) throw new Error("reason is required");
    const stocktakeId = crypto.randomUUID();
    this.store.record({ stocktakeId, operatorId: input.operatorId, warehouseId: input.warehouseId, itemId: input.itemId, batchId: input.batchId, quantityDelta: difference.toString(), reason: input.reason });
    return { stocktakeId, difference: difference.toString() };
  }
}
