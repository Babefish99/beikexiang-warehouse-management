import { expect, test, type Page } from "@playwright/test";
import { apiUrl, loginAs } from "./mobile-test-helpers";

const mobileViewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 820, height: 900 },
] as const;

const longWarehouse = "华东集团企业微信移动办公超长仓库名称一号仓库";
const longItem = "用于企业微信窄屏回归的超长中文物品名称与规格组合";
const longBatch = "BATCH-2026-08-13-ENTERPRISE-WECOM-LONG-VALUE-0001";

async function mockInboundOptions(page: Page): Promise<void> {
  await page.route(apiUrl("/admin/warehouses"), (route) => route.fulfill({
    json: [{ id: "warehouse-long", code: "WH-LONG-001", name: longWarehouse }],
  }));
  await page.route(apiUrl("/admin/items"), (route) => route.fulfill({
    json: [{ id: "item-long", code: "ITEM-LONG-001", name: longItem }],
  }));
}

async function openInbound(page: Page): Promise<void> {
  await mockInboundOptions(page);
  await loginAs(page, "/admin/inbound", "ADMIN");
  await expect(page.getByRole("heading", { name: "登记入库" })).toBeVisible();
}

for (const viewport of mobileViewports) {
  test(`${viewport.width}x${viewport.height} has one mobile tree, usable bottom navigation, and no page overflow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await loginAs(page, "/", "ADMIN");

    const nav = page.getByRole("navigation", { name: "手机任务导航" });
    await expect(nav).toHaveCount(1);
    await expect(page.locator(".sidebar")).toBeHidden();

    const layout = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>(".mobile-bottom-nav")!;
      const content = document.querySelector<HTMLElement>(".main-content")!;
      const navRect = nav.getBoundingClientRect();
      const controls = Array.from(nav.querySelectorAll<HTMLElement>("a, button"));
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        frameHeight: document.querySelector<HTMLElement>(".mobile-app-frame")!.getBoundingClientRect().height,
        navBottom: navRect.bottom,
        navHeight: navRect.height,
        contentBottomPadding: Number.parseFloat(getComputedStyle(content).paddingBottom),
        targets: controls.map((control) => {
          const bounds = control.getBoundingClientRect();
          const icon = control.querySelector("svg")?.getBoundingClientRect();
          const label = control.querySelector("span");
          return {
            width: bounds.width,
            height: bounds.height,
            icon: icon?.width,
            label: label ? getComputedStyle(label).fontSize : null,
          };
        }),
      };
    });

    expect(layout.overflow).toBe(false);
    expect(layout.frameHeight).toBeGreaterThanOrEqual(viewport.height);
    expect(layout.navBottom).toBeCloseTo(viewport.height, 0);
    expect(layout.contentBottomPadding).toBeGreaterThanOrEqual(layout.navHeight);
    expect(layout.targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
    expect(layout.targets.every(({ icon, label }) => icon === 18 && label === "12px")).toBe(true);
  });
}

test("821px mounts only desktop navigation", async ({ page }) => {
  await page.setViewportSize({ width: 821, height: 900 });
  await loginAs(page, "/", "ADMIN");
  await expect(page.getByRole("navigation", { name: "手机任务导航" })).toHaveCount(0);
  await expect(page.locator(".sidebar")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("inbound draft and long values survive the 820 to 821 presentation boundary", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await openInbound(page);
  await page.getByLabel("仓库 *").selectOption("warehouse-long");
  await page.getByLabel("物品 *").selectOption("item-long");
  await page.getByLabel("批次号 *").fill(longBatch);
  const longPurchaser = "企业微信移动端超长中文采购负责人姓名";
  await page.getByLabel("采购人").fill(longPurchaser);
  await page.evaluate(() => sessionStorage.removeItem("warehouse.inbound.v1.local-admin"));

  await page.setViewportSize({ width: 821, height: 900 });

  await expect(page.getByRole("navigation", { name: "手机任务导航" })).toHaveCount(0);
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.getByLabel("仓库 *")).toHaveValue("warehouse-long");
  await expect(page.getByLabel("物品 *")).toHaveValue("item-long");
  await expect(page.getByLabel("批次号 *")).toHaveValue(longBatch);
  await expect(page.getByLabel("采购人")).toHaveValue(longPurchaser);
  expect(await page.evaluate(() => sessionStorage.getItem("warehouse.inbound.v1.local-admin"))).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("inventory table becomes readable cards for long warehouse and batch values", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route(/\/admin\/reports\/inventory-search.*/, (route) => route.fulfill({
    json: [{
      itemId: "item-long",
      code: "ITEM-LONG-001",
      name: longItem,
      specification: "超长规格型号-用于验证中文与连续字符都可以自然换行",
      unit: "件",
      totalQuantity: "12",
      totalAmount: "240.00",
      locations: [{
        warehouseId: "warehouse-long",
        warehouseName: longWarehouse,
        batchId: "batch-long",
        batchNo: longBatch,
        quantity: "12",
        unitCost: "20",
        amount: "240.00",
      }],
    }],
  }));
  await loginAs(page, "/admin/inventory?query=ITEM-LONG-001", "ADMIN");

  await expect(page.locator(".inventory-query-cards")).toBeVisible();
  await expect(page.locator(".inventory-query-table-wrap")).toHaveCount(0);
  const card = page.getByRole("article", { name: /ITEM-LONG-001/ });
  await expect(card).toContainText(longWarehouse);
  await expect(card).toContainText("超长规格型号-用于验证中文与连续字符都可以自然换行");
  await expect(card).toContainText(longBatch);
  const longValueBounds = await card.locator(".inventory-query-location").evaluate((location) => ({
    right: location.getBoundingClientRect().right,
    scrollWidth: location.scrollWidth,
    clientWidth: location.clientWidth,
    viewport: innerWidth,
  }));
  expect(longValueBounds.right).toBeLessThanOrEqual(longValueBounds.viewport);
  expect(longValueBounds.scrollWidth).toBeLessThanOrEqual(longValueBounds.clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("dismiss and confirm modals trap focus, lock scroll, close with Escape, and restore focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openInbound(page);

  const more = page.getByRole("button", { name: "更多" });
  await more.click();
  const dismissDialog = page.getByRole("dialog", { name: "更多功能" });
  const dismissClose = dismissDialog.getByRole("button", { name: "关闭更多功能" });
  const notification = dismissDialog.getByRole("button", { name: /通知中心/ });
  await expect(dismissClose).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await dismissClose.press("Shift+Tab");
  await expect(notification).toBeFocused();
  await notification.press("Tab");
  await expect(dismissClose).toBeFocused();
  await dismissDialog.press("Escape");
  await expect(dismissDialog).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");

  await page.getByLabel("仓库 *").selectOption("warehouse-long");
  await page.getByLabel("物品 *").selectOption("item-long");
  await page.getByLabel("批次号 *").fill(longBatch);
  await page.getByLabel("采购日期 *").fill("2026-08-13");
  await page.getByLabel("入库数量 *").fill("1");
  await page.getByLabel("采购单价 *").fill("2");
  const save = page.getByRole("button", { name: "保存入库" });
  await save.click();

  const confirmDialog = page.getByRole("dialog", { name: "确认入库" });
  await expect(confirmDialog.getByRole("button", { name: "取消" })).toBeVisible();
  const confirmClose = confirmDialog.getByRole("button", { name: "关闭确认入库" });
  const confirmAction = confirmDialog.getByRole("button", { name: "确认入库", exact: true });
  await expect(confirmAction).toBeVisible();
  await expect(confirmClose).toBeFocused();
  await confirmClose.press("Shift+Tab");
  await expect(confirmAction).toBeFocused();
  await confirmAction.press("Tab");
  await expect(confirmClose).toBeFocused();
  await confirmDialog.press("Escape");
  await expect(confirmDialog).toHaveCount(0);
  await expect(save).toBeFocused();
});

test("browser Back closes dismiss and confirm modals before leaving the current page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openInbound(page);
  const inboundUrl = page.url();

  const more = page.getByRole("button", { name: "更多" });
  await more.click();
  const dismissDialog = page.getByRole("dialog", { name: "更多功能" });
  await expect(dismissDialog).toBeVisible();
  await page.goBack();
  await expect(dismissDialog).toHaveCount(0);
  await expect(page).toHaveURL(inboundUrl);
  await expect(more).toBeFocused();

  await page.getByLabel("仓库 *").selectOption("warehouse-long");
  await page.getByLabel("物品 *").selectOption("item-long");
  await page.getByLabel("批次号 *").fill(longBatch);
  await page.getByLabel("采购日期 *").fill("2026-08-13");
  await page.getByLabel("入库数量 *").fill("1");
  await page.getByLabel("采购单价 *").fill("2");
  const save = page.getByRole("button", { name: "保存入库" });
  await save.click();
  const confirmDialog = page.getByRole("dialog", { name: "确认入库" });
  await expect(confirmDialog).toBeVisible();
  await page.goBack();
  await expect(confirmDialog).toHaveCount(0);
  await expect(page).toHaveURL(inboundUrl);
  await expect(save).toBeFocused();
});

test("programmatic modal close consumes its history entry without adding a phantom Back step", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "/", "ADMIN");
  await page.getByRole("link", { name: "查询" }).click();
  await expect(page).toHaveURL(/\/admin\/inventory$/);

  const more = page.getByRole("button", { name: "更多" });
  await more.click();
  const dialog = page.getByRole("dialog", { name: "更多功能" });
  await dialog.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test("a busy confirm modal rearms Back protection when its close callback refuses dismissal", async ({ page }) => {
  let releaseSubmit!: () => void;
  const submitReleased = new Promise<void>((resolve) => { releaseSubmit = resolve; });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInboundOptions(page);
  await page.route(apiUrl("/admin/inbound"), async (route) => {
    await submitReleased;
    await route.fulfill({ status: 500, json: { error: "暂时无法入库" } });
  });
  await loginAs(page, "/", "ADMIN");
  await page.getByRole("link", { name: "入库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登记入库" })).toBeVisible();
  const inboundUrl = page.url();
  await page.getByLabel("仓库 *").selectOption("warehouse-long");
  await page.getByLabel("物品 *").selectOption("item-long");
  await page.getByLabel("批次号 *").fill(longBatch);
  await page.getByLabel("采购日期 *").fill("2026-08-13");
  await page.getByLabel("入库数量 *").fill("1");
  await page.getByLabel("采购单价 *").fill("2");
  await page.getByRole("button", { name: "保存入库" }).click();
  const dialog = page.getByRole("dialog", { name: "确认入库" });
  await dialog.getByRole("button", { name: "确认入库", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "提交中…" })).toBeDisabled();

  await page.goBack();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(inboundUrl);
  await page.goBack();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(inboundUrl);

  releaseSubmit();
  await expect(dialog.getByRole("alert")).toHaveText("暂时无法入库");
});

test("overlapping real modals close top to bottom before browser Back leaves the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInboundOptions(page);
  await loginAs(page, "/", "ADMIN");
  const dashboardUrl = page.url();
  await page.getByRole("link", { name: "入库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登记入库" })).toBeVisible();
  const inboundUrl = page.url();
  await page.getByLabel("仓库 *").selectOption("warehouse-long");
  await page.getByLabel("物品 *").selectOption("item-long");
  await page.getByLabel("批次号 *").fill(longBatch);
  await page.getByLabel("采购日期 *").fill("2026-08-13");
  await page.getByLabel("入库数量 *").fill("1");
  await page.getByLabel("采购单价 *").fill("2");
  const save = page.getByRole("button", { name: "保存入库" });
  await save.click();
  const confirmDialog = page.getByRole("dialog", { name: "确认入库" });
  await expect(confirmDialog).toBeVisible();

  await page.getByRole("button", { name: "更多" }).evaluate((button: HTMLButtonElement) => button.click());
  const moreDialog = page.getByRole("dialog", { name: "更多功能" });
  await expect(moreDialog).toBeVisible();
  await expect(confirmDialog).toBeVisible();

  await page.goBack();
  await expect(moreDialog).toHaveCount(0);
  await expect(confirmDialog).toBeVisible();
  await expect(page).toHaveURL(inboundUrl);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  expect(await confirmDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);

  await page.goBack();
  await expect(confirmDialog).toHaveCount(0);
  await expect(page).toHaveURL(inboundUrl);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
  await expect(save).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL(dashboardUrl);
});

test("programmatic underlying close preserves top modal scroll and focus ownership", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInboundOptions(page);
  await loginAs(page, "/admin/inbound", "ADMIN");
  await page.getByLabel("仓库 *").selectOption("warehouse-long");
  await page.getByLabel("物品 *").selectOption("item-long");
  await page.getByLabel("批次号 *").fill(longBatch);
  await page.getByLabel("采购日期 *").fill("2026-08-13");
  await page.getByLabel("入库数量 *").fill("1");
  await page.getByLabel("采购单价 *").fill("2");
  const save = page.getByRole("button", { name: "保存入库" });
  await save.click();
  const confirmDialog = page.getByRole("dialog", { name: "确认入库" });
  await expect(confirmDialog).toBeVisible();

  await page.getByRole("button", { name: "更多" }).evaluate((button: HTMLButtonElement) => button.click());
  const moreDialog = page.getByRole("dialog", { name: "更多功能" });
  await expect(moreDialog).toBeVisible();
  expect(await moreDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);

  await confirmDialog.evaluate((dialog) => {
    dialog.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
  });
  await expect(confirmDialog).toHaveCount(0);
  await expect(moreDialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  expect(await moreDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);

  await moreDialog.press("Escape");
  await expect(moreDialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
  await expect(save).toBeFocused();
});

test("aria-invalid attribute changes focus errors and restore temporary tabindex state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openInbound(page);
  await page.getByRole("button", { name: "更多" }).click();
  const dialog = page.getByRole("dialog", { name: "更多功能" });
  const values = dialog.locator(".mobile-more-sheet__account dd");
  const first = values.nth(0);
  const second = values.nth(1);

  await first.evaluate((node) => node.setAttribute("aria-invalid", "true"));
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("tabindex", "-1");
  await first.press("Tab");
  await expect(dialog.getByRole("button", { name: "关闭更多功能" })).toBeFocused();

  await second.evaluate((node) => node.setAttribute("aria-invalid", "true"));
  await expect(second).toBeFocused();
  await expect(first).not.toHaveAttribute("tabindex", /.+/);
  await first.evaluate((node) => node.setAttribute("aria-invalid", "false"));
  await second.evaluate((node) => node.setAttribute("aria-invalid", "false"));
  await expect(second).not.toHaveAttribute("tabindex", /.+/);

  await first.evaluate((node) => {
    (window as typeof window & { __task7ErrorTarget?: HTMLElement }).__task7ErrorTarget = node as HTMLElement;
    node.setAttribute("aria-invalid", "true");
  });
  await expect(first).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (
    window as typeof window & { __task7ErrorTarget?: HTMLElement }
  ).__task7ErrorTarget?.hasAttribute("tabindex"))).toBe(false);
});

test("reduced viewport height lets the focused inbound action scroll above fixed navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openInbound(page);
  const unitCost = page.getByLabel("采购单价 *");
  await unitCost.focus();
  await page.setViewportSize({ width: 390, height: 360 });
  await unitCost.evaluate((node) => node.scrollIntoView({ block: "nearest" }));

  const focusedLayout = await page.evaluate(() => {
    const focused = document.activeElement as HTMLElement;
    const nav = document.querySelector<HTMLElement>(".mobile-bottom-nav")!;
    return { focusedBottom: focused.getBoundingClientRect().bottom, navTop: nav.getBoundingClientRect().top };
  });
  expect(focusedLayout.focusedBottom).toBeLessThanOrEqual(focusedLayout.navTop);

  const save = page.getByRole("button", { name: "保存入库" });
  await save.evaluate((button) => button.scrollIntoView({ block: "nearest" }));
  const actionLayout = await save.evaluate((button) => ({
    bottom: button.getBoundingClientRect().bottom,
    navTop: document.querySelector<HTMLElement>(".mobile-bottom-nav")!.getBoundingClientRect().top,
  }));
  expect(actionLayout.bottom).toBeLessThanOrEqual(actionLayout.navTop);
});

test("a failed modal confirmation scrolls to and focuses the first error", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await page.route(apiUrl("/admin/inbound"), (route) => route.fulfill({ status: 500, json: { error: "暂时无法入库" } }));
  await openInbound(page);
  await page.getByLabel("仓库 *").selectOption("warehouse-long");
  await page.getByLabel("物品 *").selectOption("item-long");
  await page.getByLabel("批次号 *").fill(longBatch);
  await page.getByLabel("采购日期 *").fill("2026-08-13");
  await page.getByLabel("入库数量 *").fill("1");
  await page.getByLabel("采购单价 *").fill("2");
  await page.getByRole("button", { name: "保存入库" }).click();
  const dialog = page.getByRole("dialog", { name: "确认入库" });
  await dialog.getByRole("button", { name: "确认入库", exact: true }).click();

  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveText("暂时无法入库");
  await expect(alert).toBeFocused();
  await expect(alert).toBeInViewport();
});

test("browser Back returns to the previous page when no modal is open", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "/", "ADMIN");
  await page.getByRole("link", { name: "查询" }).click();
  await expect(page).toHaveURL(/\/admin\/inventory$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test.describe("enterprise WeChat web viewport", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile MicroMessenger/8.0.50 wxwork/4.1.30",
  });

  test("uses the same single mobile tree without zoom-prone inputs or viewport overflow", async ({ page }) => {
    await openInbound(page);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
    const behavior = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      innerWidth,
      visualWidth: window.visualViewport?.width,
      inputFonts: Array.from(document.querySelectorAll("input, select, textarea"), (control) => getComputedStyle(control).fontSize),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    expect(behavior.userAgent).toContain("MicroMessenger");
    expect(behavior.userAgent).toContain("wxwork");
    expect(behavior.innerWidth).toBe(390);
    expect(behavior.visualWidth).toBe(390);
    expect(behavior.inputFonts.every((fontSize) => Number.parseFloat(fontSize) >= 16)).toBe(true);
    expect(behavior.overflow).toBe(false);
    await expect(page.getByRole("navigation", { name: "手机任务导航" })).toHaveCount(1);
  });
});
