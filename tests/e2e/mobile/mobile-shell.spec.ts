import { expect, test } from "@playwright/test";
import { loginAs } from "./mobile-test-helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("admin gets task navigation with balanced icon and label sizes", async ({ page }) => {
  await loginAs(page, "/", "ADMIN");
  const nav = page.getByRole("navigation", { name: "手机任务导航" });
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(nav.getByRole("button", { name: "更多" })).toBeVisible();
  await expect(nav).toContainText("首页查询入库出库更多");
  const sizing = await nav.evaluate((node) => {
    const icon = node.querySelector("svg")!;
    const label = node.querySelector("span")!;
    return { icon: icon.getBoundingClientRect().width, label: getComputedStyle(label).fontSize };
  });
  expect(sizing.icon).toBe(18);
  expect(sizing.label).toBe("12px");
});

test("more sheet explains desktop-only work without horizontal overflow", async ({ page }) => {
  await loginAs(page, "/", "ADMIN");
  await page.getByRole("button", { name: "更多" }).click();
  await expect(page.getByRole("dialog", { name: "更多功能" })).toContainText("调拨");
  await expect(page.getByRole("dialog", { name: "更多功能" })).toContainText("电脑端");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("finance gets query and report navigation without inventory mutations", async ({ page }) => {
  await loginAs(page, "/", "FINANCE");
  const nav = page.getByRole("navigation", { name: "手机任务导航" });
  await expect(nav).toContainText("首页查询报表更多");
  await expect(nav).not.toContainText("入库");
  await expect(nav).not.toContainText("出库");
});

for (const width of [320, 390, 430, 820]) {
  test(`mobile shell fits the ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await loginAs(page, "/", "ADMIN");
    await expect(page.getByRole("navigation", { name: "手机任务导航" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
