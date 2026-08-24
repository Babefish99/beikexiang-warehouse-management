import { expect, test, type Page } from "@playwright/test";
import { apiUrl, loginAs } from "./mobile-test-helpers";

const tasks = [
  { id: "pending-outbound", kind: "PENDING_OUTBOUND", title: "待出库审批", description: "1 条审批待确认出库。", href: "/admin/outbound", priority: 1 },
  { id: "low-stock-item-1", kind: "LOW_STOCK", title: "库存预警：Tea", description: "Tea 当前库存 1，低于最低库存 3。", href: "/admin/inventory?query=TEA-001", priority: 1 },
  { id: "anomaly", kind: "ANOMALY", title: "盘点差异待处理", description: "1 条盘点差异需要处理。", href: "/admin/stocktake", priority: 1 },
  { id: "stocktake", kind: "STOCKTAKE", title: "盘点调整待复核", description: "1 条记录等待复核。", href: "/admin/stocktake", priority: 2 },
  { id: "period-close-2026-08", kind: "PERIOD_CLOSE", title: "当前期间待结账", description: "记账期间 2026-08 尚未结账。", href: "/admin/period-close", priority: 3 },
];

async function openMobileNotificationCenter(page: Page) {
  await page.getByRole("button", { name: "更多" }).click();
  const moreSheet = page.getByRole("dialog", { name: "更多功能" });
  await expect(moreSheet.getByRole("button", { name: /通知中心/ })).toContainText("5");
  await moreSheet.getByRole("button", { name: /通知中心/ }).click();
  return page.getByRole("dialog", { name: "通知与待办" });
}

test.use({ viewport: { width: 390, height: 844 } });

test("mobile notifications open as a readable task sheet with real routes", async ({ page }) => {
  await page.route(apiUrl("/admin/notifications"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(tasks) }));
  await loginAs(page, "/", "ADMIN");

  const center = await openMobileNotificationCenter(page);
  await expect(center).toBeVisible();
  await expect(center.getByRole("link", { name: /待出库审批/ })).toHaveAttribute("href", "/admin/outbound");
  await expect(center.getByRole("link", { name: /库存预警：Tea/ })).toHaveAttribute("href", "/admin/inventory?query=TEA-001");
  await expect(center.getByText("请在电脑端处理")).toHaveCount(3);

  const bounds = await center.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: innerWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Back closes the latest modal after the more sheet transitions to notifications", async ({ page }) => {
  await page.route(apiUrl("/admin/notifications"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(tasks) }));
  await loginAs(page, "/", "ADMIN");
  const dashboardUrl = page.url();

  const center = await openMobileNotificationCenter(page);
  await expect(center).toBeVisible();
  await page.goBack();

  await expect(center).toHaveCount(0);
  await expect(page).toHaveURL(dashboardUrl);
  await expect(page.getByRole("button", { name: "更多" })).toBeFocused();
});

test("an internal notification link consumes its sentinel before navigation", async ({ page }) => {
  await page.route(apiUrl("/admin/notifications"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(tasks) }));
  await page.route(apiUrl("/admin/outbound/pending"), (route) => route.fulfill({ json: [] }));
  await loginAs(page, "/admin/inventory", "ADMIN");
  await expect(page.getByRole("heading", { name: "库存查询" })).toBeVisible();
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();
  const dashboardUrl = page.url();
  const sourceHistoryLength = await page.evaluate(() => history.length);

  const center = await openMobileNotificationCenter(page);
  await center.getByRole("link", { name: /待出库审批/ }).click();
  await expect(page).toHaveURL(/\/admin\/outbound$/);
  await expect(page.getByRole("heading", { name: "办理出库" })).toBeVisible();
  await expect(page.getByText("当前没有待出库审批")).toBeVisible();
  await expect(page.getByRole("heading", { name: "选择待办" })).toHaveCount(0);
  expect(await page.evaluate(() => history.length)).toBe(sourceHistoryLength + 1);

  await page.goBack();
  await expect(page).toHaveURL(dashboardUrl);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/inventory$/);
});

