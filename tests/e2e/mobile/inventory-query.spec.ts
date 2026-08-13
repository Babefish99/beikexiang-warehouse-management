import { expect, test } from "@playwright/test";
import { loginAs } from "./mobile-test-helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("inventory search renders warehouse and batch cards with cost for admin", async ({ page }) => {
  await page.route(/\/admin\/reports\/inventory-search.*/, (route) => route.fulfill({
    json: [{
      itemId: "item-1", code: "TEA-001", name: "接待茶叶", unit: "盒",
      totalQuantity: "12", totalAmount: "240.00",
      locations: [{ warehouseId: "wh-1", warehouseName: "北京总仓", batchId: "batch-1", batchNo: "B-001", quantity: "12", unitCost: "20", amount: "240.00" }],
    }],
  }));
  await loginAs(page, "/admin/inventory?query=TEA", "ADMIN");
  await expect(page.getByRole("article", { name: /TEA-001/ })).toContainText("北京总仓");
  await expect(page.getByRole("article", { name: /TEA-001/ })).toContainText("批次 B-001");
  await expect(page.getByRole("article", { name: /TEA-001/ })).toContainText("单价 20");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("mobile admin dashboard shows task actions and notification-derived overview", async ({ page }) => {
  await page.route(/\/admin\/items\?includeInactive=true$/, (route) => route.fulfill({
    json: [{ isActive: true }, { isActive: true }, { isActive: false }],
  }));
  await page.route(/\/admin\/outbound\/pending$/, (route) => route.fulfill({ json: [] }));
  await page.route(/\/admin\/reports\/transactions.*/, (route) => route.fulfill({ json: [] }));
  await page.route(/\/admin\/notifications$/, (route) => route.fulfill({
    json: [
      { id: "n-1", kind: "PENDING_OUTBOUND", title: "待出库", description: "", href: "/admin/outbound", priority: 1 },
      { id: "n-2", kind: "PENDING_OUTBOUND", title: "待出库", description: "", href: "/admin/outbound", priority: 1 },
      { id: "n-3", kind: "LOW_STOCK", title: "低库存", description: "", href: "/admin/inventory", priority: 2 },
    ],
  }));

  await loginAs(page, "/", "ADMIN");

  const dashboard = page.getByRole("main");
  await expect(dashboard.getByRole("heading", { name: /你好/ })).toBeVisible();
  await expect(dashboard.getByRole("link", { name: "手机入库" })).toBeVisible();
  await expect(dashboard.getByRole("link", { name: "实际出库" })).toBeVisible();
  await expect(dashboard.getByRole("region", { name: "今日概览" })).toContainText("待出库2低库存1库存品类2通知3");
  const iconSizes = await dashboard.locator(".mobile-dashboard svg").evaluateAll((icons) => icons.map((icon) => icon.getBoundingClientRect().width));
  expect(iconSizes.length).toBeGreaterThan(0);
  expect(iconSizes.every((size) => size === 18)).toBe(true);
});

test("finance inventory route renders the shared query without admin dashboard requests", async ({ page }) => {
  const forbiddenRequests: string[] = [];
  await page.route(/\/admin\/(items|outbound\/pending|notifications)(?:\?|$)/, (route) => {
    forbiddenRequests.push(route.request().url());
    return route.fulfill({ json: [] });
  });
  await page.route(/\/admin\/reports\/inventory-search.*/, (route) => route.fulfill({ json: [] }));

  await loginAs(page, "/admin/inventory?query=TEA", "FINANCE");

  await expect(page.getByRole("heading", { name: "库存查询" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "查询库存" })).toHaveValue("TEA");
  expect(forbiddenRequests).toEqual([]);
});
