import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getStructuralSeedData } from "../../prisma/seed.ts";

const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");
const schema = readFileSync(schemaPath, "utf8");

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

  it("enforces unique codes and accounting periods", () => {
    expect(schema).toMatch(/code\s+String\s+@unique/);
    expect(schema).toMatch(/periodCode\s+String\s+@unique/);
  });

  it("seeds only structural placeholder data", () => {
    const seedData = getStructuralSeedData();

    expect(seedData.warehouses).toHaveLength(3);
    expect(seedData.warehouses.every((warehouse) => warehouse.isPlaceholder)).toBe(true);
    expect(seedData.categories.map((category) => category.prefix)).toEqual(["BJ", "CY", "WP"]);
    expect(seedData.historicalRows).toEqual([]);
  });
});
