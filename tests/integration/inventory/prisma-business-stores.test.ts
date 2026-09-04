import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OutboundAllocator } from "../../../apps/api/src/application/inventory/outbound-allocator.js";
import { OpeningStockService } from "../../../apps/api/src/application/inventory/opening-stock-service.js";
import { OutboundService } from "../../../apps/api/src/application/inventory/outbound-service.js";
import { ReturnService } from "../../../apps/api/src/application/inventory/return-service.js";
import { StocktakeService } from "../../../apps/api/src/application/inventory/stocktake-service.js";
import { TransferService } from "../../../apps/api/src/application/inventory/transfer-service.js";
import { PeriodCloseService } from "../../../apps/api/src/application/periods/period-close-service.js";
import { ApprovalSyncService, type ApprovalSyncRecord, type ApprovalSyncStore } from "../../../apps/api/src/application/wecom/approval-sync-service.js";
import type { WeComApprovalPayload } from "../../../apps/api/src/infrastructure/wecom/approval-parser.js";
import { createAccountingPeriod } from "../../../apps/api/src/domain/periods/accounting-period.js";
import { PrismaAccountingPeriodStore } from "../../../apps/api/src/infrastructure/db/prisma-accounting-period-store.js";
import { PrismaApprovalSyncStore } from "../../../apps/api/src/infrastructure/db/prisma-approval-sync-store.js";
import { PrismaInventoryEntryStore } from "../../../apps/api/src/infrastructure/db/prisma-inventory-entry-store.js";
import { PrismaMovementStore } from "../../../apps/api/src/infrastructure/db/prisma-movement-store.js";
import { PrismaOutboundStore } from "../../../apps/api/src/infrastructure/db/prisma-outbound-store.js";
import { PrismaReportSource } from "../../../apps/api/src/infrastructure/db/prisma-report-source.js";
import { PrismaStocktakeStore } from "../../../apps/api/src/infrastructure/db/prisma-stocktake-store.js";
import { seedStructuralData } from "../../../prisma/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaName = `warehouse_task3_${process.pid}_${Date.now()}`;
const itemId = "task3-item";
const secondItemId = "task3-item-2";
const historicalMigrationPaths = [
  "prisma/migrations/00000000000000_init/migration.sql",
  "prisma/migrations/20260811163000_production_persistence/migration.sql",
  "prisma/migrations/20260811171500_stocktake_quantity_snapshots/migration.sql",
  "prisma/migrations/20260814110000_inbound_batch_sequences/migration.sql",
  "prisma/migrations/20260824170000_opening_stock_import/migration.sql",
];
const approvalIntentMigrationPath = "prisma/migrations/20260904183000_approval_intent_outbound_decisions/migration.sql";
const legacySchemaFixturePath = "tests/integration/inventory/fixtures/prisma-business-stores-legacy.prisma";

async function applyMigrations(client: PoolClient, paths: string[]) {
  for (const path of paths) {
    await client.query(readFileSync(resolve(process.cwd(), path), "utf8"));
  }
}

function schemaUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

type PrismaClientConstructor = new (options: { adapter: PrismaPg }) => PrismaClient;

