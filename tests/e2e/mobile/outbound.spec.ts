import { expect, test, type Locator, type Page } from "@playwright/test";

import { apiUrl, loginAs } from "./mobile-test-helpers";

const pendingApproval = {
  id: "approval-1",
  weComSpNo: "202609040001",
  status: "PENDING_OUTBOUND",
  lines: [
    {
      id: "line-wine",
      requestedItemName: "招待用白酒",
      requestedQuantity: "3",
      unit: "瓶",
      note: "集团客户晚宴",
      legacyResolutionStatus: "NOT_APPLICABLE",
    },
    {
      id: "line-water",
      requestedItemName: "会议饮用水",
      requestedQuantity: "2",
      unit: "箱",
      note: "周五前送达",
      legacyResolutionStatus: "NOT_APPLICABLE",
    },
  ],
};

const secondApproval = {
  id: "approval-2",
  weComSpNo: "202609040002",
  status: "PENDING_OUTBOUND",
  lines: [{
    id: "line-paper",
    requestedItemName: "打印纸",
    requestedQuantity: "1",
    unit: "箱",
    legacyResolutionStatus: "NOT_APPLICABLE",
  }],
};

const options = {
  approvalId: "approval-1",
  lines: [
    {
      approvalLineId: "line-wine",
      items: [
        { id: "item-maotai", code: "BJ0002", name: "飞天茅台", unit: "瓶", isActive: true, availableQuantity: "10" },
        { id: "item-wine", code: "BJ0003", name: "陈年白酒", unit: "瓶", isActive: true, availableQuantity: "6" },
      ],
    },
    {
      approvalLineId: "line-water",
      items: [{ id: "item-water", code: "YL0001", name: "天然饮用水", unit: "箱", isActive: true, availableQuantity: "8" }],
    },
  ],
  batches: [
    { batchId: "wine-a", warehouseId: "一号仓", itemId: "item-maotai", remainingQuantity: "6", unitCost: "20" },
    { batchId: "wine-b", warehouseId: "二号仓", itemId: "item-maotai", remainingQuantity: "4", unitCost: "25" },
    { batchId: "water-a", warehouseId: "一号仓", itemId: "item-water", remainingQuantity: "8", unitCost: "4" },
  ],
};

async function mockPending(page: Page, read: () => object[] = () => [pendingApproval]) {
  await page.route(apiUrl("/admin/outbound/pending"), (route) => route.fulfill({ json: read() }));
  await page.route(apiUrl("/admin/approvals/sync-failures?limit=20"), (route) => route.fulfill({ json: [] }));
}

async function selectTwoBatchAndZeroIssue(page: Page) {
  const wine = page.getByTestId("outbound-decision-line-line-wine");
  await wine.getByLabel("标准物品").selectOption("item-maotai");
  let allocations = wine.getByTestId("outbound-allocation-row");
  await allocations.nth(0).getByLabel("实际仓库").selectOption("一号仓");
  await allocations.nth(0).getByLabel("采购批次").selectOption("wine-a");
  await allocations.nth(0).getByLabel("实际数量").fill("1");
  await wine.getByRole("button", { name: "增加分配" }).click();
  allocations = wine.getByTestId("outbound-allocation-row");
  await allocations.nth(1).getByLabel("实际仓库").selectOption("二号仓");
  await allocations.nth(1).getByLabel("采购批次").selectOption("wine-b");
  await allocations.nth(1).getByLabel("实际数量").fill("1");
  await wine.getByLabel("少出 / 零出原因").fill("晚宴人数减少");

  const water = page.getByTestId("outbound-decision-line-line-water");
  await water.getByRole("button", { name: "本项不出库" }).click();
  await water.getByLabel("少出 / 零出原因").fill("会议取消");
}

async function expectNoHorizontalOverflow(page: Page, target?: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (target) expect(await target.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPending(page);
});

