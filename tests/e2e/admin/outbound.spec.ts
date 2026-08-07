import { test, expect } from "@playwright/test";

test("outbound execution APIs remain administrator-only", async ({ request }) => {
  const [pending, confirm] = await Promise.all([
    request.get("http://localhost:3001/admin/outbound/pending"),
    request.post("http://localhost:3001/admin/outbound/confirm", { data: {} }),
  ]);

  expect(pending.status()).toBe(401);
  expect(confirm.status()).toBe(401);
});
