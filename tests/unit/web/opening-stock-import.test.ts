import { describe, expect, it } from "vitest";

import {
  canCommitOpeningStockImport,
  filterOpeningStockIssues,
  type OpeningStockImportIssue,
  type OpeningStockImportPreview,
} from "../../../apps/web/src/features/opening-stock/opening-stock-import";

const previewFixture = (
  overrides: Partial<OpeningStockImportPreview> = {},
): OpeningStockImportPreview => ({
  canCommit: true,
  previewToken: "signed-preview",
  previewExpiresAt: "2026-08-24T08:30:00.000Z",
  fileSha256: "a".repeat(64),
  baselineDate: "2026-08-24",
  summary: {
    itemCount: 81,
    newItemCount: 81,
    existingItemCount: 0,
    inventoryRowCount: 243,
    positiveRowCount: 1,
    zeroRowCount: 242,
    totalQuantity: "2",
    totalAmount: "20.00",
  },
  issues: [],
  rows: [],
  ...overrides,
});

describe("opening stock import UI state", () => {
  it("enables commit only for a valid unexpired preview and joint review", () => {
    expect(canCommitOpeningStockImport({
      preview: previewFixture({ previewExpiresAt: "2026-08-24T08:30:00.000Z" }),
      fileMatchesPreview: true,
      financeReviewer: "财务甲",
      confirmed: true,
      now: new Date("2026-08-24T08:10:00.000Z"),
    })).toBe(true);
  });

  it.each([
    ["errors", previewFixture({ canCommit: false })],
    ["missing token", previewFixture({ previewToken: undefined })],
    ["expired", previewFixture({ previewExpiresAt: "2026-08-24T07:59:59.000Z" })],
  ])("disables commit for %s", (_label, preview) => {
    expect(canCommitOpeningStockImport({
      preview,
      fileMatchesPreview: true,
      financeReviewer: "财务甲",
      confirmed: true,
      now: new Date("2026-08-24T08:00:00.000Z"),
    })).toBe(false);
  });

  it.each([
    ["blank reviewer", { fileMatchesPreview: true, financeReviewer: "   ", confirmed: true }],
    ["unchecked confirmation", { fileMatchesPreview: true, financeReviewer: "财务甲", confirmed: false }],
    ["changed File object", { fileMatchesPreview: false, financeReviewer: "财务甲", confirmed: true }],
  ])("disables commit for %s", (_label, input) => {
    expect(canCommitOpeningStockImport({
      preview: previewFixture(),
      ...input,
      now: new Date("2026-08-24T08:00:00.000Z"),
    })).toBe(false);
  });

  it("filters issues by severity without mutating their order", () => {
    const issues: OpeningStockImportIssue[] = [
      { severity: "WARNING", code: "W", message: "提醒" },
      { severity: "ERROR", code: "E", message: "错误" },
    ];

    expect(filterOpeningStockIssues(issues, "ERROR")).toEqual([issues[1]]);
    expect(filterOpeningStockIssues(issues, "WARNING")).toEqual([issues[0]]);
    expect(filterOpeningStockIssues(issues, "ALL")).toEqual(issues);
    expect(issues.map(({ code }) => code)).toEqual(["W", "E"]);
  });
});
