import type { FastifyInstance } from "fastify";

import { BusinessRuleError } from "../../application/errors/business-rule-error.js";
import type { OutboundService } from "../../application/inventory/outbound-service.js";
import type { OutboundDecisionInput } from "../../application/inventory/outbound-allocator.js";
import { withAdminBusinessErrorResponse, withAdminMutationAudit } from "./admin-mutation-route.js";
import { getAdminRequestActor } from "./admin-request-context.js";

interface ConfirmOutboundBody {
  approvalId: string;
  decisions: OutboundDecisionInput[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BusinessRuleError(`${path} must be a non-empty string`, 400);
  }
  return value;
}

function parseAllocation(value: unknown, path: string): OutboundDecisionInput["allocations"][number] {
  if (!isRecord(value)) throw new BusinessRuleError(`${path} must be an object`, 400);
  return {
    warehouseId: requiredString(value.warehouseId, `${path}.warehouseId`),
    batchId: requiredString(value.batchId, `${path}.batchId`),
    quantity: requiredString(value.quantity, `${path}.quantity`),
  };
}

function parseDecision(value: unknown, index: number): OutboundDecisionInput {
  const path = `decisions[${index}]`;
  if (!isRecord(value)) throw new BusinessRuleError(`${path} must be an object`, 400);
  if (!Array.isArray(value.allocations)) {
    throw new BusinessRuleError(`${path}.allocations must be an array`, 400);
  }
  if (value.selectedItemId !== undefined && (typeof value.selectedItemId !== "string" || !value.selectedItemId.trim())) {
    throw new BusinessRuleError(`${path}.selectedItemId must be a non-empty string`, 400);
  }
  if (value.varianceReason !== undefined && typeof value.varianceReason !== "string") {
    throw new BusinessRuleError(`${path}.varianceReason must be a string`, 400);
  }
  return {
    approvalLineId: requiredString(value.approvalLineId, `${path}.approvalLineId`),
    ...(value.selectedItemId === undefined ? {} : { selectedItemId: value.selectedItemId }),
    allocations: value.allocations.map((allocation, allocationIndex) => parseAllocation(allocation, `${path}.allocations[${allocationIndex}]`)),
    ...(value.varianceReason === undefined ? {} : { varianceReason: value.varianceReason }),
  };
}

function parseConfirmOutboundBody(value: unknown): ConfirmOutboundBody {
  if (!isRecord(value)) throw new BusinessRuleError("confirmation request is required", 400);
  if (!Array.isArray(value.decisions)) throw new BusinessRuleError("decisions are required", 400);
  return {
    approvalId: requiredString(value.approvalId, "approvalId"),
    decisions: value.decisions.map(parseDecision),
  };
}

function auditString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function sanitizeConfirmationRequest(value: unknown): { approvalId?: string; decisions: unknown[] } {
  if (!value || typeof value !== "object") return { decisions: [] };
  const body = value as { approvalId?: unknown; decisions?: unknown };
  return {
    ...(auditString(body.approvalId) === undefined ? {} : { approvalId: auditString(body.approvalId) }),
    decisions: Array.isArray(body.decisions)
      ? body.decisions.map((entry) => {
          if (!entry || typeof entry !== "object") return {};
          const decision = entry as Record<string, unknown>;
          return {
            ...(auditString(decision.approvalLineId) === undefined ? {} : { approvalLineId: auditString(decision.approvalLineId) }),
            ...(auditString(decision.selectedItemId) === undefined ? {} : { selectedItemId: auditString(decision.selectedItemId) }),
            allocations: Array.isArray(decision.allocations)
              ? decision.allocations.map((entry) => {
                  if (!entry || typeof entry !== "object") return {};
                  const allocation = entry as Record<string, unknown>;
                  return {
                    ...(auditString(allocation.warehouseId) === undefined ? {} : { warehouseId: auditString(allocation.warehouseId) }),
                    ...(auditString(allocation.batchId) === undefined ? {} : { batchId: auditString(allocation.batchId) }),
                    ...(auditString(allocation.quantity) === undefined ? {} : { quantity: auditString(allocation.quantity) }),
                  };
                })
              : [],
            ...(auditString(decision.varianceReason) === undefined ? {} : { varianceReason: auditString(decision.varianceReason) }),
          };
        })
      : [],
  };
}

function sanitizeConfirmationResult(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  const sanitized: Record<string, string> = {};
  for (const key of ["id", "approvalId", "status", "actualQuantity", "amount", "reason"] as const) {
    const field = auditString(result[key]);
    if (field !== undefined) sanitized[key] = field;
  }
  return sanitized;
}

export function registerOutboundRoutes(app: FastifyInstance, dependencies: { outboundService: OutboundService }): void {
  app.get("/admin/outbound/pending", async () => dependencies.outboundService.listPending());
  app.get<{ Params: { approvalId: string } }>(
    "/admin/outbound/:approvalId/options",
    withAdminBusinessErrorResponse(async (request) => dependencies.outboundService.listOptions(request.params.approvalId)),
  );
  app.post(
    "/admin/outbound/confirm",
    withAdminMutationAudit(app, {
      action: "OUTBOUND_CONFIRMED",
      entityType: "OUTBOUND_ORDER",
      getEntityId: ({ result, request }) => sanitizeConfirmationResult(result)?.id
        ?? sanitizeConfirmationRequest(request.body).approvalId
        ?? request.id,
      getAfterData: ({ request, result }) => ({
        request: sanitizeConfirmationRequest(request.body),
        ...(sanitizeConfirmationResult(result) ? { result: sanitizeConfirmationResult(result) } : {}),
      }),
    }, async (request, reply) => {
      const actor = getAdminRequestActor(request);
      if (!actor) return reply.code(401).send({ error: "unauthorized" });
      const body = parseConfirmOutboundBody(request.body);
      return dependencies.outboundService.confirm({
        approvalId: body.approvalId,
        operatorId: actor.id,
        decisions: body.decisions,
      });
    }),
  );
  app.post<{ Params: { approvalId: string } }>(
    "/admin/outbound/:approvalId/cancel",
    withAdminMutationAudit(app, {
      action: "OUTBOUND_CANCELLED",
      entityType: "APPROVAL",
      getEntityId: ({ request }) => request.params.approvalId,
    }, async (request) => dependencies.outboundService.cancelBeforeIssue({ approvalId: request.params.approvalId, reason: (request.body as { reason?: string } | undefined)?.reason ?? "" })),
  );
}
