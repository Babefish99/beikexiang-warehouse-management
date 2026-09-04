import { describe, expect, it } from "vitest";

import { ApprovalSyncQueryService } from "../../../apps/api/src/application/wecom/approval-sync-query-service.js";

describe("approval synchronization failure query", () => {
  it("publishes an allowlisted parser error without forwarding retained diagnostic fields", async () => {
    const source = {
      listRecentFailures: async () => [{
        weComSpNo: "2026090400000201",
        attemptedAt: "2026-09-04T08:00:00.000Z",
        error: "approval quantity must be a positive integer",
        payload: { Authorization: "Bearer private-token" },
      }],
    };

    await expect(new ApprovalSyncQueryService(source).listRecentFailures()).resolves.toEqual([{
      weComSpNo: "2026090400000201",
      attemptedAt: "2026-09-04T08:00:00.000Z",
      error: "审批数量必须为正整数",
    }]);
  });

  it.each([
    ["authorization bearer", "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.private.signature"],
    ["password", "upstream rejected password=hunter2"],
    ["API key", "api-key=sk-live-1234567890"],
    ["internal URL", "connect ECONNREFUSED http://10.0.0.8:5432/private"],
    ["SQL detail", "SQLSTATE 23505 duplicate key violates constraint ApprovalRequest_pkey"],
    ["unlabelled high-entropy value", "4fA9xQ2mL7vN8cR1pT6yK3dW0zB5hJ9s"],
    ["ordinary unknown error", "upstream connection reset unexpectedly"],
  ])("uses the public fallback for %s instead of exposing the persisted message", async (_case, error) => {
    const source = {
      listRecentFailures: async () => [{
        weComSpNo: "2026090400000202",
        attemptedAt: "2026-09-04T08:01:00.000Z",
        error,
      }],
    };

    await expect(new ApprovalSyncQueryService(source).listRecentFailures()).resolves.toEqual([{
      weComSpNo: "2026090400000202",
      attemptedAt: "2026-09-04T08:01:00.000Z",
      error: "审批同步失败，请检查审批内容或同步配置后重试",
    }]);
  });
});
