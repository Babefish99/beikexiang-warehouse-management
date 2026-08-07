import { test, expect } from "@playwright/test";

test("report APIs require a finance or administrator session", async ({ request }) => {
  const response = await request.get("http://localhost:3001/admin/reports/summary?period=2026-08");

  expect(response.status()).toBe(401);
});
