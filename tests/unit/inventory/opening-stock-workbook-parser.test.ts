import { describe, expect, it } from "vitest";

import { ExcelOpeningStockWorkbookParser } from "../../../apps/api/src/infrastructure/import/excel-opening-stock-workbook-parser.js";
import { buildOpeningStockWorkbook } from "../../helpers/opening-stock-workbook.js";

const parser = new ExcelOpeningStockWorkbookParser();

describe("ExcelOpeningStockWorkbookParser workbook contract", () => {
  it("parses the fixed five-sheet contract and normalizes 81 items", async () => {
    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer: await buildOpeningStockWorkbook() });

    expect(result.baselineDate).toBe("2026-08-24");
    expect(result.items).toHaveLength(81);
    expect(result.rows).toHaveLength(243);
    expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
  });

  it("reports a missing sheet without throwing away other issues", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) =>
      workbook.removeWorksheet(workbook.getWorksheet("物品资料")!.id),
    );

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "WORKBOOK_SHEETS_INVALID", severity: "ERROR" }),
    );
  });

  it("rejects changed headers and extra authoritative business rows", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      workbook.getWorksheet("物品资料")!.getCell("C1").value = "分类";
      workbook.getWorksheet("物品资料")!.getCell("A83").value = "BJ9999";
      workbook.getWorksheet("期初库存")!.getCell("A245").value = "WH-01";
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "WORKSHEET_HEADERS_INVALID",
        "ITEM_ROW_COUNT_INVALID",
        "INVENTORY_ROW_COUNT_INVALID",
      ]),
    );
  });

  it("ignores styled blank rows outside the fixed business ranges", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      workbook.getWorksheet("物品资料")!.getRow(1000).height = 18;
      workbook.getWorksheet("期初库存")!.getRow(1000).height = 18;
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
  });

  it("requires an authoritative baseline date in 填写说明!B6", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      workbook.getWorksheet("填写说明")!.getCell("B6").value = null;
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "BASELINE_DATE_REQUIRED",
        sheet: "填写说明",
        row: 6,
        field: "盘点基准日期",
      }),
    );
  });

  it("rejects non-ISO text dates", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      workbook.getWorksheet("填写说明")!.getCell("B6").value = "2026/08/24";
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "BASELINE_DATE_INVALID", sheet: "填写说明", row: 6 }),
    );
  });

  it.each([
    ["baseline date", "填写说明", "B6", { formula: "TODAY()", result: new Date("2026-08-24T00:00:00.000Z") }],
    ["item code", "物品资料", "A2", { formula: '"BJ0001"', result: "BJ0001" }],
  ])("rejects a formula in authoritative %s even with a cached result", async (_label, sheetName, cell, value) => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      workbook.getWorksheet(sheetName)!.getCell(cell).value = value;
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "AUTHORITATIVE_FORMULA_NOT_ALLOWED", sheet: sheetName }),
    );
  });

  it("blocks duplicate and malformed item codes", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      const sheet = workbook.getWorksheet("物品资料")!;
      sheet.getCell("A2").value = "bad";
      sheet.getCell("A3").value = "bad";
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["ITEM_CODE_INVALID", "ITEM_CODE_DUPLICATE"]),
    );
  });

  it("reports duplicate names and missing reference cost as non-blocking warnings", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      const sheet = workbook.getWorksheet("物品资料")!;
      sheet.getCell("B3").value = "测试物品 BJ0001";
      sheet.getCell("F3").value = null;
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DUPLICATE_ITEM_NAME", severity: "WARNING" }),
        expect.objectContaining({ code: "REFERENCE_UNIT_COST_MISSING", severity: "WARNING", row: 3 }),
      ]),
    );
    expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
  });
});
