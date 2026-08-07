import { test, expect } from "@playwright/test";

test("dashboard quick actions open the corresponding operation pages", async ({ page }) => {
  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2F");
  await expect(page.getByRole("heading", { name: "库存总览" })).toBeVisible();

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
