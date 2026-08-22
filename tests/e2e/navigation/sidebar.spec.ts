import { test, expect } from "@playwright/test";
import { loginAs } from "../mobile/mobile-test-helpers";

test("sidebar brand renders the company logo instead of the text placeholder", async ({ page }) => {
  await loginAs(page, "/", "ADMIN");

  const brand = page.locator(".sidebar__brand");
  const logo = brand.getByRole("img", { name: "贝壳祥集团" });

  await expect(logo).toBeVisible();
  await expect(brand).not.toContainText("集团仓库");
  await expect.poll(() => logo.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
});

test("sidebar navigation opens the corresponding admin pages", async ({ page }) => {
  await loginAs(page, "/", "ADMIN");
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

test("1180px sidebar stays compact until it is pinned, then collapses on a second click", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await loginAs(page, "/", "ADMIN");

  const sidebar = page.locator(".sidebar");
  const workspace = page.locator(".workspace");
  const toggle = page.getByRole("button", { name: "固定展开侧栏" });

  await page.mouse.move(1179, 880);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(64);
  await expect.poll(() => workspace.evaluate((node) => Math.round(node.getBoundingClientRect().left))).toBe(64);

  await sidebar.hover();
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(232);
  await page.mouse.move(1179, 880);
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(64);

  await toggle.click();
  await expect(page.getByRole("button", { name: "收起固定侧栏" })).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(232);
  await expect.poll(() => workspace.evaluate((node) => Math.round(node.getBoundingClientRect().left))).toBe(232);

  await page.getByRole("button", { name: "收起固定侧栏" }).click();
  await expect(page.getByRole("button", { name: "固定展开侧栏" })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => workspace.evaluate((node) => Math.round(node.getBoundingClientRect().left))).toBe(64);
  await page.mouse.move(1179, 880);
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(64);
});

test("full desktop and mobile navigation stay outside the compact-sidebar range", async ({ page }) => {
  await page.setViewportSize({ width: 1181, height: 900 });
  await loginAs(page, "/", "ADMIN");
  await expect(page.getByRole("button", { name: "固定展开侧栏" })).toHaveCount(0);
  await expect.poll(() => page.locator(".sidebar").evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(232);

  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "手机任务导航" })).toBeVisible();
});
