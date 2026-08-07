export interface BatchBalance {
  batchId: string;
  warehouseId: string;
  itemId: string;
  remainingQuantity: string;
  unitCost: string;
}

export function assertBatchMatches(balance: BatchBalance, warehouseId: string, itemId: string): void {
  if (balance.warehouseId !== warehouseId) throw new Error("batch does not belong to warehouse");
  if (balance.itemId !== itemId) throw new Error("batch does not belong to item");
}
