import { describe, expect, it } from "vitest";

import { nextInboundBatchNo } from "../../../apps/api/src/application/inventory/batch-number.js";

describe("nextInboundBatchNo", () => {
  it("starts a purchase date at sequence 001", () => {
    expect(nextInboundBatchNo("2026-08-14T00:00:00.000Z", [])).toBe("20260814-001");
  });

  it("continues after the highest sequence for the same purchase date", () => {
    expect(nextInboundBatchNo("2026-08-14T00:00:00.000Z", ["20260814-001", "20260814-009"])).toBe("20260814-010");
  });

  it("rejects an invalid purchase date", () => {
    expect(() => nextInboundBatchNo("invalid", [])).toThrow("purchasedAt is invalid");
  });
});
