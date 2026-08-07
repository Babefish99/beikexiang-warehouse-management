import type { FastifyInstance } from "fastify";

import type { ApprovalSyncService } from "../../application/wecom/approval-sync-service.js";

interface ResyncDependencies {
  syncService: Pick<ApprovalSyncService, "sync">;
}

export function registerApprovalResyncRoute(app: FastifyInstance, dependencies: ResyncDependencies): void {
  app.post<{ Params: { spNo: string } }>("/admin/approvals/:spNo/resync", async (request, reply) => {
    if (!/^\d{8,32}$/.test(request.params.spNo)) return reply.code(400).send({ error: "approval number is invalid" });
    return dependencies.syncService.sync(request.params.spNo);
  });
}
