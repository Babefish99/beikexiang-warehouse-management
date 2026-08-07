import type { FastifyInstance } from "fastify";
import type { TransferService } from "../../application/inventory/transfer-service.js";
import { withAdminMutationAudit } from "./admin-mutation-route.js";

export function registerTransferRoutes(app: FastifyInstance, dependencies: { transferService: TransferService }): void {
  app.get("/admin/transfers/options", async () => dependencies.transferService.listOptions());
  app.post(
    "/admin/transfers",
    withAdminMutationAudit(app, {
      action: "TRANSFER_COMPLETED",
      entityType: "TRANSFER_ORDER",
      getEntityId: ({ result, request }) => result?.transferId ?? request.id,
    }, async (request, reply) => {
      reply.code(201);
      return dependencies.transferService.complete(request.body as { itemId: string; batchId: string; sourceWarehouseId: string; destinationWarehouseId: string; quantity: string; reason: string });
    }),
  );
}
