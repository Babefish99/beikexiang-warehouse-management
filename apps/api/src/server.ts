import Fastify from "fastify";
import cors from "@fastify/cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { RolePolicy, type AuthenticatedUser } from "./application/auth/role-service.js";
import { SessionService } from "./application/auth/session-service.js";
import { ApprovalSyncService, InMemoryApprovalSyncStore } from "./application/wecom/approval-sync-service.js";
import { InMemoryItemRepository, ItemService } from "./application/items/item-service.js";
import { InMemoryWarehouseRepository, WarehouseService } from "./application/warehouses/warehouse-service.js";
import { InMemoryInventoryEntryStore, InboundService } from "./application/inventory/inbound-service.js";
import { OpeningStockService } from "./application/inventory/opening-stock-service.js";
import { InMemoryOutboundStore, OutboundService } from "./application/inventory/outbound-service.js";
import { InMemoryMovementStore, TransferService } from "./application/inventory/transfer-service.js";
import { ReturnService } from "./application/inventory/return-service.js";
import { InMemoryStocktakeStore, StocktakeService } from "./application/inventory/stocktake-service.js";
import { PeriodCloseService } from "./application/periods/period-close-service.js";
import { InventoryReportService, TransactionReportService } from "./application/reports/report-query-service.js";
import { InMemoryAuditService } from "./infrastructure/audit/audit-service.js";
import { HttpApprovalGateway } from "./infrastructure/wecom/approval-gateway.js";
import { ApprovalParser } from "./infrastructure/wecom/approval-parser.js";
import { WeComOAuthClient } from "./infrastructure/wecom/oauth-client.js";
import { WeComSignatureVerifier } from "./infrastructure/wecom/signature-verifier.js";
import { registerApprovalResyncRoute } from "./routes/admin/approvals-resync.js";
import { registerItemRoutes } from "./routes/admin/items.js";
import { registerWarehouseRoutes } from "./routes/admin/warehouses.js";
import { registerInboundRoutes } from "./routes/admin/inbound.js";
import { registerOpeningStockRoutes } from "./routes/admin/opening-stock.js";
import { registerOutboundRoutes } from "./routes/admin/outbound.js";
import { registerTransferRoutes } from "./routes/admin/transfers.js";
import { registerReturnRoutes } from "./routes/admin/returns.js";
import { registerStocktakeRoutes } from "./routes/admin/stocktake.js";
import { registerPeriodCloseRoutes } from "./routes/admin/period-close.js";
import { registerReportRoutes } from "./routes/admin/reports.js";
import { registerApprovalCallbackRoute } from "./routes/wecom/approval-callback.js";

