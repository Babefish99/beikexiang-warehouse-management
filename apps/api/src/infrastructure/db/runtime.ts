import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";

import { isLocalAuthEnabled } from "../../application/auth/local-auth.js";
import { parseConfiguredWeComUserIds, type AuthenticatedUser, type UserRole } from "../../application/auth/role-service.js";
import { InMemoryItemRepository, type ItemRepository } from "../../application/items/item-service.js";
import { InMemoryInventoryEntryStore, type InventoryEntryStore, type StoredBatch } from "../../application/inventory/inbound-service.js";
import { createInventoryMemoryState } from "../../application/inventory/inventory-memory-state.js";
import type { OpeningStockImportStore } from "../../application/inventory/opening-stock-import-contract.js";
import { InMemoryOutboundStore, type OutboundStore } from "../../application/inventory/outbound-service.js";
import { InMemoryMovementStore, type MovementStore } from "../../application/inventory/transfer-service.js";
import { InMemoryStocktakeStore, type StocktakeStore } from "../../application/inventory/stocktake-service.js";
import { InMemoryAccountingPeriodStore, type AccountingPeriodStore } from "../../application/periods/period-close-service.js";
import type { ReportEntry } from "../../application/reports/report-query-service.js";
import { InMemoryWarehouseRepository, type WarehouseRepository } from "../../application/warehouses/warehouse-service.js";
import { InMemoryApprovalSyncStore, type ApprovalSyncStore } from "../../application/wecom/approval-sync-service.js";
import type { ItemDefinition } from "../../domain/items/item.js";
import { CANONICAL_ITEM_CATEGORIES } from "../../domain/items/item-category.js";
import type { WarehouseDefinition } from "../../domain/warehouses/warehouse.js";
import { InMemoryAuditService, type AuditEvent, type AuditService } from "../audit/audit-service.js";
import { decodeWeComEncodingAesKey } from "../wecom/signature-verifier.js";
import { PrismaAccountingPeriodStore } from "./prisma-accounting-period-store.js";
import { PrismaApprovalSyncStore } from "./prisma-approval-sync-store.js";
import { PrismaInventoryEntryStore } from "./prisma-inventory-entry-store.js";
import { PrismaMovementStore } from "./prisma-movement-store.js";
import { InMemoryOpeningStockImportStore } from "./in-memory-opening-stock-import-store.js";
import { PrismaOpeningStockImportStore } from "./prisma-opening-stock-import-store.js";
import { PrismaOutboundStore } from "./prisma-outbound-store.js";
import { PrismaReportSource } from "./prisma-report-source.js";
import { PrismaStocktakeStore } from "./prisma-stocktake-store.js";

export type PersistenceDriver = "memory" | "prisma";

export interface ServerConfig {
  persistenceDriver: PersistenceDriver;
  databaseUrl?: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  sessionSecret: string;
  localAuthEnabled: boolean;
  nodeEnv: string;
  approvalTemplateId?: string;
}

export interface CoreEntityRecord {
  id: string;
  [key: string]: unknown;
}

export interface CoreEntityRepository<TRecord extends CoreEntityRecord = CoreEntityRecord> {
  list(): Promise<TRecord[]>;
  get(id: string): Promise<TRecord | undefined>;
  save(record: TRecord): Promise<TRecord>;
}

export interface CoreRepositorySeam {
  roles: CoreEntityRepository;
  users: CoreEntityRepository;
  warehouses: WarehouseRepository;
  categories: CoreEntityRepository;
  items: ItemRepository;
  approvals: CoreEntityRepository;
  batches: CoreEntityRepository;
  ledgerEntries: CoreEntityRepository;
  outboundOrders: CoreEntityRepository;
  transfers: CoreEntityRepository;
  returns: CoreEntityRepository;
  stocktakes: CoreEntityRepository;
  periods: CoreEntityRepository;
  auditLogs: CoreEntityRepository;
}

export interface IdentityService {
  ensureUser(user: AuthenticatedUser): Promise<void>;
}

export interface InventoryReadSource {
  listBatches(): Promise<StoredBatch[]>;
  listBalances(): Promise<Array<{ warehouseId: string; itemId: string; batchId: string; remainingQuantity: string; unitCost: string }>>;
  listEntries(): Promise<ReportEntry[]>;
  getPendingOutboundCount(): Promise<number>;
  getStocktakeCount(): Promise<number>;
  getAnomalyCount(): Promise<number>;
  getUnpostedAdjustmentCount(): Promise<number>;
}

