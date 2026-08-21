import { Decimal } from "decimal.js";

interface AlertBalance { itemId: string; warehouseId: string; remainingQuantity: string }
interface AlertItem { id: string; code: string; name: string; minimumStock?: string; isActive: boolean }

export interface LowStockItem { itemId: string; itemCode: string; itemName: string; totalQuantity: string; minimumStock: string }

export class AlertService {
  constructor(private readonly dependencies: { listBalances(): Promise<AlertBalance[]>; listItems(): Promise<AlertItem[]> }) {}

  async listLowStock(): Promise<LowStockItem[]> {
    const [balances, items] = await Promise.all([this.dependencies.listBalances(), this.dependencies.listItems()]);
    const totals = new Map<string, Decimal>();
    for (const balance of balances) totals.set(balance.itemId, (totals.get(balance.itemId) ?? new Decimal(0)).plus(balance.remainingQuantity));
    return items.filter((item) => item.isActive && item.minimumStock && new Decimal(item.minimumStock).gt(0)).flatMap((item) => {
      const total = totals.get(item.id) ?? new Decimal(0);
      return total.lt(new Decimal(item.minimumStock!)) ? [{ itemId: item.id, itemCode: item.code, itemName: item.name, totalQuantity: total.toString(), minimumStock: new Decimal(item.minimumStock!).toString() }] : [];
    });
  }
}
