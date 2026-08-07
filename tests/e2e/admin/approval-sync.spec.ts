import { test, expect } from "@playwright/test";

test.describe("approval synchronization administration", () => {
  test("manual resynchronization remains protected by administrator authentication", async ({ request }) => {
    const response = await request.post("http://localhost:3001/admin/approvals/202607230021/resync");

    expect(response.status()).toBe(401);
  });
});
