export interface WarehouseDefinition {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isPlaceholder?: boolean;
}

export function normalizeWarehouseCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new Error("warehouse code is required");
  return normalized;
}
