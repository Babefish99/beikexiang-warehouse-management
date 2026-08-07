import Fastify from "fastify";
import { RolePolicy, type AuthenticatedUser } from "./application/auth/role-service.js";
import { SessionService } from "./application/auth/session-service.js";
import { WeComOAuthClient } from "./infrastructure/wecom/oauth-client.js";

const SESSION_COOKIE = "warehouse_session";

function roleForUser(weComUserId: string): AuthenticatedUser["role"] {
  const adminIds = new Set((process.env.WE_COM_ADMIN_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const financeIds = new Set((process.env.WE_COM_FINANCE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (adminIds.has(weComUserId)) return "ADMIN";
  if (financeIds.has(weComUserId)) return "FINANCE";
  return "APPLICANT";
}

function readCookie(header: string | undefined, name: string): string | null {
  const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : null;
}

export function buildServer() {
  const app = Fastify({ logger: true });
  const sessionService = new SessionService(process.env.SESSION_SECRET ?? "local-development-session-secret");
  const oauthClient = new WeComOAuthClient({
    corpId: process.env.WE_COM_CORP_ID ?? "",
    agentId: process.env.WE_COM_AGENT_ID ?? "",
    secret: process.env.WE_COM_SECRET ?? "",
    redirectUri: `${process.env.API_BASE_URL ?? "http://localhost:3001"}/auth/wecom/callback`,
  });

  app.get("/health", async () => ({ status: "ok", service: "warehouse-api" }));
  app.get<{ Querystring: { returnTo?: string } }>("/auth/wecom/authorize", async (request) => ({ authorizeUrl: oauthClient.getAuthorizeUrl(request.query.returnTo ?? "/") }));
  app.get<{ Querystring: { code?: string } }>("/auth/wecom/callback", async (request, reply) => {
    if (!request.query.code) return reply.code(400).send({ error: "code is required" });
    const identity = await oauthClient.exchangeCode(request.query.code);
    const user: AuthenticatedUser = { id: identity.weComUserId, weComUserId: identity.weComUserId, name: identity.name, role: roleForUser(identity.weComUserId) };
    const token = sessionService.createSession(user);
    reply.header("set-cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${sessionService.cookieOptions(false).maxAge}`);
    return reply.redirect(process.env.WEB_BASE_URL ?? "http://localhost:5173");
  });
  app.get("/auth/session", async (request, reply) => {
    const user = sessionService.readSession(readCookie(request.headers.cookie, SESSION_COOKIE) ?? "");
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { user };
  });
  app.get("/auth/permissions", async (request, reply) => {
    const user = sessionService.readSession(readCookie(request.headers.cookie, SESSION_COOKIE) ?? "");
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { role: user.role, canViewAdmin: RolePolicy.can(user, "VIEW_ADMIN"), canViewReports: RolePolicy.can(user, "VIEW_REPORTS") };
  });

  return app;
}

const app = buildServer();
const port = Number(process.env.API_PORT ?? 3001);

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
