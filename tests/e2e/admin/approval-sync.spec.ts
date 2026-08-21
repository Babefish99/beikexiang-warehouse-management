import { test, expect } from "@playwright/test";
import { apiUrl } from "../mobile/mobile-test-helpers";

test.describe("approval synchronization administration", () => {
  test("manual resynchronization remains protected by administrator authentication", async ({ request }) => {
    const response = await request.post(apiUrl("/admin/approvals/202607230021/resync"));

    expect(response.status()).toBe(401);
  });
});
