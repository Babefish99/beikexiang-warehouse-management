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

const validPreviewFixture = {
  canCommit: true,
  previewToken: "signed-preview",
  previewExpiresAt: "2099-08-24T08:30:00.000Z",
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
  rows: [
    {
      sheetRow: 2,
      warehouseCode: "WH-01",
      itemCode: "BJ0001",
      itemName: "测试物品 BJ0001",
      batchNo: "OPEN-20260824-WH01-BJ0001",
      quantity: "2",
      unitCost: "10",
      amount: "20.00",
      disposition: "IMPORT",
    },
    {
      sheetRow: 3,
      warehouseCode: "WH-02",
      itemCode: "BJ0001",
      itemName: "测试物品 BJ0001",
      batchNo: "OPEN-20260824-WH02-BJ0001",
      quantity: "0",
      unitCost: "0",
      amount: "0.00",
      disposition: "SKIP_ZERO",
    },
  ],
};

const completedImportFixture = {
  id: "INITIAL_OPENING_STOCK",
  fileSha256: "a".repeat(64),
  sourceFileName: "期初库存.xlsx",
  baselineDate: "2026-08-24",
  operatorId: "local-admin",
  financeReviewer: "财务甲",
  itemCount: 81,
  createdItemCount: 81,
  inventoryRowCount: 243,
  positiveRowCount: 1,
  zeroRowCount: 242,
  totalQuantity: "2",
  totalAmount: "20.00",
  importedAt: "2026-08-24T08:05:00.000Z",
};

async function selectOpeningStockFile(page: import("@playwright/test").Page): Promise<void> {
  await page.setInputFiles('input[type="file"]', {
    name: "期初库存.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("fixture"),
  });
}

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
  await selectOpeningStockFile(page);
  await page.getByRole("button", { name: "预览校验" }).click();

  await expect(page.getByText("期初库存 · 第 3 行 · 实盘数量")).toBeVisible();
  const issueHeading = page.locator(".opening-import-section-heading").filter({ hasText: "校验问题" });
  await expect(issueHeading.locator("h2")).toHaveCSS("font-size", "18px");
  await expect(issueHeading.locator("p")).toHaveCSS("font-size", "13px");
  await expect(page.getByRole("button", { name: "正式导入" })).toBeDisabled();
});

test("uses the shared secondary button when status loading fails", async ({ page }) => {
  await page.route(apiUrl("/admin/opening-stock/import/status"), (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "期初库存状态读取失败" }),
  }));

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fopening-stock"));

  await expect(page.getByRole("alert")).toContainText("期初库存状态读取失败");
  await expect(page.getByRole("button", { name: "重新加载" })).toHaveClass(/button--secondary/);
});

test("preserves reviewer and confirmation when commit returns a conflict", async ({ page }) => {
  await page.route(apiUrl("/admin/opening-stock/import/status"), (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ availability: "AVAILABLE" }),
  }));
  await page.route(apiUrl("/admin/opening-stock/import/preview"), (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(validPreviewFixture),
  }));
  await page.route(apiUrl("/admin/opening-stock/import/commit"), (route) => {
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data; boundary=");
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "期初库存文件或系统状态已变化，请重新预览" }),
    });
  });

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fopening-stock"));
  await selectOpeningStockFile(page);
  await page.getByRole("button", { name: "预览校验" }).click();

  const summary = page.getByRole("region", { name: "导入预览汇总" });
  for (const [label, value] of [
    ["物品", "81"],
    ["新建", "81"],
    ["已有", "0"],
    ["盘点", "243"],
    ["写入", "1"],
    ["零库存", "242"],
    ["总数量", "2"],
    ["总金额", "20.00"],
  ] as const) {
    const card = summary.locator(".opening-import-summary__card").filter({ hasText: label });
    await expect(card).toContainText(value);
  }
  await expect(page.getByText("测试物品 BJ0001", { exact: true }).first()).toBeVisible();

  await page.getByLabel("财务复核人").fill("财务甲");
  await page.getByRole("checkbox", { name: "已与财务共同核对" }).check();
  await page.getByRole("button", { name: "正式导入" }).click();

  await expect(page.getByRole("alert")).toContainText("系统状态已变化");
  await expect(page.getByLabel("财务复核人")).toHaveValue("财务甲");
  await expect(page.getByRole("checkbox", { name: "已与财务共同核对" })).toBeChecked();
});

test("switches to the immutable completed summary after HTTP 201", async ({ page }) => {
  await page.route(apiUrl("/admin/opening-stock/import/status"), (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ availability: "AVAILABLE" }),
  }));
  await page.route(apiUrl("/admin/opening-stock/import/preview"), (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(validPreviewFixture),
  }));
  await page.route(apiUrl("/admin/opening-stock/import/commit"), (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify(completedImportFixture),
  }));

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fopening-stock"));
  await selectOpeningStockFile(page);
  await page.getByRole("button", { name: "预览校验" }).click();
  await expect(page.getByText("81", { exact: true }).first()).toBeVisible();
  await page.getByLabel("财务复核人").fill("财务甲");
  await page.getByRole("checkbox", { name: "已与财务共同核对" }).check();
  await page.getByRole("button", { name: "正式导入" }).click();

  await expect(page.getByText("INITIAL_OPENING_STOCK")).toBeVisible();
  await expect(page.getByText("后续差错请通过盘点调整处理", { exact: false })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("hides upload controls when inventory activity already blocks initialization", async ({ page }) => {
  await page.route(apiUrl("/admin/opening-stock/import/status"), (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ availability: "BLOCKED_BY_ACTIVITY" }),
  }));

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fopening-stock"));

  await expect(page.getByText("已有库存业务，不能再初始化期初库存")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});
