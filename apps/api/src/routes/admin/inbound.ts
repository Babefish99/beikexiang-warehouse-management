import type { FastifyInstance } from "fastify";

import type { InboundInput, InboundService } from "../../application/inventory/inbound-service.js";

export function registerInboundRoutes(app: FastifyInstance, dependencies: { inboundService: InboundService }): void {
  app.post<{ Body: InboundInput }>("/admin/inbound", async (request, reply) => reply.code(201).send(await dependencies.inboundService.create(request.body)));
}
