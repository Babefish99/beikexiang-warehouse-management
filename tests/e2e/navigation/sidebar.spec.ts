import { test, expect } from "@playwright/test";
import { apiUrl } from "../mobile/mobile-test-helpers";

test("sidebar brand renders the company logo instead of the text placeholder", async ({ page }) => {
  await page.goto(apiUrl("/auth/local?returnTo=%2F"));

  const brand = page.locator(".sidebar__brand");
  const logo = brand.getByRole("img", { name: "贝壳祥集团" });

  await expect(logo).toBeVisible();
  await expect(brand).not.toContainText("集团仓库");
  await expect.poll(() => logo.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
});

test("sidebar navigation opens the corresponding admin pages", async ({ page }) => {
  await page.goto(apiUrl("/auth/local?returnTo=%2F"));
  await expect(page.getByRole("heading", { name: "库存总览" })).toBeVisible();

  const destinations = [
    { label: "库存台账", path: "/admin/items", heading: "标准物品库" },
    { label: "出入库管理", path: "/admin/outbound", heading: "办理出库" },
    { label: "报表中心", path: "/admin/reports", heading: "报表中心" },
    { label: "系统设置", path: "/admin/warehouses", heading: "仓库设置" },
  ];

  for (const destination of destinations) {
    await page.getByRole("link", { name: destination.label }).click();
    await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
    await expect(page.getByRole("heading", { name: destination.heading })).toBeVisible();
  }
});
