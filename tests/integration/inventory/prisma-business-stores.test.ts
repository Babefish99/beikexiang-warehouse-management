import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OutboundAllocator } from "../../../apps/api/src/application/inventory/outbound-allocator.js";
import { OpeningStockService } from "../../../apps/api/src/application/inventory/opening-stock-service.js";
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
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema: schemaName }) });
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
    const migrationClient = await migrationPool.connect();
    try {
      await migrationClient.query(`SET search_path TO "${schemaName}"`);
      await migrationClient.query(readFileSync(resolve(process.cwd(), "prisma/migrations/00000000000000_init/migration.sql"), "utf8"));
      await migrationClient.query(readFileSync(resolve(process.cwd(), "prisma/migrations/20260811163000_production_persistence/migration.sql"), "utf8"));
      await migrationClient.query(readFileSync(resolve(process.cwd(), "prisma/migrations/20260811171500_stocktake_quantity_snapshots/migration.sql"), "utf8"));
    } finally {
      migrationClient.release();
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
    await prisma.inboundOrder.deleteMany();
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
    await expect(recordStock({ batchNo: "TASK3-INBOUND" })).rejects.toThrow();
    await expect(prisma.inboundOrder.count()).resolves.toBe(orderCount);
    await expect(prisma.inventoryLedgerEntry.count()).resolves.toBe(ledgerCount);
  });

  it("rolls back the complete opening-stock request when row two conflicts", async () => {
    await recordStock({ batchNo: "TASK3-OPENING-DUPLICATE" });
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
        { warehouseId: "warehouse-1", itemId, batchNo: "TASK3-OPENING-DUPLICATE", quantity: "6", unitCost: "3" },
      ],
    })).rejects.toThrow();

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
    expect(storedOutbound.orderNo).toMatch(/^OUT-/);
    expect(storedOutbound.allocations.map((allocation) => ({ approvalLineId: allocation.approvalLineId, quantity: allocation.quantity.toString(), originalQuantity: allocation.originalQuantity.toString() }))).toEqual([
      { approvalLineId: approval.lines[0]!.id, quantity: "5", originalQuantity: "5" },
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

    const storedApproval = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: record.id }, include: { lines: true } });
    expect(storedApproval.outboundStatus).toBe("COMPLETED");
    expect(storedApproval.lines.map((line) => ({ itemId: line.itemId, requestedQuantity: line.requestedQuantity.toString() }))).toEqual([{ itemId, requestedQuantity: "2" }]);
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
