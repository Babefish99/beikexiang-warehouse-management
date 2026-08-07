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

  test("local development login reaches the admin dashboard", async ({ page }) => {
    await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2F");
    await expect(page.getByRole("heading", { name: "库存总览" })).toBeVisible();
  });

  test("finance local login only reaches the report center", async ({ page }) => {
    await page.goto("http://127.0.0.1:3001/auth/local?role=FINANCE&returnTo=%2Fadmin%2Freports");
    await expect(page.getByRole("heading", { name: "报表中心" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "库存总览" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "导出 Excel 兼容报表" })).toBeVisible();
  });

  test("applicant local login stays out of the admin backend", async ({ page }) => {
    await page.goto("http://127.0.0.1:3001/auth/local?role=APPLICANT&returnTo=%2Fadmin%2Fitems");
    await expect(page.getByRole("heading", { name: "暂无后台权限" })).toBeVisible();
    await expect(page.getByText("当前企业微信账号只能发起和查看领用申请。")).toBeVisible();
    await expect(page.getByRole("heading", { name: "库存总览" })).toHaveCount(0);
  });
});
