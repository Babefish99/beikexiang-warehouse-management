import { test, expect, type Page } from "@playwright/test";
import { apiUrl, loginAs } from "../mobile/mobile-test-helpers";

const intentApproval = {
  id: "approval-1",
  weComSpNo: "202609040001",
  status: "PENDING_OUTBOUND",
  lines: [{
    id: "line-wine",
    itemId: "item-0001",
    requestedItemName: "招待用白酒",
    requestedQuantity: "2",
    unit: "瓶",
    note: "集团客户晚宴",
    legacyResolutionStatus: "NOT_APPLICABLE",
  }],
};

const initialOptions = {
  approvalId: "approval-1",
  lines: [{
    approvalLineId: "line-wine",
    items: [
      { id: "item-maotai", code: "BJ0002", name: "飞天茅台", unit: "瓶", isActive: true, availableQuantity: "3" },
      { id: "item-wine", code: "BJ0003", name: "陈年白酒", unit: "瓶", isActive: true, availableQuantity: "6" },
    ],
  }],
  batches: [
    { batchId: "期初-260827", warehouseId: "一号仓", itemId: "item-maotai", remainingQuantity: "3", unitCost: "100" },
    { batchId: "期初-260828", warehouseId: "二号仓", itemId: "item-wine", remainingQuantity: "6", unitCost: "80" },
  ],
};

async function mockPending(page: Page, approvals: object[] = [intentApproval]) {
  await page.route(apiUrl("/admin/outbound/pending"), (route) => route.fulfill({ json: approvals }));
  await page.route(apiUrl("/admin/approvals/sync-failures?limit=20"), (route) => route.fulfill({ json: [] }));
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test("outbound execution APIs remain administrator-only", async ({ request }) => {
  const [pending, confirm] = await Promise.all([
    request.get(apiUrl("/admin/outbound/pending")),
    request.post(apiUrl("/admin/outbound/confirm"), { data: {} }),
  ]);

  expect(pending.status()).toBe(401);
  expect(confirm.status()).toBe(401);
});

test("desktop outbound resolves each immutable intent to a standard item and posts decisions", async ({ page }) => {
  await mockPending(page);
  let optionReads = 0;
  let submitted: unknown;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => {
    optionReads += 1;
    return route.fulfill({ json: initialOptions });
  });
  await page.route(apiUrl("/admin/outbound/confirm"), async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { id: "outbound-1", status: "PARTIALLY_ISSUED", actualQuantity: "1", amount: "100.00" } });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const line = page.getByTestId("outbound-decision-line-line-wine");
  await expect(line).toContainText("招待用白酒");
  await expect(line).toContainText("审批数量：2 瓶");
  await expect(line).toContainText("集团客户晚宴");

  const item = line.getByLabel("标准物品");
  const warehouse = line.getByLabel("实际仓库");
  const batch = line.getByLabel("采购批次");
  await expect(item).toHaveValue("");
  await expect(item.locator('option[value="item-0001"]')).toHaveCount(0);
  await expect(item.locator("option").nth(1)).toHaveText("BJ0002 飞天茅台 / 瓶 / 可用 3");
  await expect(warehouse).toBeDisabled();
  await expect(batch).toBeDisabled();

  await item.selectOption("item-maotai");
  await warehouse.selectOption("一号仓");
  await batch.selectOption("期初-260827");
  const quantity = line.getByLabel("实际数量");
  await expect(quantity).toHaveAttribute("min", "1");
  await expect(quantity).toHaveAttribute("step", "1");
  await quantity.fill("2");
  await expect(line.getByLabel("少出 / 零出原因")).toHaveCount(0);
  await quantity.fill("1");
  await expect(line.getByLabel("少出 / 零出原因")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await item.selectOption("item-wine");
  await expect(line.getByTestId("outbound-allocation-row")).toHaveCount(0);
  await line.getByRole("button", { name: "本项不出库" }).click();
  await expect(line.getByLabel("标准物品")).toHaveCount(0);
  await expect(line.getByTestId("outbound-allocation-row")).toHaveCount(0);
  await expect(line.getByLabel("少出 / 零出原因")).toHaveAttribute("required", "");
  await line.getByRole("button", { name: "恢复本项出库" }).click();
  await line.getByLabel("标准物品").selectOption("item-maotai");
  await line.getByLabel("实际仓库").selectOption("一号仓");
  await line.getByLabel("采购批次").selectOption("期初-260827");
  await line.getByLabel("实际数量").fill("1");
  await expect(line.getByLabel("少出 / 零出原因")).toBeVisible();
  await line.getByLabel("少出 / 零出原因").fill("库存不足");

  await page.getByRole("button", { name: "复核出库" }).click();
  await expect.poll(() => optionReads).toBe(2);
  const review = page.getByTestId("outbound-review-line-line-wine");
  await expect(review).toContainText("申请：招待用白酒 2 瓶");
  await expect(review).toContainText("实际：BJ0002 飞天茅台 1 瓶");
  await expect(review).toContainText("分配：一号仓 / 期初-260827 / 1");
  await expect(review).toContainText("差额：1；原因：库存不足");
  await page.getByRole("button", { name: "确认并提交" }).click();

  await expect(page.getByRole("status")).toContainText("outbound-1");
  expect(submitted).toEqual({
    approvalId: "approval-1",
    decisions: [{
      approvalLineId: "line-wine",
      selectedItemId: "item-maotai",
      allocations: [{ warehouseId: "一号仓", batchId: "期初-260827", quantity: "1" }],
      varianceReason: "库存不足",
    }],
  });
});

