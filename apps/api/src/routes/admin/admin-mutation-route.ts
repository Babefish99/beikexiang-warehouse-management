import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { classifyAdminBusinessError } from "../../application/errors/business-rule-error.js";
import type { AuditEvent } from "../../infrastructure/audit/audit-service.js";
import { getAdminRequestActor } from "./admin-request-context.js";

type AdminMutationHandler<TRequest extends FastifyRequest, TResult> = (request: TRequest, reply: FastifyReply) => Promise<TResult> | TResult;

interface AdminMutationAuditOptions<TRequest extends FastifyRequest, TResult> {
  action: string;
  entityType: string;
  getEntityId?: (context: { request: TRequest; result?: any; error?: unknown }) => string | undefined;
  getAfterData?: (context: { request: TRequest; result?: any; error?: unknown }) => unknown;
}

const SENSITIVE_FIELD_PATTERN = /(session|secret|token|cookie|password)/i;

function sanitizeAuditValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => sanitizeAuditValue(entry, seen));
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) continue;
    sanitized[key] = sanitizeAuditValue(nested, seen);
  }
  return sanitized;
}

async function recordAuditEvent<TRequest extends FastifyRequest, TResult>(
  app: FastifyInstance,
  request: TRequest,
  options: AdminMutationAuditOptions<TRequest, TResult>,
  status: AuditEvent["status"],
  result?: TResult,
  error?: unknown,
): Promise<void> {
  const actor = getAdminRequestActor(request);
  if (!actor || !app.auditService) return;

  const rawAfterData = options.getAfterData?.({ request, result, error })
    ?? (status === "SUCCEEDED" ? result ?? request.body : request.body);

  await app.auditService.record({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: options.action,
    entityType: options.entityType,
    entityId: options.getEntityId?.({ request, result, error }) ?? request.id,
    requestId: request.id,
    occurredAt: new Date().toISOString(),
    status,
    errorMessage: error instanceof Error ? error.message : undefined,
    afterData: sanitizeAuditValue(rawAfterData),
  });
}

export function withAdminMutationAudit<TRequest extends FastifyRequest, TResult>(
  app: FastifyInstance,
  options: AdminMutationAuditOptions<TRequest, TResult>,
  handler: AdminMutationHandler<TRequest, TResult>,
): AdminMutationHandler<TRequest, TResult | FastifyReply> {
  return async (request, reply) => {
    try {
      const result = await handler(request, reply);
      await recordAuditEvent(app, request, options, "SUCCEEDED", result);
      return result;
    } catch (error) {
      await recordAuditEvent(app, request, options, "FAILED", undefined, error);
      const businessError = classifyAdminBusinessError(error);
      if (businessError) {
        return reply.code(businessError.statusCode).send({ error: businessError.message });
      }
      throw error;
    }
  };
}

export function withAdminBusinessErrorResponse<TRequest extends FastifyRequest, TResult>(
  handler: AdminMutationHandler<TRequest, TResult>,
): AdminMutationHandler<TRequest, TResult | FastifyReply> {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      const businessError = classifyAdminBusinessError(error);
      if (businessError) {
        return reply.code(businessError.statusCode).send({ error: businessError.message });
      }
      throw error;
    }
  };
}
