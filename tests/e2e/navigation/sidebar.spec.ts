import { test, expect } from "@playwright/test";

test("sidebar navigation opens the corresponding admin pages", async ({ page }) => {
  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2F");
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
