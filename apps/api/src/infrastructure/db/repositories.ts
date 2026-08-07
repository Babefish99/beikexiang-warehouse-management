import type { InventoryLedgerEntry } from "../../domain/inventory/ledger.js";
import { Decimal } from "decimal.js";
import type { BatchBalance, StockBalanceRepository } from "../../domain/inventory/batch.js";

export interface InventoryLedgerRepository {
  append(entry: InventoryLedgerEntry): Promise<InventoryLedgerEntry>;
  listByReference(referenceType: string, referenceId: string): Promise<InventoryLedgerEntry[]>;
}

export class InMemoryInventoryLedgerRepository implements InventoryLedgerRepository {
  private readonly entries: InventoryLedgerEntry[] = [];

  async append(entry: InventoryLedgerEntry): Promise<InventoryLedgerEntry> {
    this.entries.push(entry);
    return entry;
  }

  async listByReference(referenceType: string, referenceId: string): Promise<InventoryLedgerEntry[]> {
    return this.entries.filter((entry) => entry.referenceType === referenceType && entry.referenceId === referenceId);
  }
}

export function createInMemoryStockBalanceRepository(): StockBalanceRepository & { get(warehouseId: string, batchId: string): BatchBalance | undefined } {
  const balances = new Map<string, BatchBalance>();
  const keyOf = (warehouseId: string, batchId: string) => `${warehouseId}:${batchId}`;
  return {
    seed(balance) { balances.set(keyOf(balance.warehouseId, balance.batchId), { ...balance }); },
    get(warehouseId, batchId) { return balances.get(keyOf(warehouseId, batchId)); },
    decrementMany(input) {
      const next = new Map([...balances].map(([key, value]) => [key, { ...value }]));
      for (const allocation of input) {
        const current = next.get(keyOf(allocation.warehouseId, allocation.batchId));
        if (!current || current.itemId !== allocation.itemId) throw new Error("stock balance batch not found");
        if (!new Decimal(current.remainingQuantity).eq(allocation.expectedRemainingQuantity)) throw new Error("stock balance changed; retry transaction");
        const remaining = new Decimal(current.remainingQuantity).minus(allocation.quantity);
        if (remaining.lt(0)) throw new Error("batch balance cannot become negative");
        next.set(keyOf(current.warehouseId, current.batchId), { ...current, remainingQuantity: remaining.toString() });
      }
      balances.clear();
      for (const [key, value] of next) balances.set(key, value);
    },
    transfer(input) {
      const sourceKey = keyOf(input.sourceWarehouseId, input.batchId);
      const destinationKey = keyOf(input.destinationWarehouseId, input.batchId);
      const source = balances.get(sourceKey);
      if (!source || source.itemId !== input.itemId) throw new Error("source stock balance not found");
      const quantity = new Decimal(input.quantity);
      const remaining = new Decimal(source.remainingQuantity).minus(quantity);
      if (remaining.lt(0)) throw new Error("batch balance cannot become negative");
      const destination = balances.get(destinationKey) ?? { batchId: input.batchId, warehouseId: input.destinationWarehouseId, itemId: input.itemId, remainingQuantity: "0", unitCost: input.unitCost };
      if (destination.unitCost !== input.unitCost) throw new Error("transferred batch cost cannot change");
      balances.set(sourceKey, { ...source, remainingQuantity: remaining.toString() });
      balances.set(destinationKey, { ...destination, remainingQuantity: new Decimal(destination.remainingQuantity).plus(quantity).toString() });
    },
  };
}