test("desktop outbound keeps the draft and blocks review when refreshed options are stale", async ({ page }) => {
  await mockPending(page);
  let optionReads = 0;
  let confirmationRequests = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => {
    optionReads += 1;
    const stale = { ...initialOptions, lines: [{ approvalLineId: "line-wine", items: [] }], batches: [] };
    return route.fulfill({ json: optionReads === 1 ? initialOptions : stale });
  });
  await page.route(apiUrl("/admin/outbound/confirm"), (route) => {
    confirmationRequests += 1;
    return route.fulfill({ status: 500 });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const line = page.getByTestId("outbound-decision-line-line-wine");
  await line.getByLabel("标准物品").selectOption("item-maotai");
  await line.getByLabel("实际仓库").selectOption("一号仓");
  await line.getByLabel("采购批次").selectOption("期初-260827");
  await line.getByLabel("实际数量").fill("2");
  await page.getByRole("button", { name: "复核出库" }).click();

  await expect(page.getByRole("alert")).toContainText("所选标准物品已失效");
  await expect(line.getByLabel("标准物品")).toHaveValue("item-maotai");
  await expect(line.getByLabel("实际数量")).toHaveValue("2");
  expect(confirmationRequests).toBe(0);
});

test("desktop outbound preserves the draft after a server rejection", async ({ page }) => {
  await mockPending(page);
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => route.fulfill({ json: initialOptions }));
  await page.route(apiUrl("/admin/outbound/confirm"), (route) => route.fulfill({ status: 400, json: { error: "batch balance cannot become negative" } }));

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const line = page.getByTestId("outbound-decision-line-line-wine");
  await line.getByLabel("标准物品").selectOption("item-maotai");
  await line.getByLabel("实际仓库").selectOption("一号仓");
  await line.getByLabel("采购批次").selectOption("期初-260827");
  await line.getByLabel("实际数量").fill("1");
  await line.getByLabel("少出 / 零出原因").fill("库存不足");
  await page.getByRole("button", { name: "复核出库" }).click();
  await page.getByRole("button", { name: "确认并提交" }).click();

  await expect(page.getByRole("alert")).toHaveText("batch balance cannot become negative");
  await page.getByRole("button", { name: "返回修改" }).click();
  await expect(line.getByLabel("标准物品")).toHaveValue("item-maotai");
  await expect(line.getByLabel("实际数量")).toHaveValue("1");
  await expect(line.getByLabel("少出 / 零出原因")).toHaveValue("库存不足");
});

