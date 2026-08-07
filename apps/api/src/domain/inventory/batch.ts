export interface BatchBalance {
  batchId: string;
  warehouseId: string;
  itemId: string;
  remainingQuantity: string;
  unitCost: string;
}

export interface StockBalanceRepository {
  seed(balance: BatchBalance): void;
  get(warehouseId: string, batchId: string): BatchBalance | undefined;
  decrementMany(input: Array<{ warehouseId: string; itemId: string; batchId: string; quantity: string; expectedRemainingQuantity: string }>): void;
  transfer(input: { sourceWarehouseId: string; destinationWarehouseId: string; itemId: string; batchId: string; quantity: string; unitCost: string }): void;
}

export function assertBatchMatches(balance: BatchBalance, warehouseId: string, itemId: string): void {
  if (balance.warehouseId !== warehouseId) throw new Error("batch does not belong to warehouse");
  if (balance.itemId !== itemId) throw new Error("batch does not belong to item");
}
