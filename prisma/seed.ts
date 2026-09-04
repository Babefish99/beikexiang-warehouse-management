import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { CANONICAL_ITEM_CATEGORIES } from "../apps/api/src/domain/items/item-category.ts";

export interface StructuralSeedData {
  roles: Array<{ id: string; code: string; name: string }>;
  warehouses: Array<{ id: string; code: string; name: string; isPlaceholder: boolean; isActive: boolean }>;
  categories: Array<{ id: string; code: string; prefix: string; name: string }>;
  historicalRows: unknown[];
}

export function getStructuralSeedData(): StructuralSeedData {
  return {
    roles: [
      { id: "role-admin", code: "ADMIN", name: "管理员" },
      { id: "role-finance", code: "FINANCE", name: "财务" },
      { id: "role-applicant", code: "APPLICANT", name: "领用人" },
    ],
    warehouses: [
      { id: "warehouse-1", code: "WH-01", name: "待配置仓库一", isPlaceholder: true, isActive: true },
      { id: "warehouse-2", code: "WH-02", name: "待配置仓库二", isPlaceholder: true, isActive: true },
      { id: "warehouse-3", code: "WH-03", name: "待配置仓库三", isPlaceholder: true, isActive: true },
    ],
    categories: CANONICAL_ITEM_CATEGORIES.map((category) => ({ ...category })),
    historicalRows: [],
  };
}

export async function seedStructuralData(client: {
  role: { upsert(args: { where: { code: string }; update: { id: string; code: string; name: string }; create: { id: string; code: string; name: string } }): Promise<unknown> };
  warehouse: { upsert(args: { where: { code: string }; update: { id: string; code: string }; create: { id: string; code: string; name: string; isPlaceholder: boolean; isActive: boolean } }): Promise<unknown> };
  itemCategory: { upsert(args: { where: { code: string }; update: { id: string; code: string; name: string; prefix: string }; create: { id: string; code: string; name: string; prefix: string } }): Promise<unknown> };
}): Promise<void> {
  const seedData = getStructuralSeedData();
  for (const role of seedData.roles) {
    await client.role.upsert({ where: { code: role.code }, update: role, create: role });
  }
  for (const warehouse of seedData.warehouses) {
    await client.warehouse.upsert({
      where: { code: warehouse.code },
      update: { id: warehouse.id, code: warehouse.code },
      create: warehouse,
    });
  }
  for (const category of seedData.categories) {
    await client.itemCategory.upsert({ where: { code: category.code }, update: category, create: category });
  }
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  await seedStructuralData(prisma);
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