test("reapply-required approvals and sanitized sync failures are non-actionable administrator notices", async ({ page }) => {
  const reapplyApproval = {
    id: "approval-reapply",
    weComSpNo: "202608080001",
    status: "PENDING_OUTBOUND",
    lines: [{
      id: "line-legacy",
      itemId: "item-0001",
      requestedItemName: "旧模板物品",
      requestedQuantity: "1",
      unit: "瓶",
      legacyResolutionStatus: "REAPPLY_REQUIRED",
    }],
  };
  await mockPending(page, [reapplyApproval]);
  await page.unroute(apiUrl("/admin/approvals/sync-failures?limit=20"));
  await page.route(apiUrl("/admin/approvals/sync-failures?limit=20"), (route) => route.fulfill({ json: [{
    weComSpNo: "202609040099",
    attemptedAt: "2026-09-04T02:03:04.000Z",
    error: "审批数量必须为正整数",
  }] }));

  await loginAs(page, "/admin/outbound", "ADMIN");
  const reapply = page.getByTestId("outbound-reapply-approval-reapply");
  await expect(reapply).toContainText("需重新申请");
  await expect(reapply).toContainText("旧模板物品 1 瓶");
  await expect(reapply.getByRole("button", { name: "办理出库" })).toHaveCount(0);
  await expect(reapply.getByLabel("实际仓库")).toHaveCount(0);

  const failures = page.getByTestId("approval-sync-failures");
  await expect(failures).not.toHaveAttribute("open", "");
  await failures.locator("summary").click();
  await expect(failures).toContainText("202609040099");
  await expect(failures).toContainText("审批数量必须为正整数");
});

test("desktop keeps the latest review result when an older options request finishes last", async ({ page }) => {
  await mockPending(page);
  const olderOpenResponse = deferred();
  const latestOpenResponse = deferred();
  const reviewResponse = deferred();
  let twoOpenRequestsStarted!: () => void;
  const twoOpenRequests = new Promise<void>((resolve) => { twoOpenRequestsStarted = resolve; });
  let optionReads = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), async (route) => {
    optionReads += 1;
    if (optionReads === 1) {
      await olderOpenResponse.promise;
      return route.fulfill({ json: initialOptions });
    }
    if (optionReads === 2) {
      twoOpenRequestsStarted();
      await latestOpenResponse.promise;
      return route.fulfill({ json: initialOptions });
    }
    await reviewResponse.promise;
    return route.fulfill({ json: { ...initialOptions, lines: [{ approvalLineId: "line-wine", items: [] }], batches: [] } });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await twoOpenRequests;
  latestOpenResponse.release();
  const line = page.getByTestId("outbound-decision-line-line-wine");
  await line.getByLabel("标准物品").selectOption("item-maotai");
  await line.getByLabel("实际仓库").selectOption("一号仓");
  await line.getByLabel("采购批次").selectOption("期初-260827");
  await line.getByLabel("实际数量").fill("2");
  await page.getByRole("button", { name: "复核出库" }).click();
  const toggle = page.getByRole("button", { name: "收起" });
  await expect(toggle).toBeDisabled();
  reviewResponse.release();
  await expect(page.getByRole("alert")).toContainText("所选标准物品已失效");
  olderOpenResponse.release();
  await page.waitForTimeout(50);

  expect(optionReads).toBe(3);
  await expect(line.getByLabel("标准物品").locator('option[value="item-maotai"]')).toHaveText("已失效：item-maotai");
  await expect(line.getByLabel("实际数量")).toHaveValue("2");
});

