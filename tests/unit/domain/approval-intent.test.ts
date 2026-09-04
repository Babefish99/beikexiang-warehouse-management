import { describe, expect, it } from "vitest";

import {
  approvalUnitsMatch,
  normalizeApprovalUnit,
  parsePositiveIntegerQuantity,
} from "../../../apps/api/src/domain/approvals/approval-intent.js";

describe("approval intent invariants", () => {
  it("normalizes only whitespace and full-width ASCII unit characters", () => {
    expect(normalizeApprovalUnit("　瓶　")).toBe("瓶");
    expect(normalizeApprovalUnit("ＢＯＸ")).toBe("BOX");
  });

  it("matches units only after whitespace and full-width normalization", () => {
    expect(approvalUnitsMatch(" 瓶 ", "瓶")).toBe(true);
    expect(approvalUnitsMatch("瓶", "箱")).toBe(false);
  });

  it("accepts a positive integer quantity", () => {
    expect(parsePositiveIntegerQuantity("12")).toBe("12");
  });

  it.each(["1.5", "0", "", "-1", "100000000000000"])("rejects non-positive or non-integer quantity %j", (value) => {
    expect(() => parsePositiveIntegerQuantity(value)).toThrow("approval quantity must be a positive integer");
  });
});