const SESSION_COOKIE = "warehouse_session";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

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
  void app.register(cors, { origin: process.env.WEB_BASE_URL ?? "http://localhost:5174", credentials: true });
  const sessionService = new SessionService(process.env.SESSION_SECRET ?? "local-development-session-secret");
  const auditService = new InMemoryAuditService();
  const itemService = new ItemService(new InMemoryItemRepository());
  const inventoryEntryStore = new InMemoryInventoryEntryStore();
  const inboundService = new InboundService(inventoryEntryStore);
  const openingStockService = new OpeningStockService(inventoryEntryStore);
  const outboundService = new OutboundService(new InMemoryOutboundStore());
  const movementStore = new InMemoryMovementStore();
  const transferService = new TransferService(movementStore);
  const returnService = new ReturnService(movementStore);
  const stocktakeService = new StocktakeService(new InMemoryStocktakeStore());
  const periodCloseService = new PeriodCloseService();
  const inventoryReportService = new InventoryReportService(async () => []);
  const transactionReportService = new TransactionReportService(async () => []);
  const warehouseService = new WarehouseService(new InMemoryWarehouseRepository([
    { id: "warehouse-1", code: "WH-01", name: "待配置仓库一", isActive: true, isPlaceholder: true },
    { id: "warehouse-2", code: "WH-02", name: "待配置仓库二", isActive: true, isPlaceholder: true },
    { id: "warehouse-3", code: "WH-03", name: "待配置仓库三", isActive: true, isPlaceholder: true },
  ]));
  const oauthClient = new WeComOAuthClient({
    corpId: process.env.WE_COM_CORP_ID ?? "",
    agentId: process.env.WE_COM_AGENT_ID ?? "",
    secret: process.env.WE_COM_SECRET ?? "",
    redirectUri: `${process.env.API_BASE_URL ?? "http://localhost:3001"}/auth/wecom/callback`,
  });
  const approvalSyncService = new ApprovalSyncService({
    gateway: new HttpApprovalGateway({ corpId: process.env.WE_COM_CORP_ID ?? "", secret: process.env.WE_COM_SECRET ?? "" }),
    parser: new ApprovalParser((optionKey) => itemService.resolveByWeComOptionKey(optionKey)),
    store: new InMemoryApprovalSyncStore(),
  });
  const signatureVerifier = new WeComSignatureVerifier({ token: process.env.WE_COM_CALLBACK_TOKEN ?? "", encodingAesKey: process.env.WE_COM_ENCODING_AES_KEY ?? "", corpId: process.env.WE_COM_CORP_ID ?? "" });

  const getSessionUser = (request: { headers: { cookie?: string } }) => sessionService.readSession(readCookie(request.headers.cookie, SESSION_COOKIE) ?? "");

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/admin")) return;
    const user = getSessionUser(request);
    const requiredPermission = request.url.startsWith("/admin/reports") ? "VIEW_REPORTS" as const : "VIEW_ADMIN" as const;
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!RolePolicy.can(user, requiredPermission)) return reply.code(403).send({ error: "forbidden" });
  });

  app.get("/health", async () => ({ status: "ok", service: "warehouse-api" }));
  app.get<{ Querystring: { returnTo?: string } }>("/auth/wecom/authorize", async (request, reply) => {
    try {
      return { authorizeUrl: oauthClient.getAuthorizeUrl(request.query.returnTo ?? "/") };
    } catch (error) {
      if (error instanceof Error && error.message === "enterprise WeChat OAuth is not configured") {
        return reply.code(503).send({ error: "wecom_not_configured", message: "Enterprise WeChat OAuth is not configured" });
      }
      throw error;
    }
  });
  app.get<{ Querystring: { code?: string; state?: string } }>("/auth/wecom/callback", async (request, reply) => {
    if (!request.query.code) return reply.code(400).send({ error: "code is required" });
    const identity = await oauthClient.exchangeCode(request.query.code);
    const user: AuthenticatedUser = { id: identity.weComUserId, weComUserId: identity.weComUserId, name: identity.name, role: roleForUser(identity.weComUserId) };
    const token = sessionService.createSession(user);
    reply.header("set-cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${sessionService.cookieOptions(false).maxAge}`);
    await auditService.record({ actorUserId: user.id, actorRole: user.role, action: "LOGIN", entityType: "SESSION", entityId: user.id, requestId: request.id, occurredAt: new Date().toISOString() });
    return reply.redirect(`${process.env.WEB_BASE_URL ?? "http://localhost:5174"}${oauthClient.decodeReturnTo(request.query.state)}`);
  });
  app.get("/auth/session", async (request, reply) => {
    const user = getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { user };
  });
  app.get("/auth/permissions", async (request, reply) => {
    const user = getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { role: user.role, canViewAdmin: RolePolicy.can(user, "VIEW_ADMIN"), canViewReports: RolePolicy.can(user, "VIEW_REPORTS") };
  });

  registerApprovalCallbackRoute(app, { verifier: signatureVerifier, syncService: approvalSyncService });
  registerApprovalResyncRoute(app, { syncService: approvalSyncService });
  registerItemRoutes(app, { itemService });
  registerWarehouseRoutes(app, { warehouseService });
  registerInboundRoutes(app, { inboundService });
  registerOpeningStockRoutes(app, { openingStockService });
  registerOutboundRoutes(app, { outboundService });
  registerTransferRoutes(app, { transferService });
  registerReturnRoutes(app, { returnService });
  registerStocktakeRoutes(app, { stocktakeService });
  registerPeriodCloseRoutes(app, { periodCloseService });
  registerReportRoutes(app, { inventoryReportService, transactionReportService });

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
