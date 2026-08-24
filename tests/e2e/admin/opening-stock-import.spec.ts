import { expect, test } from "@playwright/test";

import { apiUrl } from "../mobile/mobile-test-helpers";

const invalidPreviewFixture = {
  canCommit: false,
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
  issues: [
    {
      severity: "ERROR",
      code: "QUANTITY_REQUIRED",
      sheet: "期初库存",
      row: 3,
      field: "实盘数量",
      message: "实盘数量未填写",
    },
  ],
  rows: [],
};

test("shows row errors and keeps formal import disabled", async ({ page }) => {
  await page.route(apiUrl("/admin/opening-stock/import/status"), (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ availability: "AVAILABLE" }),
  }));
  await page.route(apiUrl("/admin/opening-stock/import/preview"), (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(invalidPreviewFixture),
  }));

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fopening-stock"));
  await page.setInputFiles('input[type="file"]', {
    name: "期初库存.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("fixture"),
  });
  await page.getByRole("button", { name: "预览校验" }).click();

  await expect(page.getByText("期初库存 · 第 3 行 · 实盘数量")).toBeVisible();
  await expect(page.getByRole("button", { name: "正式导入" })).toBeDisabled();
});
