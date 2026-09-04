import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { parseConfiguredWeComUserIds, RolePolicy, type AuthenticatedUser } from "./application/auth/role-service.js";
import { SessionService } from "./application/auth/session-service.js";
import { classifyAdminBusinessError } from "./application/errors/business-rule-error.js";
import { ItemService } from "./application/items/item-service.js";
import { InboundService } from "./application/inventory/inbound-service.js";
import { AlertService } from "./application/inventory/alert-service.js";
import { InventoryQueryService } from "./application/inventory/inventory-query-service.js";
import { NotificationService } from "./application/inventory/notification-service.js";
import { OpeningStockImportService } from "./application/inventory/opening-stock-import-service.js";
import { OpeningStockPreviewTokenService } from "./application/inventory/opening-stock-preview-token-service.js";
import { OutboundService } from "./application/inventory/outbound-service.js";
import { ReturnService } from "./application/inventory/return-service.js";
import { StocktakeService } from "./application/inventory/stocktake-service.js";
import { TransferService } from "./application/inventory/transfer-service.js";
import { PeriodCloseService, type AccountingPeriodStore } from "./application/periods/period-close-service.js";
import { InventoryReportService, TransactionReportService } from "./application/reports/report-query-service.js";
import { WarehouseService } from "./application/warehouses/warehouse-service.js";
import { ApprovalSyncService } from "./application/wecom/approval-sync-service.js";
import { createPersistenceAdapters, readServerConfig } from "./infrastructure/db/runtime.js";
import { ExcelOpeningStockWorkbookParser } from "./infrastructure/import/excel-opening-stock-workbook-parser.js";
import { HttpApprovalGateway } from "./infrastructure/wecom/approval-gateway.js";
import { ApprovalParser } from "./infrastructure/wecom/approval-parser.js";
import { WeComOAuthClient } from "./infrastructure/wecom/oauth-client.js";
import { WeComSignatureVerifier } from "./infrastructure/wecom/signature-verifier.js";
import { registerApprovalResyncRoute } from "./routes/admin/approvals-resync.js";
import "./routes/admin/admin-request-context.js";
import { registerInboundRoutes } from "./routes/admin/inbound.js";
import { registerItemRoutes } from "./routes/admin/items.js";
import { registerOpeningStockImportRoutes } from "./routes/admin/opening-stock-import.js";
import { registerOpeningStockRoutes } from "./routes/admin/opening-stock.js";
import { registerNotificationRoutes } from "./routes/admin/notifications.js";
import { registerOutboundRoutes } from "./routes/admin/outbound.js";
import { registerPeriodCloseRoutes } from "./routes/admin/period-close.js";
import { registerReportRoutes } from "./routes/admin/reports.js";
import { registerReturnRoutes } from "./routes/admin/returns.js";
import { registerStocktakeRoutes } from "./routes/admin/stocktake.js";
import { registerTransferRoutes } from "./routes/admin/transfers.js";
import { registerWarehouseRoutes } from "./routes/admin/warehouses.js";
import { registerLocalAuthRoutes } from "./routes/auth/local-auth.js";
import { registerApprovalCallbackRoute } from "./routes/wecom/approval-callback.js";

const SESSION_COOKIE = "warehouse_session";
const WECOM_OAUTH_STATE_COOKIE = "wecom_oauth_state";
const WECOM_OAUTH_STATE_TTL_SECONDS = 10 * 60;

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

function roleForUser(weComUserId: string): AuthenticatedUser["role"] {
  const adminIds = new Set(parseConfiguredWeComUserIds(process.env.WE_COM_ADMIN_IDS));
  const financeIds = new Set(parseConfiguredWeComUserIds(process.env.WE_COM_FINANCE_IDS));
  if (adminIds.has(weComUserId)) return "ADMIN";
  if (financeIds.has(weComUserId)) return "FINANCE";
  return "APPLICANT";
}

function readCookie(header: string | undefined, name: string): string | null {
  const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : null;
}

