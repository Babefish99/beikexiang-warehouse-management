import { test, expect } from "@playwright/test";
import { apiUrl } from "../mobile/mobile-test-helpers";

test.describe("authentication boundaries", () => {
  test("unauthenticated requests cannot enter admin routes", async ({ request }) => {
    const response = await request.get(apiUrl("/admin/ping"));
    expect(response.status()).toBe(401);
  });

  test("unauthenticated users cannot invoke administrator approval resynchronization", async ({ request }) => {
    const response = await request.post(apiUrl("/admin/approvals/202607230021/resync"));
    expect(response.status()).toBe(401);
  });

  test("unauthenticated browser users see the Enterprise WeChat login entry", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "使用企业微信登录" })).toBeVisible();
  });

  test("login starts with fresh browser state even after cookies from an idle login page expire", async ({ page, context }) => {
    await page.route("https://open.work.weixin.qq.com/wwopen/sso/qrConnect?*", (route) => route.fulfill({
      status: 200, contentType: "text/html", body: "<p>扫码登录测试</p>",
    }));
    await page.goto("/admin/outbound");
    const login = page.getByRole("link", { name: "使用企业微信登录" });
    await expect(login).toBeVisible();
    // Emulate the browser dropping cookies during a long idle period, without a ten-minute sleep.
    await context.clearCookies();
    await login.click();
    await expect(page).toHaveURL(/^https:\/\/open\.work\.weixin\.qq\.com\/wwopen\/sso\/qrConnect\?/);
    const state = new URL(page.url()).searchParams.get("state");
    const cookie = (await context.cookies(apiUrl("/auth/wecom/callback"))).find((entry) => entry.name === "wecom_oauth_state");
    expect(state).toBeTruthy();
    expect(cookie?.value).toBe(state);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 500);
    expect(JSON.parse(Buffer.from(state ?? "", "base64url").toString("utf8")).returnTo).toBe("/admin/outbound");
  });

  test("local development login reaches the admin dashboard", async ({ page }) => {
    await page.goto(apiUrl("/auth/local?returnTo=%2F"));
    await expect(page.getByRole("heading", { name: "库存总览" })).toBeVisible();
  });

  test("finance local login only reaches the report center", async ({ page }) => {
    await page.goto(apiUrl("/auth/local?role=FINANCE&returnTo=%2Fadmin%2Freports"));
    await expect(page.getByRole("heading", { name: "报表中心" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "库存总览" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "导出 Excel 兼容报表" })).toBeVisible();
  });

  test("applicant local login stays out of the admin backend", async ({ page }) => {
    await page.goto(apiUrl("/auth/local?role=APPLICANT&returnTo=%2Fadmin%2Fitems"));
    await expect(page.getByRole("heading", { name: "暂无后台权限" })).toBeVisible();
    await expect(page.getByText("当前企业微信账号只能发起和查看领用申请。")).toBeVisible();
    await expect(page.getByRole("heading", { name: "库存总览" })).toHaveCount(0);
  });
});
