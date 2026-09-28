export interface ItemDefinition {
  id: string;
  code: string;
  name: string;
  specification?: string;
  aliases?: string[];
  unit: string;
  categoryId: string;
  weComOptionKey?: string;
  minimumStock?: string;
  isActive: boolean;
}

export function normalizeItemAliases(values: readonly string[] | undefined): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const alias = value.normalize("NFKC").trim();
    if (!alias) continue;
    if (alias.length > 80) throw new Error("item alias must not exceed 80 characters");
    const key = alias.toLocaleLowerCase();
    if (!seen.has(key)) {
      aliases.push(alias);
      seen.add(key);
    }
  }
  if (aliases.length > 20) throw new Error("item aliases must not exceed 20 entries");
  return aliases;
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
