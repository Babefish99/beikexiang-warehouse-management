import { expect, test } from "@playwright/test";
import { apiUrl } from "../mobile/mobile-test-helpers";

test.describe("master data administration", () => {
  test("item and warehouse APIs remain administrator-only", async ({ request }) => {
    const [itemList, itemCreate, itemUpdate, itemDeactivate, itemActivate, warehouseList, warehouseUpdate] = await Promise.all([
      request.get(apiUrl("/admin/items")),
      request.post(apiUrl("/admin/items"), { data: {} }),
      request.patch(apiUrl("/admin/items/item-1"), { data: {} }),
      request.post(apiUrl("/admin/items/item-1/deactivate")),
      request.post(apiUrl("/admin/items/item-1/activate")),
      request.get(apiUrl("/admin/warehouses")),
      request.patch(apiUrl("/admin/warehouses/warehouse-1"), { data: {} }),
    ]);

    expect(itemList.status()).toBe(401);
    expect(itemCreate.status()).toBe(401);
    expect(itemUpdate.status()).toBe(401);
    expect(itemDeactivate.status()).toBe(401);
    expect(itemActivate.status()).toBe(401);
    expect(warehouseList.status()).toBe(401);
    expect(warehouseUpdate.status()).toBe(401);
  });

  test("uses consistent item action labels and reactivates an inactive item", async ({ page }) => {
    let items = [
      { id: "item-1", code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea", isActive: false },
    ];

    await page.route(apiUrl("/admin/items?includeInactive=true"), async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(items) });
    });
    await page.route(apiUrl("/admin/items/item-1/activate"), async (route) => {
      items = items.map((item) => ({ ...item, isActive: true }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(items[0]) });
    });

    await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fitems"));

    const row = page.locator("tbody tr").first();
    await expect(row.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "启用", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "停用", exact: true })).toHaveCount(0);

    await row.getByRole("button", { name: "启用", exact: true }).click();
    await expect(row.getByRole("button", { name: "停用", exact: true })).toBeVisible();
    const success = page.locator('.success-notice[role="status"]');
    await expect(success).toHaveText("物品已启用");
    await expect(success).toHaveCSS("font-size", "13px");
  });

  test("item page opens the edit modal and preserves edit input when the API rejects an immutable code change", async ({ page }) => {
    let items = [
      { id: "item-1", code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea", weComOptionKey: "opt-tea", minimumStock: "3", isActive: true },
    ];

    await page.route(apiUrl("/admin/items?includeInactive=true"), async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(items) });
    });
    await page.route(apiUrl("/admin/items"), async (route) => {
      const payload = JSON.parse(route.request().postData() ?? "{}") as Record<string, string>;
      const created = { id: "item-2", isActive: true, ...payload };
      items = [...items, created as (typeof items)[number]];
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
    });
    await page.route(apiUrl("/admin/items/item-1"), async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "item code cannot change after ledger activity" }),
      });
    });

    await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fitems"));
    await expect(page.getByLabel("物品搜索")).toHaveAttribute("placeholder", "搜索编码、名称或选项标识");

    const initialRow = page.locator("tbody tr").first();
    await expect(initialRow.getByText("Tea leaves", { exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "企业微信选项 key", exact: true })).toHaveCount(0);
    await expect(initialRow.getByText("opt-tea", { exact: true })).toHaveCount(0);
    await page.getByLabel("物品搜索").fill("opt-tea");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByLabel("物品搜索").fill("");

    await expect(page.locator(".master-data-form-panel")).toHaveCount(0);
    await page.getByRole("button", { name: "新增物品", exact: true }).click();
    const createDialog = page.getByRole("dialog", { name: "新增物品" });
    await expect(createDialog).toBeVisible();
    await expect(createDialog.locator(".modal-dialog__header small")).toHaveCSS("font-size", "13px");
    const form = createDialog.locator("form");
    await form.getByLabel("编码").fill("TEA-0002");
    await form.getByLabel("分类前缀").fill("TEA");
    await form.getByLabel("名称").fill("Green tea");
    await form.getByLabel("规格").fill("Spring");
    await form.getByLabel("单位").fill("bag");
    await form.getByLabel("分类", { exact: true }).fill("cat-green");
    await form.getByLabel("企业微信选项标识").fill("opt-green");
    await form.getByLabel("最低库存").fill("5");
    await form.getByRole("button", { name: "新增物品" }).click();

    await expect(page.locator("tbody").getByText("Green tea", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "编辑", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "编辑物品" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("分类前缀", { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel("分类", { exact: true })).toHaveCount(0);
    await expect(page.locator(".master-data-form-panel")).toHaveCount(0);
    const editForm = dialog.locator("form");
    await expect(editForm.getByLabel("企业微信选项标识")).toHaveValue("opt-tea");
    await editForm.getByLabel("编码").fill("TEA-0099");
    await editForm.getByLabel("名称").fill("Tea leaves premium");
    await editForm.getByRole("button", { name: "保存修改" }).click();

    await expect(page.getByText("item code cannot change after ledger activity")).toBeVisible();
    await expect(editForm.getByLabel("编码")).toHaveValue("TEA-0099");
    await expect(editForm.getByLabel("名称")).toHaveValue("Tea leaves premium");
  });

  test("item create modal manages focus and preserves input when the API rejects the request", async ({ page }) => {
    await page.route(apiUrl("/admin/items?includeInactive=true"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "item-1", code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea", isActive: true }]),
      });
    });
    await page.route(apiUrl("/admin/items"), async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "item already exists" }),
      });
    });

    await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fitems"));
    const trigger = page.getByRole("button", { name: "新增物品", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "新增物品" });
    const form = dialog.locator("form");

    await expect(form.getByLabel("编码")).toBeFocused();
    await form.getByLabel("编码").fill("TEA-0002");
    await form.getByLabel("名称").fill("Green tea");
    await form.getByLabel("单位").fill("bag");
    await form.getByLabel("分类", { exact: true }).fill("cat-green");
    await dialog.getByRole("button", { name: "新增物品", exact: true }).click();

    await expect(dialog.getByRole("alert")).toHaveText("item already exists");
    await expect(form.getByLabel("编码")).toHaveValue("TEA-0002");
    await expect(form.getByLabel("名称")).toHaveValue("Green tea");

    await form.getByLabel("编码").focus();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "关闭新增物品", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "新增物品", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "关闭新增物品", exact: true })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("warehouse page updates supported maintenance fields for the fixed warehouse set", async ({ page }) => {
    let warehouses = [
      { id: "warehouse-1", code: "WH-01", name: "Placeholder one", isActive: true, isPlaceholder: true },
      { id: "warehouse-2", code: "WH-02", name: "Warehouse two", isActive: true, isPlaceholder: false },
      { id: "warehouse-3", code: "WH-03", name: "Warehouse three", isActive: false, isPlaceholder: false },
    ];

    await page.route(apiUrl("/admin/warehouses?includeInactive=true"), async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(warehouses) });
    });
    await page.route(apiUrl("/admin/warehouses/warehouse-1"), async (route) => {
      const payload = JSON.parse(route.request().postData() ?? "{}") as { name: string; isActive: boolean };
      warehouses = warehouses.map((warehouse) => warehouse.id === "warehouse-1" ? { ...warehouse, ...payload, isPlaceholder: false } : warehouse);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(warehouses[0]) });
    });

    await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fwarehouses"));

    await page.getByRole("button", { name: "编辑 WH-01" }).click();
    const form = page.locator("form").first();
    await form.getByLabel("仓库名称").fill("Main warehouse");
    await form.getByLabel("停用").check();
    await form.getByRole("button", { name: "保存仓库" }).click();

    await expect(page.getByText("Main warehouse")).toBeVisible();
    await expect(page.getByText("停用").first()).toBeVisible();
  });

  test("inbound form loads warehouse and item selectors from standard data and preserves input on API errors", async ({ page }) => {
    await page.route(apiUrl("/admin/warehouses"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "warehouse-1", code: "WH-01", name: "Main warehouse", isActive: true }]),
      });
    });
    await page.route(apiUrl("/admin/items"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "item-1", code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea", isActive: true }]),
      });
    });
    await page.route(apiUrl("/admin/inbound"), async (route) => {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "inbound rejected by server" }) });
    });

    await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Finbound"));

    const form = page.locator("form");
    await expect(form.locator("select").nth(0)).toContainText("WH-01 · Main warehouse");
    await expect(form.locator("select").nth(1)).toContainText("TEA-0001 · Tea leaves");
    const batchPreview = form.getByLabel("批次号（系统生成）");
    await expect(batchPreview).toHaveAttribute("readonly", "");
    await form.getByLabel("采购日期 *").fill("2026-08-14");
    await expect(batchPreview).toHaveValue("20260814-001");
    await form.locator("select").nth(0).selectOption("warehouse-1");
    await form.locator("select").nth(1).selectOption("item-1");
    await form.getByLabel("入库数量 *").fill("5");
    await form.getByLabel("采购单价 *").fill("0");
    await form.getByLabel("采购人").fill("Alex");
    await form.getByLabel("备注").fill("赠品入库");
    await form.getByRole("button", { name: "保存入库" }).click();
    const inboundRequest = page.waitForRequest(apiUrl("/admin/inbound"));
    await page.getByRole("dialog", { name: "确认入库" }).getByRole("button", { name: "确认入库", exact: true }).click();
    expect((await inboundRequest).postDataJSON()).not.toHaveProperty("batchNo");

    await expect(page.getByText("inbound rejected by server")).toBeVisible();
    await expect(form.locator("select").nth(0)).toHaveValue("warehouse-1");
    await expect(form.locator("select").nth(1)).toHaveValue("item-1");
    await expect(batchPreview).toHaveValue("20260814-001");
    await expect(form.getByLabel("采购单价 *")).toHaveValue("0");
    await expect(form.getByLabel("采购人")).toHaveValue("Alex");
  });

});
