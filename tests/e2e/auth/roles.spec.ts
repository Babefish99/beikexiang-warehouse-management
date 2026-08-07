import { test, expect } from "@playwright/test";

test.describe("authentication boundaries", () => {
  test("unauthenticated requests cannot enter admin routes", async ({ request }) => {
    const response = await request.get("http://localhost:3001/admin/ping");
    expect(response.status()).toBe(401);
  });

  test("unauthenticated users cannot invoke administrator approval resynchronization", async ({ request }) => {
    const response = await request.post("http://localhost:3001/admin/approvals/202607230021/resync");
    expect(response.status()).toBe(401);
  });

  test("unauthenticated browser users see the Enterprise WeChat login entry", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "使用企业微信登录" })).toBeVisible();
  });
});
