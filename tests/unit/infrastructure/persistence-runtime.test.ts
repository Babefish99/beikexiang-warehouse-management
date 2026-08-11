import { afterEach, describe, expect, it, vi } from "vitest";

import { createPersistenceAdapters, readServerConfig } from "../../../apps/api/src/infrastructure/db/runtime.js";
import { InMemoryAuditService } from "../../../apps/api/src/infrastructure/audit/audit-service.js";
import { buildServer } from "../../../apps/api/src/server.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server runtime configuration", () => {
  const validEncodingAesKey = Buffer.alloc(32, 1).toString("base64").replace(/=+$/, "");
  const productionEnvironment = {
    NODE_ENV: "production",
    PERSISTENCE_DRIVER: "prisma",
    DATABASE_URL: "postgresql://warehouse:warehouse@db:5432/warehouse",
    API_BASE_URL: "https://warehouse.example.com",
    WEB_BASE_URL: "https://warehouse.example.com",
    SESSION_SECRET: "production-session-secret-at-least-32-characters",
    LOCAL_AUTH_BYPASS: "false",
    WE_COM_CORP_ID: "corp-id",
    WE_COM_AGENT_ID: "1000001",
    WE_COM_SECRET: "secret",
    WE_COM_ADMIN_IDS: "warehouse-admin",
    WE_COM_CALLBACK_TOKEN: "callback-token",
    WE_COM_ENCODING_AES_KEY: validEncodingAesKey,
  };

  it("defaults to in-memory persistence outside production", () => {
    const config = readServerConfig({
      NODE_ENV: "development",
      API_BASE_URL: "http://localhost:3001",
      WEB_BASE_URL: "http://localhost:5174",
      SESSION_SECRET: "test-session-secret",
      LOCAL_AUTH_BYPASS: "true",
    });

    expect(config.persistenceDriver).toBe("memory");
    expect(config.localAuthEnabled).toBe(true);
  });

  it("rejects prisma persistence when DATABASE_URL is missing", () => {
    expect(() => readServerConfig({
      NODE_ENV: "development",
      PERSISTENCE_DRIVER: "prisma",
      API_BASE_URL: "http://localhost:3001",
      WEB_BASE_URL: "http://localhost:5174",
      SESSION_SECRET: "test-session-secret",
      LOCAL_AUTH_BYPASS: "false",
    })).toThrowError("DATABASE_URL is required when PERSISTENCE_DRIVER=prisma");
  });

  it("rejects in-memory persistence in production", () => {
    expect(() => readServerConfig({
      NODE_ENV: "production",
      PERSISTENCE_DRIVER: "memory",
      API_BASE_URL: "https://warehouse.example.com",
      WEB_BASE_URL: "https://warehouse-web.example.com",
      SESSION_SECRET: "test-session-secret",
      LOCAL_AUTH_BYPASS: "false",
    })).toThrowError("in-memory persistence is not allowed when NODE_ENV=production");
  });

  it("requires an https API base URL for production Enterprise WeChat callbacks", () => {
    expect(() => readServerConfig({
      ...productionEnvironment,
      API_BASE_URL: "http://warehouse.example.com",
    })).toThrowError("API_BASE_URL must use HTTPS when Enterprise WeChat callbacks are enabled in production");
  });

  it("requires the complete production Enterprise WeChat configuration", () => {
    for (const field of ["WE_COM_CORP_ID", "WE_COM_AGENT_ID", "WE_COM_SECRET", "WE_COM_CALLBACK_TOKEN", "WE_COM_ENCODING_AES_KEY"] as const) {
      expect(() => readServerConfig({ ...productionEnvironment, [field]: "" })).toThrowError(
        `production Enterprise WeChat configuration is incomplete: ${field}`,
      );
    }
  });

  it("rejects Enterprise WeChat placeholder values in production", () => {
    for (const field of ["WE_COM_CORP_ID", "WE_COM_AGENT_ID", "WE_COM_SECRET", "WE_COM_CALLBACK_TOKEN", "WE_COM_ENCODING_AES_KEY"] as const) {
      expect(() => readServerConfig({ ...productionEnvironment, [field]: `replace-with-${field.toLowerCase()}` })).toThrowError(
        `production Enterprise WeChat configuration is incomplete: ${field}`,
      );
    }
  });

  it("accepts the canonical unpadded 43-character Enterprise WeChat EncodingAESKey", () => {
    expect(validEncodingAesKey).toHaveLength(43);
    expect(() => readServerConfig(productionEnvironment)).not.toThrow();
  });

  it("accepts surrounding whitespace around a valid production EncodingAESKey", () => {
    expect(() => readServerConfig({
      ...productionEnvironment,
      WE_COM_ENCODING_AES_KEY: ` \t${validEncodingAesKey}\r\n`,
    })).not.toThrow();
  });

  it.each([
    "A",
    Buffer.alloc(31, 1).toString("base64").replace(/=+$/, ""),
    `${validEncodingAesKey.slice(0, -1)}*`,
    `${validEncodingAesKey}=`,
  ])("rejects a malformed or incorrectly sized production EncodingAESKey: %s", (encodingAesKey) => {
    expect(() => readServerConfig({ ...productionEnvironment, WE_COM_ENCODING_AES_KEY: encodingAesKey }))
      .toThrowError("WE_COM_ENCODING_AES_KEY must be an unpadded base64 value that decodes to exactly 32 bytes in production");
  });

  it.each([
    undefined,
    "",
    " ,   ,\t",
    "replace-with-first-production-admin-userid",
    " , REPLACE-WITH-ADMIN-USERID, ",
  ])("rejects production configuration without a usable Enterprise WeChat administrator: %s", (adminIds) => {
    expect(() => readServerConfig({ ...productionEnvironment, WE_COM_ADMIN_IDS: adminIds }))
      .toThrowError("WE_COM_ADMIN_IDS must contain at least one non-placeholder Enterprise WeChat UserID in production");
  });

  it("accepts a trimmed administrator list containing at least one usable UserID", () => {
    expect(() => readServerConfig({
      ...productionEnvironment,
      WE_COM_ADMIN_IDS: " , replace-with-admin-userid, primary-admin , secondary-admin ",
    })).not.toThrow();
  });

  it("requires both production public base URLs to use HTTPS", () => {
    expect(() => readServerConfig({ ...productionEnvironment, WEB_BASE_URL: "http://warehouse.example.com" }))
      .toThrowError("WEB_BASE_URL must use HTTPS in production");
  });

  it.each([
    undefined,
    "short-secret",
    "local-development-session-secret",
    "replace-with-a-long-random-value",
  ])("rejects a missing, weak, or known-default production session secret: %s", (sessionSecret) => {
    expect(() => readServerConfig({ ...productionEnvironment, SESSION_SECRET: sessionSecret }))
      .toThrowError("SESSION_SECRET must be at least 32 characters and must not use a known default in production");
  });

  it("rejects an attempted local-auth bypass in production", () => {
    expect(() => readServerConfig({ ...productionEnvironment, LOCAL_AUTH_BYPASS: "true" }))
      .toThrowError("LOCAL_AUTH_BYPASS must be false in production");
  });

  it("accepts a complete production Prisma configuration with local auth disabled", () => {
    expect(readServerConfig(productionEnvironment)).toMatchObject({
      persistenceDriver: "prisma",
      localAuthEnabled: false,
      apiBaseUrl: "https://warehouse.example.com",
      webBaseUrl: "https://warehouse.example.com",
    });
  });

  it("reports that PostgreSQL is not required in memory mode", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PERSISTENCE_DRIVER", "memory");
    vi.stubEnv("SESSION_SECRET", "local-development-session-secret");
    const app = buildServer();

    try {
      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: "ok",
        service: "warehouse-api",
        persistenceDriver: "memory",
        database: { status: "not_required" },
      });
    } finally {
      await app.close();
    }
  });

  it("runs a live Prisma database probe and returns 503 when PostgreSQL is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PERSISTENCE_DRIVER", "prisma");
    vi.stubEnv("DATABASE_URL", "postgresql://warehouse:warehouse@127.0.0.1:1/warehouse");
    vi.stubEnv("SESSION_SECRET", "local-development-session-secret");
    const app = buildServer();

    try {
      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: "error",
        service: "warehouse-api",
        persistenceDriver: "prisma",
        database: { status: "unavailable" },
      });
    } finally {
      await app.close();
    }
  });
});