test("completes a two-intent mobile draft after reload and submits exactly once", async ({ page }) => {
  let optionReads = 0;
  let confirmPosts = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => {
    optionReads += 1;
    return route.fulfill({ json: options });
  });
  await page.route(apiUrl("/admin/outbound/confirm"), async (route) => {
    confirmPosts += 1;
    expect(route.request().postDataJSON()).toEqual({
      approvalId: "approval-1",
      decisions: [
        {
          approvalLineId: "line-wine",
          selectedItemId: "item-maotai",
          allocations: [
            { warehouseId: "一号仓", batchId: "wine-a", quantity: "1" },
            { warehouseId: "二号仓", batchId: "wine-b", quantity: "1" },
          ],
          varianceReason: "晚宴人数减少",
        },
        { approvalLineId: "line-water", allocations: [], varianceReason: "会议取消" },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ status: 201, json: { id: "outbound-1", status: "PARTIALLY_ISSUED", actualQuantity: "2", amount: "45.00" } });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await expect(page.getByText("2 个审批意向 · 待出库", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "办理出库" }).click();
  await expect(page.getByRole("heading", { name: "分配库存" })).toBeVisible();
  await expect(page.getByTestId(/outbound-decision-line-/)).toHaveCount(2);
  await selectTwoBatchAndZeroIssue(page);

  await page.reload();
  await expect(page.getByRole("heading", { name: "分配库存" })).toBeVisible();
  const restoredWine = page.getByTestId("outbound-decision-line-line-wine");
  await expect(restoredWine.getByLabel("标准物品")).toHaveValue("item-maotai");
  await expect(restoredWine.getByTestId("outbound-allocation-row").nth(1).getByLabel("实际数量")).toHaveValue("1");
  await expect(restoredWine.getByLabel("少出 / 零出原因")).toHaveValue("晚宴人数减少");
  await expect(page.getByTestId("outbound-decision-line-line-water").getByLabel("少出 / 零出原因")).toHaveValue("会议取消");
  expect(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("warehouse.outbound.v2.")))).toBe(true);

  await page.getByRole("button", { name: "复核出库" }).click();
  const review = page.getByTestId("outbound-mobile-review");
  await expect(review).toContainText("申请：招待用白酒 3 瓶");
  await expect(review).toContainText("标准物品：BJ0002 飞天茅台");
  await expect(review).toContainText("一号仓 / wine-a / 1 瓶");
  await expect(review).toContainText("二号仓 / wine-b / 1 瓶");
  await expect(review).toContainText("实际 2 / 审批 3");
  await expect(review).toContainText("原因：晚宴人数减少");
  await expect(review).toContainText("申请：会议饮用水 2 箱");
  await expect(review).toContainText("本项不出库");
  await expect(review).toContainText("实际 0 / 审批 2");
  await expect(review).toContainText("原因：会议取消");
  await expect(review).toContainText("预计总金额 45.00");

  await page.getByRole("button", { name: "确认出库" }).click();
  const dialog = page.getByRole("dialog", { name: "确认实际出库" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认提交" }).dblclick();
  await expect(page.getByRole("heading", { name: "出库完成" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("outbound-1");
  expect(optionReads).toBeGreaterThanOrEqual(3);
  expect(confirmPosts).toBe(1);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("warehouse.outbound.v2.") || key.startsWith("warehouse.outbound.index.v2.")).length)).toBe(0);
});

test("preserves stale item and batch text, marks controls, and returns to allocation", async ({ page }) => {
  let optionReads = 0;
  let confirmPosts = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => {
    optionReads += 1;
    const stale = {
      ...options,
      lines: options.lines.map((line) => line.approvalLineId === "line-water" ? { ...line, items: [] } : line),
      batches: options.batches.filter((batch) => batch.batchId !== "wine-a"),
    };
    return route.fulfill({ json: optionReads === 1 ? options : stale });
  });
  await page.route(apiUrl("/admin/outbound/confirm"), (route) => {
    confirmPosts += 1;
    return route.fulfill({ status: 500 });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const wine = page.getByTestId("outbound-decision-line-line-wine");
  await wine.getByLabel("标准物品").selectOption("item-maotai");
  await wine.getByLabel("实际仓库").selectOption("一号仓");
  await wine.getByLabel("采购批次").selectOption("wine-a");
  await wine.getByLabel("实际数量").fill("3");
  const water = page.getByTestId("outbound-decision-line-line-water");
  await water.getByLabel("标准物品").selectOption("item-water");
  await water.getByLabel("实际仓库").selectOption("一号仓");
  await water.getByLabel("采购批次").selectOption("water-a");
  await water.getByLabel("实际数量").fill("2");

  await page.getByRole("button", { name: "复核出库" }).click();
  await expect(page.getByRole("heading", { name: "分配库存" })).toBeVisible();
  await expect(wine.getByLabel("采购批次")).toHaveValue("wine-a");
  await expect(wine.getByLabel("实际数量")).toHaveValue("3");
  await expect(wine.getByLabel("采购批次")).toHaveAttribute("aria-invalid", "true");
  await expect(wine).toContainText("已失效：wine-a");
  await expect(water.getByLabel("标准物品")).toHaveValue("item-water");
  await expect(water.getByLabel("实际数量")).toHaveValue("2");
  await expect(water.getByLabel("标准物品")).toHaveAttribute("aria-invalid", "true");
  await expect(water).toContainText("已失效：item-water");
  expect(confirmPosts).toBe(0);
});

test("returns from review to allocation when the final reload invalidates a batch", async ({ page }) => {
  let optionReads = 0;
  let confirmPosts = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => {
    optionReads += 1;
    return route.fulfill({ json: optionReads < 3 ? options : { ...options, batches: options.batches.filter((batch) => batch.batchId !== "wine-a") } });
  });
  await page.route(apiUrl("/admin/outbound/confirm"), (route) => {
    confirmPosts += 1;
    return route.fulfill({ status: 500 });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const wine = page.getByTestId("outbound-decision-line-line-wine");
  await wine.getByLabel("标准物品").selectOption("item-maotai");
  await wine.getByLabel("实际仓库").selectOption("一号仓");
  await wine.getByLabel("采购批次").selectOption("wine-a");
  await wine.getByLabel("实际数量").fill("3");
  const water = page.getByTestId("outbound-decision-line-line-water");
  await water.getByRole("button", { name: "本项不出库" }).click();
  await water.getByLabel("少出 / 零出原因").fill("会议取消");
  await page.getByRole("button", { name: "复核出库" }).click();
  await expect(page.getByRole("heading", { name: "复核出库" })).toBeVisible();

  await page.getByRole("button", { name: "确认出库" }).click();
  await expect(page.getByRole("heading", { name: "分配库存" })).toBeVisible();
  await expect(wine.getByLabel("采购批次")).toHaveValue("wine-a");
  await expect(wine.getByLabel("实际数量")).toHaveValue("3");
  await expect(wine.getByLabel("采购批次")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("dialog", { name: "确认实际出库" })).toHaveCount(0);
  expect(confirmPosts).toBe(0);
});

test("closes an active editor when refreshed pending no longer contains its approval", async ({ page }) => {
  let visibleApprovals: object[] = [pendingApproval, secondApproval];
  await page.unroute(apiUrl("/admin/outbound/pending"));
  await mockPending(page, () => visibleApprovals);
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => route.fulfill({ json: options }));

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).first().click();
  await expect(page.getByRole("heading", { name: "分配库存" })).toBeVisible();
  visibleApprovals = [secondApproval];
  await page.getByRole("button", { name: "刷新" }).click();

  await expect(page.getByRole("heading", { name: "选择待办" })).toBeVisible();
  const stale = page.getByTestId("stale-draft-approval-1");
  await expect(stale).toContainText("待办状态已变化");
  await expect(page.getByTestId("outbound-decision-line-line-wine")).toHaveCount(0);
  await stale.getByRole("button", { name: "放弃该草稿" }).click();
  expect(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.includes("approval-1")))).toBe(false);
});