async function createLegacyClient(connectionString: string): Promise<{
  client: PrismaClient;
  Client: PrismaClientConstructor;
  generatedRoot: string;
}> {
  const temporaryRoot = resolve(process.cwd(), ".tmp_runtime");
  mkdirSync(temporaryRoot, { recursive: true });
  const generatedRoot = mkdtempSync(join(temporaryRoot, "warehouse-legacy-prisma-"));
  const generatedClientPath = join(generatedRoot, "client");
  const temporarySchemaPath = join(generatedRoot, "schema.prisma");
  const prismaOutputPath = generatedClientPath.replaceAll("\\", "/");
  const legacySchema = readFileSync(resolve(process.cwd(), legacySchemaFixturePath), "utf8")
    .replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output   = "${prismaOutputPath}"`);
  writeFileSync(temporarySchemaPath, legacySchema);
  const prismaCliPath = resolve(process.cwd(), "node_modules/prisma/build/index.js");
  const childEnvironment = { ...process.env, DATABASE_URL: connectionString };
  execFileSync(process.execPath, [prismaCliPath, "generate", "--schema", temporarySchemaPath], {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: "pipe",
  });
  const legacyClientModule = await import(pathToFileURL(join(generatedClientPath, "index.js")).href) as { PrismaClient: PrismaClientConstructor };
  return {
    client: new legacyClientModule.PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema: schemaName }) }),
    Client: legacyClientModule.PrismaClient,
    generatedRoot,
  };
}

describe.skipIf(!databaseUrl)("Prisma inventory business stores", () => {
  let adminPool: Pool;
  let prisma: PrismaClient;
  let isolatedDatabaseUrl: string;
  let legacyClientRoot: string;
  let LegacyPrismaClient: PrismaClientConstructor;

  beforeAll(async () => {
    if (!/^warehouse_task3_\d+_\d+$/.test(schemaName)) throw new Error("unsafe test schema name");
    isolatedDatabaseUrl = schemaUrl(databaseUrl as string);
    adminPool = new Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    const migrationPool = new Pool({ connectionString: isolatedDatabaseUrl });
    const migrationClient = await migrationPool.connect();
    try {
      await migrationClient.query(`SET search_path TO "${schemaName}"`);
      await applyMigrations(migrationClient, historicalMigrationPaths);
    } finally {
      migrationClient.release();
      await migrationPool.end();
    }
    ({ client: prisma, Client: LegacyPrismaClient, generatedRoot: legacyClientRoot } = await createLegacyClient(isolatedDatabaseUrl));
    await seedStructuralData(prisma);
    await prisma.item.create({
      data: {
        id: itemId,
        code: "BJ-TASK3",
        name: "Task 3 test item",
        unit: "box",
        categoryId: "category-bj",
        weComOptionKey: "task3-option",
      },
    });
    await prisma.item.create({
      data: {
        id: secondItemId,
        code: "BJ-TASK3-2",
        name: "Task 3 second test item",
        unit: "box",
        categoryId: "category-bj",
        weComOptionKey: "task3-option-2",
      },
    });
  });

  beforeEach(async () => {
    await prisma.openingStockImport.deleteMany();
    await prisma.returnLine.deleteMany();
    await prisma.returnOrder.deleteMany();
    await prisma.inventoryLedgerEntry.deleteMany();
    await prisma.transferLine.deleteMany();
    await prisma.transferOrder.deleteMany();
    await prisma.stockAdjustment.deleteMany();
    await prisma.stocktake.deleteMany();
    await prisma.outboundAllocation.deleteMany();
    await prisma.outboundOrder.deleteMany();
    await prisma.inboundLine.deleteMany();
    await prisma.inboundOrder.deleteMany();
    await prisma.stockBalance.deleteMany();
    await prisma.procurementBatch.deleteMany();
    await prisma.inboundBatchSequence.deleteMany();
    await prisma.approvalLine.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.syncAttempt.deleteMany();
    await prisma.accountingPeriod.deleteMany();
    await prisma.user.deleteMany({ where: { id: { startsWith: "task3-" } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminPool.end();
    }
    if (legacyClientRoot) rmSync(legacyClientRoot, { recursive: true, force: true });
  });

  it("runs the legacy store contract against the pre-decision schema", async () => {
    const [{ decisionTable }] = await prisma.$queryRawUnsafe<Array<{ decisionTable: string | null }>>(
      `SELECT to_regclass('"${schemaName}"."OutboundDecisionLine"')::text AS "decisionTable"`,
    );

    expect(decisionTable).toBeNull();
  });

  async function recordStock(options: { warehouseId?: string; itemId?: string; batchNo?: string; autoGenerateBatchNo?: boolean; quantity?: string; source?: "INBOUND" | "OPENING_STOCK" } = {}) {
    const source = options.source ?? "INBOUND";
    return new PrismaInventoryEntryStore(prisma).recordStockEntry({
      warehouseId: options.warehouseId ?? "warehouse-1",
      itemId: options.itemId ?? itemId,
      batchNo: options.autoGenerateBatchNo ? undefined : options.batchNo ?? `batch-${crypto.randomUUID()}`,
      autoGenerateBatchNo: options.autoGenerateBatchNo ?? false,
      quantity: options.quantity ?? "10",
      unitCost: "12.5",
      purchasedAt: "2026-08-11T01:00:00.000Z",
      ledgerType: source === "INBOUND" ? "INBOUND" : "OPENING_BALANCE",
      referenceType: source === "INBOUND" ? "INBOUND_ORDER" : "OPENING_STOCK",
      referenceId: `${source.toLowerCase()}-${crypto.randomUUID()}`,
      occurredAt: "2026-08-11T01:00:00.000Z",
      operatorId: "task3-operator",
    });
  }

  it("assigns globally unique daily batch numbers across concurrent warehouses and items", async () => {
    const first = await recordStock({ autoGenerateBatchNo: true });
    const [second, third] = await Promise.all([
      recordStock({ autoGenerateBatchNo: true, warehouseId: "warehouse-1", itemId: secondItemId }),
      recordStock({ autoGenerateBatchNo: true, warehouseId: "warehouse-2", itemId }),
    ]);

    expect([first.batchNo, second.batchNo, third.batchNo].sort()).toEqual([
      "20260811-001",
      "20260811-002",
      "20260811-003",
    ]);
    await expect(prisma.procurementBatch.findMany({
      where: { batchNo: { startsWith: "20260811-" } },
      select: { batchNo: true },
      orderBy: { batchNo: "asc" },
    })).resolves.toEqual([
      { batchNo: "20260811-001" },
      { batchNo: "20260811-002" },
      { batchNo: "20260811-003" },
    ]);
  });

  async function createApproval(quantity = "5") {
    await prisma.role.upsert({
      where: { id: "role-applicant" },
      update: {},
      create: { id: "role-applicant", code: "APPLICANT", name: "Applicant" },
    });
    await prisma.user.upsert({
      where: { id: "task3-applicant" },
      update: {},
      create: {
        id: "task3-applicant",
        weComUserId: "task3-applicant",
        name: "Task 3 Applicant",
        roleId: "role-applicant",
      },
    });
    return prisma.approvalRequest.create({
      data: {
        id: `task3-approval-${crypto.randomUUID()}`,
        weComSpNo: String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, "0"),
        applicantUserId: "task3-applicant",
        applicantName: "Task 3 Applicant",
        purpose: "integration test",
        status: "APPROVED",
        outboundStatus: "PENDING_OUTBOUND",
        submittedAt: new Date("2026-08-11T00:00:00.000Z"),
        approvedAt: new Date("2026-08-11T00:05:00.000Z"),
        lines: {
          create: { id: `task3-line-${crypto.randomUUID()}`, itemId, requestedQuantity: quantity, unit: "box" },
        },
      },
      include: { lines: true },
    });
  }

  function openingStockService() {
    return new OpeningStockService(new PrismaInventoryEntryStore(prisma), {
      warehouseService: { list: () => prisma.warehouse.findMany() },
      itemService: { list: () => prisma.item.findMany() },
    });
  }

  it("creates inbound/opening orders, lines, batches, balances, and ledger entries atomically", async () => {
    const inbound = await recordStock({ batchNo: "TASK3-INBOUND" });
    const opening = await recordStock({ batchNo: "TASK3-OPENING", source: "OPENING_STOCK" });

    await expect(prisma.inboundOrder.findUnique({ where: { id: inbound.orderId }, include: { lines: true } })).resolves.toMatchObject({
      source: "INBOUND",
      operatorId: "task3-operator",
      lines: [{ itemId, batchId: inbound.batchId }],
    });
    await expect(prisma.inboundOrder.findUnique({ where: { id: opening.orderId } })).resolves.toMatchObject({ source: "OPENING_STOCK" });
    const inboundBalance = await prisma.stockBalance.findUniqueOrThrow({
      where: { warehouseId_itemId_batchId: { warehouseId: "warehouse-1", itemId, batchId: inbound.batchId } },
    });
    expect({ remainingQuantity: inboundBalance.remainingQuantity.toString(), unitCost: inboundBalance.unitCost.toString() }).toEqual({ remainingQuantity: "10", unitCost: "12.5" });
    await expect(prisma.inventoryLedgerEntry.findMany({ where: { referenceId: { in: [inbound.orderId, opening.orderId] } }, orderBy: { type: "asc" } })).resolves.toMatchObject([
      { referenceId: inbound.orderId, type: "INBOUND" },
      { referenceId: opening.orderId, type: "OPENING_BALANCE" },
    ]);

    const orderCount = await prisma.inboundOrder.count();
    const ledgerCount = await prisma.inventoryLedgerEntry.count();
    await expect(recordStock({ batchNo: "TASK3-INBOUND" })).rejects.toMatchObject({
      message: "batch number already exists",
      statusCode: 409,
    });
    await expect(prisma.inboundOrder.count()).resolves.toBe(orderCount);
    await expect(prisma.inventoryLedgerEntry.count()).resolves.toBe(ledgerCount);
  });

  it("returns the stable batch conflict after automatic batch retries are exhausted", async () => {
    await recordStock({ batchNo: "20260811-001" });
    await prisma.inboundBatchSequence.create({
      data: { purchasedDate: "20260811", lastSequence: 0 },
    });

    await expect(recordStock({ autoGenerateBatchNo: true })).rejects.toMatchObject({
      message: "batch number already exists",
      statusCode: 409,
    });
    await expect(prisma.inboundBatchSequence.findUnique({
      where: { purchasedDate: "20260811" },
      select: { lastSequence: true },
    })).resolves.toEqual({ lastSequence: 0 });
  });

  it("rolls back the complete opening-stock request when row two conflicts", async () => {
    await recordStock({ warehouseId: "warehouse-2", batchNo: "TASK3-OPENING-DUPLICATE" });
    const before = {
      orders: await prisma.inboundOrder.count(),
      batches: await prisma.procurementBatch.count(),
      balances: await prisma.stockBalance.count(),
      ledger: await prisma.inventoryLedgerEntry.count(),
    };

    await expect(openingStockService().create({
      verifiedBy: "task3-operator",
      rows: [
        { warehouseId: "warehouse-1", itemId, batchNo: "TASK3-OPENING-ROW-1", quantity: "4", unitCost: "2" },
        { warehouseId: "warehouse-2", itemId, batchNo: "TASK3-OPENING-DUPLICATE", quantity: "6", unitCost: "3" },
      ],
    })).rejects.toMatchObject({
      message: "batch number already exists",
      statusCode: 409,
    });

    await expect(prisma.inboundOrder.count()).resolves.toBe(before.orders);
    await expect(prisma.procurementBatch.count()).resolves.toBe(before.batches);
    await expect(prisma.stockBalance.count()).resolves.toBe(before.balances);
    await expect(prisma.inventoryLedgerEntry.count()).resolves.toBe(before.ledger);
    await expect(prisma.procurementBatch.findFirst({ where: { batchNo: "TASK3-OPENING-ROW-1" } })).resolves.toBeNull();
  });

  it("uses one order and reference for a complete opening-stock submission", async () => {
    const result = await openingStockService().create({
      verifiedBy: "task3-operator",
      rows: [
        { warehouseId: "warehouse-1", itemId, batchNo: "TASK3-OPENING-A", quantity: "4", unitCost: "2" },
        { warehouseId: "warehouse-1", itemId, batchNo: "TASK3-OPENING-B", quantity: "6", unitCost: "3" },
      ],
    });

    const orders = await prisma.inboundOrder.findMany({ where: { source: "OPENING_STOCK" }, include: { lines: true } });
    expect(result.batchIds).toHaveLength(2);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.lines).toHaveLength(2);
    const ledger = await prisma.inventoryLedgerEntry.findMany({ where: { type: "OPENING_BALANCE" } });
    expect(new Set(ledger.map((entry) => entry.referenceId))).toEqual(new Set([orders[0]!.id]));
  });

  it("creates one correctly attributed opening-stock order per warehouse", async () => {
    const result = await openingStockService().create({
      verifiedBy: "task3-operator",
      rows: [
        { warehouseId: "warehouse-1", itemId, batchNo: "TASK3-OPENING-WH-1", quantity: "4", unitCost: "2" },
        { warehouseId: "warehouse-2", itemId, batchNo: "TASK3-OPENING-WH-2", quantity: "6", unitCost: "3" },
      ],
    });

    const orders = await prisma.inboundOrder.findMany({
      where: { source: "OPENING_STOCK" },
      include: { lines: { include: { batch: true } } },
      orderBy: { warehouseId: "asc" },
    });
    expect(result.batchIds).toHaveLength(2);
    expect(orders.map((order) => ({
      warehouseId: order.warehouseId,
      lineWarehouses: order.lines.map((line) => line.batch.warehouseId),
    }))).toEqual([
      { warehouseId: "warehouse-1", lineWarehouses: ["warehouse-1"] },
      { warehouseId: "warehouse-2", lineWarehouses: ["warehouse-2"] },
    ]);
    const orderIdsByWarehouse = new Map(orders.map((order) => [order.warehouseId, order.id]));
    const ledger = await prisma.inventoryLedgerEntry.findMany({ where: { type: "OPENING_BALANCE" }, orderBy: { warehouseId: "asc" } });
    expect(ledger.map((entry) => ({ warehouseId: entry.warehouseId, referenceId: entry.referenceId }))).toEqual([
      { warehouseId: "warehouse-1", referenceId: orderIdsByWarehouse.get("warehouse-1") },
      { warehouseId: "warehouse-2", referenceId: orderIdsByWarehouse.get("warehouse-2") },
    ]);
  });

  it("commits outbound stock, allocation, ledger, and approval closure in one transaction", async () => {
    const stock = await recordStock({ batchNo: "TASK3-OUTBOUND" });
    const approval = await createApproval("5");
    const service = new OutboundService(new PrismaOutboundStore(prisma));

    const result = await service.confirm({
      approvalId: approval.id,
      allocations: [{ approvalLineId: approval.lines[0]!.id, warehouseId: "warehouse-1", batchId: stock.batchId, quantity: "5" }],
    });

    expect(result).toMatchObject({ approvalId: approval.id, status: "COMPLETED", actualQuantity: "5", amount: "62.50" });
    expect((await prisma.stockBalance.findFirstOrThrow({ where: { batchId: stock.batchId } })).remainingQuantity.toString()).toBe("5");
    expect((await prisma.procurementBatch.findUniqueOrThrow({ where: { id: stock.batchId } })).remainingQuantity.toString()).toBe("5");
    const storedOutbound = await prisma.outboundOrder.findUniqueOrThrow({ where: { id: result.id }, include: { allocations: true } });
    const [storedAllocationLink] = await prisma.$queryRawUnsafe<Array<{ approvalLineId: string }>>(
      `SELECT "approvalLineId" FROM "${schemaName}"."OutboundAllocation" WHERE "outboundOrderId" = $1`,
      result.id,
    );
    expect(storedOutbound.orderNo).toMatch(/^OUT-/);
    expect(storedAllocationLink?.approvalLineId).toBe(approval.lines[0]!.id);
    expect(storedOutbound.allocations.map((allocation) => ({ quantity: allocation.quantity.toString(), originalQuantity: allocation.originalQuantity.toString() }))).toEqual([
      { quantity: "5", originalQuantity: "5" },
    ]);
    await expect(prisma.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).resolves.toMatchObject({ outboundStatus: "COMPLETED" });
    const outboundLedger = await prisma.inventoryLedgerEntry.findFirstOrThrow({ where: { referenceId: result.id } });
    expect({ type: outboundLedger.type, quantity: outboundLedger.quantity.toString() }).toEqual({ type: "OUTBOUND", quantity: "-5" });
  });

  it("rejects a stale outbound balance without partially closing the approval", async () => {
    const stock = await recordStock({ batchNo: "TASK3-STALE" });
    const approvalRecord = await createApproval("5");
    const store = new PrismaOutboundStore(prisma);
    const approval = await store.getApproval(approvalRecord.id);
    const batches = await store.listBatches([itemId]);
    const validation = new OutboundAllocator().validate({
      lines: approval!.lines,
      batches,
      allocations: [{ approvalLineId: approvalRecord.lines[0]!.id, warehouseId: "warehouse-1", batchId: stock.batchId, quantity: "5" }],
    });
    await prisma.stockBalance.updateMany({ where: { batchId: stock.batchId }, data: { remainingQuantity: "9" } });
    await prisma.procurementBatch.update({ where: { id: stock.batchId }, data: { remainingQuantity: "9" } });

    await expect(store.commitOutbound(approval!, validation)).rejects.toThrow(/stock balance changed.*retry/i);
    await expect(prisma.outboundOrder.count()).resolves.toBe(0);
    await expect(prisma.inventoryLedgerEntry.count({ where: { type: "OUTBOUND" } })).resolves.toBe(0);
    await expect(prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalRecord.id } })).resolves.toMatchObject({ outboundStatus: "PENDING_OUTBOUND" });
  });

  it("conditionally decrements a shared batch once for split allocations and supports zero issue", async () => {
    const stock = await recordStock({ batchNo: "TASK3-SPLIT" });
    const approval = await createApproval("5");
    const service = new OutboundService(new PrismaOutboundStore(prisma));

    await expect(service.confirm({
      approvalId: approval.id,
      allocations: [
        { approvalLineId: approval.lines[0]!.id, warehouseId: "warehouse-1", batchId: stock.batchId, quantity: "2" },
        { approvalLineId: approval.lines[0]!.id, warehouseId: "warehouse-1", batchId: stock.batchId, quantity: "3" },
      ],
    })).resolves.toMatchObject({ status: "COMPLETED", actualQuantity: "5" });
    expect((await prisma.stockBalance.findFirstOrThrow({ where: { batchId: stock.batchId } })).remainingQuantity.toString()).toBe("5");

    const zeroApproval = await createApproval("1");
    await expect(service.confirm({ approvalId: zeroApproval.id, allocations: [], reason: "no stock available" })).resolves.toMatchObject({
      status: "UNAVAILABLE",
      actualQuantity: "0",
      amount: "0.00",
    });
  });

  it("persists transfers and cumulative returns while preserving the batch cost", async () => {
    const stock = await recordStock({ batchNo: "TASK3-MOVEMENT" });
    const movementStore = new PrismaMovementStore(prisma);
    const transfer = await new TransferService(movementStore).complete({
      itemId,
      batchId: stock.batchId,
      sourceWarehouseId: "warehouse-1",
      destinationWarehouseId: "warehouse-2",
      quantity: "4",
      reason: "move to second warehouse",
    });

    expect(transfer).toMatchObject({ status: "COMPLETED", unitCost: "12.5" });
    const storedTransfer = await prisma.transferOrder.findUniqueOrThrow({ where: { id: transfer.transferId }, include: { lines: true } });
    expect(storedTransfer.transferNo).toMatch(/^TRF-/);
    expect(storedTransfer.lines.map((line) => ({ quantity: line.quantity.toString(), unitCost: line.unitCost.toString() }))).toEqual([{ quantity: "4", unitCost: "12.5" }]);
    const transferBalances = await prisma.stockBalance.findMany({ where: { batchId: stock.batchId }, orderBy: { warehouseId: "asc" } });
    expect(transferBalances.map((balance) => ({ warehouseId: balance.warehouseId, remainingQuantity: balance.remainingQuantity.toString(), unitCost: balance.unitCost.toString() }))).toEqual([
      { warehouseId: "warehouse-1", remainingQuantity: "6", unitCost: "12.5" },
      { warehouseId: "warehouse-2", remainingQuantity: "4", unitCost: "12.5" },
    ]);
    const transferLedger = await prisma.inventoryLedgerEntry.findMany({ where: { referenceId: transfer.transferId }, orderBy: { type: "asc" } });
    expect(transferLedger.map((entry) => ({ type: entry.type, quantity: entry.quantity.toString() }))).toEqual([{ type: "TRANSFER_IN", quantity: "4" }, { type: "TRANSFER_OUT", quantity: "-4" }]);

    const approval = await createApproval("3");
    const outbound = await new OutboundService(new PrismaOutboundStore(prisma)).confirm({
      approvalId: approval.id,
      allocations: [{ approvalLineId: approval.lines[0]!.id, warehouseId: "warehouse-2", batchId: stock.batchId, quantity: "3" }],
    });
    const allocation = await prisma.outboundAllocation.findFirstOrThrow({ where: { outboundOrderId: outbound.id } });
    const returned = await new ReturnService(movementStore).create({ outboundAllocationId: allocation.id, quantity: "2", reason: "unused" });

    expect(returned).toMatchObject({ status: "COMPLETED", unitCost: "12.5" });
    const storedReturn = await prisma.returnOrder.findUniqueOrThrow({ where: { id: returned.returnId }, include: { lines: true } });
    expect(storedReturn).toMatchObject({ returnNo: expect.stringMatching(/^RET-/), originalOutboundId: outbound.id });
    expect(storedReturn.lines.map((line) => ({ outboundAllocationId: line.outboundAllocationId, quantity: line.quantity.toString(), unitCost: line.unitCost.toString() }))).toEqual([{ outboundAllocationId: allocation.id, quantity: "2", unitCost: "12.5" }]);
    await expect(new ReturnService(movementStore).create({ outboundAllocationId: allocation.id, quantity: "2", reason: "too much" })).rejects.toThrow("return quantity exceeds original issued quantity");
  });

  it("persists stocktake adjustment facts and durable period closure", async () => {
    const stock = await recordStock({ batchNo: "TASK3-STOCKTAKE" });
    const periodStore = new PrismaAccountingPeriodStore(prisma);
    const stocktakeStore = new PrismaStocktakeStore(prisma);
    const service = new StocktakeService(stocktakeStore, periodStore);

    const result = await service.record({
      periodCode: "2026-08",
      operatorId: "task3-operator",
      warehouseId: "warehouse-1",
      itemId,
      batchId: stock.batchId,
      bookQuantity: "10",
      actualQuantity: "8",
      reason: "damaged",
    });

    const storedStocktake = await prisma.stocktake.findUniqueOrThrow({ where: { id: result.stocktakeId }, include: { adjustments: true } });
    expect(storedStocktake).toMatchObject({ stocktakeNo: expect.stringMatching(/^STK-/), periodCode: "2026-08", operatorId: "task3-operator" });
    expect(storedStocktake.adjustments.map((adjustment) => ({ quantity: adjustment.quantity.toString(), reason: adjustment.reason, operatorId: adjustment.operatorId }))).toEqual([{ quantity: "-2", reason: "damaged", operatorId: "task3-operator" }]);
    expect((await prisma.stockBalance.findFirstOrThrow({ where: { batchId: stock.batchId } })).remainingQuantity.toString()).toBe("8");
    const stocktakeLedger = await prisma.inventoryLedgerEntry.findFirstOrThrow({ where: { referenceId: result.stocktakeId } });
    expect({ type: stocktakeLedger.type, quantity: stocktakeLedger.quantity.toString() }).toEqual({ type: "STOCKTAKE_ADJUSTMENT", quantity: "-2" });

    await new TransferService(new PrismaMovementStore(prisma)).complete({
      itemId,
      batchId: stock.batchId,
      sourceWarehouseId: "warehouse-1",
      destinationWarehouseId: "warehouse-2",
      quantity: "1",
      reason: "movement after stocktake",
    });
    const immutableQuantities = await prisma.$queryRawUnsafe<Array<{ bookQuantity: string; actualQuantity: string }>>(
      `SELECT "bookQuantity"::text, "actualQuantity"::text FROM "${schemaName}"."StockAdjustment" WHERE "stocktakeId" = $1`,
      result.stocktakeId,
    );
    expect(immutableQuantities).toEqual([{ bookQuantity: "10.0000", actualQuantity: "8.0000" }]);
    expect((await prisma.stockBalance.findFirstOrThrow({ where: { warehouseId: "warehouse-1", batchId: stock.batchId } })).remainingQuantity.toString()).toBe("7");

    const closed = await new PeriodCloseService(periodStore).close({
      period: createAccountingPeriod({ code: "2026-08" }),
      pendingOutboundCount: 0,
      unpostedAdjustmentCount: 0,
    });
    expect(closed.status).toBe("CLOSED");
    await expect(new PrismaAccountingPeriodStore(prisma).get("2026-08")).resolves.toMatchObject({ status: "CLOSED" });
    await expect(recordStock({ batchNo: "TASK3-CLOSED" })).rejects.toThrow("closed period: 2026-08");
  });

  it("blocks every Prisma inventory mutation path after the current period is closed", async () => {
    const stock = await recordStock({ batchNo: "TASK3-CLOSED-PATHS", quantity: "20" });
    const movementStore = new PrismaMovementStore(prisma);
    const outboundService = new OutboundService(new PrismaOutboundStore(prisma));
    const issuedApproval = await createApproval("2");
    const issued = await outboundService.confirm({
      approvalId: issuedApproval.id,
      allocations: [{ approvalLineId: issuedApproval.lines[0]!.id, warehouseId: "warehouse-1", batchId: stock.batchId, quantity: "2" }],
    });
    const allocation = await prisma.outboundAllocation.findFirstOrThrow({ where: { outboundOrderId: issued.id } });
    const confirmApproval = await createApproval("1");
    const cancelApproval = await createApproval("1");
    const periodCode = new Date().toISOString().slice(0, 7);
    await prisma.accountingPeriod.upsert({
      where: { periodCode },
      update: { status: "CLOSED", closedAt: new Date() },
      create: { periodCode, status: "CLOSED", closedAt: new Date() },
    });
    const before = {
      balance: (await prisma.stockBalance.findFirstOrThrow({ where: { warehouseId: "warehouse-1", batchId: stock.batchId } })).remainingQuantity.toString(),
      outboundOrders: await prisma.outboundOrder.count(),
      transfers: await prisma.transferOrder.count(),
      returns: await prisma.returnOrder.count(),
      stocktakes: await prisma.stocktake.count(),
      ledger: await prisma.inventoryLedgerEntry.count(),
    };

    await expect(outboundService.confirm({
      approvalId: confirmApproval.id,
      allocations: [{ approvalLineId: confirmApproval.lines[0]!.id, warehouseId: "warehouse-1", batchId: stock.batchId, quantity: "1" }],
    })).rejects.toThrow(`closed period: ${periodCode}`);
    await expect(outboundService.cancelBeforeIssue({ approvalId: cancelApproval.id, reason: "cancelled" })).rejects.toThrow(`closed period: ${periodCode}`);
    await expect(new TransferService(movementStore).complete({ itemId, batchId: stock.batchId, sourceWarehouseId: "warehouse-1", destinationWarehouseId: "warehouse-2", quantity: "1", reason: "closed transfer" })).rejects.toThrow(`closed period: ${periodCode}`);
    await expect(new ReturnService(movementStore).create({ outboundAllocationId: allocation.id, quantity: "1", reason: "closed return" })).rejects.toThrow(`closed period: ${periodCode}`);
    await expect(new StocktakeService(new PrismaStocktakeStore(prisma), new PrismaAccountingPeriodStore(prisma)).record({ periodCode, operatorId: "task3-operator", warehouseId: "warehouse-1", itemId, batchId: stock.batchId, bookQuantity: before.balance, actualQuantity: "17", reason: "closed stocktake" })).rejects.toThrow(`closed period: ${periodCode}`);

    expect((await prisma.stockBalance.findFirstOrThrow({ where: { warehouseId: "warehouse-1", batchId: stock.batchId } })).remainingQuantity.toString()).toBe(before.balance);
    await expect(prisma.outboundOrder.count()).resolves.toBe(before.outboundOrders);
    await expect(prisma.transferOrder.count()).resolves.toBe(before.transfers);
    await expect(prisma.returnOrder.count()).resolves.toBe(before.returns);
    await expect(prisma.stocktake.count()).resolves.toBe(before.stocktakes);
    await expect(prisma.inventoryLedgerEntry.count()).resolves.toBe(before.ledger);
    await expect(prisma.approvalRequest.findUniqueOrThrow({ where: { id: confirmApproval.id } })).resolves.toMatchObject({ outboundStatus: "PENDING_OUTBOUND" });
    await expect(prisma.approvalRequest.findUniqueOrThrow({ where: { id: cancelApproval.id } })).resolves.toMatchObject({ outboundStatus: "PENDING_OUTBOUND" });
  });

  it("reads ledger and balances from PostgreSQL after reconnecting", async () => {
    const stock = await recordStock({ batchNo: "TASK3-RESTART" });
    await prisma.$disconnect();
    prisma = new LegacyPrismaClient({ adapter: new PrismaPg({ connectionString: isolatedDatabaseUrl }, { schema: schemaName }) });
    const source = new PrismaReportSource(prisma);

    await expect(source.listEntries()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ batchId: stock.batchId, type: "INBOUND", quantity: "10", amount: "125.00" }),
    ]));
    await expect(source.listBalances()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ batchId: stock.batchId, warehouseId: "warehouse-1", remainingQuantity: "10", unitCost: "12.5" }),
    ]));
  });
});

describe.skipIf(!databaseUrl)("approval intent outbound decision migration", () => {
  const migrationSchemaName = `warehouse_task2_migration_${process.pid}_${Date.now()}`;
  let migrationAdminPool: Pool;

  async function withHistoricalSchema(run: (client: PoolClient) => Promise<void>) {
    const isolatedUrl = schemaUrlFor(databaseUrl as string, migrationSchemaName);
    await migrationAdminPool.query(`CREATE SCHEMA "${migrationSchemaName}"`);
    const pool = new Pool({ connectionString: isolatedUrl });
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO "${migrationSchemaName}"`);
      await applyMigrations(client, historicalMigrationPaths);
      await run(client);
    } finally {
      client.release();
      await pool.end();
      await migrationAdminPool.query(`DROP SCHEMA IF EXISTS "${migrationSchemaName}" CASCADE`);
    }
  }

  beforeAll(() => {
    if (!/^warehouse_task2_migration_\d+_\d+$/.test(migrationSchemaName)) throw new Error("unsafe migration test schema name");
    migrationAdminPool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await migrationAdminPool?.end();
  });

  it("backfills one decision for split historical allocations without changing inventory facts", async () => {
    await withHistoricalSchema(async (client) => {
      await seedHistoricalOutbound(client, [
        { id: "legacy-allocation-1", itemId: "legacy-item", batchId: "legacy-batch-1", quantity: "2", amount: "25.00" },
        { id: "legacy-allocation-2", itemId: "legacy-item", batchId: "legacy-batch-2", quantity: "3", amount: "37.50" },
      ]);

      const beforeBalances = (await client.query(`SELECT "id", "remainingQuantity"::text, "unitCost"::text FROM "StockBalance" ORDER BY "id"`)).rows;
      const beforeBatches = (await client.query(`SELECT "id", "quantity"::text, "remainingQuantity"::text, "unitCost"::text FROM "ProcurementBatch" ORDER BY "id"`)).rows;
      const beforeLedger = (await client.query(`SELECT "id", "quantity"::text, "unitCost"::text, "amount"::text FROM "InventoryLedgerEntry" ORDER BY "id"`)).rows;
      const beforeOrder = (await client.query(`SELECT "actualQuantity"::text, "amount"::text FROM "OutboundOrder" WHERE "id" = 'legacy-outbound'`)).rows;

      await client.query(readFileSync(resolve(process.cwd(), approvalIntentMigrationPath), "utf8"));

      const decisions = (await client.query<{
        id: string;
        selectedItemId: string | null;
        actualQuantity: string;
        varianceReason: string | null;
        decidedBy: string;
        decidedAt: string;
      }>(`SELECT "id", "selectedItemId", "actualQuantity"::text, "varianceReason", "decidedBy", to_char("decidedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "decidedAt" FROM "OutboundDecisionLine"`)).rows.map((row) => ({
        ...row,
        actualQuantity: new Prisma.Decimal(row.actualQuantity),
      }));
      const migratedAllocations = (await client.query<{ outboundDecisionLineId: string }>(`SELECT "outboundDecisionLineId" FROM "OutboundAllocation" ORDER BY "id"`)).rows;
      const afterBalances = (await client.query(`SELECT "id", "remainingQuantity"::text, "unitCost"::text FROM "StockBalance" ORDER BY "id"`)).rows;
      const afterBatches = (await client.query(`SELECT "id", "quantity"::text, "remainingQuantity"::text, "unitCost"::text FROM "ProcurementBatch" ORDER BY "id"`)).rows;
      const afterLedger = (await client.query(`SELECT "id", "quantity"::text, "unitCost"::text, "amount"::text FROM "InventoryLedgerEntry" ORDER BY "id"`)).rows;
      const afterOrder = (await client.query(`SELECT "actualQuantity"::text, "amount"::text FROM "OutboundOrder" WHERE "id" = 'legacy-outbound'`)).rows;
      const migratedIntent = (await client.query(`SELECT "requestedItemName", "legacyResolutionStatus" FROM "ApprovalLine" WHERE "id" = 'legacy-approval-line'`)).rows;

      expect(decisions).toMatchObject([{
        selectedItemId: "legacy-item",
        actualQuantity: new Prisma.Decimal("5"),
        varianceReason: "historical shortage",
        decidedBy: "task3-operator",
        decidedAt: "2026-08-11T01:00:00.000",
      }]);
      expect(migratedAllocations.every((row) => row.outboundDecisionLineId === decisions[0]!.id)).toBe(true);
      expect(migratedIntent).toEqual([{ requestedItemName: "Legacy item", legacyResolutionStatus: "REAPPLY_REQUIRED" }]);
      expect(afterBalances).toEqual(beforeBalances);
      expect(afterBatches).toEqual(beforeBatches);
      expect(afterLedger).toEqual(beforeLedger);
      expect(afterOrder).toEqual(beforeOrder);

      await client.query(`
        INSERT INTO "ApprovalLine" ("id", "approvalRequestId", "requestedItemName", "requestedQuantity", "unit", "legacyResolutionStatus", "createdAt")
        VALUES ('constraint-approval-line', 'legacy-approval', 'Constraint item', 1, 'box', 'NOT_APPLICABLE', '2026-08-11T02:00:00Z')
      `);
      await expect(client.query(`
        INSERT INTO "OutboundDecisionLine" ("id", "outboundOrderId", "approvalLineId", "actualQuantity", "decidedBy", "decidedAt")
        VALUES ('null-actual-decision', 'legacy-outbound', 'constraint-approval-line', NULL, 'operator', '2026-08-11T02:00:00Z')
      `)).rejects.toThrow(/null value.*actualQuantity/i);
      await client.query(`
        INSERT INTO "OutboundDecisionLine" ("id", "outboundOrderId", "approvalLineId", "actualQuantity", "decidedBy", "decidedAt")
        VALUES ('constraint-decision', 'legacy-outbound', 'constraint-approval-line', 0, 'operator', '2026-08-11T02:00:00Z')
      `);
      await expect(client.query(`
        INSERT INTO "OutboundDecisionLine" ("id", "outboundOrderId", "approvalLineId", "actualQuantity", "decidedBy", "decidedAt")
        VALUES ('duplicate-decision', 'legacy-outbound', 'constraint-approval-line', 0, 'operator', '2026-08-11T02:00:00Z')
      `)).rejects.toThrow(/unique constraint/i);
      await expect(client.query(`UPDATE "OutboundAllocation" SET "outboundDecisionLineId" = NULL WHERE "id" = 'legacy-allocation-1'`))
        .rejects.toThrow(/null value.*outboundDecisionLineId/i);
      await expect(client.query(`UPDATE "OutboundAllocation" SET "outboundDecisionLineId" = 'missing-decision' WHERE "id" = 'legacy-allocation-1'`))
        .rejects.toThrow(/foreign key constraint/i);
      const oldColumns = (await client.query(`
        SELECT "column_name"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'OutboundAllocation'
          AND column_name = 'approvalLineId'
      `)).rows;
      expect(oldColumns).toEqual([]);
    });
  });

  it("creates a zero decision and does not copy an order reason to a full decision", async () => {
    await withHistoricalSchema(async (client) => {
      await seedHistoricalOutbound(client, [
        { id: "legacy-allocation-1", itemId: "legacy-item", batchId: "legacy-batch-1", quantity: "2", amount: "25.00" },
        { id: "legacy-allocation-2", itemId: "legacy-item", batchId: "legacy-batch-2", quantity: "3", amount: "37.50" },
      ]);
      await client.query(`UPDATE "ApprovalLine" SET "requestedQuantity" = 5 WHERE "id" = 'legacy-approval-line'`);
      await client.query(`
        INSERT INTO "ApprovalLine" ("id", "approvalRequestId", "itemId", "requestedQuantity", "unit", "createdAt")
        VALUES ('legacy-zero-line', 'legacy-approval', 'legacy-item', 2, 'box', '2026-08-11T00:00:00Z')
      `);

      await client.query(readFileSync(resolve(process.cwd(), approvalIntentMigrationPath), "utf8"));

      const decisions = (await client.query<{
        approvalLineId: string;
        selectedItemId: string | null;
        actualQuantity: string;
        varianceReason: string | null;
      }>(`
        SELECT "approvalLineId", "selectedItemId", "actualQuantity"::text, "varianceReason"
        FROM "OutboundDecisionLine"
        ORDER BY "approvalLineId"
      `)).rows;
      expect(decisions).toEqual([
        { approvalLineId: "legacy-approval-line", selectedItemId: "legacy-item", actualQuantity: "5.0000", varianceReason: null },
        { approvalLineId: "legacy-zero-line", selectedItemId: null, actualQuantity: "0.0000", varianceReason: "historical shortage" },
      ]);
    });
  });

  it("rejects a historical approval line allocated to multiple items", async () => {
    await withHistoricalSchema(async (client) => {
      await seedHistoricalOutbound(client, [
        { id: "legacy-allocation-1", itemId: "legacy-item", batchId: "legacy-batch-1", quantity: "2", amount: "25.00" },
        { id: "legacy-allocation-2", itemId: "legacy-item-2", batchId: "legacy-batch-other", quantity: "3", amount: "37.50" },
      ]);

      await expect(client.query(readFileSync(resolve(process.cwd(), approvalIntentMigrationPath), "utf8")))
        .rejects.toThrow(/multiple item ids/i);
    });
  });

  it("rejects historical allocations whose approval line does not belong to the outbound approval", async () => {
    await withHistoricalSchema(async (client) => {
      await seedHistoricalOutbound(client, [
        { id: "legacy-allocation-1", itemId: "legacy-item", batchId: "legacy-batch-1", quantity: "2", amount: "25.00" },
      ]);
      await client.query(`
        INSERT INTO "ApprovalRequest" ("id", "weComSpNo", "applicantUserId", "applicantName", "purpose", "status", "outboundStatus", "submittedAt", "createdAt", "updatedAt")
        VALUES ('other-approval', 'legacy-sp-no-2', 'legacy-applicant', 'Legacy Applicant', 'other', 'APPROVED', 'PENDING_OUTBOUND', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z');
        INSERT INTO "ApprovalLine" ("id", "approvalRequestId", "itemId", "requestedQuantity", "unit", "createdAt")
        VALUES ('other-approval-line', 'other-approval', 'legacy-item', 2, 'box', '2026-08-11T00:00:00Z');
        UPDATE "OutboundAllocation" SET "approvalLineId" = 'other-approval-line' WHERE "id" = 'legacy-allocation-1';
      `);

      await expect(client.query(readFileSync(resolve(process.cwd(), approvalIntentMigrationPath), "utf8")))
        .rejects.toThrow(/without an outbound decision/i);
    });
  });
});

