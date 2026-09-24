import { test, expect } from "@playwright/test";
import { apiUrl, apiUrlPattern, loginAs, webBaseUrl } from "../mobile/mobile-test-helpers";

test("dashboard shows a unified inventory overview with category filters", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.clock.setFixedTime(new Date("2026-08-15T12:00:00.000Z"));

  const dashboardItemsWarehouseIds: Array<string | null> = [];
  const dashboardPendingWarehouseIds: Array<string | null> = [];
  const dashboardInboundWarehouseIds: Array<string | null> = [];
  const dashboardOutboundWarehouseIds: Array<string | null> = [];
  const itemPageWarehouseIds: Array<string | null> = [];
  let captureItemPageRequests = false;

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
          name: "普洱茶饼",
          specification: "357g/饼",
          unit: "饼",
          categoryId: "category-cy",
          weComOptionKey: "tea_leaf",
          minimumStock: "5",
          stockQuantity: "0",
          isActive: true,
        },
        {
          id: "item-2",
          code: "BJ0003",
          name: "茅台30年",
          specification: "500ml/瓶",
          unit: "瓶",
          categoryId: "category-bj",
          weComOptionKey: "maotai_30",
          minimumStock: "6",
          stockQuantity: "12",
          isActive: true,
        },
        {
          id: "item-3",
          code: "WP0008",
          name: "盒装粉条",
          specification: "500g/盒",
          unit: "盒",
          categoryId: "category-wp",
          weComOptionKey: "noodles",
          minimumStock: "3",
          stockQuantity: "2",
          isActive: true,
        },
        {
          id: "item-4",
          code: "WP0011",
          name: "香烟",
          specification: "条",
          unit: "条",
          categoryId: "category-wp",
          weComOptionKey: "cigarette",
          minimumStock: null,
          stockQuantity: "8",
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
    const warehouseId = url.searchParams.get("warehouseId");
    expect(url.searchParams.get("period")).toBe("2026-08");
    if (url.searchParams.get("type") === "inbound") dashboardInboundWarehouseIds.push(warehouseId);
    if (url.searchParams.get("type") === "outbound") dashboardOutboundWarehouseIds.push(warehouseId);

    if (url.searchParams.get("type") === "inbound") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([warehouseId === "warehouse-2"
          ? { itemId: "item-2", quantity: "21", amount: "210.00" }
          : { itemId: "item-1", quantity: "12", amount: "120.00" }]),
      });
      return;
    }

    if (url.searchParams.get("type") === "outbound") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([warehouseId === "warehouse-2"
          ? { itemId: "item-2", quantity: "8", amount: "80.00" }
          : { itemId: "item-1", quantity: "3", amount: "30.00" }]),
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
  const inventoryOverview = page.locator(".dashboard-inventory");
  await expect(inventoryOverview.getByRole("heading", { name: "全部库存总览" })).toBeVisible();
  await expect(inventoryOverview.getByRole("columnheader")).toHaveText(["物品", "当前库存", "状态", "近期变动"]);
  await expect(inventoryOverview.getByRole("columnheader", { name: "最低库存" })).toHaveCount(0);
  await expect(inventoryOverview.getByText("TEA-001", { exact: true })).toHaveCount(0);
  await expect(inventoryOverview.getByText("普洱茶饼", { exact: true })).toBeVisible();
  await expect(inventoryOverview.getByText("0", { exact: true })).toBeVisible();
  await expect(inventoryOverview.getByText("本月入库 +12 · 出库 -3", { exact: true })).toBeVisible();

  const categorySelector = inventoryOverview.getByRole("button", { name: "筛选品类：全部品类" });
  await categorySelector.click();
  const categoryMenu = inventoryOverview.getByRole("menu", { name: "品类筛选" });
  await expect(categoryMenu).toHaveClass(/workspace-popover--menu/);
  await categoryMenu.getByRole("menuitemradio", { name: /酒水/ }).click();
  await expect(inventoryOverview.getByText("茅台30年", { exact: true })).toBeVisible();
  await expect(inventoryOverview.getByText("普洱茶饼", { exact: true })).toHaveCount(0);
  await inventoryOverview.getByRole("button", { name: "筛选品类：酒水" }).click();
  await inventoryOverview.getByRole("menu", { name: "品类筛选" }).getByRole("menuitemradio", { name: /粉条/ }).click();
  await expect(inventoryOverview.getByText("盒装粉条", { exact: true })).toBeVisible();
  await expect(inventoryOverview.getByText("香烟", { exact: true })).toHaveCount(0);
  await inventoryOverview.getByRole("button", { name: "筛选品类：粉条" }).click();
  await inventoryOverview.getByRole("menu", { name: "品类筛选" }).getByRole("menuitemradio", { name: /全部品类/ }).click();
  await inventoryOverview.getByLabel("搜索库存物品").fill("357g");
  await expect(inventoryOverview.getByText("普洱茶饼", { exact: true })).toBeVisible();
  await expect(inventoryOverview.getByText("茅台30年", { exact: true })).toHaveCount(0);
  await inventoryOverview.getByLabel("搜索库存物品").fill("");
  await expect.poll(() => dashboardItemsWarehouseIds.length).toBeGreaterThan(0);
  await expect.poll(() => dashboardPendingWarehouseIds.length).toBeGreaterThan(0);
  await expect.poll(() => dashboardInboundWarehouseIds.length).toBeGreaterThan(0);
  await expect.poll(() => dashboardOutboundWarehouseIds.length).toBeGreaterThan(0);
  expect(dashboardItemsWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);
  expect(dashboardPendingWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);
  expect(dashboardInboundWarehouseIds.every((warehouseId) => warehouseId === "all")).toBe(true);
  expect(dashboardOutboundWarehouseIds.every((warehouseId) => warehouseId === "all")).toBe(true);

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

  const selectedInboundResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/admin/reports/transactions"
      && url.searchParams.get("type") === "inbound"
      && url.searchParams.get("warehouseId") === "warehouse-2";
  });
  const selectedOutboundResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/admin/reports/transactions"
      && url.searchParams.get("type") === "outbound"
      && url.searchParams.get("warehouseId") === "warehouse-2";
  });
  await page.locator(".topbar-selector").click();
  await page.getByRole("menuitemradio", { name: /WH-02/ }).click();
  await Promise.all([selectedInboundResponse, selectedOutboundResponse]);
  expect(dashboardItemsWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);
  expect(dashboardPendingWarehouseIds.every((warehouseId) => warehouseId === null)).toBe(true);
  expect(dashboardInboundWarehouseIds).toContain("warehouse-2");
  expect(dashboardOutboundWarehouseIds).toContain("warehouse-2");
  await expect(page.locator(".metric--inbound .metric__value strong")).toHaveText("21 / 210.00");
  await expect(page.locator(".metric--outbound .metric__value strong")).toHaveText("8 / 80.00");
});