test("desktop reopening a reviewed draft reconciles stale options and exits review", async ({ page }) => {
  await mockPending(page);
  let optionReads = 0;
  let confirmPosts = 0;
  const staleOptions = { ...initialOptions, lines: [{ approvalLineId: "line-wine", items: [] }], batches: [] };
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => {
    optionReads += 1;
    return route.fulfill({ json: optionReads < 3 ? initialOptions : staleOptions });
  });
  await page.route(apiUrl("/admin/outbound/confirm"), (route) => {
    confirmPosts += 1;
    return route.fulfill({ status: 201, json: { id: "must-not-submit" } });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const line = page.getByTestId("outbound-decision-line-line-wine");
  await line.getByLabel("标准物品").selectOption("item-maotai");
  await line.getByLabel("实际仓库").selectOption("一号仓");
  await line.getByLabel("采购批次").selectOption("期初-260827");
  await line.getByLabel("实际数量").fill("2");
  await page.getByRole("button", { name: "复核出库" }).click();
  await expect(page.getByRole("button", { name: "确认并提交" })).toBeVisible();

  await page.getByRole("button", { name: "收起" }).click();
  await page.getByRole("button", { name: "办理出库" }).click();

  await expect(page.getByRole("alert")).toContainText("所选标准物品已失效");
  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "复核出库" })).toBeVisible();
  expect(optionReads).toBe(3);
  expect(confirmPosts).toBe(0);
});

test("desktop reopening a valid reviewed draft still requires a new review", async ({ page }) => {
  await mockPending(page);
  let optionReads = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => {
    optionReads += 1;
    return route.fulfill({ json: initialOptions });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const line = page.getByTestId("outbound-decision-line-line-wine");
  await line.getByLabel("标准物品").selectOption("item-maotai");
  await line.getByLabel("实际仓库").selectOption("一号仓");
  await line.getByLabel("采购批次").selectOption("期初-260827");
  await line.getByLabel("实际数量").fill("2");
  await page.getByRole("button", { name: "复核出库" }).click();
  await page.getByRole("button", { name: "收起" }).click();
  await page.getByRole("button", { name: "办理出库" }).click();

  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "复核出库" })).toBeVisible();
  await expect(line.getByLabel("实际数量")).toHaveValue("2");
  expect(optionReads).toBe(3);
});

test("desktop confirmation becomes terminal even when pending still returns the approval", async ({ page }) => {
  await mockPending(page);
  let confirmPosts = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => route.fulfill({ json: initialOptions }));
  await page.route(apiUrl("/admin/outbound/confirm"), async (route) => {
    confirmPosts += 1;
    await route.fulfill({ status: 201, json: { id: "outbound-terminal", status: "COMPLETED", actualQuantity: "2", amount: "200.00" } });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const line = page.getByTestId("outbound-decision-line-line-wine");
  await line.getByLabel("标准物品").selectOption("item-maotai");
  await line.getByLabel("实际仓库").selectOption("一号仓");
  await line.getByLabel("采购批次").selectOption("期初-260827");
  await line.getByLabel("实际数量").fill("2");
  await page.getByRole("button", { name: "复核出库" }).click();
  await page.getByRole("button", { name: "确认并提交" }).click();

  await expect(page.getByRole("status")).toContainText("outbound-terminal");
  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "已完成", exact: true })).toBeDisabled();
  await page.waitForTimeout(50);
  expect(confirmPosts).toBe(1);
});

