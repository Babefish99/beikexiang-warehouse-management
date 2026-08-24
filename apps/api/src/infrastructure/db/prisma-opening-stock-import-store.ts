import {
  PrismaClient,
  type OpeningStockImport as PrismaOpeningStockImport,
} from "@prisma/client";

import { BusinessRuleError } from "../../application/errors/business-rule-error.js";
import type {
  OpeningStockImportCommitDraft,
  OpeningStockImportResult,
  OpeningStockImportStore,
  OpeningStockMasterDataSnapshot,
  ParsedOpeningStockWorkbook,
} from "../../application/inventory/opening-stock-import-contract.js";
import { validateOpeningStockMasterData } from "../../application/inventory/opening-stock-import-service.js";
import {
  assertPrismaPeriodOpen,
  RetryableInventoryTransactionError,
  runInventoryTransaction,
  type InventoryTransactionClient,
} from "./prisma-inventory-transaction.js";

type OpeningStockDataClient = Pick<
  PrismaClient,
  | "openingStockImport"
  | "inventoryLedgerEntry"
  | "warehouse"
  | "itemCategory"
  | "item"
  | "procurementBatch"
>;

function normalizedCode(value: string): string {
  return value.trim().toUpperCase();
}

function conflict(message: string): BusinessRuleError {
  return new BusinessRuleError(message, 409);
}

function parsedDraft(input: OpeningStockImportCommitDraft): ParsedOpeningStockWorkbook {
  return {
    baselineDate: input.baselineDate,
    items: structuredClone(input.items),
    rows: input.rows.map((row) => ({ ...row, disposition: "IMPORT" as const })),
    issues: [],
    summary: {
      itemCount: input.itemCount,
      inventoryRowCount: input.inventoryRowCount,
      positiveRowCount: input.positiveRowCount,
      zeroRowCount: input.zeroRowCount,
      totalQuantity: input.totalQuantity,
      totalAmount: input.totalAmount,
    },
  };
}

function toResult(record: PrismaOpeningStockImport): OpeningStockImportResult {
  return {
    id: "INITIAL_OPENING_STOCK",
    fileSha256: record.fileSha256,
    sourceFileName: record.sourceFileName,
    baselineDate: record.baselineDate.toISOString().slice(0, 10),
    operatorId: record.operatorId,
    financeReviewer: record.financeReviewer,
    itemCount: record.itemCount,
    createdItemCount: record.createdItemCount,
    inventoryRowCount: record.inventoryRowCount,
    positiveRowCount: record.positiveRowCount,
    zeroRowCount: record.zeroRowCount,
    totalQuantity: record.totalQuantity.toString(),
    totalAmount: record.totalAmount.toFixed(2),
    importedAt: record.importedAt.toISOString(),
  };
}

async function loadSnapshot(client: OpeningStockDataClient): Promise<OpeningStockMasterDataSnapshot> {
  const [marker, ledgerCount, warehouses, categories, items, batches] = await Promise.all([
    client.openingStockImport.findUnique({ where: { id: "INITIAL_OPENING_STOCK" } }),
    client.inventoryLedgerEntry.count(),
    client.warehouse.findMany({ orderBy: { code: "asc" } }),
    client.itemCategory.findMany({ orderBy: { prefix: "asc" } }),
    client.item.findMany({ orderBy: { code: "asc" } }),
    client.procurementBatch.findMany({
      select: { warehouseId: true, itemId: true, batchNo: true },
    }),
  ]);
  return {
    availability: marker ? "COMPLETED" : ledgerCount > 0 ? "BLOCKED_BY_ACTIVITY" : "AVAILABLE",
    completedImport: marker ? toResult(marker) : undefined,
    warehouses: warehouses.map((warehouse) => ({
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      isActive: warehouse.isActive,
      isPlaceholder: warehouse.isPlaceholder,
    })),
    categories: categories.map((category) => ({
      id: category.id,
      code: category.code,
      prefix: category.prefix,
      name: category.name,
    })),
    items: items.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      specification: item.specification ?? undefined,
      unit: item.unit,
      categoryId: item.categoryId,
      isActive: item.isActive,
    })),
    existingBatchKeys: batches.map(
      (batch) => `${batch.warehouseId}\u0000${batch.itemId}\u0000${batch.batchNo}`,
    ),
  };
}

export class PrismaOpeningStockImportStore implements OpeningStockImportStore {
  constructor(private readonly prisma: PrismaClient) {}

  getSnapshot(): Promise<OpeningStockMasterDataSnapshot> {
    return loadSnapshot(this.prisma);
  }

