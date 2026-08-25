import { test, expect } from "@playwright/test";
import { apiUrl, loginAs } from "../mobile/mobile-test-helpers";

test("outbound execution APIs remain administrator-only", async ({ request }) => {
  const [pending, confirm] = await Promise.all([
    request.get(apiUrl("/admin/outbound/pending")),
    request.post(apiUrl("/admin/outbound/confirm"), { data: {} }),
  ]);

  expect(pending.status()).toBe(401);
  expect(confirm.status()).toBe(401);
});

test("outbound page allocates a batch and submits the actual issue", async ({ page }) => {
  await page.route(apiUrl("/admin/outbound/pending"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { id: "approval-1", weComSpNo: "202608080001", status: "PENDING_OUTBOUND", lines: [{ id: "line-1", itemId: "item-1", requestedQuantity: "4" }] },
    ]) });
  });
  await page.route(apiUrl("/admin/outbound/approval-1/options"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      batches: [{ batchId: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" }],
    }) });
  });
  await page.route(apiUrl("/admin/outbound/confirm"), async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}") as { approvalId?: string; allocations?: Array<{ approvalLineId: string; warehouseId: string; batchId: string; quantity: string }> };
    expect(payload.approvalId).toBe("approval-1");
    expect(payload.allocations).toEqual([{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-1", quantity: "4" }]);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "outbound-1", status: "COMPLETED", actualQuantity: "4", amount: "80.00" }) });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await expect(page.locator(".status-pill")).toHaveText("待出库");
  await expect(page.getByText("PENDING_OUTBOUND", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "办理出库" }).click();
  const form = page.locator("form");
  await form.locator("select").nth(1).selectOption("wh-1");
  await form.locator("select").nth(2).selectOption("batch-1");
  await form.locator('input[type="number"]').fill("4");
  await expect(form.getByText(/审批数量 4\.000，实际出库 4\.000，预计金额 80\.00/)).toBeVisible();
  await form.getByRole("button", { name: "确认实际出库" }).click();

  const result = page.locator('.success-notice[role="status"]');
  await expect(result).toContainText("outbound-1");
  await expect(result).toContainText("已完成");
  await expect(result).not.toContainText("COMPLETED");
});

test("outbound page shows server errors and preserves allocation input", async ({ page }) => {
  await page.route(apiUrl("/admin/outbound/pending"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { id: "approval-1", weComSpNo: "202608080001", status: "PENDING_OUTBOUND", lines: [{ id: "line-1", itemId: "item-1", requestedQuantity: "4" }] },
    ]) });
  });
  await page.route(apiUrl("/admin/outbound/approval-1/options"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      batches: [{ batchId: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" }],
    }) });
  });
  await page.route(apiUrl("/admin/outbound/confirm"), async (route) => {
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "batch balance cannot become negative" }) });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const form = page.locator("form");
  await form.locator("select").nth(1).selectOption("wh-1");
  await form.locator("select").nth(2).selectOption("batch-1");
  await form.locator('input[type="number"]').fill("4");
  await form.locator("textarea").fill("保留错误现场");
  await form.getByRole("button", { name: "确认实际出库" }).click();

  await expect(form.locator('.form-error[role="alert"]')).toHaveText("batch balance cannot become negative");
  await expect(form.locator("select").nth(1)).toHaveValue("wh-1");
  await expect(form.locator("select").nth(2)).toHaveValue("batch-1");
  await expect(form.locator('input[type="number"]')).toHaveValue("4");
  await expect(form.locator("textarea")).toHaveValue("保留错误现场");
});
