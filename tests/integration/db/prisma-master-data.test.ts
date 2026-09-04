import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { seedStructuralData } from "../../../prisma/seed.ts";
import { createPersistenceAdapters } from "../../../apps/api/src/infrastructure/db/runtime.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

function createClient(connectionString = databaseUrl): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function databaseConnectionString(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  url.searchParams.delete("schema");
  return url.toString();
}

describe.skipIf(!databaseUrl)("Prisma master-data and identity persistence", () => {
  let prisma = createClient();

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.item.deleteMany();
    await prisma.user.deleteMany();
    await seedStructuralData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("seeds stable structural data idempotently", async () => {
    await seedStructuralData(prisma);

    expect(await prisma.role.findMany({ orderBy: { id: "asc" }, select: { id: true, code: true } })).toEqual([
      { id: "role-admin", code: "ADMIN" },
      { id: "role-applicant", code: "APPLICANT" },
      { id: "role-finance", code: "FINANCE" },
    ]);
    expect(await prisma.warehouse.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true } })).toEqual([
      { id: "warehouse-1", code: "WH-01" },
      { id: "warehouse-2", code: "WH-02" },
      { id: "warehouse-3", code: "WH-03" },
    ]);
    expect(await prisma.itemCategory.findMany({ orderBy: { prefix: "asc" }, select: { id: true, code: true, prefix: true } })).toEqual([
      { id: "category-bj", code: "CATEGORY_BJ", prefix: "BJ" },
      { id: "category-cy", code: "CATEGORY_CY", prefix: "CY" },
      { id: "category-hj", code: "CATEGORY_HJ", prefix: "HJ" },
      { id: "category-wp", code: "CATEGORY_WP", prefix: "WP" },
    ]);
  });

  it("preserves operator-managed warehouse settings when structural data is reseeded", async () => {
    try {
      await prisma.warehouse.update({
        where: { code: "WH-01" },
        data: {
          name: "集团二楼仓库",
          isPlaceholder: false,
          isActive: false,
        },
      });

      await seedStructuralData(prisma);

      await expect(prisma.warehouse.findUnique({ where: { code: "WH-01" } })).resolves.toMatchObject({
        id: "warehouse-1",
        code: "WH-01",
        name: "集团二楼仓库",
        isPlaceholder: false,
        isActive: false,
      });
    } finally {
      await prisma.warehouse.update({
        where: { code: "WH-01" },
        data: {
          name: "待配置仓库一",
          isPlaceholder: true,
          isActive: true,
        },
      });
    }
  });

  it("persists master-data updates and audit identities across adapter restart", async () => {
    const adapters = createPersistenceAdapters({ driver: "prisma", prisma });
    await adapters.identityService.ensureUser({
      id: "admin-1",
      weComUserId: "zhangsan",
      name: "张三",
      role: "ADMIN",
    });
    await adapters.repositories.warehouses.save({
      id: "warehouse-1",
      code: "WH-01",
      name: "上海成品仓",
      isActive: true,
      isPlaceholder: false,
    });
    await adapters.repositories.items.save({
      id: "item-1",
      code: "BJ-0001",
      name: "打印纸",
      specification: "A4 80g",
      unit: "箱",
      categoryId: "category-bj",
      minimumStock: "5",
      isActive: true,
    });
    await adapters.auditService.record({
      actorUserId: "admin-1",
      actorRole: "ADMIN",
      actorName: "过期姓名",
      action: "ITEM_CREATED",
      entityType: "ITEM",
      entityId: "item-1",
      occurredAt: "2026-08-11T00:00:00.000Z",
    });
    await adapters.disconnect();

    prisma = createClient();
    const restarted = createPersistenceAdapters({ driver: "prisma", prisma });

    await expect(restarted.repositories.warehouses.get("warehouse-1")).resolves.toMatchObject({
      name: "上海成品仓",
      isPlaceholder: false,
    });
    await expect(restarted.repositories.items.get("item-1")).resolves.toMatchObject({
      code: "BJ-0001",
      name: "打印纸",
      categoryId: "category-bj",
    });
    await expect(prisma.user.findUnique({ where: { id: "admin-1" }, include: { role: true } })).resolves.toMatchObject({
      weComUserId: "zhangsan",
      name: "张三",
      role: { id: "role-admin", code: "ADMIN" },
    });
    await expect(prisma.auditLog.findFirst({ where: { actorUserId: "admin-1" } })).resolves.toMatchObject({
      action: "ITEM_CREATED",
      entityId: "item-1",
    });

    await restarted.disconnect();
    prisma = createClient();
  });

  it("normalizes previous-seed ids after migration without breaking dependent references", async () => {
    const sourceUrl = databaseUrl as string;
    const databaseName = `warehouse_task2_legacy_${process.pid}_${Date.now()}`;
    const adminUrl = databaseConnectionString(sourceUrl, "postgres");
    const upgradeUrl = databaseConnectionString(sourceUrl, databaseName);
    const adminPool = new Pool({ connectionString: adminUrl });
    let upgradePool: Pool | undefined;
    let upgradePrisma: PrismaClient | undefined;

    try {
      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
      upgradePool = new Pool({ connectionString: upgradeUrl });

      const initialMigration = readFileSync(resolve(process.cwd(), "prisma/migrations/00000000000000_init/migration.sql"), "utf8");
      const productionMigration = readFileSync(resolve(process.cwd(), "prisma/migrations/20260811163000_production_persistence/migration.sql"), "utf8");
      await upgradePool.query(initialMigration);
      await upgradePool.query(`
        INSERT INTO "Warehouse" ("id", "code", "name", "isActive", "isPlaceholder") VALUES
          ('legacy-warehouse-1', 'WH-01', '待配置仓库一', true, true),
          ('legacy-warehouse-2', 'WH-02', '待配置仓库二', true, true),
          ('legacy-warehouse-3', 'WH-03', '待配置仓库三', true, true);
        INSERT INTO "ItemCategory" ("id", "code", "prefix", "name") VALUES
          ('legacy-category-bj', 'CATEGORY_BJ', 'BJ', '办公用品'),
          ('legacy-category-cy', 'CATEGORY_CY', 'CY', '茶饮'),
          ('legacy-category-wp', 'CATEGORY_WP', 'WP', '物品');
        INSERT INTO "Item" ("id", "code", "name", "unit", "categoryId", "isActive", "updatedAt")
          VALUES ('legacy-item-1', 'BJ-0001', '打印纸', '箱', 'legacy-category-bj', true, CURRENT_TIMESTAMP);
        INSERT INTO "InboundOrder" ("id", "warehouseId", "orderNo", "source", "receivedAt", "operatorId")
          VALUES ('legacy-inbound-1', 'legacy-warehouse-1', 'IN-LEGACY-1', 'PURCHASE', CURRENT_TIMESTAMP, 'legacy-user');
      `);
      await upgradePool.query(productionMigration);

      upgradePrisma = createClient(upgradeUrl);
      await seedStructuralData(upgradePrisma);

      await expect(upgradePrisma.item.findUnique({ where: { id: "legacy-item-1" } })).resolves.toMatchObject({
        categoryId: "category-bj",
      });
      await expect(upgradePrisma.inboundOrder.findUnique({ where: { id: "legacy-inbound-1" } })).resolves.toMatchObject({
        warehouseId: "warehouse-1",
      });
      await expect(upgradePrisma.itemCategory.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true } })).resolves.toEqual([
        { id: "category-bj", code: "CATEGORY_BJ" },
        { id: "category-cy", code: "CATEGORY_CY" },
        { id: "category-hj", code: "CATEGORY_HJ" },
        { id: "category-wp", code: "CATEGORY_WP" },
      ]);
      await expect(upgradePrisma.warehouse.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true } })).resolves.toEqual([
        { id: "warehouse-1", code: "WH-01" },
        { id: "warehouse-2", code: "WH-02" },
        { id: "warehouse-3", code: "WH-03" },
      ]);
    } finally {
      await upgradePrisma?.$disconnect();
      await upgradePool?.end();
      await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await adminPool.end();
    }
  });
});
