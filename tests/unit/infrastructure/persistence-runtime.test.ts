import { afterEach, describe, expect, it, vi } from "vitest";

import { createPersistenceAdapters, readServerConfig } from "../../../apps/api/src/infrastructure/db/runtime.js";
import { InMemoryAuditService } from "../../../apps/api/src/infrastructure/audit/audit-service.js";
import { buildServer } from "../../../apps/api/src/server.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server runtime configuration", () => {
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
      NODE_ENV: "production",
      PERSISTENCE_DRIVER: "prisma",
      DATABASE_URL: "postgresql://warehouse:warehouse@db:5432/warehouse",
      API_BASE_URL: "http://warehouse.example.com",
      WEB_BASE_URL: "https://warehouse-web.example.com",
      SESSION_SECRET: "test-session-secret",
      LOCAL_AUTH_BYPASS: "false",
      WE_COM_CORP_ID: "corp-id",
      WE_COM_AGENT_ID: "1000001",
      WE_COM_SECRET: "secret",
    })).toThrowError("API_BASE_URL must use HTTPS when Enterprise WeChat callbacks are enabled in production");
  });

  it("does not start a fake prisma service while core inventory persistence is incomplete", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PERSISTENCE_DRIVER", "prisma");
    vi.stubEnv("DATABASE_URL", "postgresql://warehouse:warehouse@db:5432/warehouse");
    vi.stubEnv("API_BASE_URL", "http://localhost:3001");
    vi.stubEnv("WEB_BASE_URL", "http://localhost:5174");
    vi.stubEnv("SESSION_SECRET", "test-session-secret");

    expect(() => buildServer()).toThrowError(
      "PERSISTENCE_DRIVER=prisma is disabled until all core inventory flows use durable persistence",
    );
  });
});

describe("persistence adapters", () => {
  it("exposes the full core repository seam in memory mode", () => {
    const adapters = createPersistenceAdapters({ driver: "memory" });

    expect(adapters.auditService).toBeInstanceOf(InMemoryAuditService);
    expect(Object.keys(adapters.repositories)).toEqual([
      "users",
      "warehouses",
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
});