describe.skipIf(!databaseUrl)("Prisma approval synchronization after the intent migration", () => {
  const syncSchemaName = `warehouse_task3_sync_${process.pid}_${Date.now()}`;
  let adminPool: Pool;
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (!/^warehouse_task3_sync_\d+_\d+$/.test(syncSchemaName)) throw new Error("unsafe sync test schema name");
    const isolatedDatabaseUrl = schemaUrlFor(databaseUrl as string, syncSchemaName);
    adminPool = new Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${syncSchemaName}"`);
    const migrationPool = new Pool({ connectionString: isolatedDatabaseUrl });
    const migrationClient = await migrationPool.connect();
    try {
      await migrationClient.query(`SET search_path TO "${syncSchemaName}"`);
      await applyMigrations(migrationClient, [...historicalMigrationPaths, approvalIntentMigrationPath]);
    } finally {
      migrationClient.release();
      await migrationPool.end();
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: isolatedDatabaseUrl }, { schema: syncSchemaName }) });
    await prisma.itemCategory.create({ data: { id: "sync-category", code: "SYNC", prefix: "SY", name: "Sync" } });
    await prisma.item.create({
      data: {
        id: "sync-item",
        code: "SY-001",
        name: "Exact item",
        unit: "box",
        categoryId: "sync-category",
        weComOptionKey: "sync-option",
      },
    });
  });

  beforeEach(async () => {
    await prisma.outboundDecisionLine.deleteMany();
    await prisma.outboundOrder.deleteMany();
    await prisma.approvalLine.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.syncAttempt.deleteMany();
    await prisma.user.deleteMany({ where: { id: { startsWith: "sync-" }, NOT: { id: "sync-item" } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${syncSchemaName}" CASCADE`);
      await adminPool.end();
    }
  });

  function intentRecord(overrides: Partial<ApprovalSyncRecord> = {}): ApprovalSyncRecord {
    return {
      id: "sync-approval",
      weComSpNo: "2026090400000001",
      sourceTemplateId: "tpl-intent-v2",
      status: "APPROVED",
      outboundStatus: "PENDING_OUTBOUND",
      applicantUserId: "sync-applicant",
      applicantName: "Sync Applicant",
      department: "Operations",
      purpose: "Supplies",
      submittedAt: "2026-09-04T00:00:00.000Z",
      lines: [{
        requestedItemName: "Tea supplies",
        requestedQuantity: "2",
        unit: "box",
        note: "Keep dry",
        legacyResolutionStatus: "NOT_APPLICABLE",
      }],
      ...overrides,
    };
  }

  function pauseOneFind(store: PrismaApprovalSyncStore): {
    store: ApprovalSyncStore;
    reached: Promise<void>;
    release(): void;
  } {
    let markReached!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => { markReached = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let shouldPause = true;
    return {
      reached,
      release,
      store: {
        findBySpNo: async (weComSpNo) => {
          const result = await store.findBySpNo(weComSpNo);
          if (shouldPause) {
            shouldPause = false;
            markReached();
            await gate;
          }
          return result;
        },
        save: (record) => store.save(record),
        recordSyncAttempt: (attempt) => store.recordSyncAttempt(attempt),
        saveWithAttempt: (record, attempt) => store.saveWithAttempt(record, attempt),
      },
    };
  }

  function syncDetail(templateId = "tpl-intent-v2"): WeComApprovalPayload {
    return {
      sp_no: "2026090400000001",
      template_id: templateId,
      sp_status: 4,
      apply_time: 1788480000,
      applyer: { userid: "sync-applicant", name: "Sync Applicant" },
      contents: [],
    };
  }

  it("persists immutable intent facts and reuses line IDs on an unprocessed duplicate sync", async () => {
    const store = new PrismaApprovalSyncStore(prisma);
    const record = intentRecord();

    await store.saveWithAttempt(record, { weComSpNo: record.weComSpNo, status: "SUCCEEDED", payload: { callback: 1 } });
    const first = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: record.id }, include: { lines: true } });
    await store.saveWithAttempt(intentRecord({
      lines: [{ requestedItemName: "Updated supplies", requestedQuantity: "3", unit: "box", legacyResolutionStatus: "NOT_APPLICABLE" }],
    }), { weComSpNo: record.weComSpNo, status: "SUCCEEDED", payload: { callback: 2 } });

    const stored = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: record.id }, include: { lines: true } });
    expect(stored).toMatchObject({ sourceTemplateId: "tpl-intent-v2", outboundStatus: "PENDING_OUTBOUND" });
    expect(stored.lines).toEqual([
      expect.objectContaining({
        id: first.lines[0]!.id,
        requestedItemName: "Updated supplies",
        itemId: null,
        note: null,
        legacyResolutionStatus: "NOT_APPLICABLE",
      }),
    ]);
    await expect(prisma.syncAttempt.count({ where: { weComSpNo: record.weComSpNo } })).resolves.toBe(2);
  });

  it("promotes a pre-migration reapply line only when exact selector evidence is persisted", async () => {
    const store = new PrismaApprovalSyncStore(prisma);
    await store.save(intentRecord({
      sourceTemplateId: undefined,
      outboundStatus: "REAPPLY_REQUIRED",
      lines: [{ requestedItemName: "Legacy item", requestedQuantity: "2", unit: "box", legacyResolutionStatus: "REAPPLY_REQUIRED" }],
    }));
    const original = await prisma.approvalLine.findFirstOrThrow({ where: { approvalRequestId: "sync-approval" } });

    await store.save(intentRecord({
      sourceTemplateId: "tpl-selector-v1",
      lines: [{
        requestedItemName: "Exact item",
        requestedQuantity: "2",
        unit: "box",
        itemId: "sync-item",
        itemOptionKey: "sync-option",
        legacyResolutionStatus: "EXACT_LOCKED",
      }],
    }));

    await expect(store.findBySpNo("2026090400000001")).resolves.toMatchObject({
      sourceTemplateId: "tpl-selector-v1",
      outboundStatus: "PENDING_OUTBOUND",
      lines: [{
        requestedItemName: "Exact item",
        itemId: "sync-item",
        itemOptionKey: "sync-option",
        legacyResolutionStatus: "EXACT_LOCKED",
      }],
    });
    await expect(prisma.approvalLine.findFirstOrThrow({ where: { approvalRequestId: "sync-approval" } }))
      .resolves.toMatchObject({ id: original.id });
  });

  it("records a post-issue revocation exception without rewriting lines or deleting the outbound order", async () => {
    const store = new PrismaApprovalSyncStore(prisma);
    const record = intentRecord({
      sourceTemplateId: "tpl-selector-v1",
      lines: [{
        requestedItemName: "Exact item",
        requestedQuantity: "2",
        unit: "box",
        itemId: "sync-item",
        itemOptionKey: "sync-option",
        legacyResolutionStatus: "EXACT_LOCKED",
      }],
    });
    await store.save(record);
    const originalLine = await prisma.approvalLine.findFirstOrThrow({ where: { approvalRequestId: record.id } });
    await prisma.outboundOrder.create({
      data: {
        id: "sync-order",
        approvalRequestId: record.id,
        orderNo: "OUT-SYNC",
        status: "COMPLETED",
        actualQuantity: "2",
        amount: "20",
        operatorId: "sync-operator",
        decisions: {
          create: {
            id: "sync-decision",
            approvalLineId: originalLine.id,
            selectedItemId: "sync-item",
            actualQuantity: "2",
            decidedBy: "sync-operator",
            decidedAt: new Date("2026-09-04T01:00:00.000Z"),
          },
        },
      },
    });
    await prisma.approvalRequest.update({
      where: { id: record.id },
      data: { outboundStatus: "COMPLETED" },
    });
    await store.save(intentRecord({
      status: "REVOKED",
      outboundStatus: "REVOCATION_EXCEPTION",
      sourceTemplateId: "tpl-selector-v1",
      lines: [{ requestedItemName: "Changed", requestedQuantity: "5", unit: "case", legacyResolutionStatus: "NOT_APPLICABLE" }],
    }));

    const stored = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: record.id }, include: { lines: true, outboundOrder: true } });
    expect(stored).toMatchObject({
      status: "REVOKED",
      outboundStatus: "REVOCATION_EXCEPTION",
      sourceTemplateId: "tpl-selector-v1",
      outboundOrder: { id: "sync-order" },
      lines: [expect.objectContaining({
        id: originalLine.id,
        requestedItemName: "Exact item",
        itemId: "sync-item",
        legacyResolutionStatus: "EXACT_LOCKED",
      })],
    });
    await expect(prisma.outboundDecisionLine.count({ where: { outboundOrderId: "sync-order" } })).resolves.toBe(1);
  });

  it("re-derives a revoke against the status locked inside the save transaction", async () => {
    const realStore = new PrismaApprovalSyncStore(prisma);
    await realStore.save(intentRecord());
    const paused = pauseOneFind(realStore);
    const service = new ApprovalSyncService({
      gateway: { fetchDetail: async () => syncDetail() },
      parser: { parse: async () => ({
        ...intentRecord({ status: "REVOKED" }),
        status: "REVOKED" as const,
      }) },
      store: paused.store,
      approvalTemplateIds: ["tpl-intent-v2"],
    });

    const synchronization = service.sync("2026090400000001");
    await paused.reached;
    await prisma.approvalRequest.update({ where: { id: "sync-approval" }, data: { outboundStatus: "COMPLETED" } });
    paused.release();

    await expect(synchronization).resolves.toMatchObject({ status: "REVOCATION_EXCEPTION" });
    await expect(prisma.approvalRequest.findUniqueOrThrow({ where: { id: "sync-approval" } }))
      .resolves.toMatchObject({ status: "REVOKED", outboundStatus: "REVOCATION_EXCEPTION" });
  });

  it("rejects a source-template race inside the save transaction without mixing provenance and lines", async () => {
    const realStore = new PrismaApprovalSyncStore(prisma);
    await realStore.save(intentRecord());
    const paused = pauseOneFind(realStore);
    const service = new ApprovalSyncService({
      gateway: { fetchDetail: async () => syncDetail() },
      parser: { parse: async () => ({
        ...intentRecord({
          lines: [{ requestedItemName: "Incoming intent", requestedQuantity: "3", unit: "box", legacyResolutionStatus: "NOT_APPLICABLE" }],
        }),
      }) },
      store: paused.store,
      approvalTemplateIds: ["tpl-intent-v2", "tpl-selector-v1"],
    });

    const synchronization = service.sync("2026090400000001");
    await paused.reached;
    await prisma.$transaction([
      prisma.approvalRequest.update({ where: { id: "sync-approval" }, data: { sourceTemplateId: "tpl-selector-v1" } }),
      prisma.approvalLine.update({
        where: { id: "sync-approval-line-1" },
        data: {
          requestedItemName: "Concurrent legacy",
          itemId: "sync-item",
          legacyResolutionStatus: "EXACT_LOCKED",
        },
      }),
    ]);
    paused.release();

    await expect(synchronization).rejects.toThrow("approval source template does not match the existing record");
    await expect(prisma.approvalRequest.findUniqueOrThrow({
      where: { id: "sync-approval" },
      include: { lines: true },
    })).resolves.toMatchObject({
      sourceTemplateId: "tpl-selector-v1",
      lines: [{ requestedItemName: "Concurrent legacy", itemId: "sync-item", legacyResolutionStatus: "EXACT_LOCKED" }],
    });
  });

  it("retains distinct success and failure audit events when two synchronizations start together", async () => {
    const realStore = new PrismaApprovalSyncStore(prisma);
    let gatewayCalls = 0;
    let releaseGateway!: () => void;
    const gatewayGate = new Promise<void>((resolve) => { releaseGateway = resolve; });
    const details = [syncDetail(), syncDetail("tpl-unlisted")];
    const coordinatedStore = {
      findBySpNo: (weComSpNo: string) => realStore.findBySpNo(weComSpNo),
      save: (record: ApprovalSyncRecord) => realStore.save(record),
      recordSyncAttempt: (attempt: Parameters<ApprovalSyncStore["recordSyncAttempt"]>[0]) => realStore.recordSyncAttempt(attempt),
      saveWithAttempt: (record: ApprovalSyncRecord, attempt: Parameters<NonNullable<ApprovalSyncStore["saveWithAttempt"]>>[1]) => realStore.saveWithAttempt(record, attempt),
    };
    const service = new ApprovalSyncService({
      gateway: {
        fetchDetail: async () => {
          const index = gatewayCalls;
          gatewayCalls += 1;
          if (gatewayCalls === 2) releaseGateway();
          await gatewayGate;
          return details[index]!;
        },
      },
      parser: { parse: async () => intentRecord() },
      store: coordinatedStore,
      approvalTemplateIds: ["tpl-intent-v2"],
    });

    const outcomes = await Promise.allSettled([
      service.sync("2026090400000001"),
      service.sync("2026090400000001"),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    const attempts = await prisma.syncAttempt.findMany({
      where: { weComSpNo: "2026090400000001" },
      orderBy: { attemptNo: "asc" },
    });
    expect(attempts.map((attempt) => attempt.attemptNo)).toEqual([1, 2]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["FAILED", "SUCCEEDED"]);
    expect(new Set(attempts.map((attempt) => attempt.id)).size).toBe(2);
  });
});

