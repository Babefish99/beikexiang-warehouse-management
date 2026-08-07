import { describe, expect, it } from "vitest";

import {
  assertItemCodeChangeAllowed,
  assertItemDefinitionInput,
  ensureUniqueItemCode,
  generateItemCode,
  normalizeItemCode,
} from "../../../apps/api/src/application/items/item-code-policy.js";

describe("item code policy", () => {
  it("normalizes codes and generates the next category-prefixed code", () => {
    expect(normalizeItemCode("  bj-0007 ")).toBe("BJ-0007");
    expect(generateItemCode("bj", ["BJ-0001", "BJ-0007", "CY-0003"])).toBe("BJ-0008");
  });

  it("requires name, unit, category, and code fields", () => {
    expect(() => assertItemDefinitionInput({ code: "BJ-0001", name: "", unit: "盒", categoryId: "cat-1" })).toThrow("item name is required");
    expect(() => assertItemDefinitionInput({ code: "BJ-0001", name: "茶叶", unit: "", categoryId: "cat-1" })).toThrow("item unit is required");
    expect(() => assertItemDefinitionInput({ code: "BJ-0001", name: "茶叶", unit: "盒", categoryId: "" })).toThrow("item category is required");
  });

  it("rejects duplicate codes after normalization", () => {
    expect(() => ensureUniqueItemCode("bj-0001", ["BJ-0001", "CY-0001"])).toThrow("item code already exists: BJ-0001");
  });

  it("prevents changing an item code after ledger activity", () => {
    expect(() => assertItemCodeChangeAllowed("BJ-0001", "BJ-0002", true)).toThrow("item code cannot change after ledger activity");
    expect(() => assertItemCodeChangeAllowed("BJ-0001", "BJ-0002", false)).not.toThrow();
  });
});