export interface InventoryPersistence {
  entryStore: InventoryEntryStore;
  openingStockImportStore: OpeningStockImportStore;
  outboundStore: OutboundStore;
  movementStore: MovementStore;
  stocktakeStore: StocktakeStore;
  periodStore: AccountingPeriodStore;
  approvalSyncStore: ApprovalSyncStore;
  readSource: InventoryReadSource;
}

export interface PersistenceAdapters {
  driver: PersistenceDriver;
  repositories: CoreRepositorySeam;
  identityService: IdentityService;
  auditService: AuditService;
  inventory: InventoryPersistence;
  probeDatabase(): Promise<void>;
  disconnect(): Promise<void>;
}

const DEFAULT_WAREHOUSES: WarehouseDefinition[] = [
  { id: "warehouse-1", code: "WH-01", name: "待配置仓库一", isActive: true, isPlaceholder: true },
  { id: "warehouse-2", code: "WH-02", name: "待配置仓库二", isActive: true, isPlaceholder: true },
  { id: "warehouse-3", code: "WH-03", name: "待配置仓库三", isActive: true, isPlaceholder: true },
];

const ROLE_DEFINITIONS: Record<UserRole, { id: string; code: UserRole; name: string }> = {
  ADMIN: { id: "role-admin", code: "ADMIN", name: "管理员" },
  FINANCE: { id: "role-finance", code: "FINANCE", name: "财务" },
  APPLICANT: { id: "role-applicant", code: "APPLICANT", name: "领用人" },
};

function parsePersistenceDriver(value?: string): PersistenceDriver {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "memory") return "memory";
  if (normalized === "prisma") return "prisma";
  throw new Error(`unsupported PERSISTENCE_DRIVER: ${value}`);
}

const PRODUCTION_WECOM_FIELDS = [
  "WE_COM_CORP_ID",
  "WE_COM_AGENT_ID",
  "WE_COM_SECRET",
  "WE_COM_CALLBACK_TOKEN",
  "WE_COM_ENCODING_AES_KEY",
  "WE_COM_APPROVAL_TEMPLATE_ID",
] as const;

const KNOWN_SESSION_SECRET_DEFAULTS = new Set([
  "local-development-session-secret",
  "replace-with-a-long-random-value",
]);

function usesHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function asJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

function withAuditMetadata(event: AuditEvent): Record<string, unknown> {
  return {
    ...(typeof event.afterData === "object" && event.afterData !== null ? event.afterData as Record<string, unknown> : event.afterData === undefined ? {} : { value: event.afterData }),
    actorRole: event.actorRole,
    occurredAt: event.occurredAt,
    status: event.status,
    ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
  };
}

export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const nodeEnv = (env.NODE_ENV ?? "development").trim().toLowerCase();
  const persistenceDriver = parsePersistenceDriver(env.PERSISTENCE_DRIVER);
  const apiBaseUrl = env.API_BASE_URL?.trim() || "http://localhost:3001";
  const webBaseUrl = env.WEB_BASE_URL?.trim() || "http://localhost:5174";
  const sessionSecret = env.SESSION_SECRET?.trim() || "local-development-session-secret";
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const approvalTemplateId = env.WE_COM_APPROVAL_TEMPLATE_ID?.trim() || undefined;
  const localAuthEnabled = isLocalAuthEnabled({
    bypassEnabled: env.LOCAL_AUTH_BYPASS === "true",
    nodeEnv,
  });

  if (persistenceDriver === "prisma" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when PERSISTENCE_DRIVER=prisma");
  }

  if (nodeEnv === "production" && persistenceDriver === "memory") {
    throw new Error("in-memory persistence is not allowed when NODE_ENV=production");
  }

  if (nodeEnv === "production") {
    if (env.LOCAL_AUTH_BYPASS === "true") {
      throw new Error("LOCAL_AUTH_BYPASS must be false in production");
    }
    if (sessionSecret.length < 32 || KNOWN_SESSION_SECRET_DEFAULTS.has(sessionSecret)) {
      throw new Error("SESSION_SECRET must be at least 32 characters and must not use a known default in production");
    }
    for (const field of PRODUCTION_WECOM_FIELDS) {
      const value = env[field]?.trim();
      if (!value || value.toLowerCase().startsWith("replace-with-")) {
        throw new Error(`production Enterprise WeChat configuration is incomplete: ${field}`);
      }
    }
    try {
      decodeWeComEncodingAesKey(env.WE_COM_ENCODING_AES_KEY!);
    } catch {
      throw new Error("WE_COM_ENCODING_AES_KEY must be an unpadded base64 value that decodes to exactly 32 bytes in production");
    }
    if (parseConfiguredWeComUserIds(env.WE_COM_ADMIN_IDS).length === 0) {
      throw new Error("WE_COM_ADMIN_IDS must contain at least one non-placeholder Enterprise WeChat UserID in production");
    }
    if (!usesHttps(apiBaseUrl)) {
      throw new Error("API_BASE_URL must use HTTPS when Enterprise WeChat callbacks are enabled in production");
    }
    if (!usesHttps(webBaseUrl)) {
      throw new Error("WEB_BASE_URL must use HTTPS in production");
    }
  }

  return {
    persistenceDriver,
    databaseUrl,
    apiBaseUrl,
    webBaseUrl,
    sessionSecret,
    localAuthEnabled,
    nodeEnv,
    approvalTemplateId,
  };
}

