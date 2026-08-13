import { test, expect, type Page } from "@playwright/test";
import { apiUrl, apiUrlPattern, loginAs } from "../mobile/mobile-test-helpers";

async function routeWorkspaceWarehouses(page: Page) {
  await page.route(apiUrl("/admin/reports/warehouses"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "warehouse-1", code: "WH-01", name: "杭州一仓", isActive: true },
        { id: "warehouse-2", code: "WH-02", name: "上海二仓", isActive: true },
      ]),
    });
  });
}

async function routeItems(page: Page) {
  await page.route(apiUrl("/admin/items?includeInactive=true"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "item-1",
          code: "TEA-001",
          name: "Tea leaves",
          specification: "500g",
          unit: "袋",
          categoryId: "CAT-TEA",
          weComOptionKey: "tea",
          minimumStock: "10",
          isActive: true,
        },
        {
          id: "item-2",
          code: "COF-001",
          name: "Coffee beans",
          specification: "1kg",
          unit: "袋",
          categoryId: "CAT-COF",
          weComOptionKey: "coffee",
          minimumStock: "5",
          isActive: true,
        },
      ]),
    });
  });
}

async function routeFinanceReports(page: Page) {
  await page.route(apiUrl("/admin/reports/summary?period=2026-08"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ itemId: "TEA-001", quantity: "25", amount: "450.00" }]),
    });
  });
  await page.route(apiUrl("/admin/reports/transactions?period=2026-08&type=all"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "txn-1",
          occurredAt: "2026-08-08T08:00:00.000Z",
          warehouseId: "warehouse-1",
          itemId: "TEA-001",
          type: "inbound",
          quantity: "25",
          unitCost: "18",
          amount: "450.00",
          referenceType: "INBOUND",
        },
      ]),
    });
  });
}

test("global workspace search opens the inventory query page from a search result", async ({ page }) => {
  await routeWorkspaceWarehouses(page);
  await routeItems(page);
  await page.route(apiUrlPattern("/admin/reports/inventory-search.*"), async (route) => {
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

  await loginAs(page, "/", "ADMIN");
  await expect(page.getByRole("heading", { name: "库存总览" })).toBeVisible();

  await page.getByLabel("全局搜索").fill("Tea");
  const result = page.getByRole("button", { name: /TEA-001/ });
  await expect(result).toBeVisible();
  await expect(result).toContainText("杭州一仓");
  await expect(result).toContainText("BATCH-TEA-01");
  await expect(result).toContainText("数量 25");

  await result.click();
  await expect(page).toHaveURL(/\/admin\/inventory\?query=TEA-001$/);
  await expect(page.getByRole("heading", { name: "库存查询" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "查询库存" })).toHaveValue("TEA-001");
});

test("changing the selected warehouse clears stale search results and shows the new warehouse context", async ({ page }) => {
  await routeWorkspaceWarehouses(page);
  await routeItems(page);
  await page.route(apiUrlPattern("/admin/reports/inventory-search.*"), async (route) => {
    const url = new URL(route.request().url());
    const warehouseId = url.searchParams.get("warehouseId");

    if (warehouseId === "all") {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            itemId: "item-old",
            code: "OLD-001",
            name: "Old warehouse result",
            unit: "袋",
            totalQuantity: "8",
            totalAmount: "120.00",
            locations: [
              {
                warehouseId: "warehouse-1",
                warehouseName: "杭州一仓",
                batchId: "batch-old",
                batchNo: "OLD-BATCH",
                quantity: "8",
                unitCost: "15",
                amount: "120.00",
              },
            ],
          },
        ]),
      });
      return;
    }

    expect(warehouseId).toBe("warehouse-2");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          itemId: "item-new",
          code: "NEW-002",
          name: "New warehouse result",
          unit: "袋",
          totalQuantity: "12",
          totalAmount: "300.00",
          locations: [
            {
              warehouseId: "warehouse-2",
              warehouseName: "上海二仓",
              batchId: "batch-new",
              batchNo: "NEW-BATCH",
              quantity: "12",
              unitCost: "25",
              amount: "300.00",
            },
          ],
        },
      ]),
    });
  });

  await loginAs(page, "/", "ADMIN");
  await expect(page.getByRole("heading", { name: "库存总览" })).toBeVisible();

  await page.getByLabel("全局搜索").fill("Tea");
  await expect(page.getByRole("button", { name: /OLD-001/ })).toBeVisible();

  await page.getByRole("button", { name: /全部仓库/ }).click();
  await page.getByRole("menuitemradio", { name: /WH-02 · 上海二仓/ }).click();

  await expect(page.getByRole("button", { name: /OLD-001/ })).toHaveCount(0);
  const refreshedResult = page.getByRole("button", { name: /NEW-002/ });
  await expect(refreshedResult).toBeVisible();
  await expect(refreshedResult).toContainText("上海二仓");
  await expect(page.getByRole("button", { name: /OLD-001/ })).toHaveCount(0);
});

