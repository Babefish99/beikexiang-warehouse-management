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

test("business completion bypasses an older request and resolved tasks stay removed", async ({ page }) => {
  let requestCount = 0;
  let releaseOlderRequest!: () => void;
  const olderRequestReleased = new Promise<void>((resolve) => { releaseOlderRequest = resolve; });
  let olderRequestStarted!: () => void;
  const olderRequestHasStarted = new Promise<void>((resolve) => { olderRequestStarted = resolve; });
  await page.route(apiUrl("/admin/notifications"), async (route) => {
    requestCount += 1;
    if (requestCount === 2) {
      olderRequestStarted();
      await olderRequestReleased;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(tasks) });
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
