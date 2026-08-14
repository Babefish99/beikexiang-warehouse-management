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
  await page.route(/\/admin\/outbound\/pending$/, (route) => route.fulfill({
    json: [
      { id: "approval-1", weComSpNo: "202608130001", status: "PENDING_OUTBOUND", lines: [] },
      { id: "approval-2", weComSpNo: "202608130002", status: "PENDING_OUTBOUND", lines: [] },
    ],
  }));
  await page.route(/\/admin\/reports\/transactions.*/, (route) => route.fulfill({ json: [] }));
  await page.route(/\/admin\/notifications$/, (route) => route.fulfill({
    json: [
      { id: "n-1", kind: "PENDING_OUTBOUND", title: "待出库", description: "当前有 2 个审批单待完成实际出库。", href: "/admin/outbound", priority: 1 },
      { id: "n-2", kind: "LOW_STOCK", title: "低库存", description: "当前有 1 个物品低于最低库存。", href: "/admin/inventory", priority: 2 },
    ],
  }));

  await loginAs(page, "/", "ADMIN");

  const dashboard = page.getByRole("main");
  await expect(dashboard.getByRole("heading", { name: /你好/ })).toBeVisible();
  await expect(dashboard.getByRole("link", { name: "手机入库" })).toBeVisible();
  await expect(dashboard.getByRole("link", { name: "实际出库" })).toBeVisible();
  await expect(dashboard.getByRole("region", { name: "今日概览" })).toContainText("待出库2低库存1库存品类2通知2");
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

test("finance dashboard makes zero administrator data requests", async ({ page }) => {
  const forbiddenRequests: string[] = [];
  await page.route(/\/admin\/(items|outbound\/pending|reports\/transactions|notifications)(?:\?|$)/, (route) => {
    forbiddenRequests.push(route.request().url());
    return route.fulfill({ json: [] });
  });

  await loginAs(page, "/", "FINANCE");

  await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "库存查询" })).toBeVisible();
  expect(forbiddenRequests).toEqual([]);
});

test("keeps loading through debounce and ignores older query, warehouse, and error responses", async ({ page }) => {
  const releases = new Map<string, () => void>();
  await page.route(/\/admin\/reports\/warehouses$/, (route) => route.fulfill({ json: [
    { id: "wh-1", code: "WH-01", name: "总部仓", isActive: true },
    { id: "wh-2", code: "WH-02", name: "上海二仓", isActive: true },
  ] }));
  await page.route(/\/admin\/reports\/inventory-search.*/, async (route) => {
    const url = new URL(route.request().url());
    const key = `${url.searchParams.get("query")}:${url.searchParams.get("warehouseId")}`;
    await new Promise<void>((resolve) => releases.set(key, resolve));
    if (key.startsWith("broken:")) {
      await route.fulfill({ status: 500, json: { error: "旧请求失败" } });
      return;
    }
    await route.fulfill({ json: [{
      itemId: key, code: key, name: key, unit: "盒", totalQuantity: "1", totalAmount: "1.00",
      locations: [{ warehouseId: "wh-1", warehouseName: "总部仓", batchId: key, batchNo: key, quantity: "1", unitCost: "1", amount: "1.00" }],
    }] });
  });
  await loginAs(page, "/admin/inventory", "ADMIN");
  const search = page.getByRole("searchbox", { name: "查询库存" });

  await search.fill("old");
  expect(await page.getByText("正在查询库存…").count()).toBe(1);
  await expect(page.getByText("未找到匹配的库存结果")).toHaveCount(0);
  await expect.poll(() => releases.has("old:all")).toBe(true);
  await search.fill("new");
  await expect.poll(() => releases.has("new:all")).toBe(true);
  releases.get("new:all")!();
  await expect(page.getByRole("article", { name: /new:all/ })).toBeVisible();
  releases.get("old:all")!();
  await expect(page.getByRole("article", { name: /new:all/ })).toBeVisible();

  await search.fill("switch");
  await expect.poll(() => releases.has("switch:all")).toBe(true);
  await page.setViewportSize({ width: 821, height: 844 });
  await page.getByRole("button", { name: /全部仓库/ }).click();
  await page.getByRole("menuitemradio", { name: /WH-02 · 上海二仓/ }).click();
  await expect.poll(() => releases.has("switch:wh-2")).toBe(true);
  releases.get("switch:wh-2")!();
  await expect(page.locator("tbody tr").filter({ hasText: "switch:wh-2" })).toBeVisible();
  releases.get("switch:all")!();
  await expect(page.locator("tbody tr").filter({ hasText: "switch:wh-2" })).toBeVisible();

  await search.fill("broken");
  await expect.poll(() => releases.has("broken:wh-2")).toBe(true);
  await search.fill("recovered");
  await expect.poll(() => releases.has("recovered:wh-2")).toBe(true);
  releases.get("recovered:wh-2")!();
  await expect(page.locator("tbody tr").filter({ hasText: "recovered:wh-2" })).toBeVisible();
  releases.get("broken:wh-2")!();
  await expect(page.getByText("旧请求失败")).toHaveCount(0);
});
