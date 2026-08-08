import { test, expect } from "@playwright/test";

test("report APIs require a finance or administrator session", async ({ request }) => {
  const response = await request.get("http://localhost:3001/admin/reports/summary?period=2026-08");

  expect(response.status()).toBe(401);
});

test("reports page filters transaction details and keeps filters after a server error", async ({ page }) => {
  await page.route("http://127.0.0.1:3001/admin/reports/warehouses", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "warehouse-1", code: "WH-01", name: "Warehouse 1", isActive: true }]),
    });
  });
  await page.route(/http:\/\/127\.0\.0\.1:3001\/admin\/reports\/summary.*/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("period")).toBe("2026-08");
    expect(url.searchParams.get("warehouseId")).toBe("all");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ itemId: "item-1", quantity: "11", amount: "230.00" }]),
    });
  });
  await page.route(/http:\/\/127\.0\.0\.1:3001\/admin\/reports\/transactions.*/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("period")).toBe("2026-08");
    expect(url.searchParams.get("warehouseId")).toBe("all");

    if (url.searchParams.get("type") === "all") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "tx-1", occurredAt: "2026-08-04T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-1", type: "TRANSFER_OUT", quantity: "-2", unitCost: "20", amount: "40.00", referenceType: "TRANSFER_ORDER" },
        ]),
      });
      return;
    }

    if (url.searchParams.get("type") === "transfers") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "report query unavailable" }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Freports");
  const form = page.locator(".report-toolbar");
  await expect(page.locator(".report-filter-panel .panel__header h2")).toBeVisible();
  await expect(page.locator(".report-section .panel__header h2")).toHaveCount(2);
  await expect(page.locator(".topbar-selector")).toBeVisible();

  const periodLabel = form.locator("label").nth(0).locator("span");
  const typeLabel = form.locator("label").nth(1).locator("span");
  await expect(periodLabel).toHaveText("统计期间");
  await expect(typeLabel).toHaveText("交易类型");
  await expect(periodLabel).toHaveCSS("white-space", "nowrap");
  await expect(typeLabel).toHaveCSS("white-space", "nowrap");
  const periodBox = await periodLabel.boundingBox();
  const typeBox = await typeLabel.boundingBox();
  if (!periodBox || !typeBox) throw new Error("report filter labels should be visible");
  expect(Math.abs(periodBox.y - typeBox.y)).toBeLessThan(4);

  await expect(page.getByText("230.00")).toBeVisible();
  await expect(page.getByText("TRANSFER_OUT")).toBeVisible();

  await form.locator("select").selectOption("transfers");

  await expect(page.getByText("report query unavailable")).toBeVisible();
  await expect(form.locator('input[type="month"]')).toHaveValue("2026-08");
  await expect(form.locator("select")).toHaveValue("transfers");
});

test("reports page enables export when queries are available", async ({ page }) => {
  await page.route("http://127.0.0.1:3001/admin/reports/warehouses", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "warehouse-1", code: "WH-01", name: "Warehouse 1", isActive: true }]),
    });
  });
  await page.route(/http:\/\/127\.0\.0\.1:3001\/admin\/reports\/summary.*/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("period")).toBe("2026-08");
    expect(url.searchParams.get("warehouseId")).toBe("all");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ itemId: "item-1", quantity: "11", amount: "230.00" }]),
    });
  });
  await page.route(/http:\/\/127\.0\.0\.1:3001\/admin\/reports\/transactions.*/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("period")).toBe("2026-08");
    expect(url.searchParams.get("type")).toBe("all");
    expect(url.searchParams.get("warehouseId")).toBe("all");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "tx-1", occurredAt: "2026-08-04T00:00:00.000Z", warehouseId: "wh-1", itemId: "item-1", type: "TRANSFER_OUT", quantity: "-2", unitCost: "20", amount: "40.00", referenceType: "TRANSFER_ORDER" },
      ]),
    });
  });
  await page.route(/http:\/\/127\.0\.0\.1:3001\/admin\/reports\/export.*/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("period")).toBe("2026-08");
    expect(url.searchParams.get("type")).toBe("all");
    expect(url.searchParams.get("warehouseId")).toBe("all");
    await route.fulfill({
      status: 200,
      contentType: "text/csv; charset=utf-8",
      body: "\uFEFFtype,quantity,amount\nTRANSFER_OUT,-2,40.00\n",
      headers: { "content-disposition": 'attachment; filename="inventory-report-2026-08-all.csv"' },
    });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Freports");
  const exportButton = page.locator(".report-actions .button--primary");

  await expect(exportButton).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("inventory-report-2026-08-all.csv");
});

test("reports page keeps export enabled after export failure", async ({ page }) => {
  let exportRequests = 0;

  await page.route("http://127.0.0.1:3001/admin/reports/warehouses", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "warehouse-1", code: "WH-01", name: "Warehouse 1", isActive: true }]),
    });
  });
  await page.route(/http:\/\/127\.0\.0\.1:3001\/admin\/reports\/summary.*/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("period")).toBe("2026-08");
    expect(url.searchParams.get("warehouseId")).toBe("all");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ itemId: "item-1", quantity: "11", amount: "230.00" }]),
    });
  });
  await page.route(/http:\/\/127\.0\.0\.1:3001\/admin\/reports\/transactions.*/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("period")).toBe("2026-08");
    expect(url.searchParams.get("type")).toBe("all");
    expect(url.searchParams.get("warehouseId")).toBe("all");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route(/http:\/\/127\.0\.0\.1:3001\/admin\/reports\/export.*/, async (route) => {
    exportRequests += 1;
    const url = new URL(route.request().url());
    expect(url.searchParams.get("period")).toBe("2026-08");
    expect(url.searchParams.get("type")).toBe("all");
    expect(url.searchParams.get("warehouseId")).toBe("all");
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "report export unavailable" }),
    });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Freports");
  const exportButton = page.locator(".report-actions .button--primary");

  await expect(exportButton).toBeEnabled();
  await exportButton.click();
  await expect(page.getByText("report export unavailable")).toBeVisible();
  await expect(exportButton).toBeEnabled();

  await exportButton.click();
  await expect(page.getByText("report export unavailable")).toBeVisible();
  expect(exportRequests).toBe(2);
});
