import { test, expect } from "@playwright/test";

test("dashboard quick actions open the corresponding operation pages", async ({ page }) => {
  const dashboardItemsWarehouseIds: Array<string | null> = [];
  const dashboardPendingWarehouseIds: Array<string | null> = [];
  const dashboardInboundWarehouseIds: Array<string | null> = [];
  const dashboardOutboundWarehouseIds: Array<string | null> = [];
  const itemPageWarehouseIds: Array<string | null> = [];
  let captureItemPageRequests = false;
  let expectedTransactionWarehouseId = "all";

  await page.route(/^http:\/\/127\.0\.0\.1:3001\/admin\/items(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    if (url.searchParams.get("includeInactive") !== "true") {
      await route.fallback();
      return;
    }
    expect(url.searchParams.get("includeInactive")).toBe("true");
    expect(url.searchParams.has("warehouseId")).toBe(false);
    (captureItemPageRequests ? itemPageWarehouseIds : dashboardItemsWarehouseIds).push(url.searchParams.get("warehouseId"));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "item-1",
          code: "TEA-001",
          name: "Tea Leaf",
          specification: "500g",
          unit: "bag",
          categoryId: "cat-tea",
          weComOptionKey: "tea_leaf",
          minimumStock: "5",
          isActive: true,
        },
      ]),
    });
  });
  await page.route(/http:\/\/127\.0\.0\.1:3001\/admin\/outbound\/pending.*/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.has("warehouseId")).toBe(false);
    dashboardPendingWarehouseIds.push(url.searchParams.get("warehouseId"));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{
        id: "approval-1",
        weComSpNo: "202608080001",
        status: "PENDING_OUTBOUND",
        lines: [{ id: "line-1", itemId: "item-1", requestedQuantity: "4" }],
      }]),
    });
  });
  await page.route(/http:\/\/127\.0\.0\.1:3001\/admin\/reports\/transactions.*/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("period")).toBe("2026-08");
    expect(url.searchParams.get("warehouseId")).toBe(expectedTransactionWarehouseId);

    if (url.searchParams.get("type") === "inbound") dashboardInboundWarehouseIds.push(url.searchParams.get("warehouseId"));
    if (url.searchParams.get("type") === "outbound") dashboardOutboundWarehouseIds.push(url.searchParams.get("warehouseId"));

    if (url.searchParams.get("type") === "inbound") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([{ quantity: "12", amount: "120.00" }]),
      });
      return;
    }

    if (url.searchParams.get("type") === "outbound") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([{ quantity: "3", amount: "30.00" }]),
      });
      return;
    }

    await route.fallback();
  });
  await page.route("http://127.0.0.1:3001/admin/reports/warehouses", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "warehouse-1", code: "WH-01", name: "Warehouse 1", isActive: true },
        { id: "warehouse-2", code: "WH-02", name: "Warehouse 2", isActive: true },
      ]),
    });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2F");
  await expect(page.locator(".page-header h1")).toBeVisible();
  await expect(page.locator(".metric")).toHaveCount(4);
  await expect(page.locator(".metric .metric__label")).toHaveCount(4);
  await expect(page.locator(".metric .metric__value")).toHaveCount(4);
  await expect(page.locator(".metric--inventory")).toHaveCount(1);
  await expect(page.locator(".metric--approval")).toHaveCount(1);
  await expect(page.locator(".metric--inbound")).toHaveCount(1);
  await expect(page.locator(".metric--outbound")).toHaveCount(1);
  const metricOrder = await page.locator(".metric").evaluateAll((metrics) => metrics.map((metric) =>
    Array.from(metric.querySelectorAll(".metric__label, .metric__value")).map((node) => node.className),
  ));
  expect(metricOrder).toEqual([
    ["metric__label", "metric__value"],
    ["metric__label", "metric__value"],
    ["metric__label", "metric__value"],
    ["metric__label", "metric__value"],
  ]);
  await expect(page.locator(".topbar-selector")).toBeVisible();
  await expect(page.locator(".workspace-user-button")).toBeVisible();
  await expect(page.locator(".system-status__item")).toHaveCount(3);
  await expect.poll(() => dashboardItemsWarehouseIds.length).toBeGreaterThan(0);
  await expect.poll(() => dashboardPendingWarehouseIds.length).toBeGreaterThan(0);
  await expect.poll(() => dashboardInboundWarehouseIds.length).toBeGreaterThan(0);
  await expect.poll(() => dashboardOutboundWarehouseIds.length).toBeGreaterThan(0);
  expect(dashboardItemsWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);
  expect(dashboardPendingWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);
  expect(dashboardInboundWarehouseIds.every((warehouseId) => warehouseId === "all")).toBe(true);
  expect(dashboardOutboundWarehouseIds.every((warehouseId) => warehouseId === "all")).toBe(true);

  const destinations = [
    { path: "/admin/inbound", selector: '.quick-actions a[href="/admin/inbound"]' },
    { path: "/admin/outbound", selector: '.quick-actions a[href="/admin/outbound"]' },
    { path: "/admin/opening-stock", selector: '.quick-actions a[href="/admin/opening-stock"]' },
  ];

  for (const destination of destinations) {
    await page.locator(destination.selector).click();
    await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
    await expect(page.locator(".page-header h1")).toBeVisible();
    await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2F");
    await expect(page.locator(".page-header h1")).toBeVisible();
  }

  dashboardItemsWarehouseIds.length = 0;
  dashboardPendingWarehouseIds.length = 0;
  dashboardInboundWarehouseIds.length = 0;
  dashboardOutboundWarehouseIds.length = 0;
  captureItemPageRequests = true;

  await page.goto(new URL("/admin/items?search=TEA-001", page.url()).toString());
  await expect(page.locator(".master-data-panel .master-data-toolbar input")).toHaveValue("TEA-001");
  await expect.poll(() => itemPageWarehouseIds.length).toBeGreaterThan(0);
  expect(itemPageWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);

  const createForm = page.locator(".master-data-form-panel .form-grid").first();
  expect(await createForm.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").filter(Boolean).length)).toBe(2);

  await page.locator(".table-actions button").first().click();
  const editForm = page.locator(".master-data-form-panel .form-grid").nth(1);
  expect(await editForm.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").filter(Boolean).length)).toBe(2);

  captureItemPageRequests = false;
  expectedTransactionWarehouseId = "all";
  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2F");
  await expect(page.locator(".page-header h1")).toBeVisible();
  await expect.poll(() => dashboardItemsWarehouseIds.length).toBeGreaterThan(0);
  await expect.poll(() => dashboardPendingWarehouseIds.length).toBeGreaterThan(0);
  await expect.poll(() => dashboardInboundWarehouseIds.length).toBeGreaterThan(0);
  await expect.poll(() => dashboardOutboundWarehouseIds.length).toBeGreaterThan(0);
  expect(dashboardItemsWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);
  expect(dashboardPendingWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);
  expect(dashboardInboundWarehouseIds.every((warehouseId) => warehouseId === "all")).toBe(true);
  expect(dashboardOutboundWarehouseIds.every((warehouseId) => warehouseId === "all")).toBe(true);

  const initialDashboardRequestCounts = {
    items: dashboardItemsWarehouseIds.length,
    pending: dashboardPendingWarehouseIds.length,
    inbound: dashboardInboundWarehouseIds.length,
    outbound: dashboardOutboundWarehouseIds.length,
  };
  expectedTransactionWarehouseId = "warehouse-2";
  await page.locator(".topbar-selector").click();
  await page.getByRole("menuitemradio", { name: /WH-02/ }).click();
  await expect.poll(() => dashboardItemsWarehouseIds.length).toBeGreaterThan(initialDashboardRequestCounts.items);
  await expect.poll(() => dashboardPendingWarehouseIds.length).toBeGreaterThan(initialDashboardRequestCounts.pending);
  await expect.poll(() => dashboardInboundWarehouseIds.length).toBeGreaterThan(initialDashboardRequestCounts.inbound);
  await expect.poll(() => dashboardOutboundWarehouseIds.length).toBeGreaterThan(initialDashboardRequestCounts.outbound);
  expect(dashboardItemsWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);
  expect(dashboardPendingWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);
  expect(dashboardInboundWarehouseIds.slice(initialDashboardRequestCounts.inbound).every((warehouseId) => warehouseId === "warehouse-2")).toBe(true);
  expect(dashboardOutboundWarehouseIds.slice(initialDashboardRequestCounts.outbound).every((warehouseId) => warehouseId === "warehouse-2")).toBe(true);
});
