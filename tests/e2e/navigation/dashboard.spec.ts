import { test, expect } from "@playwright/test";
import { apiUrl, apiUrlPattern, loginAs, webBaseUrl } from "../mobile/mobile-test-helpers";

test("dashboard quick actions open the corresponding operation pages", async ({ page }) => {
  const dashboardItemsWarehouseIds: Array<string | null> = [];
  const dashboardPendingWarehouseIds: Array<string | null> = [];
  const dashboardInboundWarehouseIds: Array<string | null> = [];
  const dashboardOutboundWarehouseIds: Array<string | null> = [];
  const itemPageWarehouseIds: Array<string | null> = [];
  let captureItemPageRequests = false;
  let expectedTransactionWarehouseId = "all";

  await page.route(apiUrlPattern("/admin/items(?:\\?|$)"), async (route) => {
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
  await page.route(apiUrlPattern("/admin/outbound/pending.*"), async (route) => {
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
  await page.route(apiUrlPattern("/admin/reports/transactions.*"), async (route) => {
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
  await page.route(apiUrl("/admin/reports/warehouses"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "warehouse-1", code: "WH-01", name: "Warehouse 1", isActive: true },
        { id: "warehouse-2", code: "WH-02", name: "Warehouse 2", isActive: true },
      ]),
    });
  });
  await page.route(apiUrl("/admin/notifications"), async (route) => {
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await loginAs(page, "/", "ADMIN");
  await expect(page.locator(".page-header h1")).toBeVisible();
  await expect(page.locator(".metric")).toHaveCount(4);
  await expect(page.locator(".metric .metric__label")).toHaveCount(4);
  await expect(page.locator(".metric .metric__value")).toHaveCount(4);
  await expect(page.locator(".metric--inventory")).toHaveCount(1);
  await expect(page.locator(".metric--approval")).toHaveCount(1);
  await expect(page.locator(".metric--inbound")).toHaveCount(1);
  await expect(page.locator(".metric--outbound")).toHaveCount(1);
  await expect(page.locator(".metric__icon svg")).toHaveCount(4);
  await expect(page.locator(".quick-actions a svg")).toHaveCount(3);
  const metricIconLayout = await page.locator(".metric__icon").evaluateAll((icons) => icons.map((icon) => {
    const iconRect = icon.getBoundingClientRect();
    const svg = icon.querySelector("svg");
    const svgRect = svg?.getBoundingClientRect();
    return {
      display: getComputedStyle(icon).display,
      horizontalGap: svgRect ? svgRect.left - iconRect.left : 0,
      verticalGap: svgRect ? svgRect.top - iconRect.top : 0,
      svgSize: svgRect?.width ?? 0,
    };
  }));
  expect(metricIconLayout.every(({ display, horizontalGap, verticalGap, svgSize }) => display === "grid" && horizontalGap > 0 && verticalGap > 0 && svgSize >= 24)).toBe(true);
  const quickActionIconSizes = await page.locator(".quick-actions a svg").evaluateAll((icons) => icons.map((icon) => icon.getBoundingClientRect().width));
  expect(quickActionIconSizes.every((size) => size >= 26)).toBe(true);
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
    await loginAs(page, "/", "ADMIN");
    await expect(page.locator(".page-header h1")).toBeVisible();
  }

  dashboardItemsWarehouseIds.length = 0;
  dashboardPendingWarehouseIds.length = 0;
  dashboardInboundWarehouseIds.length = 0;
  dashboardOutboundWarehouseIds.length = 0;
  captureItemPageRequests = true;

  await page.goto(new URL("/admin/items?search=TEA-001", webBaseUrl).toString());
  await expect(page.locator(".master-data-panel .master-data-toolbar input")).toHaveValue("TEA-001");
  await expect.poll(() => itemPageWarehouseIds.length).toBeGreaterThan(0);
  expect(itemPageWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);

  await expect(page.locator(".master-data-form-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "新增物品", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "新增物品" });
  await expect(createDialog).toBeVisible();
  const createForm = createDialog.locator(".form-grid");
  expect(await createForm.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").filter(Boolean).length)).toBe(2);
  await createDialog.getByRole("button", { name: "取消" }).click();

  await page.locator(".table-actions button").first().click();
  const editDialog = page.getByRole("dialog", { name: "编辑物品" });
  await expect(editDialog).toBeVisible();
  const editForm = editDialog.locator(".form-grid");
  expect(await editForm.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").filter(Boolean).length)).toBe(2);

  captureItemPageRequests = false;
  expectedTransactionWarehouseId = "all";
  await loginAs(page, "/", "ADMIN");
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
