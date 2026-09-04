import type { FastifyInstance } from "fastify";

import { BusinessRuleError } from "../../application/errors/business-rule-error.js";
import type { ApprovalSyncQueryService } from "../../application/wecom/approval-sync-query-service.js";

interface ApprovalSyncFailureRouteDependencies {
  queryService: Pick<ApprovalSyncQueryService, "listRecentFailures">;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new BusinessRuleError("limit must be a positive integer", 400);
  const limit = Number(value);
  if (!Number.isSafeInteger(limit)) throw new BusinessRuleError("limit must be a positive integer", 400);
  return limit;
}

export function registerApprovalSyncFailureRoutes(
  app: FastifyInstance,
  dependencies: ApprovalSyncFailureRouteDependencies,
): void {
  app.get<{ Querystring: { limit?: string } }>("/admin/approvals/sync-failures", async (request) => {
    const limit = parseLimit(request.query.limit);
    return limit === undefined
      ? dependencies.queryService.listRecentFailures()
      : dependencies.queryService.listRecentFailures(limit);
  });
}
