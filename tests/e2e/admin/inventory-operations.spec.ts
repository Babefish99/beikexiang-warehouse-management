import { test, expect } from "@playwright/test";
import { apiUrl } from "../mobile/mobile-test-helpers";

test("transfer, return, and stocktake APIs remain administrator-only", async ({ request }) => {
  const [transferOptions, transferCreate, returnOptions, returnCreate, stocktakeOptions, stocktakeCreate] = await Promise.all([
    request.get(apiUrl("/admin/transfers/options")),
    request.post(apiUrl("/admin/transfers"), { data: {} }),
    request.get(apiUrl("/admin/returns/options")),
    request.post(apiUrl("/admin/returns"), { data: {} }),
    request.get(apiUrl("/admin/stocktake/options")),
    request.post(apiUrl("/admin/stocktake"), { data: {} }),
  ]);

  expect(transferOptions.status()).toBe(401);
  expect(transferCreate.status()).toBe(401);
  expect(returnOptions.status()).toBe(401);
  expect(returnCreate.status()).toBe(401);
  expect(stocktakeOptions.status()).toBe(401);
  expect(stocktakeCreate.status()).toBe(401);
});

test("transfer form shows server errors and preserves input", async ({ page }) => {
  await page.route(apiUrl("/admin/transfers/options"), async (route) => {
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
  await page.route(apiUrl("/admin/transfers"), async (route) => {
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "batch balance cannot become negative" }) });
  });

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Ftransfers"));
  const form = page.locator("form");
  await form.locator("select").nth(0).selectOption("item-1");
  await form.locator("select").nth(1).selectOption("wh-1");
  await form.locator("select").nth(2).selectOption("batch-1");
  await form.locator("select").nth(3).selectOption("wh-2");
  await form.locator('input[type="number"]').fill("11");
  await form.locator("textarea").fill("over-limit test");
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('.form-error[role="alert"]')).toHaveText("batch balance cannot become negative");
  await expect(form.locator('input[type="number"]')).toHaveValue("11");
  await expect(form.locator("textarea")).toHaveValue("over-limit test");
});

test("transfer form renders the completed status in Chinese", async ({ page }) => {
  await page.route(apiUrl("/admin/transfers/options"), async (route) => {
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
  await page.route(apiUrl("/admin/transfers"), async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ transferId: "transfer-1", status: "COMPLETED", unitCost: "20" }) });
  });

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Ftransfers"));
  const form = page.locator("form");
  await form.locator("select").nth(0).selectOption("item-1");
  await form.locator("select").nth(1).selectOption("wh-1");
  await form.locator("select").nth(2).selectOption("batch-1");
  await form.locator("select").nth(3).selectOption("wh-2");
  await form.locator('input[type="number"]').fill("2");
  await form.locator("textarea").fill("仓库补货");
  await form.locator('button[type="submit"]').click();

  const result = page.locator('.success-notice[role="status"]');
  await expect(result).toContainText("状态 已完成");
  await expect(result).not.toContainText("COMPLETED");
});

test("return form submits selected allocation and shows the server result", async ({ page }) => {
  await page.route(apiUrl("/admin/returns/options"), async (route) => {
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
  await page.route(apiUrl("/admin/returns"), async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ returnId: "return-1", status: "COMPLETED", unitCost: "20" }) });
  });

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Freturns"));
  const form = page.locator("form");
  await form.locator("select").selectOption("allocation-1");
  await form.locator('input[type="number"]').fill("2");
  await form.locator("textarea").fill("unused return");
  await form.locator('button[type="submit"]').click();

  const result = page.locator('.success-notice[role="status"]');
  await expect(result).toContainText("return-1");
  await expect(result).toContainText("状态 已完成");
  await expect(result).not.toContainText("COMPLETED");
});

test("return form shows server errors and preserves input", async ({ page }) => {
  await page.route(apiUrl("/admin/returns/options"), async (route) => {
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
  await page.route(apiUrl("/admin/returns"), async (route) => {
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "return stock balance item mismatch" }) });
  });

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Freturns"));
  const form = page.locator("form");
  await form.locator("select").selectOption("allocation-1");
  await form.locator('input[type="number"]').fill("2");
  await form.locator("textarea").fill("server rejection");
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('.form-error[role="alert"]')).toHaveText("return stock balance item mismatch");
  await expect(form.locator("select")).toHaveValue("allocation-1");
  await expect(form.locator('input[type="number"]')).toHaveValue("2");
  await expect(form.locator("textarea")).toHaveValue("server rejection");
});

test("stocktake form allows zero difference without a reason", async ({ page }) => {
  await page.route(apiUrl("/admin/stocktake/options"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ balances: [{ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", unitCost: "20" }] }),
    });
  });
  await page.route(apiUrl("/admin/stocktake"), async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}") as { actualQuantity?: string; reason?: string };
    expect(payload.actualQuantity).toBe("10");
    expect(payload.reason).toBe("");
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ stocktakeId: "stocktake-zero", difference: "0" }) });
  });

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fstocktake"));
  const form = page.locator("form");
  await form.locator("select").nth(0).selectOption("wh-1");
  await form.locator("select").nth(1).selectOption("item-1");
  await form.locator("select").nth(2).selectOption("batch-1");
  await form.locator('input[type="number"]').fill("10");
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('.success-notice[role="status"]')).toContainText("stocktake-zero");
});

test("stocktake form shows server errors and preserves input", async ({ page }) => {
  await page.route(apiUrl("/admin/stocktake/options"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ balances: [{ warehouseId: "wh-1", itemId: "item-1", batchId: "batch-1", bookQuantity: "10", unitCost: "20" }] }),
    });
  });
  await page.route(apiUrl("/admin/stocktake"), async (route) => {
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "closed period: 2026-08" }) });
  });

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fstocktake"));
  const form = page.locator("form");
  await form.locator('input[type="month"]').fill("2026-08");
  await form.locator("select").nth(0).selectOption("wh-1");
  await form.locator("select").nth(1).selectOption("item-1");
  await form.locator("select").nth(2).selectOption("batch-1");
  await form.locator('input[type="number"]').fill("9");
  await form.locator("textarea").fill("closed period attempt");
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('.form-error[role="alert"]')).toHaveText("closed period: 2026-08");
  await expect(form.locator('input[type="month"]')).toHaveValue("2026-08");
  await expect(form.locator("select").nth(0)).toHaveValue("wh-1");
  await expect(form.locator("select").nth(1)).toHaveValue("item-1");
  await expect(form.locator("select").nth(2)).toHaveValue("batch-1");
  await expect(form.locator('input[type="number"]')).toHaveValue("9");
  await expect(form.locator("textarea")).toHaveValue("closed period attempt");
});

test("stocktake form submits the selected balance and shows the difference", async ({ page }) => {
  await page.route(apiUrl("/admin/stocktake/options"), async (route) => {
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
  await page.route(apiUrl("/admin/stocktake"), async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ stocktakeId: "stocktake-1", difference: "-2" }) });
  });

  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fstocktake"));
  const form = page.locator("form");
  await form.locator("select").nth(0).selectOption("wh-1");
  await form.locator("select").nth(1).selectOption("item-1");
  await form.locator("select").nth(2).selectOption("batch-1");
  await expect(form.locator('input[readonly]')).toHaveValue("10");
  await form.locator('input[type="number"]').fill("8");
  await form.locator("textarea").fill("damaged stock");
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('.success-notice[role="status"]')).toContainText("stocktake-1");
});
