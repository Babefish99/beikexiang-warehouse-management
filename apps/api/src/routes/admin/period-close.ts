import type { FastifyInstance } from "fastify";
import type { PeriodCloseService } from "../../application/periods/period-close-service.js";
import { withAdminMutationAudit } from "./admin-mutation-route.js";

export function registerPeriodCloseRoutes(app: FastifyInstance, dependencies: { periodCloseService: PeriodCloseService }): void {
  app.post(
    "/admin/period-close",
    withAdminMutationAudit(app, {
      action: "PERIOD_CLOSED",
      entityType: "ACCOUNTING_PERIOD",
      getEntityId: ({ result, request }) => result?.code ?? (request.body as { period?: { code?: string } }).period?.code ?? request.id,
    }, async (request) => dependencies.periodCloseService.close(request.body as Parameters<PeriodCloseService["close"]>[0])),
  );
}
