import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getStructuralSeedData } from "../../prisma/seed.ts";

const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");
const schema = readFileSync(schemaPath, "utf8");
const prismaConfigPath = resolve(process.cwd(), "prisma.config.ts");
const prismaConfig = readFileSync(prismaConfigPath, "utf8");
const migrationPath = resolve(process.cwd(), "prisma/migrations/00000000000000_init/migration.sql");
const migrationLockPath = resolve(process.cwd(), "prisma/migrations/migration_lock.toml");
const productionMigrationDirectory = readdirSync(resolve(process.cwd(), "prisma/migrations"))
  .find((entry) => entry.endsWith("_production_persistence"));
const productionMigrationPath = productionMigrationDirectory
  ? resolve(process.cwd(), "prisma/migrations", productionMigrationDirectory, "migration.sql")
  : "";

function modelBody(modelName: string): string {
  return schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
}

describe("database schema contract", () => {
  it("declares the full Task 1 model list", () => {
    const requiredModels = [
      "User",
      "Role",
      "Warehouse",
      "ItemCategory",
      "Item",
      "ApprovalRequest",
      "ApprovalLine",
      "InboundOrder",
      "InboundLine",
      "ProcurementBatch",
      "StockBalance",
      "OutboundOrder",
      "OutboundAllocation",
      "TransferOrder",
      "TransferLine",
      "ReturnOrder",
      "ReturnLine",
      "Stocktake",
      "StockAdjustment",
      "InventoryLedgerEntry",
      "AccountingPeriod",
      "SyncAttempt",
      "AuditLog",
    ];

    for (const modelName of requiredModels) {
      expect(schema).toContain(`model ${modelName} {`);
    }
  });

  it("keeps unique nullable selector mapping and one outbound per approval", () => {
    expect(schema).toMatch(/weComOptionKey\s+String\?\s+@unique/);
    expect(schema).toMatch(/weComSpNo\s+String\s+@unique/);
    expect(schema).toMatch(/approvalRequestId\s+String\s+@unique/);
  });

  it("stores quantities and amounts as Decimal fields", () => {
    expect(schema).toMatch(/requestedQuantity\s+Decimal/);
    expect(schema).toMatch(/originalQuantity\s+Decimal/);
    expect(schema).toMatch(/remainingQuantity\s+Decimal/);
    expect(schema).toMatch(/quantity\s+Decimal/);
    expect(schema).toMatch(/unitCost\s+Decimal/);
    expect(schema).toMatch(/amount\s+Decimal/);
  });

  it("pins quantity and amount precision explicitly", () => {
    expect(schema).toMatch(/requestedQuantity\s+Decimal\s+@db\.Decimal\(18,\s*4\)/);
    expect(schema).toMatch(/remainingQuantity\s+Decimal\s+@db\.Decimal\(18,\s*4\)/);
    expect(schema).toMatch(/unitCost\s+Decimal\s+@db\.Decimal\(18,\s*4\)/);
    expect(schema).toMatch(/amount\s+Decimal\s+@db\.Decimal\(18,\s*2\)/);
  });

  it("enforces unique codes and accounting periods", () => {
    expect(schema).toMatch(/code\s+String\s+@unique/);
    expect(schema).toMatch(/periodCode\s+String\s+@unique/);
  });

  it("declares key foreign-key relations", () => {
    expect(schema).toMatch(/role\s+Role\s+@relation\(fields: \[roleId\], references: \[id\]\)/);
    expect(schema).toMatch(/category\s+ItemCategory\s+@relation\(fields: \[categoryId\], references: \[id\]\)/);
    expect(schema).toMatch(/approvalRequest\s+ApprovalRequest\s+@relation\(fields: \[approvalRequestId\], references: \[id\](, onDelete: Restrict)?\)/);
    expect(schema).toMatch(/batch\s+ProcurementBatch\s+@relation\(fields: \[batchId\], references: \[id\]\)/);
  });

  it("anchors approval applicants and audit actors back to users with restrictive deletes", () => {
    expect(schema).toMatch(/applicant\s+User\s+@relation\(fields: \[applicantUserId\], references: \[id\], onDelete: Restrict\)/);
    expect(schema).toMatch(/actor\s+User\s+@relation\(fields: \[actorUserId\], references: \[id\], onDelete: Restrict\)/);
  });

  it("tracks warehouse outbound lifecycle separately from Enterprise WeChat approval status", () => {
    const approvalRequest = modelBody("ApprovalRequest");

    expect(approvalRequest).toMatch(/^\s*outboundStatus\s+String\s+@default\("NONE"\)\s*$/m);
    expect(approvalRequest).toMatch(/^\s*cancelReason\s+String\?\s*$/m);
  });

  it("requires restrictive stocktake and batch lineage for confirmed records", () => {
    const stockAdjustment = modelBody("StockAdjustment");
    const ledgerEntry = modelBody("InventoryLedgerEntry");

    expect(stockAdjustment).toMatch(/^\s*stocktakeId\s+String\s*$/m);
    expect(stockAdjustment).toMatch(/stocktake\s+Stocktake\s+@relation\(fields: \[stocktakeId\], references: \[id\], onDelete: Restrict\)/);
    expect(ledgerEntry).toMatch(/^\s*batchId\s+String\s*$/m);
    expect(ledgerEntry).toMatch(/batch\s+ProcurementBatch\s+@relation\(fields: \[batchId\], references: \[id\], onDelete: Restrict\)/);
  });

  it("keeps stock balances and confirmed relations uniquely scoped", () => {
    expect(schema).toMatch(/@@unique\(\[warehouseId,\s*itemId,\s*batchId\]\)/);
    expect(schema).toMatch(/approvalRequest\s+ApprovalRequest\s+@relation\(fields: \[approvalRequestId\], references: \[id\], onDelete: Restrict\)/);
    expect(schema).toMatch(/outboundOrder\s+OutboundOrder\s+@relation\(fields: \[outboundOrderId\], references: \[id\], onDelete: Restrict\)/);
  });

  it("keeps DATABASE_URL configured through Prisma 7 config", () => {
    expect(prismaConfig).toContain('url: env("DATABASE_URL")');
    expect(prismaConfig).toContain("shadowDatabaseUrl");
    expect(prismaConfig).toContain("process.env.SHADOW_DATABASE_URL");
  });

  it("checks in an initial PostgreSQL migration matching the schema contract", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(migrationLockPath)).toBe(true);

    const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
    const migrationLock = existsSync(migrationLockPath) ? readFileSync(migrationLockPath, "utf8") : "";

    expect(migrationLock).toContain('provider = "postgresql"');
    expect(migration).toContain('CREATE TABLE "StockAdjustment"');
    expect(migration).toContain('"stocktakeId" TEXT NOT NULL');
    expect(migration).toContain('"batchId" TEXT NOT NULL');
    expect(migration).toContain('"StockAdjustment_stocktakeId_fkey"');
    expect(migration).toContain('"InventoryLedgerEntry_batchId_fkey"');
    expect(migration).toContain('ON DELETE RESTRICT');
    expect(migration).toContain('CREATE UNIQUE INDEX "StockBalance_warehouseId_itemId_batchId_key"');
  });

  it("checks in a production persistence migration for the approval lifecycle fields", () => {
    expect(productionMigrationDirectory).toBeTruthy();
    expect(existsSync(productionMigrationPath)).toBe(true);

    const migration = existsSync(productionMigrationPath) ? readFileSync(productionMigrationPath, "utf8") : "";
    expect(migration).toContain('ADD COLUMN "outboundStatus" TEXT NOT NULL DEFAULT \'NONE\'');
    expect(migration).toContain('ADD COLUMN "cancelReason" TEXT');
  });

  it("seeds only structural placeholder data", () => {
    const seedData = getStructuralSeedData();

    expect(seedData.roles).toEqual([
      { id: "role-admin", code: "ADMIN", name: "管理员" },
      { id: "role-finance", code: "FINANCE", name: "财务" },
      { id: "role-applicant", code: "APPLICANT", name: "领用人" },
    ]);
    expect(seedData.warehouses).toHaveLength(3);
    expect(seedData.warehouses.map(({ id, code }) => ({ id, code }))).toEqual([
      { id: "warehouse-1", code: "WH-01" },
      { id: "warehouse-2", code: "WH-02" },
      { id: "warehouse-3", code: "WH-03" },
    ]);
    expect(seedData.warehouses.every((warehouse) => warehouse.isPlaceholder)).toBe(true);
    expect(seedData.categories.map(({ id, code, prefix }) => ({ id, code, prefix }))).toEqual([
      { id: "category-bj", code: "CATEGORY_BJ", prefix: "BJ" },
      { id: "category-cy", code: "CATEGORY_CY", prefix: "CY" },
      { id: "category-wp", code: "CATEGORY_WP", prefix: "WP" },
    ]);
    expect(seedData.historicalRows).toEqual([]);
  });
});