  async commit(input: OpeningStockImportCommitDraft): Promise<OpeningStockImportResult> {
    try {
      return await runInventoryTransaction(this.prisma, async (transaction) =>
        this.commitTransaction(transaction, input),
      );
    } catch (error) {
      if (error instanceof BusinessRuleError) throw error;
      if (error instanceof RetryableInventoryTransactionError) {
        throw conflict("期初库存已导入或批次已存在");
      }
      if (error instanceof Error && /^closed period:/i.test(error.message)) {
        throw conflict("期初库存所属会计期间已关闭");
      }
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw conflict("期初库存已导入或批次已存在");
      }
      throw error;
    }
  }

  private async commitTransaction(
    transaction: InventoryTransactionClient,
    input: OpeningStockImportCommitDraft,
  ): Promise<OpeningStockImportResult> {
    if (input.id !== "INITIAL_OPENING_STOCK") throw conflict("期初库存导入标识无效");
    const existingMarker = await transaction.openingStockImport.findUnique({
      where: { id: "INITIAL_OPENING_STOCK" },
    });
    if (existingMarker) throw conflict("期初库存已经完成导入");
    if ((await transaction.inventoryLedgerEntry.count()) > 0) {
      throw conflict("系统已存在库存业务活动，不能再执行期初库存初始化");
    }

    const occurredAt = new Date(`${input.baselineDate}T00:00:00.000Z`);
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== `${input.baselineDate}T00:00:00.000Z`) {
      throw conflict("期初库存盘点基准日期无效");
    }
    await assertPrismaPeriodOpen(transaction, occurredAt);

    const snapshot = await loadSnapshot(transaction);
    const validation = validateOpeningStockMasterData(parsedDraft(input), snapshot);
    if (validation.issues.some((current) => current.severity === "ERROR")) {
      throw conflict("期初库存主数据或批次状态已变化");
    }
    if (
      input.itemCount !== input.items.length ||
      input.inventoryRowCount !== input.positiveRowCount + input.zeroRowCount ||
      input.positiveRowCount !== input.rows.length ||
      validation.newItemCount !== input.createdItemCount
    ) {
      throw conflict("期初库存导入统计与当前数据不一致");
    }

    const marker = await transaction.openingStockImport.create({
      data: {
        id: "INITIAL_OPENING_STOCK",
        fileSha256: input.fileSha256,
        sourceFileName: input.sourceFileName,
        baselineDate: occurredAt,
        operatorId: input.operatorId,
        financeReviewer: input.financeReviewer,
        itemCount: input.itemCount,
        createdItemCount: input.createdItemCount,
        inventoryRowCount: input.inventoryRowCount,
        positiveRowCount: input.positiveRowCount,
        zeroRowCount: input.zeroRowCount,
        totalQuantity: input.totalQuantity,
        totalAmount: input.totalAmount,
      },
    });

    const categoriesByPrefix = new Map(
      snapshot.categories.map((category) => [normalizedCode(category.prefix), category]),
    );
    const itemsByCode = new Map(snapshot.items.map((item) => [normalizedCode(item.code), item]));
    for (const item of input.items) {
      const code = normalizedCode(item.code);
      if (itemsByCode.has(code)) continue;
      const category = categoriesByPrefix.get(normalizedCode(item.categoryPrefix));
      if (!category) throw conflict("期初库存物品分类无法解析");
      const created = await transaction.item.create({
        data: {
          id: crypto.randomUUID(),
          code,
          name: item.name.trim(),
          specification: item.specification?.trim() || null,
          unit: item.unit.trim(),
          categoryId: category.id,
          isActive: true,
        },
      });
      itemsByCode.set(code, {
        id: created.id,
        code: created.code,
        name: created.name,
        specification: created.specification ?? undefined,
        unit: created.unit,
        categoryId: created.categoryId,
        isActive: created.isActive,
      });
    }

    const warehousesByCode = new Map(
      snapshot.warehouses.map((warehouse) => [normalizedCode(warehouse.code), warehouse]),
    );
    const orderIdByWarehouse = new Map<string, string>();
    for (const row of input.rows) {
      const warehouse = warehousesByCode.get(normalizedCode(row.warehouseCode));
      if (!warehouse) throw conflict("期初库存仓库无法解析");
      if (orderIdByWarehouse.has(warehouse.id)) continue;
      const orderId = crypto.randomUUID();
      await transaction.inboundOrder.create({
        data: {
          id: orderId,
          warehouseId: warehouse.id,
          orderNo: `OPEN-${input.baselineDate.replaceAll("-", "")}-${warehouse.code}-${orderId}`,
          source: "OPENING_STOCK",
          receivedAt: occurredAt,
          operatorId: input.operatorId,
          remark: `期初库存导入：${input.sourceFileName}`,
        },
      });
      orderIdByWarehouse.set(warehouse.id, orderId);
    }

    for (const row of input.rows) {
      const warehouse = warehousesByCode.get(normalizedCode(row.warehouseCode));
      const item = itemsByCode.get(normalizedCode(row.itemCode));
      if (!warehouse || !item) throw conflict("期初库存仓库或物品无法解析");
      const orderId = orderIdByWarehouse.get(warehouse.id);
      if (!orderId) throw conflict("期初库存入库单无法解析");
      const batchId = crypto.randomUUID();
      await transaction.procurementBatch.create({
        data: {
          id: batchId,
          warehouseId: warehouse.id,
          itemId: item.id,
          batchNo: row.batchNo,
          quantity: row.quantity,
          remainingQuantity: row.quantity,
          unitCost: row.unitCost,
          purchasedAt: occurredAt,
          purchaser: input.operatorId,
        },
      });
      await transaction.stockBalance.create({
        data: {
          warehouseId: warehouse.id,
          itemId: item.id,
          batchId,
          remainingQuantity: row.quantity,
          unitCost: row.unitCost,
        },
      });
      await transaction.inboundLine.create({
        data: {
          id: crypto.randomUUID(),
          inboundOrderId: orderId,
          itemId: item.id,
          batchId,
          quantity: row.quantity,
          unitCost: row.unitCost,
          amount: row.amount,
          remark: row.remark?.trim() || null,
        },
      });
      await transaction.inventoryLedgerEntry.create({
        data: {
          id: crypto.randomUUID(),
          warehouseId: warehouse.id,
          itemId: item.id,
          batchId,
          type: "OPENING_BALANCE",
          quantity: row.quantity,
          unitCost: row.unitCost,
          amount: row.amount,
          referenceType: "OPENING_STOCK",
          referenceId: orderId,
          occurredAt,
        },
      });
    }

    return toResult(marker);
  }
}
