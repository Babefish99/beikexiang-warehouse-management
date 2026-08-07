import { test, expect } from "@playwright/test";

test("period close remains administrator-only", async ({ request }) => {
  const response = await request.post("http://localhost:3001/admin/period-close", { data: {} });

  expect(response.status()).toBe(401);
});
