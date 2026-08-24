import { expect, test, type Page } from "@playwright/test";
import { apiUrl, loginAs } from "./mobile-test-helpers";

const desktopOnlyRoutes = [
  { path: "/admin/items", title: "标准物品库", request: "/admin/items?includeInactive=true" },
  { path: "/admin/warehouses", title: "仓库设置", request: "/admin/warehouses?includeInactive=true" },
  { path: "/admin/opening-stock", title: "期初库存导入", request: "/admin/opening-stock/import/status" },
  { path: "/admin/transfers", title: "仓库调拨", request: "/admin/transfers/options" },
  { path: "/admin/returns", title: "办理退库", request: "/admin/returns/options" },
  { path: "/admin/stocktake", title: "月度盘点", request: "/admin/stocktake/options" },
  { path: "/admin/period-close", title: "月度结账" },
] as const;

async function countRequests(page: Page, path: string | undefined): Promise<() => number> {
  let count = 0;
  if (path) {
    await page.route(apiUrl(path), async (route) => {
      count += 1;
      await route.fulfill({ contentType: "application/json", body: "[]" });
    });
  }
  return () => count;
}

test.describe("mobile desktop-only route guard", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const routeCase of desktopOnlyRoutes) {
    test(`${routeCase.path} does not mount its writable page or request its data`, async ({ page }) => {
      const requestCount = await countRequests(page, routeCase.request);

      await loginAs(page, routeCase.path, "ADMIN");

      await expect(page.getByRole("heading", { name: "请在电脑端处理" })).toBeVisible();
      await expect(page.getByRole("heading", { name: routeCase.title })).toHaveCount(0);
      await expect(page.locator("main form")).toHaveCount(0);
      expect(requestCount()).toBe(0);
    });
  }
});

test.describe("desktop route preservation above the mobile breakpoint", () => {
  test.use({ viewport: { width: 821, height: 844 } });

  for (const routeCase of desktopOnlyRoutes) {
    test(`${routeCase.path} keeps its existing desktop page`, async ({ page }) => {
      if (routeCase.request) {
        await page.route(apiUrl(routeCase.request), async (route) => {
          await route.fulfill({
            contentType: "application/json",
            body: routeCase.path === "/admin/transfers"
              ? '{"balances":[]}'
              : routeCase.path === "/admin/opening-stock"
                ? '{"availability":"AVAILABLE"}'
                : "[]",
          });
        });
      }

      await loginAs(page, routeCase.path, "ADMIN");

      await expect(page.getByRole("heading", { name: routeCase.title })).toBeVisible();
      await expect(page.getByRole("heading", { name: "请在电脑端处理" })).toHaveCount(0);
    });
  }
});
