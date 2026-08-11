import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OutboundAllocator } from "../../../apps/api/src/application/inventory/outbound-allocator.js";
import { OutboundService } from "../../../apps/api/src/application/inventory/outbound-service.js";
import { ReturnService } from "../../../apps/api/src/application/inventory/return-service.js";
import { StocktakeService } from "../../../apps/api/src/application/inventory/stocktake-service.js";
import { TransferService } from "../../../apps/api/src/application/inventory/transfer-service.js";
import { PeriodCloseService } from "../../../apps/api/src/application/periods/period-close-service.js";
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

function schemaUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

function createClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

describe.skipIf(!databaseUrl)("Prisma inventory business stores", () => {
  let adminPool: Pool;
  let prisma: PrismaClient;
  let isolatedDatabaseUrl: string;

  beforeAll(async () => {
    if (!/^warehouse_task3_\d+_\d+$/.test(schemaName)) throw new Error("unsafe test schema name");
    isolatedDatabaseUrl = schemaUrl(databaseUrl as string);
    adminPool = new Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    const migrationPool = new Pool({ connectionString: isolatedDatabaseUrl });
    try {
      await migrationPool.query(`SET search_path TO "${schemaName}"`);
      await migrationPool.query(readFileSync(resolve(process.cwd(), "prisma/migrations/00000000000000_init/migration.sql"), "utf8"));
      await migrationPool.query(readFileSync(resolve(process.cwd(), "prisma/migrations/20260811163000_production_persistence/migration.sql"), "utf8"));
    } finally {
      await migrationPool.end();
    }
    prisma = createClient(isolatedDatabaseUrl);
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
  });

  beforeEach(async () => {
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
    await prisma.stockBalance.deleteMany();
    await prisma.procurementBatch.deleteMany();
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
  });

  async function recordStock(options: { batchNo?: string; quantity?: string; source?: "INBOUND" | "OPENING_STOCK" } = {}) {
    const source = options.source ?? "INBOUND";
    return new PrismaInventoryEntryStore(prisma).recordStockEntry({
      warehouseId: "warehouse-1",
      itemId,
      batchNo: options.batchNo ?? `batch-${crypto.randomUUID()}`,
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

  it("creates inbound/opening orders, lines, batches, balances, and ledger entries atomically", async () => {
    const inbound = await recordStock({ batchNo: "TASK3-INBOUND" });
    const opening = await recordStock({ batchNo: "TASK3-OPENING", source: "OPENING_STOCK" });

    await expect(prisma.inboundOrder.findUnique({ where: { id: inbound.orderId }, include: { lines: true } })).resolves.toMatchObject({
      source: "INBOUND",
      operatorId: "task3-operator",
      lines: [{ itemId, batchId: inbound.batchId }],
    });
    await expect(prisma.inboundOrder.findUnique({ where: { id: opening.orderId } })).resolves.toMatchObject({ source: "OPENING_STOCK" });
    await expect(prisma.stockBalance.findUnique({
      where: { warehouseId_itemId_batchId: { warehouseId: "warehouse-1", itemId, batchId: inbound.batchId } },
    })).resolves.toMatchObject({ remainingQuantity: "10", unitCost: "12.5" });
    await expect(prisma.inventoryLedgerEntry.findMany({ where: { referenceId: { in: [inbound.orderId, opening.orderId] } }, orderBy: { type: "asc" } })).resolves.toMatchObject([
      { referenceId: inbound.orderId, type: "INBOUND" },
      { referenceId: opening.orderId, type: "OPENING_BALANCE" },
    ]);

    const orderCount = await prisma.inboundOrder.count();
    const ledgerCount = await prisma.inventoryLedgerEntry.count();
    await expect(recordStock({ batchNo: "TASK3-INBOUND" })).rejects.toThrow();
    await expect(prisma.inboundOrder.count()).resolves.toBe(orderCount);
    await expect(prisma.inventoryLedgerEntry.count()).resolves.toBe(ledgerCount);
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
    await expect(prisma.stockBalance.findFirstOrThrow({ where: { batchId: stock.batchId } })).resolves.toMatchObject({ remainingQuantity: "5" });
    await expect(prisma.procurementBatch.findUniqueOrThrow({ where: { id: stock.batchId } })).resolves.toMatchObject({ remainingQuantity: "5" });
    await expect(prisma.outboundOrder.findUnique({ where: { id: result.id }, include: { allocations: true } })).resolves.toMatchObject({
      orderNo: expect.stringMatching(/^OUT-/),
      allocations: [{ approvalLineId: approval.lines[0]!.id, quantity: "5", originalQuantity: "5" }],
    });
    await expect(prisma.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).resolves.toMatchObject({ outboundStatus: "COMPLETED" });
    await expect(prisma.inventoryLedgerEntry.findFirst({ where: { referenceId: result.id } })).resolves.toMatchObject({ type: "OUTBOUND", quantity: "-5" });
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
    await expect(prisma.transferOrder.findUnique({ where: { id: transfer.transferId }, include: { lines: true } })).resolves.toMatchObject({
      transferNo: expect.stringMatching(/^TRF-/),
      lines: [{ quantity: "4", unitCost: "12.5" }],
    });
    await expect(prisma.stockBalance.findMany({ where: { batchId: stock.batchId }, orderBy: { warehouseId: "asc" } })).resolves.toMatchObject([
      { warehouseId: "warehouse-1", remainingQuantity: "6", unitCost: "12.5" },
      { warehouseId: "warehouse-2", remainingQuantity: "4", unitCost: "12.5" },
    ]);
    await expect(prisma.inventoryLedgerEntry.findMany({ where: { referenceId: transfer.transferId }, orderBy: { type: "asc" } })).resolves.toMatchObject([
      { type: "TRANSFER_IN", quantity: "4" },
      { type: "TRANSFER_OUT", quantity: "-4" },
    ]);

    const approval = await createApproval("3");
    const outbound = await new OutboundService(new PrismaOutboundStore(prisma)).confirm({
      approvalId: approval.id,
      allocations: [{ approvalLineId: approval.lines[0]!.id, warehouseId: "warehouse-2", batchId: stock.batchId, quantity: "3" }],
    });
    const allocation = await prisma.outboundAllocation.findFirstOrThrow({ where: { outboundOrderId: outbound.id } });
    const returned = await new ReturnService(movementStore).create({ outboundAllocationId: allocation.id, quantity: "2", reason: "unused" });

    expect(returned).toMatchObject({ status: "COMPLETED", unitCost: "12.5" });
    await expect(prisma.returnOrder.findUnique({ where: { id: returned.returnId }, include: { lines: true } })).resolves.toMatchObject({
      returnNo: expect.stringMatching(/^RET-/),
      originalOutboundId: outbound.id,
      lines: [{ outboundAllocationId: allocation.id, quantity: "2", unitCost: "12.5" }],
    });
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

    await expect(prisma.stocktake.findUnique({ where: { id: result.stocktakeId }, include: { adjustments: true } })).resolves.toMatchObject({
      stocktakeNo: expect.stringMatching(/^STK-/),
      periodCode: "2026-08",
      operatorId: "task3-operator",
      adjustments: [{ quantity: "-2", reason: "damaged", operatorId: "task3-operator" }],
    });
    await expect(prisma.stockBalance.findFirstOrThrow({ where: { batchId: stock.batchId } })).resolves.toMatchObject({ remainingQuantity: "8" });
    await expect(prisma.inventoryLedgerEntry.findFirst({ where: { referenceId: result.stocktakeId } })).resolves.toMatchObject({ type: "STOCKTAKE_ADJUSTMENT", quantity: "-2" });

    const closed = await new PeriodCloseService(periodStore).close({
      period: createAccountingPeriod({ code: "2026-08" }),
      pendingOutboundCount: 0,
      unpostedAdjustmentCount: 0,
    });
    expect(closed.status).toBe("CLOSED");
    await expect(new PrismaAccountingPeriodStore(prisma).get("2026-08")).resolves.toMatchObject({ status: "CLOSED" });
    await expect(recordStock({ batchNo: "TASK3-CLOSED" })).rejects.toThrow("closed period: 2026-08");
  });

  it("upserts approval lines and sync attempts without reopening a closed approval", async () => {
    const store = new PrismaApprovalSyncStore(prisma);
    const record = {
      id: "task3-synced-approval",
      weComSpNo: "2026081100000001",
      status: "APPROVED" as const,
      outboundStatus: "PENDING_OUTBOUND" as const,
      applicantUserId: "task3-sync-user",
      applicantName: "Sync User",
      department: "Operations",
      purpose: "supplies",
      submittedAt: "2026-08-11T00:00:00.000Z",
      lines: [{ itemId, itemOptionKey: "task3-option", itemName: "Task 3 test item", requestedQuantity: "2", unit: "box" }],
    };
    await store.saveWithAttempt(record, { weComSpNo: record.weComSpNo, status: "SUCCEEDED", attemptNo: 1, payload: { callback: 1 } });
    await prisma.approvalRequest.update({ where: { id: record.id }, data: { outboundStatus: "COMPLETED" } });
    await store.saveWithAttempt({ ...record, outboundStatus: "PENDING_OUTBOUND" }, { weComSpNo: record.weComSpNo, status: "SUCCEEDED", attemptNo: 2, payload: { callback: 2 } });

    await expect(prisma.approvalRequest.findUnique({ where: { id: record.id }, include: { lines: true } })).resolves.toMatchObject({
      outboundStatus: "COMPLETED",
      lines: [{ itemId, requestedQuantity: "2" }],
    });
    await expect(prisma.approvalRequest.count({ where: { weComSpNo: record.weComSpNo } })).resolves.toBe(1);
    await expect(prisma.approvalLine.count({ where: { approvalRequestId: record.id } })).resolves.toBe(1);
    await expect(prisma.syncAttempt.findMany({ where: { weComSpNo: record.weComSpNo }, orderBy: { attemptNo: "asc" } })).resolves.toMatchObject([
      { attemptNo: 1, status: "SUCCEEDED" },
      { attemptNo: 2, status: "SUCCEEDED" },
    ]);
  });

  it("reads ledger and balances from PostgreSQL after reconnecting", async () => {
    const stock = await recordStock({ batchNo: "TASK3-RESTART" });
    await prisma.$disconnect();
    prisma = createClient(isolatedDatabaseUrl);
    const source = new PrismaReportSource(prisma);

    await expect(source.listEntries()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ batchId: stock.batchId, type: "INBOUND", quantity: "10", amount: "125.00" }),
    ]));
    await expect(source.listBalances()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ batchId: stock.batchId, warehouseId: "warehouse-1", remainingQuantity: "10", unitCost: "12.5" }),
    ]));
  });
});
