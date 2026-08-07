import type { FastifyInstance } from "fastify";

import type { InboundInput, InboundService } from "../../application/inventory/inbound-service.js";
import { withAdminMutationAudit } from "./admin-mutation-route.js";

export function registerInboundRoutes(app: FastifyInstance, dependencies: { inboundService: InboundService }): void {
  app.post<{ Body: InboundInput }>(
    "/admin/inbound",
    withAdminMutationAudit(app, {
      action: "INBOUND_CREATED",
      entityType: "INBOUND_ORDER",
      getEntityId: ({ result, request }) => result?.inboundId ?? request.id,
    }, async (request, reply) => {
      reply.code(201);
      return dependencies.inboundService.create(request.body);
    }),
  );
}
