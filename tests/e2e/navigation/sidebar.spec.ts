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

test("1180px keyboard unpin keeps the focused compact sidebar expanded", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await loginAs(page, "/", "ADMIN");

  const toggle = page.locator(".sidebar__toggle");
  await toggle.focus();
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 232 });

  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 64 });

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "首页" })).toBeFocused();
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 64 });
});

test("1180px pointer unpin restores compact sidebar focus expansion on Tab", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await loginAs(page, "/", "ADMIN");

  const toggle = page.locator(".sidebar__toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 232 });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 64, workspaceLeft: 64 });

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "首页" })).toBeFocused();
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 64 });
});

test("1180px pinned sidebar remains expanded after focus moves to the workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await loginAs(page, "/", "ADMIN");

  const toggle = page.locator(".sidebar__toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 232 });

  await page.locator(".topbar-selector").focus();
  await expect(page.locator(".topbar-selector")).toBeFocused();
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 232 });
});

test("1180px focus-only sidebar collapses after focus moves to the workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await loginAs(page, "/", "ADMIN");

  await page.getByRole("link", { name: "首页" }).focus();
  await expect(page.getByRole("link", { name: "首页" })).toBeFocused();
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 232, workspaceLeft: 64 });

  await page.locator(".topbar-selector").focus();
  await expect(page.locator(".topbar-selector")).toBeFocused();
  await expect.poll(() => compactLayout(page)).toEqual({ sidebarWidth: 64, workspaceLeft: 64 });
});

test("821px and 980px compact topbar retains its page, role, and user controls without horizontal overflow", async ({ page }) => {
  for (const width of [821, 980]) {
    await page.setViewportSize({ width, height: 900 });
    await loginAs(page, "/", "ADMIN");

    const userButton = page.locator(".workspace-user-button");
    const userIcons = userButton.locator("> svg");
    await expect(page.locator(".topbar__crumb strong")).toBeVisible();
    await expect(page.locator(".topbar__crumb strong")).toHaveText("首页");
    await expect(userButton).toBeVisible();
    await expect(page.locator(".workspace-user-button small")).toBeVisible();
    await expect(page.locator(".workspace-user-button small")).toHaveText("库存管理员");
    await expect(userIcons).toHaveCount(2);
    await expect(userIcons.nth(0)).toBeVisible();
    await expect(userIcons.nth(1)).toBeVisible();
    await expect(page.locator(".topbar__crumb span")).toBeHidden();
    await expect(page.locator(".workspace-user-button strong")).toHaveCSS("text-overflow", "ellipsis");
    await expect(page.locator(".workspace-user-button small")).toHaveCSS("text-overflow", "ellipsis");
    await expect(page.locator(".topbar")).toHaveCSS("height", "74px");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  }
});

test("ADMIN and FINANCE retain the existing desktop navigation labels and hrefs", async ({ page }) => {
  const destinations = [
    { label: "首页", href: "/" },
    { label: "库存台账", href: "/admin/items" },
    { label: "出入库管理", href: "/admin/outbound" },
    { label: "报表中心", href: "/admin/reports" },
    { label: "系统设置", href: "/admin/warehouses" },
  ];

  for (const role of ["ADMIN", "FINANCE"] as const) {
    await page.setViewportSize({ width: 1181, height: 900 });
    await loginAs(page, "/", role);
    const navigation = page.getByRole("navigation", { name: "主导航" });
    await expect(navigation).toBeVisible();

    for (const destination of destinations) {
      await expect(navigation.getByRole("link", { name: destination.label })).toHaveAttribute("href", destination.href);
    }
  }
});

test("compact desktop keeps the topbar and dashboard readable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 900 });
  await loginAs(page, "/", "ADMIN");
  await expect(page.locator(".metric-strip")).toBeVisible();

  const narrow = await page.evaluate(() => {
    const metricStrip = document.querySelector<HTMLElement>(".metric-strip");
    const dashboard = document.querySelector<HTMLElement>(".dashboard-grid");
    const topbar = document.querySelector<HTMLElement>(".topbar");
    if (!metricStrip || !dashboard || !topbar) throw new Error("dashboard layout is missing");
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      topbarHeight: Math.round(topbar.getBoundingClientRect().height),
      metricColumns: getComputedStyle(metricStrip).gridTemplateColumns.split(" ").length,
      dashboardColumns: getComputedStyle(dashboard).gridTemplateColumns.split(" ").length,
    };
  });

  expect(narrow).toEqual({ overflow: false, topbarHeight: 74, metricColumns: 2, dashboardColumns: 1 });

  await page.setViewportSize({ width: 1180, height: 900 });
  const wide = await page.evaluate(() => {
    const metricStrip = document.querySelector<HTMLElement>(".metric-strip");
    const dashboard = document.querySelector<HTMLElement>(".dashboard-grid");
    if (!metricStrip || !dashboard) throw new Error("dashboard layout is missing");
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      metricColumns: getComputedStyle(metricStrip).gridTemplateColumns.split(" ").length,
      dashboardColumns: getComputedStyle(dashboard).gridTemplateColumns.split(" ").length,
    };
  });

  expect(wide).toEqual({ overflow: false, metricColumns: 4, dashboardColumns: 1 });
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
