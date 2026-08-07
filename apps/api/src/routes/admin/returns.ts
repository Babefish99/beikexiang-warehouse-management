import type { FastifyInstance } from "fastify";
import type { ReturnService } from "../../application/inventory/return-service.js";
import { withAdminMutationAudit } from "./admin-mutation-route.js";

export function registerReturnRoutes(app: FastifyInstance, dependencies: { returnService: ReturnService }): void {
  app.get("/admin/returns/options", async () => dependencies.returnService.listOptions());
  app.post(
    "/admin/returns",
    withAdminMutationAudit(app, {
      action: "RETURN_CREATED",
      entityType: "RETURN_ORDER",
      getEntityId: ({ result, request }) => result?.returnId ?? (request.body as { outboundAllocationId?: string }).outboundAllocationId ?? request.id,
    }, async (request, reply) => {
      reply.code(201);
      return dependencies.returnService.create(request.body as { outboundAllocationId: string; quantity: string; reason: string });
    }),
  );
}
