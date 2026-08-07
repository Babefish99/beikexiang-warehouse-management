import { test, expect } from "@playwright/test";

test("inbound and opening-stock APIs remain administrator-only", async ({ request }) => {
  const [inbound, opening] = await Promise.all([
    request.post("http://localhost:3001/admin/inbound", { data: {} }),
    request.post("http://localhost:3001/admin/opening-stock", { data: {} }),
  ]);

  expect(inbound.status()).toBe(401);
  expect(opening.status()).toBe(401);
});
