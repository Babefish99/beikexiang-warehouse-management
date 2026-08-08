import { Decimal } from "decimal.js";

import type { ItemDefinition } from "../../domain/items/item.js";
import type { WarehouseDefinition } from "../../domain/warehouses/warehouse.js";
import type { StoredBatch } from "./inbound-service.js";

interface InventoryBalanceSnapshot {
  warehouseId: string;
  itemId: string;
  batchId: string;
  remainingQuantity: string;
  unitCost: string;
}

export interface InventorySearchLocation {
  warehouseId: string;
  warehouseName: string;
  batchId: string;
  batchNo: string;
  quantity: string;
  unitCost: string;
  amount: string;
}

export interface InventorySearchResult {
  itemId: string;
  code: string;
  name: string;
  specification?: string;
  unit: string;
  totalQuantity: string;
  totalAmount: string;
  locations: InventorySearchLocation[];
}

export class InventoryQueryService {
  constructor(private readonly dependencies: {
    listItems: () => Promise<ItemDefinition[]>;
    listWarehouses: () => Promise<WarehouseDefinition[]>;
    listBatches: () => StoredBatch[];
    listBalances: () => InventoryBalanceSnapshot[];
  }) {}

  async search(query: string, warehouseId?: string): Promise<InventorySearchResult[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    const [items, warehouses] = await Promise.all([
      this.dependencies.listItems(),
      this.dependencies.listWarehouses(),
    ]);
    const activeItems = items.filter((item) => item.isActive);
    const activeWarehouses = warehouses.filter((warehouse) => warehouse.isActive);
    const warehouseById = new Map(activeWarehouses.map((warehouse) => [warehouse.id, warehouse]));
    const itemById = new Map(activeItems.map((item) => [item.id, item]));
    const batchById = new Map(this.dependencies.listBatches().map((batch) => [batch.id, batch]));
    const shouldFilterWarehouse = Boolean(warehouseId && warehouseId !== "all");
    const results = new Map<string, {
      item: ItemDefinition;
      totalQuantity: Decimal;
      totalAmount: Decimal;
      locations: Array<InventorySearchLocation & { warehouseCode: string }>;
    }>();

    for (const balance of this.dependencies.listBalances()) {
      const item = itemById.get(balance.itemId);
      const warehouse = warehouseById.get(balance.warehouseId);
      const batch = batchById.get(balance.batchId);
      if (!item || !warehouse || !batch) continue;
      if (shouldFilterWarehouse && balance.warehouseId !== warehouseId) continue;
      if (!matchesQuery(normalizedQuery, { item, warehouse, batch })) continue;

      const quantity = new Decimal(balance.remainingQuantity);
      const unitCost = new Decimal(balance.unitCost);
      const amount = quantity.mul(unitCost);
      const current = results.get(item.id) ?? {
        item,
        totalQuantity: new Decimal(0),
        totalAmount: new Decimal(0),
        locations: [],
      };

      current.totalQuantity = current.totalQuantity.plus(quantity);
      current.totalAmount = current.totalAmount.plus(amount);
      current.locations.push({
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        warehouseCode: warehouse.code,
        batchId: batch.id,
        batchNo: batch.batchNo,
        quantity: quantity.toString(),
        unitCost: unitCost.toString(),
        amount: amount.toFixed(2),
      });
      results.set(item.id, current);
    }

    return [...results.values()]
      .map((entry) => ({
        itemId: entry.item.id,
        code: entry.item.code,
        name: entry.item.name,
        specification: entry.item.specification,
        unit: entry.item.unit,
        totalQuantity: entry.totalQuantity.toString(),
        totalAmount: entry.totalAmount.toFixed(2),
        locations: entry.locations
          .sort((left, right) => left.warehouseCode.localeCompare(right.warehouseCode) || left.batchNo.localeCompare(right.batchNo))
          .map(({ warehouseCode: _warehouseCode, ...location }) => location),
      }))
      .sort((left, right) => left.code.localeCompare(right.code));
  }
}

function matchesQuery(
  query: string,
  input: { item: ItemDefinition; warehouse: WarehouseDefinition; batch: Pick<StoredBatch, "batchNo"> },
): boolean {
  return [
    input.item.code,
    input.item.name,
    input.item.specification,
    input.item.categoryId,
    input.item.weComOptionKey,
    input.batch.batchNo,
    input.warehouse.code,
    input.warehouse.name,
  ].some((value) => value?.toLowerCase().includes(query));
}
