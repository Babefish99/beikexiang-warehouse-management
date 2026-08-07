import type { FastifyInstance } from "fastify";

import type { OpeningStockService } from "../../application/inventory/opening-stock-service.js";

export function registerOpeningStockRoutes(app: FastifyInstance, dependencies: { openingStockService: OpeningStockService }): void {
  app.post("/admin/opening-stock", async (request, reply) => reply.code(201).send(await dependencies.openingStockService.create(request.body as { verifiedBy: string; rows: Array<{ warehouseId: string; itemId: string; batchNo: string; quantity: string; unitCost: string; remark?: string }> })));
}
