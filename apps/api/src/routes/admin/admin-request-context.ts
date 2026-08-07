import type { FastifyRequest } from "fastify";

import type { AuthenticatedUser } from "../../application/auth/role-service.js";
import type { AuditService } from "../../infrastructure/audit/audit-service.js";

declare module "fastify" {
  interface FastifyInstance {
    auditService?: Pick<AuditService, "record">;
  }

  interface FastifyRequest {
    adminUser?: AuthenticatedUser;
  }
}

export function getAdminRequestActor(request: FastifyRequest): AuthenticatedUser | undefined {
  return request.adminUser;
}
