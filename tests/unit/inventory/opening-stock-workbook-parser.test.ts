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

  it("recomputes batch and amount instead of trusting formula cells", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      const row = workbook.getWorksheet("期初库存")!.getRow(2);
      row.getCell(8).value = { formula: '"TAMPERED"', result: "TAMPERED" };
      row.getCell(11).value = { formula: "999999", result: 999999 };
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.rows[0]).toMatchObject({
      batchNo: "OPEN-20260824-WH01-BJ0001",
      quantity: "2",
      unitCost: "10",
      amount: "20.00",
      disposition: "IMPORT",
    });
    expect(result.summary).toMatchObject({
      positiveRowCount: 1,
      zeroRowCount: 242,
      totalQuantity: "2",
      totalAmount: "20.00",
    });
  });

  it("distinguishes blank quantity from counted zero", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      workbook.getWorksheet("期初库存")!.getCell("I3").value = null;
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "QUANTITY_REQUIRED",
        sheet: "期初库存",
        row: 3,
        field: "实盘数量",
      }),
    );
    expect(result.rows[0]!.disposition).toBe("IMPORT");
  });

  it("accepts zero with blank cost but requires a remark for positive zero cost", async () => {
    const zeroResult = await parser.parse({
      fileName: "期初库存.xlsx",
      buffer: await buildOpeningStockWorkbook(),
    });
    expect(zeroResult.issues).not.toContainEqual(
      expect.objectContaining({ row: 3, code: "UNIT_COST_REQUIRED" }),
    );

    const freeBuffer = await buildOpeningStockWorkbook((workbook) => {
      const sheet = workbook.getWorksheet("期初库存")!;
      sheet.getCell("J2").value = 0;
      sheet.getCell("L2").value = null;
    });
    const freeResult = await parser.parse({ fileName: "期初库存.xlsx", buffer: freeBuffer });
    expect(freeResult.issues).toContainEqual(
      expect.objectContaining({ code: "ZERO_COST_REMARK_REQUIRED", row: 2 }),
    );
  });

  it("requires each item and warehouse combination exactly once", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      workbook.getWorksheet("期初库存")!.getCell("A3").value = "WH-01";
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["INVENTORY_COMBINATION_DUPLICATE", "INVENTORY_COMBINATION_MISSING"]),
    );
  });

  it("rejects formulas in authoritative input cells even when they have cached results", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      workbook.getWorksheet("期初库存")!.getCell("I2").value = { formula: "1+1", result: 2 };
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "AUTHORITATIVE_FORMULA_NOT_ALLOWED", row: 2, field: "实盘数量" }),
    );
  });

  it.each([
    ["negative quantity", "I2", -1, "QUANTITY_NEGATIVE"],
    ["quantity precision", "I2", "1.23456", "QUANTITY_PRECISION_INVALID"],
    ["quantity exponent notation", "I2", "1e3", "QUANTITY_FORMAT_INVALID"],
    ["quantity overflow", "I2", "123456789012345.1234", "QUANTITY_OUT_OF_RANGE"],
    ["negative unit cost", "J2", -1, "UNIT_COST_NEGATIVE"],
    ["unit cost precision", "J2", "1.23456", "UNIT_COST_PRECISION_INVALID"],
    ["unit cost overflow", "J2", "123456789012345.1234", "UNIT_COST_OUT_OF_RANGE"],
  ])("reports %s", async (_label, cell, value, code) => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      workbook.getWorksheet("期初库存")!.getCell(cell).value = value;
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues).toContainEqual(expect.objectContaining({ code, severity: "ERROR" }));
  });

  it("reports positive quantity without cost and unknown workbook item", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      const sheet = workbook.getWorksheet("期初库存")!;
      sheet.getCell("J2").value = null;
      sheet.getCell("C3").value = "BJ9999";
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["UNIT_COST_REQUIRED", "INVENTORY_ITEM_UNKNOWN"]),
    );
  });

  it("rejects a derived row amount that cannot fit Decimal(18,2)", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      const sheet = workbook.getWorksheet("期初库存")!;
      sheet.getCell("I2").value = "99999999999999.9999";
      sheet.getCell("J2").value = "99999999999999.9999";
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "AMOUNT_OUT_OF_RANGE", row: 2, severity: "ERROR" }),
    );
  });

  it.each([
    ["quantity", "50000000000000", "1", "TOTAL_QUANTITY_OUT_OF_RANGE"],
    ["amount", "100", "60000000000000", "TOTAL_AMOUNT_OUT_OF_RANGE"],
  ])("rejects an overflowing %s summary", async (_label, quantity, unitCost, code) => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      const sheet = workbook.getWorksheet("期初库存")!;
      for (const row of [2, 3]) {
        sheet.getCell(`I${row}`).value = quantity;
        sheet.getCell(`J${row}`).value = unitCost;
      }
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues).toContainEqual(expect.objectContaining({ code, severity: "ERROR" }));
  });

  it("blocks the known WP0010 category anomaly", async () => {
    const buffer = await buildOpeningStockWorkbook((workbook) => {
      workbook.getWorksheet("物品资料")!.getCell("C71").value = "个";
    });

    const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "ITEM_CATEGORY_INVALID", severity: "ERROR" }),
    );
  });
});
