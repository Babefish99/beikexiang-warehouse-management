import { describe, expect, it } from "vitest";

import { classifyAdminBusinessError } from "../../../apps/api/src/application/errors/business-rule-error.js";

describe("classifyAdminBusinessError", () => {
  it.each([
    "batch does not belong to warehouse",
    "batch does not belong to item",
    "warehouse, item, and batch are required",
    "reason is required for partial or zero issue",
    "destination stock balance item mismatch",
    "stocktake quantity is invalid",
  ])("classifies domain validation error %s as bad request", (message) => {
    expect(classifyAdminBusinessError(new Error(message))).toMatchObject({
      message,
      statusCode: 400,
    });
  });
});
