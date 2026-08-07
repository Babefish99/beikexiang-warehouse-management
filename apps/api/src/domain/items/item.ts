export interface ItemDefinition {
  id: string;
  code: string;
  name: string;
  specification?: string;
  unit: string;
  categoryId: string;
  weComOptionKey?: string;
  minimumStock?: string;
  isActive: boolean;
}

export function normalizeItemCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new Error("item code is required");
  return normalized;
}

export function assertItemDefinition(item: Pick<ItemDefinition, "code" | "name" | "unit" | "categoryId">): void {
  if (!normalizeItemCode(item.code)) throw new Error("item code is required");
  if (!item.name.trim()) throw new Error("item name is required");
  if (!item.unit.trim()) throw new Error("item unit is required");
  if (!item.categoryId.trim()) throw new Error("item category is required");
}
