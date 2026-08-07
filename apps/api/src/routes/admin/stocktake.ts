import type { FastifyInstance } from "fastify";
import type { StocktakeService } from "../../application/inventory/stocktake-service.js";
import { withAdminMutationAudit } from "./admin-mutation-route.js";

export function registerStocktakeRoutes(app: FastifyInstance, dependencies: { stocktakeService: StocktakeService }): void {
  app.get("/admin/stocktake/options", async () => dependencies.stocktakeService.listOptions());
  app.post(
    "/admin/stocktake",
    withAdminMutationAudit(app, {
      action: "STOCKTAKE_RECORDED",
      entityType: "STOCKTAKE",
      getEntityId: ({ result, request }) => result?.stocktakeId ?? request.id,
    }, async (request, reply) => {
      reply.code(201);
      return dependencies.stocktakeService.record(request.body as Parameters<StocktakeService["record"]>[0]);
    }),
  );
}
