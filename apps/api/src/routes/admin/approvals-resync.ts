import type { FastifyInstance } from "fastify";

import { BusinessRuleError } from "../../application/errors/business-rule-error.js";
import type { ApprovalSyncService } from "../../application/wecom/approval-sync-service.js";
import { withAdminMutationAudit } from "./admin-mutation-route.js";

interface ResyncDependencies {
  syncService: Pick<ApprovalSyncService, "sync">;
}

export function registerApprovalResyncRoute(app: FastifyInstance, dependencies: ResyncDependencies): void {
  app.post<{ Params: { spNo: string } }>(
    "/admin/approvals/:spNo/resync",
    withAdminMutationAudit(app, {
      action: "APPROVAL_RESYNC_TRIGGERED",
      entityType: "APPROVAL",
      getEntityId: ({ result, request }) => result?.approvalId ?? request.params.spNo,
    }, async (request, reply) => {
      if (!/^\d{8,32}$/.test(request.params.spNo)) throw new BusinessRuleError("approval number is invalid", 400);
      reply.code(200);
      return dependencies.syncService.sync(request.params.spNo);
    }),
  );
}
