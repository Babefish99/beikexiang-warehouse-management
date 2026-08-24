import { Decimal } from "decimal.js";

import { BusinessRuleError } from "../../application/errors/business-rule-error.js";
import type { InMemoryInventoryEntryStore } from "../../application/inventory/inbound-service.js";
import type { InventoryMemoryState } from "../../application/inventory/inventory-memory-state.js";
import type {
  OpeningStockImportCommitDraft,
  OpeningStockImportResult,
  OpeningStockImportStore,
  OpeningStockMasterDataSnapshot,
  ParsedOpeningStockWorkbook,
} from "../../application/inventory/opening-stock-import-contract.js";
import { validateOpeningStockMasterData } from "../../application/inventory/opening-stock-import-service.js";
import type { AccountingPeriodStore } from "../../application/periods/period-close-service.js";
import type { ItemDefinition } from "../../domain/items/item.js";
import type { WarehouseDefinition } from "../../domain/warehouses/warehouse.js";

export interface OpeningStockItemRepository {
  list(includeInactive?: boolean): Promise<ItemDefinition[]>;
  save(item: ItemDefinition): Promise<void>;
}

export interface OpeningStockWarehouseRepository {
  list(includeInactive?: boolean): Promise<WarehouseDefinition[]>;
}

export interface OpeningStockCategoryRepository {
  list(): Promise<Array<{ id: string; code: string; prefix: string; name: string }>>;
}

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

export class InMemoryOpeningStockImportStore implements OpeningStockImportStore {
  constructor(
    private readonly itemRepository: OpeningStockItemRepository,
    private readonly warehouseRepository: OpeningStockWarehouseRepository,
    private readonly categoryRepository: OpeningStockCategoryRepository,
    private readonly state: InventoryMemoryState,
    private readonly entryStore: InMemoryInventoryEntryStore,
    private readonly periodStore: AccountingPeriodStore,
  ) {}

