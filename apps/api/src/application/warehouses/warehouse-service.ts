import type { WarehouseDefinition } from "../../domain/warehouses/warehouse.js";
import { normalizeWarehouseCode } from "../../domain/warehouses/warehouse.js";

export interface WarehouseRepository {
  list(includeInactive?: boolean): Promise<WarehouseDefinition[]>;
}

export class InMemoryWarehouseRepository implements WarehouseRepository {
  constructor(private readonly warehouses: WarehouseDefinition[] = []) {}

  async list(includeInactive = false): Promise<WarehouseDefinition[]> {
    return this.warehouses
      .filter((warehouse) => includeInactive || warehouse.isActive)
      .map((warehouse) => ({ ...warehouse, code: normalizeWarehouseCode(warehouse.code) }));
  }
}

export class WarehouseService {
  constructor(private readonly repository: WarehouseRepository) {}

  listActive(): Promise<WarehouseDefinition[]> {
    return this.repository.list(false);
  }
}
