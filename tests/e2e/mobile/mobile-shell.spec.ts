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

test("mobile dashboard keeps warehouse controls and heading levels aligned with desktop", async ({ page }) => {
  await loginAs(page, "/", "ADMIN");

  const typography = await page.locator(".mobile-dashboard").evaluate((dashboard) => {
    const style = (selector: string) => getComputedStyle(dashboard.querySelector<HTMLElement>(selector)!).fontSize;
    const warehouse = dashboard.querySelector<HTMLElement>(".mobile-dashboard__warehouse select")!;
    const action = dashboard.querySelector<HTMLElement>(".mobile-dashboard__actions a")!;

    return {
      warehouse: style(".mobile-dashboard__warehouse select"),
      action: style(".mobile-dashboard__actions a"),
      h1: style(".mobile-dashboard__greeting h1"),
      h2: style(".mobile-dashboard__overview h2"),
      warehouseHeight: warehouse.getBoundingClientRect().height,
      actionHeight: action.getBoundingClientRect().height,
    };
  });

  expect(typography).toEqual({
    warehouse: "14px",
    action: "14px",
    h1: "25px",
    h2: "18px",
    warehouseHeight: 44,
    actionHeight: 72,
  });
});

test("more sheet explains desktop-only work without horizontal overflow", async ({ page }) => {
  await loginAs(page, "/", "ADMIN");
  await page.getByRole("button", { name: "更多" }).click();
  const dialog = page.getByRole("dialog", { name: "更多功能" });
  await expect(dialog).toContainText("调拨");
  await expect(dialog).toContainText("电脑端");
  const closeButton = dialog.getByRole("button", { name: "关闭更多功能" });
  const closeSize = await closeButton.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  expect(closeSize.width).toBeGreaterThanOrEqual(44);
  expect(closeSize.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("confirm dialog actions keep mobile-sized touch targets", async ({ page }) => {
  await loginAs(page, "/", "ADMIN");
  await page.evaluate(() => {
    const dialog = document.createElement("section");
    dialog.className = "modal-dialog modal-dialog--shared";
    const actions = document.createElement("footer");
    actions.className = "modal-dialog__actions";
    actions.innerHTML = `
      <button class="button button--secondary" type="button">取消</button>
      <button class="button button--primary" type="button">确认</button>
    `;
    dialog.append(actions);
    document.body.append(dialog);
  });

  for (const name of ["取消", "确认"]) {
    const size = await page.getByRole("button", { name, exact: true }).evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
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
