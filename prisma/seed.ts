import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export interface StructuralSeedData {
  warehouses: Array<{ code: string; name: string; isPlaceholder: boolean; isActive: boolean }>;
  categories: Array<{ prefix: string; name: string }>;
  historicalRows: unknown[];
}

export function getStructuralSeedData(): StructuralSeedData {
  return {
    warehouses: [
      { code: "WH-01", name: "待配置仓库一", isPlaceholder: true, isActive: true },
      { code: "WH-02", name: "待配置仓库二", isPlaceholder: true, isActive: true },
      { code: "WH-03", name: "待配置仓库三", isPlaceholder: true, isActive: true },
    ],
    categories: [
      { prefix: "BJ", name: "办公用品" },
      { prefix: "CY", name: "茶饮" },
      { prefix: "WP", name: "物品" },
    ],
    historicalRows: [],
  };
}

export async function seedStructuralData(client: {
  warehouse: { upsert(args: { where: { code: string }; update: { name: string; isPlaceholder: boolean; isActive: boolean }; create: { code: string; name: string; isPlaceholder: boolean; isActive: boolean } }): Promise<unknown> };
  itemCategory: { upsert(args: { where: { code: string }; update: { name: string; prefix: string }; create: { code: string; name: string; prefix: string } }): Promise<unknown> };
}): Promise<void> {
  const seedData = getStructuralSeedData();
  for (const warehouse of seedData.warehouses) {
    await client.warehouse.upsert({ where: { code: warehouse.code }, update: warehouse, create: warehouse });
  }
  for (const category of seedData.categories) {
    await client.itemCategory.upsert({ where: { code: `CATEGORY_${category.prefix}` }, update: category, create: { ...category, code: `CATEGORY_${category.prefix}` } });
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