class InMemoryCoreEntityRepository<TRecord extends CoreEntityRecord> implements CoreEntityRepository<TRecord> {
  private readonly records = new Map<string, TRecord>();

  constructor(initialRecords: TRecord[] = []) {
    for (const record of initialRecords) {
      this.records.set(record.id, structuredClone(record));
    }
  }

  async list(): Promise<TRecord[]> {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  async get(id: string): Promise<TRecord | undefined> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async save(record: TRecord): Promise<TRecord> {
    const snapshot = structuredClone(record);
    this.records.set(record.id, snapshot);
    return structuredClone(snapshot);
  }
}

type PrismaByIdDelegate<TRecord extends CoreEntityRecord> = {
  findMany(args?: unknown): Promise<TRecord[]>;
  findUnique(args: unknown): Promise<TRecord | null>;
  upsert(args: unknown): Promise<TRecord>;
};

class PrismaByIdRepository<TRecord extends CoreEntityRecord> implements CoreEntityRepository<TRecord> {
  constructor(private readonly delegate: PrismaByIdDelegate<TRecord>) {}

  async list(): Promise<TRecord[]> {
    return this.delegate.findMany();
  }

  async get(id: string): Promise<TRecord | undefined> {
    return (await this.delegate.findUnique({ where: { id } })) ?? undefined;
  }

  async save(record: TRecord): Promise<TRecord> {
    return this.delegate.upsert({
      where: { id: record.id },
      update: record,
      create: record,
    });
  }
}

class PrismaWarehouseRepository implements WarehouseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(includeInactive = false): Promise<WarehouseDefinition[]> {
    const warehouses = await this.prisma.warehouse.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { code: "asc" },
    });
    return warehouses.map((warehouse) => ({
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      isActive: warehouse.isActive,
      isPlaceholder: warehouse.isPlaceholder,
    }));
  }

  async get(id: string): Promise<WarehouseDefinition | undefined> {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) return undefined;
    return {
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      isActive: warehouse.isActive,
      isPlaceholder: warehouse.isPlaceholder,
    };
  }

  async save(warehouse: WarehouseDefinition): Promise<void> {
    await this.prisma.warehouse.upsert({
      where: { id: warehouse.id },
      update: {
        code: warehouse.code,
        name: warehouse.name,
        isActive: warehouse.isActive,
        isPlaceholder: warehouse.isPlaceholder ?? false,
      },
      create: {
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
        isActive: warehouse.isActive,
        isPlaceholder: warehouse.isPlaceholder ?? false,
      },
    });
  }
}

