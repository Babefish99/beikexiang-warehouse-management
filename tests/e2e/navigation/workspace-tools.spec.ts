import { test, expect, type Page } from "@playwright/test";

async function routeWorkspaceWarehouses(page: Page) {
  await page.route("http://127.0.0.1:3001/admin/reports/warehouses", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "warehouse-1", code: "WH-01", name: "杭州一仓", isActive: true },
        { id: "warehouse-2", code: "WH-02", name: "上海二仓", isActive: true },
      ]),
    });
  });
}

test("global workspace search shows inventory details and opens item search results", async ({ page }) => {
  await routeWorkspaceWarehouses(page);
  await page.route(/http:\/\/127\.0\.0\.1:3001\/admin\/reports\/inventory-search.*/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("query")).toBe("Tea");
    expect(url.searchParams.get("warehouseId")).toBe("all");

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          itemId: "item-1",
          code: "TEA-001",
          name: "Tea leaves",
          specification: "500g",
          unit: "袋",
          totalQuantity: "25",
          totalAmount: "450.00",
          locations: [
            {
              warehouseId: "warehouse-1",
              warehouseName: "杭州一仓",
              batchId: "batch-1",
              batchNo: "BATCH-TEA-01",
              quantity: "25",
              unitCost: "18",
              amount: "450.00",
            },
          ],
        },
      ]),
    });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2F");
  await expect(page.getByRole("heading", { name: "库存总览" })).toBeVisible();

  await page.getByLabel("全局搜索").fill("Tea");
  const result = page.getByRole("button", { name: /TEA-001/ });
  await expect(result).toBeVisible();
  await expect(result).toContainText("杭州一仓");
  await expect(result).toContainText("BATCH-TEA-01");
  await expect(result).toContainText("数量 25");

  await result.click();
  await expect(page).toHaveURL(/\/admin\/items\?search=TEA-001$/);
});

test("notification center shows unread items and clears the local unread indicator", async ({ page }) => {
  await routeWorkspaceWarehouses(page);
  await page.route("http://127.0.0.1:3001/admin/notifications", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "notification-1",
          kind: "ANOMALY",
          title: "盘点差异待复核",
          description: "杭州一仓存在 1 条盘点差异，请及时处理。",
          href: "/admin/stocktake",
          priority: 1,
        },
      ]),
    });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2F");
  await expect(page.getByRole("heading", { name: "库存总览" })).toBeVisible();

  const notificationButton = page.getByRole("button", { name: "通知中心" });
  await expect(notificationButton.locator(".workspace-icon-button__badge")).toHaveCount(1);
  await notificationButton.click();
  await expect(page.getByText("盘点差异待复核")).toBeVisible();
  await expect(page.getByRole("button", { name: "全部已读" })).toBeVisible();
  await page.getByRole("button", { name: "全部已读" }).click();
  await expect(notificationButton.locator(".workspace-icon-button__badge")).toHaveCount(0);
});
