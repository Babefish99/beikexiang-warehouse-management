import { test, expect } from "@playwright/test";

test.describe("master data administration", () => {
  test("item and warehouse APIs remain administrator-only", async ({ request }) => {
    const [items, warehouses] = await Promise.all([
      request.get("http://localhost:3001/admin/items"),
      request.get("http://localhost:3001/admin/warehouses"),
    ]);

    expect(items.status()).toBe(401);
    expect(warehouses.status()).toBe(401);
  });
});