class PrismaItemRepository implements ItemRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(includeInactive = false): Promise<ItemDefinition[]> {
    const items = await this.prisma.item.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { code: "asc" },
    });
    return items.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      specification: item.specification ?? undefined,
      unit: item.unit,
      categoryId: item.categoryId,
      weComOptionKey: item.weComOptionKey ?? undefined,
      minimumStock: item.minimumStock?.toString(),
      isActive: item.isActive,
    }));
  }

  async get(id: string): Promise<ItemDefinition | undefined> {
    const item = await this.prisma.item.findUnique({ where: { id } });
    if (!item) return undefined;
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      specification: item.specification ?? undefined,
      unit: item.unit,
      categoryId: item.categoryId,
      weComOptionKey: item.weComOptionKey ?? undefined,
      minimumStock: item.minimumStock?.toString(),
      isActive: item.isActive,
    };
  }

  async save(item: ItemDefinition): Promise<void> {
    await this.prisma.item.upsert({
      where: { id: item.id },
      update: {
        code: item.code,
        name: item.name,
        specification: item.specification ?? null,
        unit: item.unit,
        categoryId: item.categoryId,
        weComOptionKey: item.weComOptionKey ?? null,
        minimumStock: item.minimumStock ?? null,
        isActive: item.isActive,
      },
      create: {
        id: item.id,
        code: item.code,
        name: item.name,
        specification: item.specification ?? null,
        unit: item.unit,
        categoryId: item.categoryId,
        weComOptionKey: item.weComOptionKey ?? null,
        minimumStock: item.minimumStock ?? null,
        isActive: item.isActive,
      },
    });
  }

  async hasLedgerActivity(id: string): Promise<boolean> {
    return (await this.prisma.inventoryLedgerEntry.count({ where: { itemId: id } })) > 0;
  }
}

type PrismaIdentityClient = Pick<PrismaClient, "role" | "user">;

interface IdentityInput {
  id: string;
  weComUserId?: string;
  name?: string;
  role: UserRole;
  updateExistingProfile?: boolean;
}

async function ensurePrismaIdentity(prisma: PrismaIdentityClient, identity: IdentityInput): Promise<void> {
  const role = ROLE_DEFINITIONS[identity.role];
  await prisma.role.upsert({
    where: { id: role.id },
    update: { code: role.code, name: role.name },
    create: role,
  });
  await prisma.user.upsert({
    where: { id: identity.id },
    update: {
      ...(identity.updateExistingProfile !== false && identity.weComUserId ? { weComUserId: identity.weComUserId } : {}),
      ...(identity.updateExistingProfile !== false && identity.name ? { name: identity.name } : {}),
      roleId: role.id,
      isActive: true,
    },
    create: {
      id: identity.id,
      weComUserId: identity.weComUserId ?? identity.id,
      name: identity.name ?? identity.id,
      roleId: role.id,
      isActive: true,
    },
  });
}

class PrismaIdentityService implements IdentityService {
  constructor(private readonly prisma: PrismaClient) {}

  async ensureUser(user: AuthenticatedUser): Promise<void> {
    await ensurePrismaIdentity(this.prisma, user);
  }
}

class PrismaAuditService implements AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(event: AuditEvent): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await ensurePrismaIdentity(transaction, {
        id: event.actorUserId,
        name: event.actorName,
        role: event.actorRole,
        updateExistingProfile: false,
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: event.actorUserId,
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId,
          requestId: event.requestId,
          beforeData: asJson(structuredClone(event.beforeData)),
          afterData: asJson(structuredClone(withAuditMetadata(event))),
        },
      });
    });
  }
}

function createPrismaClient(connectionString: string): PrismaClient {
  const schema = new URL(connectionString).searchParams.get("schema") ?? undefined;
  const adapter = new PrismaPg({ connectionString }, schema ? { schema } : undefined);
  return new PrismaClient({ adapter });
}

