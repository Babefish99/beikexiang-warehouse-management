import type { FastifyInstance } from "fastify";
import type { StocktakeService } from "../../application/inventory/stocktake-service.js";

export function registerStocktakeRoutes(app: FastifyInstance, dependencies: { stocktakeService: StocktakeService }): void {
  app.post("/admin/stocktake", async (request, reply) => reply.code(201).send(await dependencies.stocktakeService.record(request.body as Parameters<StocktakeService["record"]>[0])));
}
