import type { FastifyInstance } from "fastify";

import type { OutboundService } from "../../application/inventory/outbound-service.js";
import { withAdminBusinessErrorResponse, withAdminMutationAudit } from "./admin-mutation-route.js";

export function registerOutboundRoutes(app: FastifyInstance, dependencies: { outboundService: OutboundService }): void {
  app.get("/admin/outbound/pending", async () => dependencies.outboundService.listPending());
  app.get<{ Params: { approvalId: string } }>(
    "/admin/outbound/:approvalId/options",
    withAdminBusinessErrorResponse(async (request) => dependencies.outboundService.listOptions(request.params.approvalId)),
  );
  app.post(
    "/admin/outbound/confirm",
    withAdminMutationAudit(app, {
      action: "OUTBOUND_CONFIRMED",
      entityType: "OUTBOUND_ORDER",
      getEntityId: ({ result, request }) => result?.id ?? (request.body as { approvalId?: string }).approvalId ?? request.id,
    }, async (request) => dependencies.outboundService.confirm(request.body as { approvalId: string; allocations: Array<{ approvalLineId: string; warehouseId: string; batchId: string; quantity: string }>; reason?: string })),
  );
  app.post<{ Params: { approvalId: string } }>(
    "/admin/outbound/:approvalId/cancel",
    withAdminMutationAudit(app, {
      action: "OUTBOUND_CANCELLED",
      entityType: "APPROVAL",
      getEntityId: ({ request }) => request.params.approvalId,
    }, async (request) => dependencies.outboundService.cancelBeforeIssue({ approvalId: request.params.approvalId, reason: (request.body as { reason?: string } | undefined)?.reason ?? "" })),
  );
}