export function createPersistenceAdapters(options: { driver: "memory" } | { driver: "prisma"; connectionString?: string; prisma?: PrismaClient }): PersistenceAdapters {
  if (options.driver === "memory") {
    const roles = new InMemoryCoreEntityRepository();
    const users = new InMemoryCoreEntityRepository();
    const items = new InMemoryItemRepository();
    const state = createInventoryMemoryState();
    const entryStore = new InMemoryInventoryEntryStore(state, {
      onRecordStockEntry: ({ itemId }) => items.markLedgerActivity(itemId),
    });
    const periodStore = new InMemoryAccountingPeriodStore();
    const warehouses = new InMemoryWarehouseRepository(DEFAULT_WAREHOUSES);
    const categories = new InMemoryCoreEntityRepository(
      CANONICAL_ITEM_CATEGORIES.map((category) => ({ ...category })),
    );
    return {
      driver: "memory",
      repositories: {
        roles,
        users,
        warehouses,
        categories,
        items,
        approvals: new InMemoryCoreEntityRepository(),
        batches: new InMemoryCoreEntityRepository(),
        ledgerEntries: new InMemoryCoreEntityRepository(),
        outboundOrders: new InMemoryCoreEntityRepository(),
        transfers: new InMemoryCoreEntityRepository(),
        returns: new InMemoryCoreEntityRepository(),
        stocktakes: new InMemoryCoreEntityRepository(),
        periods: new InMemoryCoreEntityRepository(),
        auditLogs: new InMemoryCoreEntityRepository(),
      },
      identityService: {
        async ensureUser(user) {
          const role = ROLE_DEFINITIONS[user.role];
          await roles.save(role);
          await users.save({ ...user, roleId: role.id, isActive: true });
        },
      },
      auditService: new InMemoryAuditService(),
      inventory: {
        entryStore,
        openingStockImportStore: new InMemoryOpeningStockImportStore(
          items,
          warehouses,
          categories,
          state,
          entryStore,
          periodStore,
        ),
        outboundStore: new InMemoryOutboundStore(state),
        movementStore: new InMemoryMovementStore(state),
        stocktakeStore: new InMemoryStocktakeStore(state),
        periodStore,
        approvalSyncStore: new InMemoryApprovalSyncStore(state),
        readSource: {
          async listBatches() { return entryStore.batches(); },
          async listBalances() { return entryStore.balances(); },
          async listEntries() { return entryStore.ledger().map(({ batchId: _batchId, referenceId: _referenceId, ...entry }) => entry); },
          async getPendingOutboundCount() { return [...state.approvals.values()].filter((approval) => approval.outboundStatus === "PENDING_OUTBOUND").length; },
          async getStocktakeCount() { return state.stocktakeAdjustments.length; },
          async getAnomalyCount() { return state.stocktakeAdjustments.filter((adjustment) => adjustment.quantityDelta !== "0").length; },
          async getUnpostedAdjustmentCount() { return 0; },
        },
      },
      async probeDatabase() {},
      async disconnect() {},
    };
  }

  const prisma = options.prisma ?? createPrismaClient(options.connectionString ?? "");
  const reportSource = new PrismaReportSource(prisma);
  const periodStore = new PrismaAccountingPeriodStore(prisma);

  return {
    driver: "prisma",
    repositories: {
      roles: new PrismaByIdRepository(prisma.role),
      users: new PrismaByIdRepository(prisma.user),
      warehouses: new PrismaWarehouseRepository(prisma),
      categories: new PrismaByIdRepository(prisma.itemCategory),
      items: new PrismaItemRepository(prisma),
      approvals: new PrismaByIdRepository(prisma.approvalRequest),
      batches: new PrismaByIdRepository(prisma.procurementBatch),
      ledgerEntries: new PrismaByIdRepository(prisma.inventoryLedgerEntry),
      outboundOrders: new PrismaByIdRepository(prisma.outboundOrder),
      transfers: new PrismaByIdRepository(prisma.transferOrder),
      returns: new PrismaByIdRepository(prisma.returnOrder),
      stocktakes: new PrismaByIdRepository(prisma.stocktake),
      periods: new PrismaByIdRepository(prisma.accountingPeriod),
      auditLogs: new PrismaByIdRepository(prisma.auditLog),
    },
    identityService: new PrismaIdentityService(prisma),
    auditService: new PrismaAuditService(prisma),
    inventory: {
      entryStore: new PrismaInventoryEntryStore(prisma),
      openingStockImportStore: new PrismaOpeningStockImportStore(prisma),
      outboundStore: new PrismaOutboundStore(prisma),
      movementStore: new PrismaMovementStore(prisma),
      stocktakeStore: new PrismaStocktakeStore(prisma),
      periodStore,
      approvalSyncStore: new PrismaApprovalSyncStore(prisma),
      readSource: reportSource,
    },
    async probeDatabase() {
      await prisma.$queryRaw`SELECT 1`;
    },
    async disconnect() {
      await prisma.$disconnect();
    },
  };
}