test("an application-handled internal link cannot leave a modal sentinel behind", async ({ page }) => {
  await page.route(apiUrl("/admin/notifications"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(tasks) }));
  await loginAs(page, "/admin/inventory", "ADMIN");
  await page.getByRole("link", { name: "首页", exact: true }).click();
  const dashboardUrl = page.url();
  const sourceHistoryLength = await page.evaluate(() => history.length);
  const center = await openMobileNotificationCenter(page);

  await center.evaluate((dialog) => {
    const link = document.createElement("a");
    link.href = "/admin/outbound";
    link.textContent = "应用路由待办";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      history.pushState({ applicationRouter: true }, "", link.href);
      (window as typeof window & { __task7ApplicationLinkHandled?: boolean }).__task7ApplicationLinkHandled = true;
    });
    dialog.querySelector(".mobile-notification-center")!.append(link);
  });

  await center.getByRole("link", { name: "应用路由待办" }).click();
  expect(await page.evaluate(() => (
    window as typeof window & { __task7ApplicationLinkHandled?: boolean }
  ).__task7ApplicationLinkHandled)).toBe(true);
  await expect(page).toHaveURL(/\/admin\/outbound$/);
  expect(await page.evaluate(() => history.length)).toBe(sourceHistoryLength + 1);
  await expect(center).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(dashboardUrl);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/inventory$/);
});

test("modal link coordination leaves external and alternate navigation semantics intact", async ({ page }) => {
  await page.route(apiUrl("/admin/notifications"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(tasks) }));
  await loginAs(page, "/", "ADMIN");
  const center = await openMobileNotificationCenter(page);
  await expect(center).toBeVisible();

  const prevented = await center.evaluate((dialog) => {
    const cases = [
      { href: "https://example.com/external" },
      { href: "/admin/outbound", target: "_blank" },
      { href: "/admin/outbound", download: "tasks.csv" },
      { href: "/admin/outbound", ctrlKey: true },
    ];

    return cases.map(({ ctrlKey = false, ...attributes }) => {
      const link = document.createElement("a");
      Object.assign(link, attributes);
      dialog.append(link);
      let preventedBeforeDocumentGuard = false;
      const guardDefaultNavigation = (event: MouseEvent) => {
        preventedBeforeDocumentGuard = event.defaultPrevented;
        event.preventDefault();
      };
      document.addEventListener("click", guardDefaultNavigation, { once: true });
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey }));
      link.remove();
      return preventedBeforeDocumentGuard;
    });
  });

  expect(prevented).toEqual([false, false, false, false]);
  await expect(page).toHaveURL(/\/$/);
  await expect(center).toBeVisible();
});

test("business completion bypasses an older request and resolved tasks stay removed", async ({ page }) => {
  let requestCount = 0;
  let releaseOlderRequest!: () => void;
  const olderRequestReleased = new Promise<void>((resolve) => { releaseOlderRequest = resolve; });
  let olderRequestStarted!: () => void;
  const olderRequestHasStarted = new Promise<void>((resolve) => { olderRequestStarted = resolve; });
  let olderRequestFinished!: () => void;
  const olderRequestHasFinished = new Promise<void>((resolve) => { olderRequestFinished = resolve; });
  await page.route(apiUrl("/admin/notifications"), async (route) => {
    requestCount += 1;
    if (requestCount === 2) {
      olderRequestStarted();
      await olderRequestReleased;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(tasks) });
      olderRequestFinished();
      return;
    }
    await route.fulfill({ contentType: "application/json", body: requestCount === 1 ? JSON.stringify(tasks) : "[]" });
  });
  await loginAs(page, "/", "ADMIN");
  await expect(page.getByRole("button", { name: "更多" })).toBeVisible();
  await expect.poll(() => requestCount).toBeGreaterThanOrEqual(1);
  const center = await openMobileNotificationCenter(page);
  await olderRequestHasStarted;
  await page.evaluate(() => window.dispatchEvent(new Event("warehouse:business-completed")));
  await expect.poll(() => requestCount).toBeGreaterThanOrEqual(3);
  releaseOlderRequest();
  await olderRequestHasFinished;

  await expect(center.getByText("暂无待处理任务")).toBeVisible();
  await expect(center.getByText("待出库审批")).toHaveCount(0);
});

test("dashboard notification metrics follow the shared live task snapshot", async ({ page }) => {
  let requestCount = 0;
  await page.route(apiUrl("/admin/notifications"), async (route) => {
    requestCount += 1;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(requestCount === 1 ? tasks : []) });
  });
  await loginAs(page, "/", "ADMIN");
  const overview = page.getByRole("region", { name: "今日概览" });
  await expect(overview.getByText("通知").locator("..").getByText("5")).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("warehouse:business-completed")));
  await expect.poll(() => requestCount).toBeGreaterThanOrEqual(2);
  await expect(overview.getByText("通知").locator("..").getByText("0")).toBeVisible();
});

test("desktop keeps a popover and does not offer local mark-all-read state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route(apiUrl("/admin/notifications"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(tasks.slice(0, 1)) }));
  await loginAs(page, "/", "ADMIN");

  const trigger = page.getByRole("button", { name: /通知中心/ });
  await expect(trigger).toContainText("1");
  await trigger.click();
  await expect(page.getByRole("region", { name: "通知与待办" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "通知与待办" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "全部已读" })).toHaveCount(0);
});
