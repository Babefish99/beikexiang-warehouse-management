import { test, expect } from "@playwright/test";

test("period close remains administrator-only", async ({ request }) => {
  const response = await request.post("http://localhost:3001/admin/period-close", { data: {} });

  expect(response.status()).toBe(401);
});

test("period close page leaves server-side checks authoritative", async ({ page }) => {
  await page.route("http://127.0.0.1:3001/admin/period-close", async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}") as { period?: { code?: string }; pendingOutboundCount?: number; unpostedAdjustmentCount?: number };
    expect(payload.period?.code).toMatch(/^\d{4}-\d{2}$/);
    expect(payload.pendingOutboundCount).toBeUndefined();
    expect(payload.unpostedAdjustmentCount).toBeUndefined();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: payload.period?.code, status: "CLOSED" }) });
  });

  await page.goto("http://127.0.0.1:3001/auth/local?returnTo=%2Fadmin%2Fperiod-close");
  await page.getByRole("button", { name: "确认结账" }).click();
  await expect(page.getByRole("status")).toContainText("本月已结账");
});
