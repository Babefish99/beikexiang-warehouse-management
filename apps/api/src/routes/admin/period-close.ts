import type { FastifyInstance } from "fastify";
import type { PeriodCloseService } from "../../application/periods/period-close-service.js";

export function registerPeriodCloseRoutes(app: FastifyInstance, dependencies: { periodCloseService: PeriodCloseService }): void {
  app.post("/admin/period-close", async (request) => dependencies.periodCloseService.close(request.body as Parameters<PeriodCloseService["close"]>[0]));
}