test("Escape closes workspace popovers and updates aria-expanded state", async ({ page }) => {
  await routeWorkspaceWarehouses(page);
  await routeItems(page);
  await page.route(apiUrlPattern("/admin/reports/inventory-search.*"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          itemId: "item-1",
          code: "TEA-001",
          name: "Tea leaves",
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
  await page.route(apiUrl("/admin/notifications"), async (route) => {
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

  await loginAs(page, "/", "ADMIN");
  const warehouseButton = page.getByRole("button", { name: /全部仓库/ });
  await warehouseButton.click();
  await expect(warehouseButton).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(warehouseButton).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("menu", { name: "仓库切换" })).toHaveCount(0);

  await page.getByLabel("全局搜索").fill("Tea");
  await expect(page.getByRole("button", { name: /TEA-001/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /TEA-001/ })).toHaveCount(0);

  const notificationButton = page.getByRole("button", { name: "通知中心" });
  await notificationButton.click();
  await expect(notificationButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("盘点差异待复核")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(notificationButton).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("盘点差异待复核")).toHaveCount(0);

  const userButton = page.getByRole("button", { name: /本地管理员/ });
  await userButton.click();
  await expect(userButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("登录信息")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(userButton).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("登录信息")).toHaveCount(0);
});

test("notification center shows the live task count without local read state", async ({ page }) => {
  await routeWorkspaceWarehouses(page);
  await routeItems(page);
  await page.route(apiUrl("/admin/notifications"), async (route) => {
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

  await loginAs(page, "/", "ADMIN");
  await expect(page.getByRole("heading", { name: "库存总览" })).toBeVisible();
  await expect(page.locator(".sidebar__footer strong")).toHaveCSS("font-size", "14px");
  await expect(page.locator(".sidebar__footer small")).toHaveCSS("font-size", "12px");
  await expect(page.getByText("Inventory Center", { exact: true })).toHaveCount(0);

  const notificationButton = page.getByRole("button", { name: "通知中心" });
  await expect(notificationButton).toContainText("1");
  await notificationButton.click();
  await expect(page.getByText("盘点差异待复核")).toBeVisible();
  await expect(page.getByRole("button", { name: "全部已读" })).toHaveCount(0);
  await expect(notificationButton).toContainText("1");
});

test("saved warehouse selection restores from localStorage", async ({ page }) => {
  await routeWorkspaceWarehouses(page);
  await routeItems(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("warehouse.selectedWarehouseId", "warehouse-2");
  });
  await page.route(apiUrlPattern("/admin/reports/inventory-search.*"), async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("warehouseId")).toBe("warehouse-2");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          itemId: "item-2",
          code: "SH-002",
          name: "Shanghai selection",
          unit: "袋",
          totalQuantity: "12",
          totalAmount: "300.00",
          locations: [
            {
              warehouseId: "warehouse-2",
              warehouseName: "上海二仓",
              batchId: "batch-sh",
              batchNo: "SH-BATCH",
              quantity: "12",
              unitCost: "25",
              amount: "300.00",
            },
          ],
        },
      ]),
    });
  });

  await loginAs(page, "/", "ADMIN");
  await expect(page.getByRole("button", { name: /WH-02 · 上海二仓/ })).toBeVisible();
  await page.getByLabel("全局搜索").fill("Tea");
  await expect(page.getByRole("button", { name: /SH-002/ })).toBeVisible();
});

test("desktop topbar keeps search beside the warehouse selector at approved type sizes", async ({ page }) => {
  await routeWorkspaceWarehouses(page);
  await routeItems(page);

  await loginAs(page, "/", "ADMIN");
  await expect(page.getByRole("button", { name: /全部仓库/ })).toBeVisible();

  const layout = await page.locator(".topbar").evaluate((topbar) => {
    const selector = topbar.querySelector<HTMLElement>(".topbar-selector");
    const search = topbar.querySelector<HTMLElement>(".workspace-search");
    const section = topbar.querySelector<HTMLElement>(".topbar__crumb strong");
    if (!selector || !search || !section) throw new Error("topbar controls are missing");

    return {
      gap: search.getBoundingClientRect().left - selector.getBoundingClientRect().right,
      sectionFontSize: Number.parseFloat(getComputedStyle(section).fontSize),
      selectorFontSize: Number.parseFloat(getComputedStyle(selector).fontSize),
    };
  });

  expect(layout.gap).toBeGreaterThanOrEqual(12);
  expect(layout.gap).toBeLessThanOrEqual(28);
  expect(layout.sectionFontSize).toBe(16);
  expect(layout.selectorFontSize).toBe(14);
});

test("invalid saved warehouse selection resets to all", async ({ page }) => {
  await routeWorkspaceWarehouses(page);
  await routeItems(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("warehouse.selectedWarehouseId", "warehouse-missing");
  });

  await loginAs(page, "/", "ADMIN");
  await expect(page.getByRole("button", { name: /全部仓库/ })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("warehouse.selectedWarehouseId"))).toBe("all");
});

test("finance report shell does not request notifications", async ({ page }) => {
  await routeWorkspaceWarehouses(page);
  await routeFinanceReports(page);

  let notificationRequests = 0;
  await page.route(apiUrl("/admin/notifications"), async (route) => {
    notificationRequests += 1;
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await loginAs(page, "/admin/reports", "FINANCE");
  await expect(page.getByRole("heading", { name: "报表中心" })).toBeVisible();
  await expect(page.getByRole("button", { name: /全部仓库/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "通知中心" })).toHaveCount(0);
  expect(notificationRequests).toBe(0);
});
