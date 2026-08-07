import { assertItemDefinition, normalizeItemCode } from "../../domain/items/item.js";

export function normalizeItemCodeInput(code: string): string {
  return normalizeItemCode(code);
}

export { normalizeItemCodeInput as normalizeItemCode };

export function generateItemCode(categoryPrefix: string, existingCodes: string[]): string {
  const prefix = categoryPrefix.trim().toUpperCase();
  if (!prefix) throw new Error("item category prefix is required");
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
  const nextSequence = existingCodes.reduce((max, code) => {
    const match = pattern.exec(code.trim().toUpperCase());
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `${prefix}-${String(nextSequence).padStart(4, "0")}`;
}

export function assertItemDefinitionInput(input: { code: string; name: string; unit: string; categoryId: string }): void {
  assertItemDefinition({ ...input, code: normalizeItemCode(input.code) });
}

export function ensureUniqueItemCode(code: string, existingCodes: string[]): void {
  const normalized = normalizeItemCode(code);
  if (existingCodes.some((existingCode) => normalizeItemCode(existingCode) === normalized)) {
    throw new Error(`item code already exists: ${normalized}`);
  }
}

export function assertItemCodeChangeAllowed(currentCode: string, nextCode: string, hasLedgerActivity: boolean): void {
  if (hasLedgerActivity && normalizeItemCode(currentCode) !== normalizeItemCode(nextCode)) {
    throw new Error("item code cannot change after ledger activity");
  }
}
