import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../../apps/api/src/server.js";
import { OutboundService } from "../../../apps/api/src/application/inventory/outbound-service.js";
import { PrismaOpeningStockImportStore } from "../../../apps/api/src/infrastructure/db/prisma-opening-stock-import-store.js";
import { PrismaOutboundStore } from "../../../apps/api/src/infrastructure/db/prisma-outbound-store.js";
import { seedStructuralData } from "../../../prisma/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaName = process.env.TASK4_TEST_SCHEMA ?? `warehouse_task4_${process.pid}_${Date.now()}`;
const preserveSchema = process.env.TASK4_PRESERVE_TEST_SCHEMA === "true";

function schemaUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("schema", schemaName);
  url.searchParams.set("options", `-c search_path=${schemaName}`);
  return url.toString();
}

function createClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema: schemaName }) });
}

async function createAdminSessionCookie(app: ReturnType<typeof buildServer>): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: "/auth/local?returnTo=/admin/items",
    remoteAddress: "127.0.0.1",
    headers: { host: "localhost:3001" },
  });
  expect(response.statusCode).toBe(302);
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? value[0]! : value!;
}

function mockRestartApproval(): void {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    if (url.pathname.endsWith("/gettoken")) {
      return new Response(JSON.stringify({ access_token: "task4-access-token" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname.endsWith("/getapprovaldetail")) {
      return new Response(JSON.stringify({
        info: {
          sp_no: "2026081100000006",
          template_id: "task4-legacy-template",
          sp_status: 2,
          apply_time: Math.floor(Date.now() / 1000),
          applyer: { userid: "task4-restart-applicant", name: "Restart Applicant" },
          contents: [{
            control: "Table",
            value: { children: [{ list: [
              { control: "Selector", value: { selector: { options: [{ key: "task4-option", value: "Task 4 durable item" }] } } },
              { control: "Number", value: { new_number: { value: "1", unit: "box" } } },
            ] }] },
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${url.toString()}`);
  }));
}

describe.skipIf(!databaseUrl)("Prisma application restart persistence", () => {
  let adminPool: Pool;
  let fixturePrisma: PrismaClient;
  let isolatedDatabaseUrl: string;

  beforeAll(async () => {
    if (!/^warehouse_task4_\d+_\d+$/.test(schemaName)) throw new Error("unsafe test schema name");
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
        "prisma/migrations/20260904183000_approval_intent_outbound_decisions/migration.sql",
      ]) {
        await migrationClient.query(readFileSync(resolve(process.cwd(), migration), "utf8"));
      }
    } finally {
      migrationClient.release();
      await migrationPool.end();
    }
    fixturePrisma = createClient(isolatedDatabaseUrl);
    await seedStructuralData(fixturePrisma);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await fixturePrisma?.$disconnect();
    if (adminPool) {
      if (preserveSchema) console.info(`preserved Task 4 restart evidence schema: ${schemaName}`);
      else await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminPool.end();
    }
  });

  it("preserves every core API path and durable read model after application reconstruction", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PERSISTENCE_DRIVER", "prisma");
    vi.stubEnv("DATABASE_URL", isolatedDatabaseUrl);
    vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
    vi.stubEnv("API_BASE_URL", "http://localhost:3001");
    vi.stubEnv("WEB_BASE_URL", "http://localhost:5174");
    vi.stubEnv("SESSION_SECRET", "local-development-session-secret");
    vi.stubEnv("WE_COM_CORP_ID", "wx-task4-corp");
    vi.stubEnv("WE_COM_AGENT_ID", "1000001");
    vi.stubEnv("WE_COM_SECRET", "task4-secret");
    vi.stubEnv("WE_COM_APPROVAL_TEMPLATE_ID", "task4-intent-template");
    vi.stubEnv("WE_COM_LEGACY_APPROVAL_TEMPLATE_IDS", "task4-legacy-template");
    vi.stubEnv("WE_COM_CALLBACK_TOKEN", "task4-token");
    vi.stubEnv("WE_COM_ENCODING_AES_KEY", "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");

    const firstApp = buildServer();
    let itemId: string;
    let batchId: string;
    let approvalId: string;
    let outboundAllocationId: string;
    const periodCode = new Date().toISOString().slice(0, 7);

    try {
      const cookie = await createAdminSessionCookie(firstApp);
      const itemResponse = await firstApp.inject({
        method: "POST",
        url: "/admin/items",
        headers: { cookie },
        payload: {
          code: "BJ-TASK4",
          name: "Task 4 durable item",
          unit: "box",
          categoryId: "category-bj",
          weComOptionKey: "task4-option",
          minimumStock: "20",
        },
      });
      expect(itemResponse.statusCode).toBe(201);
      itemId = itemResponse.json<{ id: string }>().id;

      await Promise.all([
        fixturePrisma.warehouse.update({
          where: { id: "warehouse-1" },
          data: { name: "集团二楼仓库", isPlaceholder: false },
        }),
        fixturePrisma.warehouse.update({
          where: { id: "warehouse-2" },
          data: { name: "内区1号仓库", isPlaceholder: false },
        }),
        fixturePrisma.warehouse.update({
          where: { id: "warehouse-3" },
          data: { name: "1区车库后仓库", isPlaceholder: false },
        }),
      ]);
      const baselineDate = `${periodCode}-01`;
      await new PrismaOpeningStockImportStore(fixturePrisma).commit({
        id: "INITIAL_OPENING_STOCK",
        fileSha256: "a".repeat(64),
        sourceFileName: "task4-opening.xlsx",
        baselineDate,
        operatorId: "local-admin",
        financeReviewer: "task4-finance",
        itemCount: 1,
        createdItemCount: 0,
        inventoryRowCount: 1,
        positiveRowCount: 1,
        zeroRowCount: 0,
        totalQuantity: "20",
        totalAmount: "200.00",
        items: [
          {
            sheetRow: 2,
            code: "BJ-TASK4",
            name: "Task 4 durable item",
            categoryLabel: "白酒",
            categoryPrefix: "BJ",
            unit: "box",
            referenceUnitCost: "10",
          },
        ],
        rows: [
          {
            sheetRow: 2,
            warehouseCode: "WH-01",
            itemCode: "BJ-TASK4",
            batchNo: "TASK4-OPENING",
            quantity: "20",
            unitCost: "10",
            amount: "200.00",
            remark: "restart acceptance",
          },
        ],
      });
      batchId = (
        await fixturePrisma.procurementBatch.findFirstOrThrow({
          where: { batchNo: "TASK4-OPENING" },
        })
      ).id;

      await fixturePrisma.user.upsert({
        where: { id: "task4-applicant" },
        update: {},
        create: { id: "task4-applicant", weComUserId: "task4-applicant", name: "Task 4 Applicant", roleId: "role-applicant" },
      });
      const approval = await fixturePrisma.approvalRequest.create({
        data: {
          id: "task4-approved-request",
          weComSpNo: "2026081100000004",
          applicantUserId: "task4-applicant",
          applicantName: "Task 4 Applicant",
          purpose: "restart acceptance",
          status: "APPROVED",
          outboundStatus: "PENDING_OUTBOUND",
          submittedAt: new Date(),
          approvedAt: new Date(),
          lines: {
            create: {
              id: "task4-approved-line",
              itemId,
              requestedItemName: "Task 4 durable item",
              requestedQuantity: "5",
              unit: "box",
              legacyResolutionStatus: "EXACT_LOCKED",
            },
          },
        },
        include: { lines: true },
      });
      approvalId = approval.id;

      const outbound = await new OutboundService(new PrismaOutboundStore(fixturePrisma, schemaName)).confirm({
        approvalId,
        operatorId: "local-admin",
        decisions: [{
          approvalLineId: approval.lines[0]!.id,
          selectedItemId: itemId,
          allocations: [{ warehouseId: "warehouse-1", batchId, quantity: "5" }],
        }],
      });
      expect(outbound).toMatchObject({ status: "COMPLETED", actualQuantity: "5", amount: "50.00" });
      const outboundId = outbound.id;
      outboundAllocationId = (await fixturePrisma.outboundAllocation.findFirstOrThrow({ where: { outboundOrderId: outboundId } })).id;

      const transferResponse = await firstApp.inject({
        method: "POST",
        url: "/admin/transfers",
        headers: { cookie },
        payload: { itemId, batchId, sourceWarehouseId: "warehouse-1", destinationWarehouseId: "warehouse-2", quantity: "4", reason: "restart acceptance" },
      });
      expect(transferResponse.statusCode).toBe(201);

      const returnResponse = await firstApp.inject({
        method: "POST",
        url: "/admin/returns",
        headers: { cookie },
        payload: { outboundAllocationId, quantity: "2", reason: "unused stock" },
      });
      expect(returnResponse.statusCode).toBe(201);

      const stocktakeResponse = await firstApp.inject({
        method: "POST",
        url: "/admin/stocktake",
        headers: { cookie },
        payload: { periodCode, operatorId: "local-admin", warehouseId: "warehouse-2", itemId, batchId, bookQuantity: "4", actualQuantity: "3", reason: "counted shortage" },
      });
      expect(stocktakeResponse.statusCode).toBe(201);

      const searchBeforeRestart = await firstApp.inject({ method: "GET", url: "/admin/reports/inventory-search?query=BJ-TASK4&warehouseId=all", headers: { cookie } });
      expect(searchBeforeRestart.statusCode).toBe(200);
      expect(searchBeforeRestart.json()).toEqual([
        expect.objectContaining({ itemId, totalQuantity: "16", totalAmount: "160.00", locations: expect.arrayContaining([
          expect.objectContaining({ warehouseId: "warehouse-1", quantity: "13" }),
          expect.objectContaining({ warehouseId: "warehouse-2", quantity: "3" }),
        ]) }),
      ]);

      const closeResponse = await firstApp.inject({
        method: "POST",
        url: "/admin/period-close",
        headers: { cookie },
        payload: { period: { code: periodCode, status: "OPEN" } },
      });
      expect(closeResponse.statusCode).toBe(200);
      expect(closeResponse.json()).toMatchObject({ code: periodCode, status: "CLOSED" });

      await fixturePrisma.approvalRequest.create({
        data: {
          id: "task4-pending-after-close",
          weComSpNo: "2026081100000005",
          applicantUserId: "task4-applicant",
          applicantName: "Task 4 Applicant",
          purpose: "notification acceptance",
          status: "APPROVED",
          outboundStatus: "PENDING_OUTBOUND",
          submittedAt: new Date(),
          approvedAt: new Date(),
          lines: {
            create: {
              id: "task4-pending-line",
              itemId,
              requestedItemName: "Task 4 durable item",
              requestedQuantity: "1",
              unit: "box",
              legacyResolutionStatus: "EXACT_LOCKED",
            },
          },
        },
      });
    } finally {
      await firstApp.close();
    }

    await fixturePrisma.$disconnect();
    fixturePrisma = createClient(isolatedDatabaseUrl);
    mockRestartApproval();
    const secondApp = buildServer();
    try {
      const cookie = await createAdminSessionCookie(secondApp);
      const reconstructedOutbound = await fixturePrisma.approvalRequest.findUniqueOrThrow({
        where: { id: approvalId },
        include: {
          lines: true,
          outboundOrder: {
            include: {
              decisions: { include: { allocations: true } },
              allocations: true,
            },
          },
        },
      });
      expect(reconstructedOutbound).toMatchObject({
        lines: [{
          id: "task4-approved-line",
          requestedItemName: "Task 4 durable item",
          unit: "box",
          itemId,
          legacyResolutionStatus: "EXACT_LOCKED",
        }],
        outboundOrder: {
          operatorId: "local-admin",
          decisions: [{
            approvalLineId: "task4-approved-line",
            selectedItemId: itemId,
            varianceReason: null,
            decidedBy: "local-admin",
            allocations: [expect.objectContaining({ warehouseId: "warehouse-1", itemId, batchId })],
          }],
          allocations: [expect.objectContaining({ warehouseId: "warehouse-1", itemId, batchId })],
        },
      });
      expect(reconstructedOutbound.lines[0]!.requestedQuantity.toString()).toBe("5");
      expect(reconstructedOutbound.outboundOrder!.decisions[0]!.actualQuantity.toString()).toBe("5");
      expect(reconstructedOutbound.outboundOrder!.allocations[0]!.quantity.toString()).toBe("5");
      const resync = await secondApp.inject({ method: "POST", url: "/admin/approvals/2026081100000006/resync", headers: { cookie } });
      expect(resync.statusCode, resync.body).toBe(200);
      expect(resync.json()).toMatchObject({ created: true, status: "PENDING_OUTBOUND" });

      const [health, items, search, transactions, summary, pending, notifications, transferOptions, returnOptions, stocktakeOptions] = await Promise.all([
        secondApp.inject({ method: "GET", url: "/health" }),
        secondApp.inject({ method: "GET", url: "/admin/items?includeInactive=true", headers: { cookie } }),
        secondApp.inject({ method: "GET", url: "/admin/reports/inventory-search?query=TASK4-OPENING&warehouseId=all", headers: { cookie } }),
        secondApp.inject({ method: "GET", url: `/admin/reports/transactions?period=${periodCode}&type=all`, headers: { cookie } }),
        secondApp.inject({ method: "GET", url: `/admin/reports/summary?period=${periodCode}`, headers: { cookie } }),
        secondApp.inject({ method: "GET", url: "/admin/outbound/pending", headers: { cookie } }),
        secondApp.inject({ method: "GET", url: "/admin/notifications", headers: { cookie } }),
        secondApp.inject({ method: "GET", url: "/admin/transfers/options", headers: { cookie } }),
        secondApp.inject({ method: "GET", url: "/admin/returns/options", headers: { cookie } }),
        secondApp.inject({ method: "GET", url: "/admin/stocktake/options", headers: { cookie } }),
      ]);

      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ status: "ok", persistenceDriver: "prisma", database: { status: "ok" } });
      expect(items.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: itemId, code: "BJ-TASK4" })]));
      expect(search.json()).toEqual([expect.objectContaining({ itemId, totalQuantity: "16", totalAmount: "160.00" })]);
      expect(new Set(transactions.json<Array<{ type: string }>>().map((entry) => entry.type))).toEqual(new Set([
        "OPENING_BALANCE", "OUTBOUND", "TRANSFER_OUT", "TRANSFER_IN", "RETURN", "STOCKTAKE_ADJUSTMENT",
      ]));
      expect(summary.json()).toEqual([expect.objectContaining({ itemId, quantity: "16", amount: "160.00" })]);
      expect(pending.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "task4-pending-after-close", status: "PENDING_OUTBOUND" }),
        expect.objectContaining({ weComSpNo: "2026081100000006", status: "PENDING_OUTBOUND" }),
      ]));
      expect(notifications.json<Array<{ kind: string }>>().map((entry) => entry.kind)).toEqual(expect.arrayContaining(["PENDING_OUTBOUND", "LOW_STOCK", "STOCKTAKE", "ANOMALY"]));
      expect(transferOptions.json<{ balances: Array<{ batchId: string }> }>().balances).toEqual(expect.arrayContaining([expect.objectContaining({ batchId })]));
      expect(returnOptions.json<{ allocations: Array<{ id: string; remainingReturnableQuantity: string }> }>().allocations).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: outboundAllocationId, remainingReturnableQuantity: "3" }),
      ]));
      expect(stocktakeOptions.json<{ balances: Array<{ batchId: string }> }>().balances).toEqual(expect.arrayContaining([expect.objectContaining({ batchId })]));

      const closedPeriodWrite = await secondApp.inject({
        method: "POST",
        url: "/admin/inbound",
        headers: { cookie },
        payload: { warehouseId: "warehouse-1", itemId, batchNo: "TASK4-CLOSED", quantity: "1", unitCost: "10", purchasedAt: new Date().toISOString() },
      });
      expect(closedPeriodWrite.statusCode).toBe(400);
      expect(closedPeriodWrite.json()).toEqual({ error: `closed period: ${periodCode}` });
    } finally {
      await secondApp.close();
    }

    await expect(fixturePrisma.item.findUnique({ where: { id: itemId } })).resolves.toMatchObject({ code: "BJ-TASK4" });
    await expect(fixturePrisma.accountingPeriod.findUnique({ where: { periodCode } })).resolves.toMatchObject({ status: "CLOSED" });
    await expect(
      fixturePrisma.openingStockImport.findUnique({ where: { id: "INITIAL_OPENING_STOCK" } }),
    ).resolves.toBeTruthy();
    await expect(fixturePrisma.inventoryLedgerEntry.count({ where: { itemId } })).resolves.toBe(6);
    expect((await fixturePrisma.stockBalance.aggregate({ where: { itemId }, _sum: { remainingQuantity: true } }))._sum.remainingQuantity?.toString()).toBe("16");
  });
});
