import { test, expect } from "@playwright/test";

test("report APIs require a finance or administrator session", async ({ request }) => {
  const response = await request.get("http://localhost:3001/admin/reports/summary?period=2026-08");

  expect(response.status()).toBe(401);
});

test("reports page filters transaction details and keeps filters after a server error", async ({ page }) => {
  await page.route("http://127.0.0.1:3001/admin/reports/summary?period=2026-08", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ itemId: "item-1", quantity: "11", amount: "230.00" }]),
    });
  });
  await page.route("http://127.0.0.1:3001/admin/reports/transactions?period=2026-08&type=all", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "tx-1", occurredAt: "2026-08-04T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-1", type: "TRANSFER_OUT", quantity: "-2", unitCost: "20", amount: "40.00", referenceType: "TRANSFER_ORDER" },
      ]),
    });
  });
  await page.route("http://127.0.0.1:3001/admin/reports/transactions?period=2026-08&type=transfers", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "report query unavailable" }),
    });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Freports");
  const form = page.locator(".master-data-toolbar");
  await expect(page.getByText("230.00")).toBeVisible();
  await expect(page.getByText("TRANSFER_OUT")).toBeVisible();

  await form.locator("select").selectOption("transfers");

  await expect(page.getByText("report query unavailable")).toBeVisible();
  await expect(form.locator('input[type="month"]')).toHaveValue("2026-08");
  await expect(form.locator("select")).toHaveValue("transfers");
});

test("reports page enables export when queries are available", async ({ page }) => {
  await page.route("http://127.0.0.1:3001/admin/reports/summary?period=2026-08", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ itemId: "item-1", quantity: "11", amount: "230.00" }]),
    });
  });
  await page.route("http://127.0.0.1:3001/admin/reports/transactions?period=2026-08&type=all", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "tx-1", occurredAt: "2026-08-04T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-1", type: "TRANSFER_OUT", quantity: "-2", unitCost: "20", amount: "40.00", referenceType: "TRANSFER_ORDER" },
      ]),
    });
  });
  await page.route("http://127.0.0.1:3001/admin/reports/export?period=2026-08&type=all", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/csv; charset=utf-8",
      body: "\uFEFF类型,数量,金额\nTRANSFER_OUT,-2,40.00\n",
      headers: { "content-disposition": 'attachment; filename="inventory-report-2026-08-all.csv"' },
    });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Freports");
  const exportButton = page.getByRole("button", { name: /导出/i });

  await expect(exportButton).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("inventory-report-2026-08-all.csv");
});

test("reports page keeps export enabled after export failure", async ({ page }) => {
  let exportRequests = 0;

  await page.route("http://127.0.0.1:3001/admin/reports/summary?period=2026-08", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ itemId: "item-1", quantity: "11", amount: "230.00" }]),
    });
  });
  await page.route("http://127.0.0.1:3001/admin/reports/transactions?period=2026-08&type=all", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route("http://127.0.0.1:3001/admin/reports/export?period=2026-08&type=all", async (route) => {
    exportRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "report export unavailable" }),
    });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Freports");
  const exportButton = page.getByRole("button", { name: /导出/i });

  await expect(exportButton).toBeEnabled();
  await exportButton.click();
  await expect(page.getByText("report export unavailable")).toBeVisible();
  await expect(exportButton).toBeEnabled();

  await exportButton.click();
  await expect(page.getByText("report export unavailable")).toBeVisible();
  expect(exportRequests).toBe(2);
});
