import type { FastifyInstance } from "fastify";

import type { OpeningStockService } from "../../application/inventory/opening-stock-service.js";
import { withAdminMutationAudit } from "./admin-mutation-route.js";

export function registerOpeningStockRoutes(app: FastifyInstance, dependencies: { openingStockService: OpeningStockService }): void {
  app.post(
    "/admin/opening-stock",
    withAdminMutationAudit(app, {
      action: "OPENING_STOCK_CREATED",
      entityType: "OPENING_STOCK",
      getEntityId: ({ result, request }) => result?.batchIds?.join(",") || (request.body as { verifiedBy?: string }).verifiedBy || request.id,
    }, async (request, reply) => {
      reply.code(201);
      return dependencies.openingStockService.create(request.body as { verifiedBy: string; rows: Array<{ warehouseId: string; itemId: string; batchNo: string; quantity: string; unitCost: string; remark?: string }> });
    }),
  );
}