function schemaUrlFor(connectionString: string, targetSchema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("schema", targetSchema);
  return url.toString();
}

async function seedHistoricalOutbound(client: PoolClient, allocations: Array<{ id: string; itemId: string; batchId: string; quantity: string; amount: string }>) {
  await client.query(`
    INSERT INTO "Role" ("id", "code", "name", "createdAt") VALUES ('legacy-role', 'LEGACY', 'Legacy', '2026-08-11T00:00:00Z');
    INSERT INTO "User" ("id", "weComUserId", "name", "roleId", "isActive", "createdAt") VALUES ('legacy-applicant', 'legacy-applicant', 'Legacy Applicant', 'legacy-role', true, '2026-08-11T00:00:00Z');
    INSERT INTO "Warehouse" ("id", "code", "name", "isActive", "isPlaceholder", "createdAt") VALUES ('legacy-warehouse', 'LEGACY-WH', 'Legacy warehouse', true, false, '2026-08-11T00:00:00Z');
    INSERT INTO "ItemCategory" ("id", "code", "prefix", "name", "createdAt") VALUES ('legacy-category', 'LEGACY-CATEGORY', 'LG', 'Legacy category', '2026-08-11T00:00:00Z');
    INSERT INTO "Item" ("id", "code", "name", "unit", "categoryId", "isActive", "createdAt", "updatedAt") VALUES
      ('legacy-item', 'LG-001', 'Legacy item', 'box', 'legacy-category', true, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
      ('legacy-item-2', 'LG-002', 'Other legacy item', 'box', 'legacy-category', true, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z');
    INSERT INTO "ApprovalRequest" ("id", "weComSpNo", "applicantUserId", "applicantName", "purpose", "status", "outboundStatus", "submittedAt", "createdAt", "updatedAt")
      VALUES ('legacy-approval', 'legacy-sp-no', 'legacy-applicant', 'Legacy Applicant', 'historical issue', 'APPROVED', 'PARTIALLY_ISSUED', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z');
    INSERT INTO "ApprovalLine" ("id", "approvalRequestId", "itemId", "requestedQuantity", "unit", "createdAt")
      VALUES ('legacy-approval-line', 'legacy-approval', 'legacy-item', 7, 'box', '2026-08-11T00:00:00Z');
    INSERT INTO "ProcurementBatch" ("id", "warehouseId", "itemId", "batchNo", "quantity", "remainingQuantity", "unitCost", "purchasedAt", "createdAt") VALUES
      ('legacy-batch-1', 'legacy-warehouse', 'legacy-item', 'LEGACY-BATCH-1', 10, 8, 12.5, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
      ('legacy-batch-2', 'legacy-warehouse', 'legacy-item', 'LEGACY-BATCH-2', 10, 7, 12.5, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
      ('legacy-batch-other', 'legacy-warehouse', 'legacy-item-2', 'LEGACY-BATCH-OTHER', 10, 10, 12.5, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    INSERT INTO "StockBalance" ("id", "warehouseId", "itemId", "batchId", "remainingQuantity", "unitCost", "updatedAt") VALUES
      ('legacy-balance-1', 'legacy-warehouse', 'legacy-item', 'legacy-batch-1', 8, 12.5, '2026-08-11T00:00:00Z'),
      ('legacy-balance-2', 'legacy-warehouse', 'legacy-item', 'legacy-batch-2', 7, 12.5, '2026-08-11T00:00:00Z'),
      ('legacy-balance-other', 'legacy-warehouse', 'legacy-item-2', 'legacy-batch-other', 10, 12.5, '2026-08-11T00:00:00Z');
    INSERT INTO "OutboundOrder" ("id", "approvalRequestId", "orderNo", "status", "actualQuantity", "amount", "reason", "issuedAt", "operatorId", "createdAt")
      VALUES ('legacy-outbound', 'legacy-approval', 'OUT-LEGACY', 'PARTIALLY_ISSUED', 5, 62.50, 'historical shortage', '2026-08-11T01:00:00Z', 'task3-operator', '2026-08-11T00:30:00Z');
  `);

  for (const allocation of allocations) {
    await client.query(`
      INSERT INTO "OutboundAllocation" ("id", "outboundOrderId", "approvalLineId", "warehouseId", "itemId", "batchId", "originalQuantity", "quantity", "unitCost", "amount")
      VALUES ($1, 'legacy-outbound', 'legacy-approval-line', 'legacy-warehouse', $2, $3, 7, $4, 12.5, $5)
    `, [allocation.id, allocation.itemId, allocation.batchId, allocation.quantity, allocation.amount]);
    await client.query(`
      INSERT INTO "InventoryLedgerEntry" ("id", "warehouseId", "itemId", "batchId", "type", "quantity", "unitCost", "amount", "referenceType", "referenceId", "occurredAt", "createdAt")
      VALUES ($1, 'legacy-warehouse', $2, $3, 'OUTBOUND', -($4::numeric), 12.5, $5, 'OUTBOUND_ORDER', 'legacy-outbound', '2026-08-11T01:00:00Z', '2026-08-11T01:00:00Z')
    `, [`ledger-${allocation.id}`, allocation.itemId, allocation.batchId, allocation.quantity, allocation.amount]);
  }
}