test("mobile locks the active editor while the final options reload is pending", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPending(page);
  const reloadResponse = deferred();
  let reloadStarted!: () => void;
  const reloadRequestStarted = new Promise<void>((resolve) => { reloadStarted = resolve; });
  let optionReads = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), async (route) => {
    optionReads += 1;
    if (optionReads === 1) return route.fulfill({ json: initialOptions });
    reloadStarted();
    await reloadResponse.promise;
    return route.fulfill({ json: initialOptions });
  });
  await page.route(apiUrl("/admin/outbound/confirm"), (route) => route.fulfill({ status: 201, json: { id: "mobile-safe", status: "COMPLETED", actualQuantity: "2", amount: "200.00" } }));

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const line = page.getByTestId("outbound-decision-line-line-wine");
  await line.getByLabel("标准物品").selectOption("item-maotai");
  await line.getByLabel("实际仓库").selectOption("一号仓");
  await line.getByLabel("采购批次").selectOption("期初-260827");
  await line.getByLabel("实际数量").fill("2");
  await page.getByRole("button", { name: "确认出库" }).click();
  await reloadRequestStarted;

  await expect(page.getByRole("button", { name: "返回待办" })).toBeDisabled();
  await expect(line.getByLabel("标准物品")).toBeDisabled();
  await expect(line.getByLabel("实际数量")).toBeDisabled();
  await expect(line.getByRole("button", { name: "本项不出库" })).toBeDisabled();
  reloadResponse.release();
  await expect(page.getByRole("status")).toContainText("mobile-safe");
});

test("mobile offers retry and return after the first options request fails", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPending(page);
  let optionReads = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => {
    optionReads += 1;
    return optionReads === 1
      ? route.fulfill({ status: 503, json: { error: "temporary failure" } })
      : route.fulfill({ json: initialOptions });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  await expect(page.getByRole("alert")).toHaveText("temporary failure");
  await expect(page.getByLabel("标准物品")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回待办" })).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByLabel("标准物品")).toBeVisible();
  expect(optionReads).toBe(2);
});

test("mobile does not post an old decision after SPA navigation invalidates a pending reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPending(page);
  const reloadResponse = deferred();
  let reloadStarted!: () => void;
  const reloadRequestStarted = new Promise<void>((resolve) => { reloadStarted = resolve; });
  let optionReads = 0;
  let confirmPosts = 0;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), async (route) => {
    optionReads += 1;
    if (optionReads === 1) return route.fulfill({ json: initialOptions });
    reloadStarted();
    await reloadResponse.promise;
    return route.fulfill({ json: initialOptions });
  });
  await page.route(apiUrl("/admin/outbound/confirm"), (route) => {
    confirmPosts += 1;
    return route.fulfill({ status: 201, json: { id: "must-not-submit" } });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const line = page.getByTestId("outbound-decision-line-line-wine");
  await line.getByLabel("标准物品").selectOption("item-maotai");
  await line.getByLabel("实际仓库").selectOption("一号仓");
  await line.getByLabel("采购批次").selectOption("期初-260827");
  await line.getByLabel("实际数量").fill("2");
  await page.getByRole("button", { name: "确认出库" }).click();
  await reloadRequestStarted;
  await page.getByRole("link", { name: "首页" }).click();
  await expect(page).toHaveURL(/\/$/);
  reloadResponse.release();
  await page.waitForTimeout(100);
  expect(confirmPosts).toBe(0);
});

test("a reason hidden by full issuance is omitted from the decisions payload", async ({ page }) => {
  await mockPending(page);
  let submitted: unknown;
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => route.fulfill({ json: initialOptions }));
  await page.route(apiUrl("/admin/outbound/confirm"), async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { id: "outbound-full", status: "COMPLETED", actualQuantity: "2", amount: "200.00" } });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const line = page.getByTestId("outbound-decision-line-line-wine");
  await line.getByLabel("标准物品").selectOption("item-maotai");
  await line.getByLabel("实际仓库").selectOption("一号仓");
  await line.getByLabel("采购批次").selectOption("期初-260827");
  await line.getByLabel("实际数量").fill("1");
  await line.getByLabel("少出 / 零出原因").fill("曾经少出");
  await line.getByLabel("实际数量").fill("2");
  await page.getByRole("button", { name: "复核出库" }).click();
  await page.getByRole("button", { name: "确认并提交" }).click();

  expect(submitted).toEqual({
    approvalId: "approval-1",
    decisions: [{
      approvalLineId: "line-wine",
      selectedItemId: "item-maotai",
      allocations: [{ warehouseId: "一号仓", batchId: "期初-260827", quantity: "2" }],
    }],
  });
});

