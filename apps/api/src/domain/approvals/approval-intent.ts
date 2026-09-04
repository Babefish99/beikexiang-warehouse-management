import { Decimal } from "decimal.js";

export type LegacyResolutionStatus = "NOT_APPLICABLE" | "EXACT_LOCKED" | "REAPPLY_REQUIRED";

export function normalizeApprovalUnit(value: string): string {
  return value
    .replace(/\u3000/g, " ")
    .replace(/[\uFF01-\uFF5E]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .trim();
}

export function approvalUnitsMatch(left: string, right: string): boolean {
  return normalizeApprovalUnit(left) === normalizeApprovalUnit(right);
}

export function parsePositiveIntegerQuantity(value: string): string {
  const normalized = value.trim();
  if (!/^[1-9]\d{0,13}$/.test(normalized)) throw new Error("approval quantity must be a positive integer");
  return new Decimal(normalized).toFixed(0);
}
