import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerApprovalResyncRoute } from "../../../apps/api/src/routes/admin/approvals-resync.js";
import { ApprovalSyncService, InMemoryApprovalSyncStore } from "../../../apps/api/src/application/wecom/approval-sync-service.js";

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

  it("rejects a manual re-synchronization whose fetched detail uses another template before it is parsed or saved", async () => {
    const app = Fastify();
    const parser = { parse: vi.fn() };
    const store = new InMemoryApprovalSyncStore();
    const syncService = new ApprovalSyncService({
      gateway: {
        fetchDetail: vi.fn().mockResolvedValue({
          sp_no: "202607230021",
          template_id: "tpl-unapproved",
          sp_status: 2,
          apply_time: 1784773140,
          applyer: { userid: "wx-1", name: "申请人" },
          contents: [],
        }),
      },
      parser,
      store,
      approvalTemplateId: "tpl-approved-requisition",
    });
    registerApprovalResyncRoute(app, { syncService });

    const response = await app.inject({ method: "POST", url: "/admin/approvals/202607230021/resync" });

    expect(response.statusCode).toBe(500);
    expect(parser.parse).not.toHaveBeenCalled();
    expect(store.records()).toEqual([]);
    expect(store.attempts()).toMatchObject([{ status: "FAILED" }]);
  });
});
