import type { WarehouseDefinition } from "../../domain/warehouses/warehouse.js";
import { normalizeWarehouseCode } from "../../domain/warehouses/warehouse.js";

export interface WarehouseUpdateInput {
  name: string;
  isActive: boolean;
}

export interface WarehouseRepository {
  list(includeInactive?: boolean): Promise<WarehouseDefinition[]>;
  get(id: string): Promise<WarehouseDefinition | undefined>;
  save(warehouse: WarehouseDefinition): Promise<void>;
}

export class InMemoryWarehouseRepository implements WarehouseRepository {
  private readonly warehouses = new Map<string, WarehouseDefinition>();

  constructor(initialWarehouses: WarehouseDefinition[] = []) {
    for (const warehouse of initialWarehouses) {
      this.warehouses.set(warehouse.id, this.normalize(warehouse));
    }
  }

  async list(includeInactive = false): Promise<WarehouseDefinition[]> {
    return [...this.warehouses.values()]
      .filter((warehouse) => includeInactive || warehouse.isActive)
      .map((warehouse) => structuredClone(warehouse));
  }

  async get(id: string): Promise<WarehouseDefinition | undefined> {
    const warehouse = this.warehouses.get(id);
    return warehouse ? structuredClone(warehouse) : undefined;
  }

  async save(warehouse: WarehouseDefinition): Promise<void> {
    this.warehouses.set(warehouse.id, this.normalize(warehouse));
  }

  private normalize(warehouse: WarehouseDefinition): WarehouseDefinition {
    return { ...warehouse, code: normalizeWarehouseCode(warehouse.code) };
  }
}

export class WarehouseService {
  constructor(private readonly repository: WarehouseRepository) {}

  list(includeInactive = false): Promise<WarehouseDefinition[]> {
    return this.repository.list(includeInactive);
  }

  async update(warehouseId: string, input: WarehouseUpdateInput): Promise<WarehouseDefinition> {
    const current = await this.repository.get(warehouseId);
    if (!current) throw new Error(`warehouse not found: ${warehouseId}`);

    const name = input.name.trim();
    if (!name) throw new Error("warehouse name is required");

    const updated: WarehouseDefinition = {
      ...current,
      name,
      isActive: input.isActive,
      isPlaceholder: false,
    };
    await this.repository.save(updated);
    return updated;
  }
}