test("shows reapplication guidance without outbound controls", async ({ page }) => {
  const reapply = {
    id: "approval-reapply",
    weComSpNo: "202608080001",
    status: "PENDING_OUTBOUND",
    lines: [{
      id: "line-legacy",
      itemId: "item-0001",
      requestedItemName: "旧模板占位物品",
      requestedQuantity: "1",
      unit: "瓶",
      legacyResolutionStatus: "REAPPLY_REQUIRED",
    }],
  };
  await page.unroute(apiUrl("/admin/outbound/pending"));
  await mockPending(page, () => [reapply]);

  await loginAs(page, "/admin/outbound", "ADMIN");
  const card = page.getByTestId("outbound-reapply-approval-reapply");
  await expect(card).toContainText("需重新申请");
  await expect(card).toContainText("旧模板占位物品 1 瓶");
  await expect(card.getByRole("button", { name: "办理出库" })).toHaveCount(0);
  await expect(card.getByLabel("标准物品")).toHaveCount(0);
  await expect(card.getByLabel("实际仓库")).toHaveCount(0);
});

test("does not restore a legacy v1 mobile draft", async ({ page }) => {
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => route.fulfill({ json: options }));
  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.evaluate(() => {
    sessionStorage.setItem("warehouse.outbound.v1.local-admin.approval-1", JSON.stringify({
      version: 1,
      userId: "local-admin",
      value: { approvalId: "approval-1", step: "review", reason: "旧原因", allocations: [] },
    }));
    sessionStorage.setItem("warehouse.outbound.index.v1.local-admin", JSON.stringify({
      version: 1,
      userId: "local-admin",
      value: [{ approvalId: "approval-1", weComSpNo: "202609040001" }],
    }));
  });
  await page.reload();

  await expect(page.getByRole("heading", { name: "选择待办" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "复核出库" })).toHaveCount(0);
  await expect(page.getByText("旧原因")).toHaveCount(0);
});

test("has no horizontal overflow and usable controls throughout supported mobile widths", async ({ page }) => {
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => route.fulfill({ json: options }));
  await loginAs(page, "/admin/outbound", "ADMIN");

  for (const width of [320, 390, 430, 820]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
  }

  await page.getByRole("button", { name: "办理出库" }).click();
  await selectTwoBatchAndZeroIssue(page);
  for (const width of [320, 390, 430, 820]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page, page.locator(".outbound-flow"));
    const targetSizes = await page.locator(".outbound-flow button:visible, .outbound-flow input:visible, .outbound-flow select:visible, .outbound-flow textarea:visible").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect(targetSizes.every((height) => height >= 44)).toBe(true);
  }

  await page.getByRole("button", { name: "复核出库" }).click();
  await page.getByRole("button", { name: "确认出库" }).click();
  const dialog = page.getByRole("dialog", { name: "确认实际出库" });
  for (const width of [320, 390, 430, 820]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page, dialog);
    await expect(dialog).toBeInViewport();
  }
});