describe("persistence adapters", () => {
  it("exposes the full core repository seam in memory mode", () => {
    const adapters = createPersistenceAdapters({ driver: "memory" });

    expect(adapters.auditService).toBeInstanceOf(InMemoryAuditService);
    expect(Object.keys(adapters.repositories)).toEqual([
      "roles",
      "users",
      "warehouses",
      "categories",
      "items",
      "approvals",
      "batches",
      "ledgerEntries",
      "outboundOrders",
      "transfers",
      "returns",
      "stocktakes",
      "periods",
      "auditLogs",
    ]);
  });

  it("passes the expanded audit envelope through the prisma audit service JSON payload", async () => {
    const roleUpsert = vi.fn().mockResolvedValue(undefined);
    const userUpsert = vi.fn().mockResolvedValue(undefined);
    const auditCreate = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      role: { upsert: roleUpsert },
      user: { upsert: userUpsert },
      auditLog: { create: auditCreate },
      itemCategory: {} as object,
      warehouse: {} as object,
      item: {} as object,
      approvalRequest: {} as object,
      procurementBatch: {} as object,
      inventoryLedgerEntry: {} as object,
      outboundOrder: {} as object,
      transferOrder: {} as object,
      returnOrder: {} as object,
      stocktake: {} as object,
      accountingPeriod: {} as object,
      $transaction: vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) => operation(prisma)),
      $disconnect: vi.fn(),
    };
    const adapters = createPersistenceAdapters({
      driver: "prisma",
      prisma: prisma as never,
    });

    await adapters.identityService.ensureUser({
      id: "admin-1",
      weComUserId: "admin-1",
      name: "仓库管理员",
      role: "ADMIN",
    });

    await adapters.auditService.record({
      actorUserId: "admin-1",
      actorRole: "ADMIN",
      action: "ITEM_CREATED",
      entityType: "ITEM",
      entityId: "item-1",
      requestId: "req-1",
      occurredAt: "2026-08-07T00:00:00.000Z",
      status: "SUCCEEDED",
      errorMessage: undefined,
      afterData: { itemId: "item-1" },
    });

    expect(roleUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "role-admin" },
      create: { id: "role-admin", code: "ADMIN", name: "管理员" },
    }));
    expect(userUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "admin-1" },
      create: expect.objectContaining({ name: "仓库管理员", roleId: "role-admin" }),
    }));

    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: "admin-1",
        action: "ITEM_CREATED",
        entityType: "ITEM",
        entityId: "item-1",
        requestId: "req-1",
        afterData: expect.objectContaining({
          itemId: "item-1",
          actorRole: "ADMIN",
          occurredAt: "2026-08-07T00:00:00.000Z",
          status: "SUCCEEDED",
        }),
      }),
    }));
  });
});