function serializeCookie(name: string, value: string, options: { httpOnly: boolean; sameSite: "lax"; secure: boolean; path: string; maxAge: number }): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    ...(options.httpOnly ? ["HttpOnly"] : []),
    `Path=${options.path}`,
    `SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`,
    `Max-Age=${options.maxAge}`,
  ];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

interface BuildServerOptions {
  periodStore?: AccountingPeriodStore;
}

export function buildServer(options: BuildServerOptions = {}) {
  const config = readServerConfig(process.env);
  const app = Fastify({ logger: true });
  const persistence = config.persistenceDriver === "prisma"
    ? createPersistenceAdapters({ driver: "prisma", connectionString: config.databaseUrl })
    : createPersistenceAdapters({ driver: "memory" });

  app.addHook("onClose", async () => {
    await persistence.disconnect();
  });

  void app.register(cors, { origin: config.webBaseUrl, credentials: true });
  void app.register(multipart, {
    limits: {
      files: 1,
      fields: 3,
      parts: 4,
      fieldSize: 4096,
      fileSize: 5 * 1024 * 1024,
    },
  });

  const sessionService = new SessionService(config.sessionSecret);
  const identityService = persistence.identityService;
  const auditService = persistence.auditService;
  app.decorateRequest("adminUser", undefined);
  app.decorate("auditService", auditService);
  const itemRepository = persistence.repositories.items;
  const itemService = new ItemService(itemRepository);
  const inventoryPersistence = persistence.inventory;
  const readSource = inventoryPersistence.readSource;
  const periodStore = options.periodStore ?? inventoryPersistence.periodStore;
  const currentPeriodCode = () => new Date().toISOString().slice(0, 7);
  const assertCurrentPeriodOpen = async () => {
    const periodCode = currentPeriodCode();
    const period = await periodStore.getOrCreate(periodCode);
    if (period.status !== "OPEN") throw new Error(`closed period: ${period.code}`);
  };
  const outboundService = new OutboundService(inventoryPersistence.outboundStore, assertCurrentPeriodOpen);
  const transferService = new TransferService(inventoryPersistence.movementStore, assertCurrentPeriodOpen);
  const returnService = new ReturnService(inventoryPersistence.movementStore, assertCurrentPeriodOpen);
  const stocktakeService = new StocktakeService(inventoryPersistence.stocktakeStore, periodStore);
  const periodCloseService = new PeriodCloseService(periodStore, {
    getPendingOutboundCount: () => readSource.getPendingOutboundCount(),
    getUnpostedAdjustmentCount: () => readSource.getUnpostedAdjustmentCount(),
  });
  const warehouseService = new WarehouseService(persistence.repositories.warehouses);
  const inventoryEntryStore = inventoryPersistence.entryStore;
  const inboundService = new InboundService(inventoryEntryStore, { warehouseService, itemService }, assertCurrentPeriodOpen);
  const openingStockImportService = new OpeningStockImportService(
    new ExcelOpeningStockWorkbookParser(),
    inventoryPersistence.openingStockImportStore,
    new OpeningStockPreviewTokenService(config.sessionSecret),
    periodStore,
  );
  const inventoryQueryService = new InventoryQueryService({
    listItems: () => itemService.list(true),
    listWarehouses: () => warehouseService.listActive(),
    listBatches: () => readSource.listBatches(),
    listBalances: () => readSource.listBalances(),
  });
  const alertService = new AlertService({
    listBalances: () => readSource.listBalances(),
    listItems: () => itemService.list(true),
  });
  const notificationService = new NotificationService({
    getPendingOutboundCount: () => readSource.getPendingOutboundCount(),
    listLowStock: () => alertService.listLowStock(),
    getPeriodStatus: async () => {
      const code = currentPeriodCode();
      return (await periodStore.get(code)) ?? { code, status: "OPEN" as const };
    },
    getStocktakeNotice: async () => ({ count: await readSource.getStocktakeCount(), href: "/admin/stocktake" }),
    getAnomalyCount: () => readSource.getAnomalyCount(),
  });
  const listReportEntries = () => readSource.listEntries();
  const inventoryReportService = new InventoryReportService(listReportEntries);
  const transactionReportService = new TransactionReportService(listReportEntries);
  const oauthClient = new WeComOAuthClient({
    corpId: process.env.WE_COM_CORP_ID ?? "",
    agentId: process.env.WE_COM_AGENT_ID ?? "",
    secret: process.env.WE_COM_SECRET ?? "",
    redirectUri: `${config.apiBaseUrl}/auth/wecom/callback`,
  });
  const approvalParser = new ApprovalParser((optionKey) => itemService.resolveByWeComOptionKey(optionKey), config.approvalTemplateId);
  const approvalSyncService = new ApprovalSyncService({
    gateway: new HttpApprovalGateway({
      corpId: process.env.WE_COM_CORP_ID ?? "",
      secret: config.approvalSecret ?? process.env.WE_COM_SECRET ?? "",
    }),
    parser: {
      async parse(detail) {
        await itemService.loadPersistedOptionIndex();
        return approvalParser.parse(detail);
      },
    },
    store: inventoryPersistence.approvalSyncStore,
    approvalTemplateId: config.approvalTemplateId,
  });
  const signatureVerifier = new WeComSignatureVerifier({
    token: process.env.WE_COM_CALLBACK_TOKEN ?? "",
    encodingAesKey: process.env.WE_COM_ENCODING_AES_KEY ?? "",
    corpId: process.env.WE_COM_CORP_ID ?? "",
  });

  const getSessionUser = (request: { headers: { cookie?: string } }) => {
    const user = sessionService.readSession(readCookie(request.headers.cookie, SESSION_COOKIE) ?? "");
    if (!user) return null;
    if (user.isLocalAuth && config.localAuthEnabled) return user;
    return { ...user, role: roleForUser(user.weComUserId) };
  };

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/admin")) return;
    const user = getSessionUser(request);
    const requiredPermission = request.url.startsWith("/admin/reports") ? "VIEW_REPORTS" as const : "VIEW_ADMIN" as const;
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!RolePolicy.can(user, requiredPermission)) return reply.code(403).send({ error: "forbidden" });
    request.adminUser = user;
  });

  app.setErrorHandler((error, request, reply) => {
    if (!request.url.startsWith("/admin")) {
      return reply.send(error);
    }
    const businessError = classifyAdminBusinessError(error);
    if (businessError) {
      return reply.code(businessError.statusCode).send({ error: businessError.message });
    }
    const errorCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
    if (errorCode && [
      "ERR_STREAM_PREMATURE_CLOSE",
      "FST_FILES_LIMIT",
      "FST_FIELDS_LIMIT",
      "FST_PARTS_LIMIT",
      "FST_INVALID_MULTIPART_CONTENT_TYPE",
    ].includes(errorCode)) {
      return reply.code(400).send({ error: "上传请求格式无效" });
    }
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(statusCode).send({ error: message });
  });

  app.get("/health", async (_request, reply) => {
    if (persistence.driver === "memory") {
      return { status: "ok", service: "warehouse-api", persistenceDriver: persistence.driver, database: { status: "not_required" } };
    }
    try {
      await persistence.probeDatabase();
      return { status: "ok", service: "warehouse-api", persistenceDriver: persistence.driver, database: { status: "ok" } };
    } catch {
      return reply.code(503).send({ status: "error", service: "warehouse-api", persistenceDriver: persistence.driver, database: { status: "unavailable" } });
    }
  });
  app.get<{ Querystring: { returnTo?: string } }>("/auth/wecom/authorize", async (request, reply) => {
    try {
      const authorizeUrl = oauthClient.getAuthorizeUrl(request.query.returnTo ?? "/");
      const state = new URL(authorizeUrl).searchParams.get("state");
      if (!state) throw new Error("enterprise WeChat OAuth state is missing");
      const secureCookies = config.apiBaseUrl.startsWith("https://");
      reply.header("set-cookie", serializeCookie(WECOM_OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
        path: "/auth/wecom/callback",
        maxAge: WECOM_OAUTH_STATE_TTL_SECONDS,
      }));
      return {
        authorizeUrl,
        ...(config.localAuthEnabled ? { localAuthUrl: `${config.apiBaseUrl}/auth/local?returnTo=${encodeURIComponent(request.query.returnTo ?? "/")}` } : {}),
      };
    } catch (error) {
      if (error instanceof Error && error.message === "enterprise WeChat OAuth is not configured") {
        return reply.code(503).send({ error: "wecom_not_configured", message: "Enterprise WeChat OAuth is not configured" });
      }
      throw error;
    }
  });
  app.get<{ Querystring: { code?: string; state?: string } }>("/auth/wecom/callback", async (request, reply) => {
    if (!request.query.code) return reply.code(400).send({ error: "code is required" });
    const expectedState = readCookie(request.headers.cookie, WECOM_OAUTH_STATE_COOKIE);
    if (!oauthClient.validateState(request.query.state, expectedState ?? undefined)) return reply.code(400).send({ error: "invalid_oauth_state" });
    const identity = await oauthClient.exchangeCode(request.query.code);
    const user: AuthenticatedUser = {
      id: identity.weComUserId,
      weComUserId: identity.weComUserId,
      name: identity.name,
      role: roleForUser(identity.weComUserId),
    };
    await identityService.ensureUser(user);
    const token = sessionService.createSession(user);
    const secureCookies = config.apiBaseUrl.startsWith("https://");
    reply.header("set-cookie", [
      serializeCookie(SESSION_COOKIE, token, sessionService.cookieOptions(secureCookies)),
      serializeCookie(WECOM_OAUTH_STATE_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
        path: "/auth/wecom/callback",
        maxAge: 0,
      }),
    ]);
    await auditService.record({
      actorUserId: user.id,
      actorRole: user.role,
      actorName: user.name,
      action: "LOGIN",
      entityType: "SESSION",
      entityId: user.id,
      requestId: request.id,
      occurredAt: new Date().toISOString(),
    });
    return reply.redirect(`${config.webBaseUrl}${oauthClient.decodeReturnTo(request.query.state)}`);
  });
  app.get("/auth/session", async (request, reply) => {
    const user = getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { user };
  });
  app.get("/auth/permissions", async (request, reply) => {
    const user = getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return {
      role: user.role,
      canViewAdmin: RolePolicy.can(user, "VIEW_ADMIN"),
      canViewReports: RolePolicy.can(user, "VIEW_REPORTS"),
    };
  });

  registerLocalAuthRoutes(app, {
    enabled: config.localAuthEnabled,
    apiBaseUrl: config.apiBaseUrl,
    webBaseUrl: config.webBaseUrl,
    sessionService,
    identityService,
    auditService,
  });
  registerApprovalCallbackRoute(app, { verifier: signatureVerifier, syncService: approvalSyncService });
  registerApprovalResyncRoute(app, { syncService: approvalSyncService });
  registerItemRoutes(app, { itemService });
  registerWarehouseRoutes(app, { warehouseService });
  registerInboundRoutes(app, { inboundService });
  registerOpeningStockRoutes(app);
  registerOpeningStockImportRoutes(app, { openingStockImportService });
  registerNotificationRoutes(app, { notificationService });
  registerOutboundRoutes(app, { outboundService });
  registerTransferRoutes(app, { transferService });
  registerReturnRoutes(app, { returnService });
  registerStocktakeRoutes(app, { stocktakeService });
  registerPeriodCloseRoutes(app, { periodCloseService });
  registerReportRoutes(app, {
    inventoryReportService,
    transactionReportService,
    inventoryQueryService,
    listReportItems: () => itemService.list(true),
    listReportWarehouses: () => warehouseService.listActive(),
  });

  return app;
}

export async function startServer() {
  const app = buildServer();
  const port = Number(process.env.API_PORT ?? 3001);

  try {
    await app.listen({ host: "0.0.0.0", port });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  return app;
}

if (process.env.NODE_ENV !== "test") {
  await startServer();
}
