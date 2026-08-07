import type { FastifyInstance } from "fastify";
import type { TransferService } from "../../application/inventory/transfer-service.js";

export function registerTransferRoutes(app: FastifyInstance, dependencies: { transferService: TransferService }): void {
  app.post("/admin/transfers", async (request, reply) => reply.code(201).send(await dependencies.transferService.complete(request.body as { itemId: string; batchId: string; sourceWarehouseId: string; destinationWarehouseId: string; quantity: string })));
}
