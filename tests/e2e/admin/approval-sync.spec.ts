import { test, expect } from "@playwright/test";
import Fastify from "fastify";

import { ApprovalSyncQueryService } from "../../../apps/api/src/application/wecom/approval-sync-query-service.js";
import { InMemoryApprovalSyncStore } from "../../../apps/api/src/application/wecom/approval-sync-service.js";
import { registerApprovalSyncFailureRoutes } from "../../../apps/api/src/routes/admin/approval-sync-failures.js";
import { apiUrl } from "../mobile/mobile-test-helpers";

test.describe("approval synchronization administration", () => {
  test("manual resynchronization remains protected by administrator authentication", async ({ request }) => {
    const response = await request.post(apiUrl("/admin/approvals/202607230021/resync"));

    expect(response.status()).toBe(401);
  });

  test("synchronization failures remain protected by administrator authentication", async ({ request }) => {
    const response = await request.get(apiUrl("/admin/approvals/sync-failures"));

    expect(response.status()).toBe(401);
  });

  test("lists recent in-memory failures without exposing retained diagnostics or credentials", async () => {
    const app = Fastify();
    const store = new InMemoryApprovalSyncStore();
    await store.recordSyncAttempt({
      weComSpNo: "2026090400000001",
      status: "FAILED",
      payload: { callback: "raw-callback", headers: { cookie: "private-cookie" } },
      error: "approval form is malformed",
    });
    await store.recordSyncAttempt({
      weComSpNo: "2026090400000002",
      status: "SUCCEEDED",
      payload: { access_token: "private-success-token" },
    });
    await store.recordSyncAttempt({
      weComSpNo: "2026090400000003",
      status: "FAILED",
      payload: { EncodingAESKey: "private-aes-key", Secret: "private-secret" },
      error: "callback headers contained access_token=private-error-token",
    });
    registerApprovalSyncFailureRoutes(app, {
      queryService: new ApprovalSyncQueryService(store),
    });

    try {
      const response = await app.inject({ method: "GET", url: "/admin/approvals/sync-failures?limit=2" });
      const failures = response.json();

      expect(response.statusCode).toBe(200);
      expect(failures).toEqual([
        {
          weComSpNo: "2026090400000003",
          attemptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          error: "approval synchronization failed",
        },
        {
          weComSpNo: "2026090400000001",
          attemptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          error: "approval form is malformed",
        },
      ]);
      expect(JSON.stringify(failures)).not.toMatch(/raw-callback|private-|access_token|headers|secret|token|EncodingAESKey|cookie/i);
    } finally {
      await app.close();
    }
  });
});
