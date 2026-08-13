import { expect, test, type Page } from "@playwright/test";
import { apiUrl, loginAs } from "./mobile-test-helpers";

const warehouses = [{ id: "warehouse-1", code: "WH-01", name: "总部仓" }];
const items = [{ id: "item-1", code: "ITEM-01", name: "打印纸" }];

async function mockInboundOptions(page: Page): Promise<void> {
  await page.route(apiUrl("/admin/warehouses"), (route) => route.fulfill({ json: warehouses }));
  await page.route(apiUrl("/admin/items"), (route) => route.fulfill({ json: items }));
}

async function openInbound(page: Page): Promise<void> {
  await mockInboundOptions(page);
  await loginAs(page, "/admin/inbound", "ADMIN");
  await expect(page.getByRole("heading", { name: "登记入库" })).toBeVisible();
}

async function fillInbound(page: Page): Promise<void> {
  await page.getByLabel("仓库 *").selectOption("warehouse-1");
  await page.getByLabel("物品 *").selectOption("item-1");
  await page.getByLabel("批次号 *").fill("B-001");
  await page.getByLabel("采购日期 *").fill("2026-08-13");
  await page.getByLabel("采购人").fill("仓库管理员");
  await page.getByLabel("入库数量 *").fill("0.1");
  await page.getByLabel("采购单价 *").fill("0.2");
}

test.use({ viewport: { width: 390, height: 844 } });

test("inbound and opening-stock APIs remain administrator-only on the isolated stack", async ({ request }) => {
  const [inbound, opening] = await Promise.all([
    request.post(apiUrl("/admin/inbound"), { data: {} }),
    request.post(apiUrl("/admin/opening-stock"), { data: {} }),
  ]);

  expect(inbound.status()).toBe(401);
  expect(opening.status()).toBe(401);
});

test("mobile inbound is grouped, confirms an exact amount, and restores a failed draft", async ({ page }) => {
  await page.route(apiUrl("/admin/inbound"), (route) => route.fulfill({
    status: 500,
    json: { error: "暂时无法入库" },
  }));
  await openInbound(page);

  await expect(page.getByRole("group", { name: "仓库与物品" })).toBeVisible();
  await expect(page.getByRole("group", { name: "批次与采购信息" })).toBeVisible();
  await expect(page.getByRole("group", { name: "数量与预计金额" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await fillInbound(page);
  await page.getByLabel("入库数量 *").fill("01.2300");
  await page.getByLabel("采购单价 *").fill("0000.2000");
  await expect(page.getByText("预计金额 ¥0.25")).toBeVisible();
  await page.getByRole("button", { name: "保存入库" }).click();

  const dialog = page.getByRole("dialog", { name: "确认入库" });
  await expect(dialog).toContainText("总部仓");
  await expect(dialog).toContainText("打印纸");
  await expect(dialog).toContainText("B-001");
  await expect(dialog).toContainText("¥0.25");
  const failedRequest = page.waitForRequest(apiUrl("/admin/inbound"));
  await dialog.getByRole("button", { name: "确认入库", exact: true }).click();
  const payload = (await failedRequest).postDataJSON();
  expect(payload).toEqual({
    warehouseId: "warehouse-1",
    itemId: "item-1",
    batchNo: "B-001",
    quantity: "1.23",
    unitCost: "0.2",
    purchasedAt: "2026-08-13",
    purchaser: "仓库管理员",
    remark: "",
  });
  await expect(dialog.getByRole("alert")).toHaveText("暂时无法入库");
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toBeAttached();
  expect(await page.getByRole("alert").evaluate((alert) => alert.closest('[role="dialog"]') !== null)).toBe(true);
  await expect(dialog.getByRole("button", { name: "确认入库", exact: true })).toBeEnabled();

  await page.reload();
  await expect(page.getByLabel("批次号 *")).toHaveValue("B-001");
  await expect(page.getByLabel("入库数量 *")).toHaveValue("01.2300");
  await expect(page.getByText("预计金额 ¥0.25")).toBeVisible();

  await page.getByRole("button", { name: "放弃草稿" }).click();
  await expect(page.getByLabel("批次号 *")).toHaveValue("");
  expect(await page.evaluate(() => sessionStorage.getItem("warehouse.inbound.v1.local-admin"))).toBeNull();
});

test("invalid runtime draft values are ignored and leave the page usable", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("warehouse.inbound.v1.local-admin", JSON.stringify({
      version: 1,
      userId: "local-admin",
      value: { quantity: 2 },
    }));
  });
  await openInbound(page);

  await expect(page.getByLabel("批次号 *")).toHaveValue("");
  await expect(page.getByLabel("入库数量 *")).toHaveValue("");
  await expect(page.getByRole("button", { name: "保存入库" })).toBeEnabled();
});

test("successful inbound disables duplicate confirmation and enters a reset completion state", async ({ page }) => {
  let releaseSubmit!: () => void;
  const submitGate = new Promise<void>((resolve) => { releaseSubmit = resolve; });
  let submitCount = 0;
  await page.route(apiUrl("/admin/inbound"), async (route) => {
    submitCount += 1;
    await submitGate;
    await route.fulfill({ status: 201, json: { inboundId: "inbound-1", batchIds: ["batch-1"] } });
  });
  await openInbound(page);
  await fillInbound(page);

  await page.getByRole("button", { name: "保存入库" }).click();
  const dialog = page.getByRole("dialog", { name: "确认入库" });
  const confirm = dialog.getByRole("button", { name: "确认入库", exact: true });
  await confirm.click();
  await expect(dialog.getByRole("button", { name: "提交中…", exact: true })).toBeDisabled();
  releaseSubmit();

  await expect(page.getByText("入库已登记：inbound-1，批次 batch-1")).toBeVisible();
  expect(submitCount).toBe(1);
  await expect(page.getByLabel("仓库 *")).toHaveValue("warehouse-1");
  await expect(page.getByLabel("采购日期 *")).toHaveValue("2026-08-13");
  await expect(page.getByLabel("采购人")).toHaveValue("仓库管理员");
  await expect(page.getByLabel("物品 *")).toHaveValue("");
  await expect(page.getByLabel("批次号 *")).toHaveValue("");
  await expect(page.getByLabel("入库数量 *")).toHaveValue("");
  expect(await page.evaluate(() => sessionStorage.getItem("warehouse.inbound.v1.local-admin"))).toBeNull();
});

for (const width of [320, 390, 430, 820]) {
  test(`inbound single-page form fits the ${width}px mobile viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openInbound(page);
    await expect(page.getByRole("group", { name: "仓库与物品" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const buttonHeight = await page.getByRole("button", { name: "保存入库" }).evaluate((button) => button.getBoundingClientRect().height);
    expect(buttonHeight).toBeGreaterThanOrEqual(44);
  });
}

test("desktop inbound retains the two-column form and full confirmation semantics", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openInbound(page);
  const form = page.locator(".inbound-form");
  expect(await form.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(2);

  await fillInbound(page);
  await page.getByRole("button", { name: "保存入库" }).click();
  const dialog = page.getByRole("dialog", { name: "确认入库" });
  await expect(dialog).toContainText("总部仓");
  await expect(dialog).toContainText("打印纸");
  await expect(dialog).toContainText("B-001");
  await expect(dialog).toContainText("¥0.02");
});
