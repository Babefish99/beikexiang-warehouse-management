import { expect, test } from "@playwright/test";
import { apiUrl, apiUrlPattern, loginAs } from "./mobile-test-helpers";

const pending = [{
  id: "approval-1",
  weComSpNo: "202608130001",
  status: "PENDING_OUTBOUND",
  lines: [
    { id: "line-1", itemId: "item-1", requestedQuantity: "3" },
    { id: "line-2", itemId: "item-2", requestedQuantity: "2" },
  ],
}];

const batches = [
  { batchId: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" },
  { batchId: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "5", unitCost: "25" },
  { batchId: "batch-3", warehouseId: "wh-1", itemId: "item-2", remainingQuantity: "2", unitCost: "4" },
];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(apiUrl("/admin/outbound/pending"), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pending) }));
});

test("guides allocation across batches, restores a draft, revalidates, and submits once", async ({ page }) => {
  let optionReads = 0;
  let confirmPosts = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), async (route) => {
    optionReads += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approvalId: "approval-1", batches }) });
  });
  await page.route(apiUrl("/admin/outbound/confirm"), async (route) => {
    confirmPosts += 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "outbound-1", status: "PARTIALLY_ISSUED", actualQuantity: "4", amount: "73.00" }) });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await expect(page.getByRole("heading", { name: "选择待办" })).toBeVisible();
  await page.getByRole("button", { name: "办理出库" }).click();
  await expect(page.getByRole("heading", { name: "分配库存" })).toBeVisible();

  const firstLine = page.getByTestId("allocation-line-line-1");
  await firstLine.getByLabel("实际仓库").selectOption("wh-1");
  await firstLine.getByLabel("采购批次").selectOption("batch-1");
  await firstLine.getByLabel("实际数量").fill("1");
  await firstLine.getByRole("button", { name: "增加分配行" }).click();
  const firstLineRows = firstLine.getByTestId("allocation-row");
  await firstLineRows.nth(1).getByLabel("实际仓库").selectOption("wh-2");
  await firstLineRows.nth(1).getByLabel("采购批次").selectOption("batch-2");
  await firstLineRows.nth(1).getByLabel("实际数量").fill("1");
  const secondLine = page.getByTestId("allocation-line-line-2");
  await secondLine.getByLabel("实际仓库").selectOption("wh-1");
  await secondLine.getByLabel("采购批次").selectOption("batch-3");
  await secondLine.getByLabel("实际数量").fill("2");

  await page.getByRole("button", { name: "下一步：复核" }).click();
  await expect(page.getByRole("heading", { name: "复核出库" })).toBeVisible();
  await page.getByLabel("少出 / 零出原因").fill("本次只需部分领用");
  await page.getByRole("button", { name: "上一步" }).click();
  await expect(firstLineRows.nth(1).getByLabel("实际数量")).toHaveValue("1");
  await page.getByRole("button", { name: "下一步：复核" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "复核出库" })).toBeVisible();
  await expect(page.getByLabel("少出 / 零出原因")).toHaveValue("本次只需部分领用");

  await page.getByRole("button", { name: "确认出库" }).click();
  await expect(page.getByRole("dialog", { name: "确认实际出库" })).toBeVisible();
  const submit = page.getByRole("dialog").getByRole("button", { name: "确认提交" });
  await submit.dblclick();
  await expect(page.getByRole("heading", { name: "出库完成" })).toBeVisible();
  await expect(page.getByText("outbound-1")).toBeVisible();
  expect(optionReads).toBeGreaterThanOrEqual(3);
  expect(confirmPosts).toBe(1);
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("warehouse.outbound.v1.")).length)).toBe(0);
});

test("keeps the review visible and marks an allocation when stock changed", async ({ page }) => {
  let optionReads = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), async (route) => {
    optionReads += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      approvalId: "approval-1",
      batches: optionReads === 1 ? batches : batches.filter((batch) => batch.batchId !== "batch-1"),
    }) });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const lines = page.getByTestId(/allocation-line-/);
  await lines.nth(0).getByLabel("实际仓库").selectOption("wh-1");
  await lines.nth(0).getByLabel("采购批次").selectOption("batch-1");
  await lines.nth(0).getByLabel("实际数量").fill("3");
  await lines.nth(1).getByLabel("实际仓库").selectOption("wh-1");
  await lines.nth(1).getByLabel("采购批次").selectOption("batch-3");
  await lines.nth(1).getByLabel("实际数量").fill("2");
  await page.getByRole("button", { name: "下一步：复核" }).click();
  await page.getByRole("button", { name: "确认出库" }).click();

  await expect(page.getByRole("heading", { name: "复核出库" })).toBeVisible();
  await expect(page.getByText("库存已变化，请返回分配步骤重新选择标记项")).toBeVisible();
  await expect(page.getByTestId("review-allocation-invalid")).toContainText("batch-1");
  expect(optionReads).toBe(2);
});

test("requires a cancel reason and a dangerous second confirmation", async ({ page }) => {
  let cancelPosts = 0;
  await page.route(apiUrlPattern("/admin/outbound/approval-1/cancel$"), async (route) => {
    cancelPosts += 1;
    expect(route.request().postDataJSON()).toEqual({ reason: "申请人撤回" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approvalId: "approval-1", status: "VOIDED" }) });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "取消待办" }).click();
  await page.getByRole("dialog", { name: "取消待办" }).getByRole("button", { name: "下一步" }).click();
  await expect(page.getByText("必须填写取消原因")).toBeVisible();
  await page.getByLabel("取消原因").fill("申请人撤回");
  await page.getByRole("dialog", { name: "取消待办" }).getByRole("button", { name: "下一步" }).click();
  const confirmation = page.getByRole("dialog", { name: "确认取消待办" });
  await expect(confirmation).toContainText("202608130001");
  await expect(confirmation).toContainText("申请人撤回");
  await confirmation.getByRole("button", { name: "确认取消", exact: true }).click();
  await expect(page.getByText("待办已取消")).toBeVisible();
  expect(cancelPosts).toBe(1);
});

test("has no horizontal overflow at supported mobile widths", async ({ page }) => {
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approvalId: "approval-1", batches }) }));
  await loginAs(page, "/admin/outbound", "ADMIN");
  for (const width of [320, 390, 430, 820]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});
