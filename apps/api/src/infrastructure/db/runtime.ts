import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";

import { isLocalAuthEnabled } from "../../application/auth/local-auth.js";
import type { AuthenticatedUser, UserRole } from "../../application/auth/role-service.js";
import { InMemoryItemRepository, type ItemRepository } from "../../application/items/item-service.js";
import { InMemoryWarehouseRepository, type WarehouseRepository } from "../../application/warehouses/warehouse-service.js";
import type { ItemDefinition } from "../../domain/items/item.js";
import type { WarehouseDefinition } from "../../domain/warehouses/warehouse.js";
import { InMemoryAuditService, type AuditEvent, type AuditService } from "../audit/audit-service.js";

export type PersistenceDriver = "memory" | "prisma";

export const PRISMA_RUNTIME_BLOCKED_ERROR =
  "PERSISTENCE_DRIVER=prisma is disabled until all core inventory flows use durable persistence";

export interface ServerConfig {
  persistenceDriver: PersistenceDriver;
  databaseUrl?: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  sessionSecret: string;
  localAuthEnabled: boolean;
  nodeEnv: string;
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

export interface PersistenceAdapters {
  driver: PersistenceDriver;
  repositories: CoreRepositorySeam;
  identityService: IdentityService;
  auditService: AuditService;
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

function hasProductionWeComCallbackConfig(env: Record<string, string | undefined>): boolean {
  return Boolean(env.WE_COM_CORP_ID?.trim() && env.WE_COM_AGENT_ID?.trim() && env.WE_COM_SECRET?.trim());
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

  if (nodeEnv === "production" && hasProductionWeComCallbackConfig(env) && !apiBaseUrl.startsWith("https://")) {
    throw new Error("API_BASE_URL must use HTTPS when Enterprise WeChat callbacks are enabled in production");
  }

  if (persistenceDriver === "prisma") {
    throw new Error(PRISMA_RUNTIME_BLOCKED_ERROR);
  }

  return {
    persistenceDriver,
    databaseUrl,
    apiBaseUrl,
    webBaseUrl,
    sessionSecret,
    localAuthEnabled,
    nodeEnv,
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
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export function createPersistenceAdapters(options: { driver: "memory" } | { driver: "prisma"; connectionString?: string; prisma?: PrismaClient }): PersistenceAdapters {
  if (options.driver === "memory") {
    const roles = new InMemoryCoreEntityRepository();
    const users = new InMemoryCoreEntityRepository();
    return {
      driver: "memory",
      repositories: {
        roles,
        users,
        warehouses: new InMemoryWarehouseRepository(DEFAULT_WAREHOUSES),
        categories: new InMemoryCoreEntityRepository(),
        items: new InMemoryItemRepository(),
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
      async disconnect() {},
    };
  }

  const prisma = options.prisma ?? createPrismaClient(options.connectionString ?? "");

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
    async disconnect() {
      await prisma.$disconnect();
    },
  };
}
