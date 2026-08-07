import { test, expect } from "@playwright/test";

test("outbound execution APIs remain administrator-only", async ({ request }) => {
  const [pending, confirm] = await Promise.all([
    request.get("http://localhost:3001/admin/outbound/pending"),
    request.post("http://localhost:3001/admin/outbound/confirm", { data: {} }),
  ]);

  expect(pending.status()).toBe(401);
  expect(confirm.status()).toBe(401);
});

test("outbound page allocates a batch and submits the actual issue", async ({ page }) => {
  await page.route("http://127.0.0.1:3001/admin/outbound/pending", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { id: "approval-1", weComSpNo: "202608080001", status: "PENDING_OUTBOUND", lines: [{ id: "line-1", itemId: "item-1", requestedQuantity: "4" }] },
    ]) });
  });
  await page.route("http://127.0.0.1:3001/admin/outbound/approval-1/options", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      batches: [{ batchId: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" }],
    }) });
  });
  await page.route("http://127.0.0.1:3001/admin/outbound/confirm", async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}") as { approvalId?: string; allocations?: Array<{ approvalLineId: string; warehouseId: string; batchId: string; quantity: string }> };
    expect(payload.approvalId).toBe("approval-1");
    expect(payload.allocations).toEqual([{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-1", quantity: "4" }]);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "outbound-1", status: "COMPLETED", actualQuantity: "4", amount: "80.00" }) });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Foutbound");
  await page.getByRole("button", { name: "办理出库" }).click();
  const form = page.locator("form");
  await form.locator("select").nth(1).selectOption("wh-1");
  await form.locator("select").nth(2).selectOption("batch-1");
  await form.locator('input[type="number"]').fill("4");
  await expect(form.getByText(/审批数量 4\.000，实际出库 4\.000，预计金额 80\.00/)).toBeVisible();
  await form.getByRole("button", { name: "确认实际出库" }).click();

  await expect(page.getByText("outbound-1")).toBeVisible();
});

test("outbound page shows server errors and preserves allocation input", async ({ page }) => {
  await page.route("http://127.0.0.1:3001/admin/outbound/pending", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { id: "approval-1", weComSpNo: "202608080001", status: "PENDING_OUTBOUND", lines: [{ id: "line-1", itemId: "item-1", requestedQuantity: "4" }] },
    ]) });
  });
  await page.route("http://127.0.0.1:3001/admin/outbound/approval-1/options", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      batches: [{ batchId: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" }],
    }) });
  });
  await page.route("http://127.0.0.1:3001/admin/outbound/confirm", async (route) => {
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "batch balance cannot become negative" }) });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Foutbound");
  await page.getByRole("button", { name: "办理出库" }).click();
  const form = page.locator("form");
  await form.locator("select").nth(1).selectOption("wh-1");
  await form.locator("select").nth(2).selectOption("batch-1");
  await form.locator('input[type="number"]').fill("4");
  await form.locator("textarea").fill("保留错误现场");
  await form.getByRole("button", { name: "确认实际出库" }).click();

  await expect(page.getByText("batch balance cannot become negative")).toBeVisible();
  await expect(form.locator("select").nth(1)).toHaveValue("wh-1");
  await expect(form.locator("select").nth(2)).toHaveValue("batch-1");
  await expect(form.locator('input[type="number"]')).toHaveValue("4");
  await expect(form.locator("textarea")).toHaveValue("保留错误现场");
});
