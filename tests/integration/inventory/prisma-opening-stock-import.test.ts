import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaInventoryEntryStore } from "../../../apps/api/src/infrastructure/db/prisma-inventory-entry-store.js";
import { PrismaOpeningStockImportStore } from "../../../apps/api/src/infrastructure/db/prisma-opening-stock-import-store.js";
import { ExcelOpeningStockWorkbookParser } from "../../../apps/api/src/infrastructure/import/excel-opening-stock-workbook-parser.js";
import { seedStructuralData } from "../../../prisma/seed.js";
import { openingStockCommitDraftFixture } from "../../helpers/opening-stock-import.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaName = `warehouse_opening_stock_${process.pid}_${Date.now()}`;
const parser = new ExcelOpeningStockWorkbookParser();

function schemaUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

function createClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema: schemaName }) });
}

describe.skipIf(!databaseUrl)("Prisma opening-stock import transaction", () => {
  let adminPool: Pool;
  let prisma: PrismaClient;
  let isolatedDatabaseUrl: string;
  let store: PrismaOpeningStockImportStore;

  beforeAll(async () => {
    if (!/^warehouse_opening_stock_\d+_\d+$/.test(schemaName)) {
      throw new Error("unsafe opening-stock test schema name");
    }
    isolatedDatabaseUrl = schemaUrl(databaseUrl as string);
    adminPool = new Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    const migrationPool = new Pool({ connectionString: isolatedDatabaseUrl });
    const migrationClient = await migrationPool.connect();
    try {
      await migrationClient.query(`SET search_path TO "${schemaName}"`);
      for (const migration of [
        "prisma/migrations/00000000000000_init/migration.sql",
        "prisma/migrations/20260811163000_production_persistence/migration.sql",
        "prisma/migrations/20260811171500_stocktake_quantity_snapshots/migration.sql",
        "prisma/migrations/20260814110000_inbound_batch_sequences/migration.sql",
        "prisma/migrations/20260824170000_opening_stock_import/migration.sql",
      ]) {
        await migrationClient.query(readFileSync(resolve(process.cwd(), migration), "utf8"));
      }
    } finally {
      migrationClient.release();
      await migrationPool.end();
    }
    prisma = createClient(isolatedDatabaseUrl);
    await seedStructuralData(prisma);
    await Promise.all([
      prisma.warehouse.update({
        where: { id: "warehouse-1" },
        data: { name: "集团二楼仓库", isPlaceholder: false },
      }),
      prisma.warehouse.update({
        where: { id: "warehouse-2" },
        data: { name: "内区1号仓库", isPlaceholder: false },
      }),
      prisma.warehouse.update({
        where: { id: "warehouse-3" },
        data: { name: "1区车库后仓库", isPlaceholder: false },
      }),
    ]);
  });

  beforeEach(async () => {
    await prisma.openingStockImport.deleteMany();
    await prisma.inventoryLedgerEntry.deleteMany();
    await prisma.inboundLine.deleteMany();
    await prisma.inboundOrder.deleteMany();
    await prisma.stockBalance.deleteMany();
    await prisma.procurementBatch.deleteMany();
    await prisma.inboundBatchSequence.deleteMany();
    await prisma.accountingPeriod.deleteMany();
    await prisma.item.deleteMany();
    store = new PrismaOpeningStockImportStore(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminPool.end();
    }
  });

  it("atomically creates import summary, missing items and positive inventory", async () => {
    const draft = await openingStockCommitDraftFixture(parser);

    const result = await store.commit(draft);

    expect(result).toMatchObject({
      id: "INITIAL_OPENING_STOCK",
      createdItemCount: 81,
      inventoryRowCount: 243,
      positiveRowCount: 1,
      zeroRowCount: 242,
    });
    await expect(
      prisma.openingStockImport.findUniqueOrThrow({ where: { id: "INITIAL_OPENING_STOCK" } }),
    ).resolves.toMatchObject({ operatorId: "admin-1", financeReviewer: "财务甲" });
    await expect(prisma.item.count()).resolves.toBe(81);
    await expect(prisma.inboundOrder.count({ where: { source: "OPENING_STOCK" } })).resolves.toBe(1);
    await expect(prisma.procurementBatch.count()).resolves.toBe(1);
    await expect(prisma.stockBalance.count()).resolves.toBe(1);
    await expect(prisma.inboundLine.findFirstOrThrow()).resolves.toMatchObject({ remark: "实盘确认" });
    await expect(
      prisma.inventoryLedgerEntry.count({ where: { type: "OPENING_BALANCE" } }),
    ).resolves.toBe(1);
  });

  it("rolls back the import marker, new items and first row when a later row write fails", async () => {
    const draft = await openingStockCommitDraftFixture(parser, {
      mutateWorkbook: (workbook) => {
        const sheet = workbook.getWorksheet("期初库存")!;
        sheet.getCell("I5").value = 1;
        sheet.getCell("J5").value = 10;
        sheet.getCell("L5").value = "第二条正库存";
      },
    });
    draft.rows[1]!.unitCost = "123456789012345.1234";
    draft.rows[1]!.amount = "123456789012345.12";

    await expect(store.commit(draft)).rejects.toBeDefined();

    await expect(prisma.openingStockImport.count()).resolves.toBe(0);
    await expect(prisma.item.findUnique({ where: { code: "BJ0001" } })).resolves.toBeNull();
    await expect(prisma.inboundOrder.count({ where: { source: "OPENING_STOCK" } })).resolves.toBe(0);
    await expect(prisma.procurementBatch.count()).resolves.toBe(0);
    await expect(prisma.stockBalance.count()).resolves.toBe(0);
    await expect(
      prisma.inventoryLedgerEntry.count({ where: { referenceType: "OPENING_STOCK" } }),
    ).resolves.toBe(0);
    await expect(
      prisma.accountingPeriod.findUnique({ where: { periodCode: "2026-08" } }),
    ).resolves.toBeNull();
  });

  it("blocks initialization after unrelated inventory activity", async () => {
    await prisma.item.create({
      data: {
        id: "unrelated-item",
        code: "UNRELATED-ITEM",
        name: "Unrelated item",
        unit: "个",
        categoryId: "category-wp",
      },
    });
    await new PrismaInventoryEntryStore(prisma).recordStockEntry({
      warehouseId: "warehouse-1",
      itemId: "unrelated-item",
      batchNo: "UNRELATED-BATCH",
      autoGenerateBatchNo: false,
      quantity: "1",
      unitCost: "1",
      purchasedAt: "2026-08-23T00:00:00.000Z",
      ledgerType: "INBOUND",
      referenceType: "INBOUND_ORDER",
      referenceId: "unrelated-order",
      occurredAt: "2026-08-23T00:00:00.000Z",
      operatorId: "unrelated-admin",
    });
    const draft = await openingStockCommitDraftFixture(parser);

    await expect(store.commit(draft)).rejects.toMatchObject({ statusCode: 409 });

    await expect(prisma.openingStockImport.count()).resolves.toBe(0);
    await expect(prisma.item.findUnique({ where: { code: "BJ0001" } })).resolves.toBeNull();
    await expect(
      prisma.inventoryLedgerEntry.count({ where: { type: "OPENING_BALANCE" } }),
    ).resolves.toBe(0);
  });

  it("rolls back when the baseline period is closed", async () => {
    await prisma.accountingPeriod.create({ data: { periodCode: "2026-08", status: "CLOSED" } });
    const draft = await openingStockCommitDraftFixture(parser);
    const before = {
      marker: await prisma.openingStockImport.count(),
      items: await prisma.item.count(),
      orders: await prisma.inboundOrder.count(),
      batches: await prisma.procurementBatch.count(),
      balances: await prisma.stockBalance.count(),
      lines: await prisma.inboundLine.count(),
      ledger: await prisma.inventoryLedgerEntry.count(),
    };

    await expect(store.commit(draft)).rejects.toMatchObject({
      message: "期初库存所属会计期间已关闭",
      statusCode: 409,
    });

    await expect(Promise.all([
      prisma.openingStockImport.count(),
      prisma.item.count(),
      prisma.inboundOrder.count(),
      prisma.procurementBatch.count(),
      prisma.stockBalance.count(),
      prisma.inboundLine.count(),
      prisma.inventoryLedgerEntry.count(),
    ])).resolves.toEqual([
      before.marker,
      before.items,
      before.orders,
      before.batches,
      before.balances,
      before.lines,
      before.ledger,
    ]);
  });

  it("rejects an existing composite batch key before writing", async () => {
    await prisma.item.create({
      data: {
        id: "existing-bj0001",
        code: "BJ0001",
        name: "测试物品 BJ0001",
        unit: "个",
        categoryId: "category-bj",
      },
    });
    await prisma.procurementBatch.create({
      data: {
        id: "existing-opening-batch",
        warehouseId: "warehouse-1",
        itemId: "existing-bj0001",
        batchNo: "OPEN-20260824-WH01-BJ0001",
        quantity: "1",
        remainingQuantity: "1",
        unitCost: "1",
        purchasedAt: new Date("2026-08-23T00:00:00.000Z"),
      },
    });
    const draft = await openingStockCommitDraftFixture(parser);
    draft.createdItemCount = 80;

    await expect(store.commit(draft)).rejects.toMatchObject({ statusCode: 409 });

    await expect(prisma.item.findUnique({ where: { id: "existing-bj0001" } })).resolves.toBeTruthy();
    await expect(
      prisma.procurementBatch.findUnique({ where: { id: "existing-opening-batch" } }),
    ).resolves.toBeTruthy();
    await expect(prisma.openingStockImport.count()).resolves.toBe(0);
    await expect(prisma.item.findUnique({ where: { code: "BJ0002" } })).resolves.toBeNull();
    await expect(prisma.inboundOrder.count({ where: { source: "OPENING_STOCK" } })).resolves.toBe(0);
    await expect(
      prisma.inventoryLedgerEntry.count({ where: { type: "OPENING_BALANCE" } }),
    ).resolves.toBe(0);
  });

  it("rejects a second completed import without changing table counts", async () => {
    const draft = await openingStockCommitDraftFixture(parser);
    await store.commit(draft);
    const counts = await Promise.all([
      prisma.openingStockImport.count(),
      prisma.item.count(),
      prisma.inboundOrder.count(),
      prisma.procurementBatch.count(),
      prisma.stockBalance.count(),
      prisma.inboundLine.count(),
      prisma.inventoryLedgerEntry.count(),
    ]);

    await expect(store.commit(draft)).rejects.toMatchObject({ statusCode: 409 });

    await expect(Promise.all([
      prisma.openingStockImport.count(),
      prisma.item.count(),
      prisma.inboundOrder.count(),
      prisma.procurementBatch.count(),
      prisma.stockBalance.count(),
      prisma.inboundLine.count(),
      prisma.inventoryLedgerEntry.count(),
    ])).resolves.toEqual(counts);
  });

  it("allows exactly one concurrent first commit", async () => {
    const draft = await openingStockCommitDraftFixture(parser);

    const results = await Promise.allSettled([
      store.commit(draft),
      store.commit(structuredClone(draft)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { statusCode: 409 } });
    await expect(prisma.openingStockImport.count()).resolves.toBe(1);
    await expect(prisma.item.count()).resolves.toBe(81);
    await expect(
      prisma.inventoryLedgerEntry.count({ where: { type: "OPENING_BALANCE" } }),
    ).resolves.toBe(1);
  });
});
