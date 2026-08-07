import { pathToFileURL } from "node:url";

export interface StructuralSeedData {
  warehouses: Array<{ code: string; name: string; isPlaceholder: boolean }>;
  categories: Array<{ prefix: string; name: string }>;
  historicalRows: unknown[];
}

export function getStructuralSeedData(): StructuralSeedData {
  return {
    warehouses: [
      { code: "WH-01", name: "待配置仓库一", isPlaceholder: true },
      { code: "WH-02", name: "待配置仓库二", isPlaceholder: true },
      { code: "WH-03", name: "待配置仓库三", isPlaceholder: true },
    ],
    categories: [
      { prefix: "BJ", name: "办公用品" },
      { prefix: "CY", name: "茶饮" },
      { prefix: "WP", name: "物品" },
    ],
    historicalRows: [],
  };
}

async function main() {
  const data = getStructuralSeedData();
  console.log(`Prisma seed placeholder ready: ${data.warehouses.length} warehouses, ${data.categories.length} categories.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
