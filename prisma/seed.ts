import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

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
    categories: [
      { id: "category-bj", code: "CATEGORY_BJ", prefix: "BJ", name: "办公用品" },
      { id: "category-cy", code: "CATEGORY_CY", prefix: "CY", name: "茶饮" },
      { id: "category-wp", code: "CATEGORY_WP", prefix: "WP", name: "物品" },
    ],
    historicalRows: [],
  };
}

export async function seedStructuralData(client: {
  role: { upsert(args: { where: { id: string }; update: { code: string; name: string }; create: { id: string; code: string; name: string } }): Promise<unknown> };
  warehouse: { upsert(args: { where: { id: string }; update: { code: string; name: string; isPlaceholder: boolean; isActive: boolean }; create: { id: string; code: string; name: string; isPlaceholder: boolean; isActive: boolean } }): Promise<unknown> };
  itemCategory: { upsert(args: { where: { id: string }; update: { code: string; name: string; prefix: string }; create: { id: string; code: string; name: string; prefix: string } }): Promise<unknown> };
}): Promise<void> {
  const seedData = getStructuralSeedData();
  for (const role of seedData.roles) {
    const { id, ...mutableRole } = role;
    await client.role.upsert({ where: { id }, update: mutableRole, create: role });
  }
  for (const warehouse of seedData.warehouses) {
    const { id, ...mutableWarehouse } = warehouse;
    await client.warehouse.upsert({ where: { id }, update: mutableWarehouse, create: warehouse });
  }
  for (const category of seedData.categories) {
    const { id, ...mutableCategory } = category;
    await client.itemCategory.upsert({ where: { id }, update: mutableCategory, create: category });
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
