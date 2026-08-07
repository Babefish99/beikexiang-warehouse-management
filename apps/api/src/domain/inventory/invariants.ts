import { Decimal } from "decimal.js";

export function decimal(value: string | number | Decimal): Decimal {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error("quantity must be finite");
  return result;
}

export function assertPositive(value: string | number | Decimal, field: string): Decimal {
  const result = decimal(value);
  if (!result.gt(0)) throw new Error(`${field} must be positive`);
  return result;
}

export function assertNonNegative(value: string | number | Decimal, field: string): Decimal {
  const result = decimal(value);
  if (result.lt(0)) throw new Error(`${field} cannot be negative`);
  return result;
}
