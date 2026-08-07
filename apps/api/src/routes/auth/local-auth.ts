import type { FastifyInstance } from "fastify";

import { isAllowedLocalAuthHost, isLoopbackAddress, localUserForRole } from "../../application/auth/local-auth.js";
import { WeComOAuthClient } from "../../infrastructure/wecom/oauth-client.js";
import type { SessionService } from "../../application/auth/session-service.js";
import type { AuditService } from "../../infrastructure/audit/audit-service.js";

const SESSION_COOKIE = "warehouse_session";

function encodeReturnTo(returnTo: string): string {
  return Buffer.from(returnTo, "utf8").toString("base64url");
}

function buildCookie(name: string, value: string, options: ReturnType<SessionService["cookieOptions"]>): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    `Path=${options.path}`,
    `SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`,
    `Max-Age=${options.maxAge}`,
  ];

  if (options.secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function registerLocalAuthRoutes(
  app: FastifyInstance,
  dependencies: {
    enabled: boolean;
    apiBaseUrl: string;
    webBaseUrl: string;
    sessionService: Pick<SessionService, "createSession" | "cookieOptions">;
    auditService: Pick<AuditService, "record">;
  },
): void {
  const oauthClient = new WeComOAuthClient({
    corpId: "local-auth",
    agentId: "local-auth",
    secret: "local-auth",
    redirectUri: `${dependencies.webBaseUrl}/auth/local`,
  });

  app.get<{ Querystring: { returnTo?: string; role?: string } }>("/auth/local", async (request, reply) => {
    if (
      !dependencies.enabled
      || !isLoopbackAddress(request.ip)
      || !isAllowedLocalAuthHost({ hostHeader: request.headers.host, apiBaseUrl: dependencies.apiBaseUrl })
    ) {
      return reply.code(404).send({ error: "local_auth_unavailable" });
    }

    let user;
    try {
      user = localUserForRole(request.query.role);
    } catch {
      return reply.code(400).send({ error: "invalid_local_auth_role" });
    }

    const token = dependencies.sessionService.createSession(user);
    const safeReturnTo = oauthClient.decodeReturnTo(encodeReturnTo(request.query.returnTo ?? "/"));

    reply.header("set-cookie", buildCookie(SESSION_COOKIE, token, dependencies.sessionService.cookieOptions(false)));
    await dependencies.auditService.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: "LOGIN",
      entityType: "SESSION",
      entityId: user.id,
      requestId: request.id,
      occurredAt: new Date().toISOString(),
    });

    return reply.redirect(`${dependencies.webBaseUrl}${safeReturnTo}`);
  });
}
