import { test, expect } from "@playwright/test";
import { apiUrl } from "../mobile/mobile-test-helpers";

test("inbound and opening-stock APIs remain administrator-only", async ({ request }) => {
  const [inbound, opening] = await Promise.all([
    request.post(apiUrl("/admin/inbound"), { data: {} }),
    request.post(apiUrl("/admin/opening-stock"), { data: {} }),
  ]);

  expect(inbound.status()).toBe(401);
  expect(opening.status()).toBe(401);
});