test("the latest sync-failure refresh wins when an older response finishes last", async ({ page }) => {
  await mockPending(page);
  let overlapping = false;
  let overlapReads = 0;
  let olderStarted!: () => void;
  const olderRequestStarted = new Promise<void>((resolve) => { olderStarted = resolve; });
  const olderResponse = deferred();
  await page.unroute(apiUrl("/admin/approvals/sync-failures?limit=20"));
  await page.route(apiUrl("/admin/approvals/sync-failures?limit=20"), async (route) => {
    if (!overlapping) return route.fulfill({ json: [] });
    overlapReads += 1;
    if (overlapReads === 1) {
      olderStarted();
      await olderResponse.promise;
      return route.fulfill({ json: [{ weComSpNo: "older", attemptedAt: "2026-09-04T01:00:00.000Z", error: "旧响应" }] });
    }
    return route.fulfill({ json: [{ weComSpNo: "newer", attemptedAt: "2026-09-04T02:00:00.000Z", error: "新响应" }] });
  });

  await loginAs(page, "/admin/outbound", "ADMIN");
  overlapping = true;
  await page.getByRole("button", { name: "刷新" }).click();
  await olderRequestStarted;
  await page.getByRole("button", { name: "刷新" }).click();
  await expect(page.getByTestId("approval-sync-failures")).toContainText("管理员通知");
  olderResponse.release();
  await page.waitForTimeout(50);
  const failures = page.getByTestId("approval-sync-failures");
  await failures.locator("summary").click();
  await expect(failures).toContainText("newer");
  await expect(failures).not.toContainText("older");
});

test("desktop item change can be cancelled and the standard-item control precedes allocation controls", async ({ page }) => {
  await mockPending(page);
  await page.route(apiUrl("/admin/outbound/approval-1/options"), (route) => route.fulfill({ json: initialOptions }));
  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const line = page.getByTestId("outbound-decision-line-line-wine");
  const item = line.getByLabel("标准物品");
  const warehouse = line.getByLabel("实际仓库");
  const batch = line.getByLabel("采购批次");
  expect(await item.evaluate((node, other) => Boolean(node.compareDocumentPosition(other as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await warehouse.elementHandle())).toBe(true);
  expect(await item.evaluate((node, other) => Boolean(node.compareDocumentPosition(other as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await batch.elementHandle())).toBe(true);
  await item.selectOption("item-maotai");
  await warehouse.selectOption("一号仓");
  await batch.selectOption("期初-260827");
  await line.getByLabel("实际数量").fill("1");
  page.once("dialog", (dialog) => dialog.dismiss());
  await item.selectOption("item-wine");
  await expect(item).toHaveValue("item-maotai");
  await expect(warehouse).toHaveValue("一号仓");
  await expect(batch).toHaveValue("期初-260827");
});

test("exact legacy approvals show a locked standard item instead of an editable selector", async ({ page }) => {
  const lockedApproval = {
    ...intentApproval,
    id: "approval-locked",
    lines: [{ ...intentApproval.lines[0], id: "line-locked", itemId: "item-maotai", legacyResolutionStatus: "EXACT_LOCKED" }],
  };
  const lockedOptions = {
    ...initialOptions,
    approvalId: "approval-locked",
    lines: [{ approvalLineId: "line-locked", items: initialOptions.lines[0].items }],
  };
  await mockPending(page, [lockedApproval]);
  await page.route(apiUrl("/admin/outbound/approval-locked/options"), (route) => route.fulfill({ json: lockedOptions }));
  await loginAs(page, "/admin/outbound", "ADMIN");
  await page.getByRole("button", { name: "办理出库" }).click();
  const line = page.getByTestId("outbound-decision-line-line-locked");
  await expect(line).toContainText("标准物品（旧审批锁定）");
  await expect(line).toContainText("BJ0002 飞天茅台 / 瓶");
  await expect(line.getByLabel("标准物品")).toHaveCount(0);
});
