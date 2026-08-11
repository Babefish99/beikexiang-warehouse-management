import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { seedStructuralData } from "../../../prisma/seed.ts";
import { createPersistenceAdapters } from "../../../apps/api/src/infrastructure/db/runtime.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

function createClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
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
      { id: "category-wp", code: "CATEGORY_WP", prefix: "WP" },
    ]);
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
});
