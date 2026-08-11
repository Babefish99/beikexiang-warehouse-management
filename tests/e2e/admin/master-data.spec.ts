import { expect, test } from "@playwright/test";

test.describe("master data administration", () => {
  test("item and warehouse APIs remain administrator-only", async ({ request }) => {
    const [itemList, itemCreate, itemUpdate, itemDeactivate, itemActivate, warehouseList, warehouseUpdate] = await Promise.all([
      request.get("http://127.0.0.1:3001/admin/items"),
      request.post("http://127.0.0.1:3001/admin/items", { data: {} }),
      request.patch("http://127.0.0.1:3001/admin/items/item-1", { data: {} }),
      request.post("http://127.0.0.1:3001/admin/items/item-1/deactivate"),
      request.post("http://127.0.0.1:3001/admin/items/item-1/activate"),
      request.get("http://127.0.0.1:3001/admin/warehouses"),
      request.patch("http://127.0.0.1:3001/admin/warehouses/warehouse-1", { data: {} }),
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

    await page.route("http://127.0.0.1:3001/admin/items?includeInactive=true", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(items) });
    });
    await page.route("http://127.0.0.1:3001/admin/items/item-1/activate", async (route) => {
      items = items.map((item) => ({ ...item, isActive: true }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(items[0]) });
    });

    await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Fitems");

    const row = page.locator("tbody tr").first();
    await expect(row.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "启用", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "停用", exact: true })).toHaveCount(0);

    await row.getByRole("button", { name: "启用", exact: true }).click();
    await expect(row.getByRole("button", { name: "停用", exact: true })).toBeVisible();
  });

  test("item page opens the edit modal and preserves edit input when the API rejects an immutable code change", async ({ page }) => {
    let items = [
      { id: "item-1", code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea", weComOptionKey: "opt-tea", minimumStock: "3", isActive: true },
    ];

    await page.route("http://127.0.0.1:3001/admin/items?includeInactive=true", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(items) });
    });
    await page.route("http://127.0.0.1:3001/admin/items", async (route) => {
      const payload = JSON.parse(route.request().postData() ?? "{}") as Record<string, string>;
      const created = { id: "item-2", isActive: true, ...payload };
      items = [...items, created as (typeof items)[number]];
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
    });
    await page.route("http://127.0.0.1:3001/admin/items/item-1", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "item code cannot change after ledger activity" }),
      });
    });

    await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Fitems");

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
    const form = createDialog.locator("form");
    await form.getByLabel("编码").fill("TEA-0002");
    await form.getByLabel("分类前缀").fill("TEA");
    await form.getByLabel("名称").fill("Green tea");
    await form.getByLabel("规格").fill("Spring");
    await form.getByLabel("单位").fill("bag");
    await form.getByLabel("分类", { exact: true }).fill("cat-green");
    await form.getByLabel("企业微信选项 key").fill("opt-green");
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
    await editForm.getByLabel("编码").fill("TEA-0099");
    await editForm.getByLabel("名称").fill("Tea leaves premium");
    await editForm.getByRole("button", { name: "保存修改" }).click();

    await expect(page.getByText("item code cannot change after ledger activity")).toBeVisible();
    await expect(editForm.getByLabel("编码")).toHaveValue("TEA-0099");
    await expect(editForm.getByLabel("名称")).toHaveValue("Tea leaves premium");
  });

  test("item create modal manages focus and preserves input when the API rejects the request", async ({ page }) => {
    await page.route("http://127.0.0.1:3001/admin/items?includeInactive=true", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "item-1", code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea", isActive: true }]),
      });
    });
    await page.route("http://127.0.0.1:3001/admin/items", async (route) => {
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

    await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Fitems");
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

    await page.route("http://127.0.0.1:3001/admin/warehouses?includeInactive=true", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(warehouses) });
    });
    await page.route("http://127.0.0.1:3001/admin/warehouses/warehouse-1", async (route) => {
      const payload = JSON.parse(route.request().postData() ?? "{}") as { name: string; isActive: boolean };
      warehouses = warehouses.map((warehouse) => warehouse.id === "warehouse-1" ? { ...warehouse, ...payload, isPlaceholder: false } : warehouse);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(warehouses[0]) });
    });

    await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Fwarehouses");

    await page.getByRole("button", { name: "编辑 WH-01" }).click();
    const form = page.locator("form").first();
    await form.getByLabel("仓库名称").fill("Main warehouse");
    await form.getByLabel("停用").check();
    await form.getByRole("button", { name: "保存仓库" }).click();

    await expect(page.getByText("Main warehouse")).toBeVisible();
    await expect(page.getByText("停用").first()).toBeVisible();
  });

  test("inbound form loads warehouse and item selectors from standard data and preserves input on API errors", async ({ page }) => {
    await page.route("http://127.0.0.1:3001/admin/warehouses", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "warehouse-1", code: "WH-01", name: "Main warehouse", isActive: true }]),
      });
    });
    await page.route("http://127.0.0.1:3001/admin/items", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "item-1", code: "TEA-0001", name: "Tea leaves", specification: "Iron Goddess", unit: "box", categoryId: "cat-tea", isActive: true }]),
      });
    });
    await page.route("http://127.0.0.1:3001/admin/inbound", async (route) => {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "remark is required when unit cost is zero" }) });
    });

    await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Finbound");

    const form = page.locator("form");
    await expect(form.locator("select").nth(0)).toContainText("WH-01 · Main warehouse");
    await expect(form.locator("select").nth(1)).toContainText("TEA-0001 · Tea leaves");
    await form.locator("select").nth(0).selectOption("warehouse-1");
    await form.locator("select").nth(1).selectOption("item-1");
    await form.getByLabel("批次号 *").fill("BATCH-01");
    await form.getByLabel("入库数量 *").fill("5");
    await form.getByLabel("采购单价 *").fill("0");
    await form.getByLabel("采购人").fill("Alex");
    await form.getByRole("button", { name: "保存入库" }).click();

    await expect(page.getByText("remark is required when unit cost is zero")).toBeVisible();
    await expect(form.locator("select").nth(0)).toHaveValue("warehouse-1");
    await expect(form.locator("select").nth(1)).toHaveValue("item-1");
    await expect(form.getByLabel("批次号 *")).toHaveValue("BATCH-01");
    await expect(form.getByLabel("采购单价 *")).toHaveValue("0");
    await expect(form.getByLabel("采购人")).toHaveValue("Alex");
  });

  test("opening stock form loads warehouse and item selectors from standard data and preserves input on API errors", async ({ page }) => {
    await page.route("http://127.0.0.1:3001/admin/warehouses", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "warehouse-2", code: "WH-02", name: "Warehouse two", isActive: true }]),
      });
    });
    await page.route("http://127.0.0.1:3001/admin/items", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "item-2", code: "MAT-0001", name: "Packing tape", specification: "Wide", unit: "roll", categoryId: "cat-pack", isActive: true }]),
      });
    });
    await page.route("http://127.0.0.1:3001/admin/opening-stock", async (route) => {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "remark is required when unit cost is zero" }) });
    });

    await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Fopening-stock");

    const form = page.locator("form");
    await expect(form.locator("select").nth(0)).toContainText("WH-02 · Warehouse two");
    await expect(form.locator("select").nth(1)).toContainText("MAT-0001 · Packing tape");
    await form.getByLabel("盘点人 *").fill("Jamie");
    await form.locator("select").nth(0).selectOption("warehouse-2");
    await form.locator("select").nth(1).selectOption("item-2");
    await form.getByLabel("批次号 *").fill("OPEN-01");
    await form.getByLabel("实盘数量 *").fill("9");
    await form.getByLabel("确认单价 *").fill("0");
    await form.getByLabel("差异/实盘说明").fill("awaiting unit cost");
    await form.getByRole("button", { name: "保存期初库存" }).click();

    await expect(page.getByText("remark is required when unit cost is zero")).toBeVisible();
    await expect(form.getByLabel("盘点人 *")).toHaveValue("Jamie");
    await expect(form.locator("select").nth(0)).toHaveValue("warehouse-2");
    await expect(form.locator("select").nth(1)).toHaveValue("item-2");
    await expect(form.getByLabel("批次号 *")).toHaveValue("OPEN-01");
    await expect(form.getByLabel("确认单价 *")).toHaveValue("0");
    await expect(form.getByLabel("差异/实盘说明")).toHaveValue("awaiting unit cost");
  });
});
