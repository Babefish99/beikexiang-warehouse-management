import type { ItemDefinition } from "../../domain/items/item.js";
import { assertItemCodeChangeAllowed, assertItemDefinitionInput, ensureUniqueItemCode, generateItemCode, normalizeItemCode } from "./item-code-policy.js";

export interface ItemInput {
  code?: string;
  categoryPrefix?: string;
  name: string;
  specification?: string;
  unit: string;
  categoryId: string;
  weComOptionKey?: string;
  minimumStock?: string;
}

export interface ItemRepository {
  list(includeInactive?: boolean): Promise<ItemDefinition[]>;
  get(id: string): Promise<ItemDefinition | undefined>;
  save(item: ItemDefinition): Promise<void>;
  hasLedgerActivity(id: string): Promise<boolean>;
}

export class InMemoryItemRepository implements ItemRepository {
  private readonly items = new Map<string, ItemDefinition>();
  private readonly ledgerActivity = new Set<string>();
  private nextId = 1;

  async list(includeInactive = false): Promise<ItemDefinition[]> {
    return [...this.items.values()]
      .filter((item) => includeInactive || item.isActive)
      .map((item) => structuredClone(item));
  }

  async get(id: string): Promise<ItemDefinition | undefined> {
    const item = this.items.get(id);
    return item ? structuredClone(item) : undefined;
  }

  async save(item: ItemDefinition): Promise<void> {
    this.items.set(item.id, structuredClone(item));
  }

  async hasLedgerActivity(id: string): Promise<boolean> {
    return this.ledgerActivity.has(id);
  }

  markLedgerActivity(id: string): void {
    this.ledgerActivity.add(id);
  }
}

export class ItemService {
  private readonly optionIndex = new Map<string, string>();

  constructor(private readonly repository: ItemRepository) {}

  async create(input: ItemInput): Promise<ItemDefinition> {
    const existing = await this.repository.list(true);
    const code = normalizeItemCode(input.code ?? generateItemCode(input.categoryPrefix ?? "IT", existing.map((item) => item.code)));
    assertItemDefinitionInput({ ...input, code });
    ensureUniqueItemCode(code, existing.map((item) => item.code));
    if (input.weComOptionKey && existing.some((item) => item.weComOptionKey === input.weComOptionKey)) {
      throw new Error(`weCom option key already exists: ${input.weComOptionKey}`);
    }
    const item: ItemDefinition = {
      id: `item-${String(existing.length + 1).padStart(4, "0")}`,
      code,
      name: input.name.trim(),
      specification: input.specification?.trim() || undefined,
      unit: input.unit.trim(),
      categoryId: input.categoryId.trim(),
      weComOptionKey: input.weComOptionKey?.trim() || undefined,
      minimumStock: input.minimumStock,
      isActive: true,
    };
    await this.repository.save(item);
    if (item.weComOptionKey) this.optionIndex.set(item.weComOptionKey, item.id);
    return item;
  }

  async update(itemId: string, input: ItemInput): Promise<ItemDefinition> {
    const current = await this.repository.get(itemId);
    if (!current) throw new Error(`item not found: ${itemId}`);
    const nextCode = normalizeItemCode(input.code ?? current.code);
    assertItemCodeChangeAllowed(current.code, nextCode, await this.repository.hasLedgerActivity(itemId));
    const existing = await this.repository.list(true);
    ensureUniqueItemCode(nextCode, existing.filter((item) => item.id !== itemId).map((item) => item.code));
    assertItemDefinitionInput({ ...input, code: nextCode });
    const updated: ItemDefinition = { ...current, ...input, code: nextCode, name: input.name.trim(), unit: input.unit.trim(), categoryId: input.categoryId.trim(), specification: input.specification?.trim() || undefined, weComOptionKey: input.weComOptionKey?.trim() || undefined };
    await this.repository.save(updated);
    if (current.weComOptionKey) this.optionIndex.delete(current.weComOptionKey);
    if (updated.weComOptionKey) this.optionIndex.set(updated.weComOptionKey, updated.id);
    return updated;
  }

  async deactivate(itemId: string): Promise<void> {
    const item = await this.repository.get(itemId);
    if (!item) throw new Error(`item not found: ${itemId}`);
    await this.repository.save({ ...item, isActive: false });
  }

  list(includeInactive = false): Promise<ItemDefinition[]> {
    return this.repository.list(includeInactive);
  }

  resolveByWeComOptionKey(optionKey: string): { id: string } | undefined {
    const itemId = this.optionIndex.get(optionKey);
    return itemId ? { id: itemId } : undefined;
  }
}
