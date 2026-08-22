import { test, expect } from "@playwright/test";
import { apiUrl, loginAs } from "../mobile/mobile-test-helpers";

async function compactLayout(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".sidebar");
    const workspace = document.querySelector<HTMLElement>(".workspace");
    if (!sidebar || !workspace) throw new Error("workspace shell is missing");
    return {
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      workspaceLeft: Math.round(workspace.getBoundingClientRect().left),
    };
  });
}

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

test("1180px compact sidebar hovers temporarily and pins only after a click", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await loginAs(page, "/", "ADMIN");

  const sidebar = page.locator(".sidebar");
  const toggle = page.locator(".sidebar__toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 64, workspaceLeft: 64 });

  await sidebar.hover();
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 64 });
  await page.mouse.move(1100, 820);
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 64, workspaceLeft: 64 });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 232 });
  await page.mouse.move(1100, 820);
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 232 });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 64, workspaceLeft: 64 });

  await toggle.click();
  await page.reload();
  await expect(page.locator(".sidebar__toggle")).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 64, workspaceLeft: 64 });
});

test("desktop and mobile navigation remain on their existing boundaries", async ({ page }) => {
  await page.setViewportSize({ width: 1181, height: 900 });
  await loginAs(page, "/", "ADMIN");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 232 });
  await expect(page.locator(".sidebar__toggle")).toBeHidden();

  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.getByRole("navigation", { name: "手机任务导航" })).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);
});
