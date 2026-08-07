import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerApprovalResyncRoute } from "../../../apps/api/src/routes/admin/approvals-resync.js";

describe("administrator approval resynchronization route", () => {
  it("validates the approval number and returns the synchronization result", async () => {
    const app = Fastify();
    const syncService = { sync: vi.fn().mockResolvedValue({ approvalId: "approval-1", created: true, status: "PENDING_OUTBOUND" }) };
    registerApprovalResyncRoute(app, { syncService });

    const response = await app.inject({ method: "POST", url: "/admin/approvals/202607230021/resync" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ approvalId: "approval-1", created: true, status: "PENDING_OUTBOUND" });
    expect(syncService.sync).toHaveBeenCalledWith("202607230021");
  });

  it("rejects malformed approval numbers without calling the gateway", async () => {
    const app = Fastify();
    const syncService = { sync: vi.fn() };
    registerApprovalResyncRoute(app, { syncService });

    const response = await app.inject({ method: "POST", url: "/admin/approvals/not-valid/resync" });

    expect(response.statusCode).toBe(400);
    expect(syncService.sync).not.toHaveBeenCalled();
  });
});