  async getSnapshot(): Promise<OpeningStockMasterDataSnapshot> {
    const [warehouses, categories, items] = await Promise.all([
      this.warehouseRepository.list(true),
      this.categoryRepository.list(),
      this.itemRepository.list(true),
    ]);
    const completedImport = this.state.openingStockImport
      ? structuredClone(this.state.openingStockImport)
      : undefined;
    const availability = completedImport
      ? "COMPLETED"
      : this.state.ledger.length > 0
        ? "BLOCKED_BY_ACTIVITY"
        : "AVAILABLE";
    return {
      availability,
      completedImport,
      warehouses: warehouses.map((warehouse) => ({ ...warehouse })),
      categories: categories.map((category) => ({ ...category })),
      items: items.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        specification: item.specification,
        unit: item.unit,
        categoryId: item.categoryId,
        isActive: item.isActive,
      })),
      existingBatchKeys: [...this.state.batches.values()].map(
        (batch) => `${batch.warehouseId}\u0000${batch.itemId}\u0000${batch.batchNo}`,
      ),
    };
  }

  async commit(input: OpeningStockImportCommitDraft): Promise<OpeningStockImportResult> {
    if (input.id !== "INITIAL_OPENING_STOCK" || this.state.openingStockImport) {
      throw conflict("期初库存已经完成导入");
    }
    if (this.state.ledger.length > 0) {
      throw conflict("系统已存在库存业务活动，不能再执行期初库存初始化");
    }
    const periodCode = input.baselineDate.slice(0, 7);
    const period = await this.periodStore.get(periodCode);
    if (period?.status === "CLOSED") {
      throw conflict("期初库存所属会计期间已关闭");
    }

    const snapshot = await this.getSnapshot();
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

    const existingItems = await this.itemRepository.list(true);
    const existingItemsByCode = new Map(
      existingItems.map((item) => [normalizedCode(item.code), item]),
    );
    const categoriesByPrefix = new Map(
      snapshot.categories.map((category) => [normalizedCode(category.prefix), category]),
    );
    const usedItemIds = new Set(existingItems.map((item) => item.id));
    const newItems: ItemDefinition[] = [];
    for (const item of input.items) {
      if (existingItemsByCode.has(normalizedCode(item.code))) continue;
      const category = categoriesByPrefix.get(normalizedCode(item.categoryPrefix));
      if (!category) throw conflict("期初库存物品分类无法解析");
      let id: string;
      do {
        id = `opening-item-${crypto.randomUUID()}`;
      } while (usedItemIds.has(id));
      usedItemIds.add(id);
      const created: ItemDefinition = {
        id,
        code: normalizedCode(item.code),
        name: item.name.trim(),
        specification: item.specification?.trim() || undefined,
        unit: item.unit.trim(),
        categoryId: category.id,
        isActive: true,
      };
      newItems.push(created);
      existingItemsByCode.set(created.code, created);
    }
    if (newItems.length !== input.createdItemCount) {
      throw conflict("期初库存新增物品数量与当前数据不一致");
    }

    const warehousesByCode = new Map(
      snapshot.warehouses.map((warehouse) => [normalizedCode(warehouse.code), warehouse]),
    );
    const existingBatchKeys = new Set(
      [...this.state.batches.values()].map(
        (batch) => `${batch.warehouseId}\u0000${batch.itemId}\u0000${batch.batchNo}`,
      ),
    );
    const requestBatchKeys = new Set<string>();
    const occurredAt = `${input.baselineDate}T00:00:00.000Z`;
    if (new Date(occurredAt).toISOString() !== occurredAt) {
      throw conflict("期初库存盘点基准日期无效");
    }
    let computedQuantity = new Decimal(0);
    let computedAmount = new Decimal(0);
    const resolvedRows = input.rows.map((row) => {
      const warehouse = warehousesByCode.get(normalizedCode(row.warehouseCode));
      const item = existingItemsByCode.get(normalizedCode(row.itemCode));
      if (!warehouse || !item) throw conflict("期初库存仓库或物品无法解析");
      const quantity = new Decimal(row.quantity);
      const unitCost = new Decimal(row.unitCost);
      if (!quantity.isFinite() || !unitCost.isFinite() || quantity.lte(0) || unitCost.lt(0)) {
        throw conflict("期初库存正库存行数量或单价无效");
      }
      const amount = quantity.mul(unitCost).toFixed(2);
      if (amount !== new Decimal(row.amount).toFixed(2)) {
        throw conflict("期初库存正库存行金额不一致");
      }
      if (unitCost.eq(0) && !row.remark?.trim()) {
        throw conflict("期初库存零成本正库存行缺少备注");
      }
      const batchKey = `${warehouse.id}\u0000${item.id}\u0000${row.batchNo}`;
      if (existingBatchKeys.has(batchKey) || requestBatchKeys.has(batchKey)) {
        throw conflict("期初库存已导入或批次已存在");
      }
      requestBatchKeys.add(batchKey);
      computedQuantity = computedQuantity.plus(quantity);
      computedAmount = computedAmount.plus(amount);
      return {
        warehouseId: warehouse.id,
        itemId: item.id,
        batchNo: row.batchNo,
        quantity: quantity.toString(),
        unitCost: unitCost.toString(),
        purchasedAt: occurredAt,
        remark: row.remark?.trim() || undefined,
      };
    });
    if (
      !computedQuantity.eq(input.totalQuantity) ||
      computedAmount.toFixed(2) !== new Decimal(input.totalAmount).toFixed(2)
    ) {
      throw conflict("期初库存导入汇总与正库存行不一致");
    }

    await this.entryStore.recordOpeningStock({
      operatorId: input.operatorId,
      referenceId: input.id,
      occurredAt,
      rows: resolvedRows,
    });
    for (const item of newItems) await this.itemRepository.save(item);

    const result: OpeningStockImportResult = {
      id: input.id,
      fileSha256: input.fileSha256,
      sourceFileName: input.sourceFileName,
      baselineDate: input.baselineDate,
      operatorId: input.operatorId,
      financeReviewer: input.financeReviewer,
      itemCount: input.itemCount,
      createdItemCount: input.createdItemCount,
      inventoryRowCount: input.inventoryRowCount,
      positiveRowCount: input.positiveRowCount,
      zeroRowCount: input.zeroRowCount,
      totalQuantity: input.totalQuantity,
      totalAmount: input.totalAmount,
      importedAt: new Date().toISOString(),
    };
    this.state.openingStockImport = structuredClone(result);
    return structuredClone(result);
  }
}
