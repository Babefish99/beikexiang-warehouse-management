import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getStructuralSeedData } from "../../prisma/seed.ts";

const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");
const schema = readFileSync(schemaPath, "utf8");
const prismaConfigPath = resolve(process.cwd(), "prisma.config.ts");
const prismaConfig = readFileSync(prismaConfigPath, "utf8");

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

  it("keeps stock balances and confirmed relations uniquely scoped", () => {
    expect(schema).toMatch(/@@unique\(\[warehouseId,\s*itemId,\s*batchId\]\)/);
    expect(schema).toMatch(/approvalRequest\s+ApprovalRequest\s+@relation\(fields: \[approvalRequestId\], references: \[id\], onDelete: Restrict\)/);
    expect(schema).toMatch(/outboundOrder\s+OutboundOrder\s+@relation\(fields: \[outboundOrderId\], references: \[id\], onDelete: Restrict\)/);
  });

  it("keeps DATABASE_URL configured through Prisma 7 config", () => {
    expect(prismaConfig).toContain('url: env("DATABASE_URL")');
  });

  it("seeds only structural placeholder data", () => {
    const seedData = getStructuralSeedData();

    expect(seedData.warehouses).toHaveLength(3);
    expect(seedData.warehouses.every((warehouse) => warehouse.isPlaceholder)).toBe(true);
    expect(seedData.categories.map((category) => category.prefix)).toEqual(["BJ", "CY", "WP"]);
    expect(seedData.historicalRows).toEqual([]);
  });
});
