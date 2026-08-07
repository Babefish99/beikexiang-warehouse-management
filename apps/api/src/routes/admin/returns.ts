import type { FastifyInstance } from "fastify";
import type { ReturnService } from "../../application/inventory/return-service.js";

export function registerReturnRoutes(app: FastifyInstance, dependencies: { returnService: ReturnService }): void {
  app.post("/admin/returns", async (request, reply) => reply.code(201).send(await dependencies.returnService.create(request.body as { outboundAllocationId: string; quantity: string; reason: string })));
}
