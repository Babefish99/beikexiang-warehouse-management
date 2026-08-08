import { test, expect } from "@playwright/test";

test("dashboard quick actions open the corresponding operation pages", async ({ page }) => {
  await page.route("http://127.0.0.1:3001/admin/reports/warehouses", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "warehouse-1", code: "WH-01", name: "杭州一仓", isActive: true },
        { id: "warehouse-2", code: "WH-02", name: "上海二仓", isActive: true },
      ]),
    });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2F");
  await expect(page.getByRole("heading", { name: "库存总览" })).toBeVisible();
  await expect(page.locator(".metric")).toHaveCount(4);
  await expect(page.locator(".metric--inventory")).toHaveCount(1);
  await expect(page.locator(".metric--approval")).toHaveCount(1);
  await expect(page.locator(".metric--inbound")).toHaveCount(1);
  await expect(page.locator(".metric--outbound")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /全部仓库/ })).toBeVisible();
  const userButton = page.getByRole("button", { name: /本地管理员/ });
  await expect(userButton).toBeVisible();
  await expect(userButton).toContainText("库存管理员");
  await expect(page.getByRole("button", { name: "通知中心" })).toBeVisible();
  await expect(page.getByText("当前运行状态")).toBeVisible();
  await expect(page.getByText("月末盘点与结账")).toBeVisible();

  const destinations = [
    { label: "登记入库", path: "/admin/inbound", heading: "登记入库" },
    { label: "办理出库", path: "/admin/outbound", heading: "办理出库" },
    { label: "录入期初库存", path: "/admin/opening-stock", heading: "录入期初库存" },
  ];

  for (const destination of destinations) {
    await page.getByRole("link", { name: destination.label }).click();
    await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
    await expect(page.getByRole("heading", { name: destination.heading })).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "库存总览" })).toBeVisible();
  }
});
