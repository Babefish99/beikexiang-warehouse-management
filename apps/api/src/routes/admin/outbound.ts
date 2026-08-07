import type { FastifyInstance } from "fastify";

import type { OutboundService } from "../../application/inventory/outbound-service.js";

export function registerOutboundRoutes(app: FastifyInstance, dependencies: { outboundService: OutboundService }): void {
  app.get("/admin/outbound/pending", async () => dependencies.outboundService.listPending());
  app.get<{ Params: { approvalId: string } }>("/admin/outbound/:approvalId/options", async (request) => dependencies.outboundService.listOptions(request.params.approvalId));
  app.post("/admin/outbound/confirm", async (request) => dependencies.outboundService.confirm(request.body as { approvalId: string; allocations: Array<{ approvalLineId: string; warehouseId: string; batchId: string; quantity: string }>; reason?: string }));
  app.post<{ Params: { approvalId: string } }>("/admin/outbound/:approvalId/cancel", async (request) => dependencies.outboundService.cancelBeforeIssue({ approvalId: request.params.approvalId, reason: (request.body as { reason?: string } | undefined)?.reason ?? "" }));
}
