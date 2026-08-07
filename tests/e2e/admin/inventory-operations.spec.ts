import { test, expect } from "@playwright/test";

test("transfer, return, and stocktake APIs remain administrator-only", async ({ request }) => {
  const [transferOptions, transferCreate, returnOptions, returnCreate, stocktakeOptions, stocktakeCreate] = await Promise.all([
    request.get("http://127.0.0.1:3001/admin/transfers/options"),
    request.post("http://127.0.0.1:3001/admin/transfers", { data: {} }),
    request.get("http://127.0.0.1:3001/admin/returns/options"),
    request.post("http://127.0.0.1:3001/admin/returns", { data: {} }),
    request.get("http://127.0.0.1:3001/admin/stocktake/options"),
    request.post("http://127.0.0.1:3001/admin/stocktake", { data: {} }),
  ]);

  expect(transferOptions.status()).toBe(401);
  expect(transferCreate.status()).toBe(401);
  expect(returnOptions.status()).toBe(401);
  expect(returnCreate.status()).toBe(401);
  expect(stocktakeOptions.status()).toBe(401);
  expect(stocktakeCreate.status()).toBe(401);
});

test("transfer form shows server errors and preserves input", async ({ page }) => {
  await page.route("http://127.0.0.1:3001/admin/transfers/options", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        balances: [
          { warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", remainingQuantity: "10", unitCost: "20" },
          { warehouseId: "wh-2", itemId: "item-9", batchId: "batch-9", remainingQuantity: "4", unitCost: "18" },
        ],
      }),
    });
  });
  await page.route("http://127.0.0.1:3001/admin/transfers", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "batch balance cannot become negative" }) });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Ftransfers");
  await expect(page.getByRole("heading", { name: "仓库调拨" })).toBeVisible();

  await page.getByLabel("物品 *").selectOption("item-1");
  await page.getByLabel("调出仓库 *").selectOption("wh-1");
  await page.getByLabel("批次 *").selectOption("batch-1");
  await page.getByLabel("调入仓库 *").selectOption("wh-2");
  await page.getByLabel("调拨数量 *").fill("11");
  await page.getByLabel("调拨原因 *").fill("超额测试");
  await page.getByRole("button", { name: "提交调拨" }).click();

  await expect(page.getByText("batch balance cannot become negative")).toBeVisible();
  await expect(page.getByLabel("调拨数量 *")).toHaveValue("11");
  await expect(page.getByLabel("调拨原因 *")).toHaveValue("超额测试");
});

test("return form submits selected allocation and shows the server result", async ({ page }) => {
  await page.route("http://127.0.0.1:3001/admin/returns/options", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        allocations: [
          { id: "allocation-1", outboundOrderId: "out-1", warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", issuedQuantity: "4", remainingReturnableQuantity: "2", unitCost: "20" },
        ],
      }),
    });
  });
  await page.route("http://127.0.0.1:3001/admin/returns", async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ returnId: "return-1", status: "COMPLETED", unitCost: "20" }) });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Freturns");
  await expect(page.getByRole("heading", { name: "办理退库" })).toBeVisible();

  await page.getByLabel("原出库分配 *").selectOption("allocation-1");
  await page.getByLabel("退回数量 *").fill("2");
  await page.getByLabel("退库原因 *").fill("未使用退回");
  await page.getByRole("button", { name: "提交退库" }).click();

  await expect(page.getByText("退库已完成：return-1")).toBeVisible();
});

test("stocktake form submits the selected balance and shows the difference", async ({ page }) => {
  await page.route("http://127.0.0.1:3001/admin/stocktake/options", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        balances: [
          { warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", unitCost: "20" },
        ],
      }),
    });
  });
  await page.route("http://127.0.0.1:3001/admin/stocktake", async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ stocktakeId: "stocktake-1", difference: "-2" }) });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Fstocktake");
  await expect(page.getByRole("heading", { name: "月度盘点" })).toBeVisible();

  await page.getByLabel("仓库 *").selectOption("wh-1");
  await page.getByLabel("物品 *").selectOption("item-1");
  await page.getByLabel("批次 *").selectOption("batch-1");
  await expect(page.getByLabel("账面数量 *")).toHaveValue("10");
  await page.getByLabel("实盘数量 *").fill("8");
  await page.getByLabel("差异原因 *").fill("盘亏破损");
  await page.getByRole("button", { name: "提交盘点" }).click();

  await expect(page.getByText("盘点调整已记录：stocktake-1")).toBeVisible();
});
