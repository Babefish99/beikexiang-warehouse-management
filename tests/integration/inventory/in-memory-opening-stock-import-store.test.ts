import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryItemRepository } from "../../../apps/api/src/application/items/item-service.js";
import { InMemoryInventoryEntryStore } from "../../../apps/api/src/application/inventory/inbound-service.js";
import {
  createInventoryMemoryState,
  type InventoryMemoryState,
} from "../../../apps/api/src/application/inventory/inventory-memory-state.js";
import { InMemoryAccountingPeriodStore } from "../../../apps/api/src/application/periods/period-close-service.js";
import { InMemoryWarehouseRepository } from "../../../apps/api/src/application/warehouses/warehouse-service.js";
import { CANONICAL_ITEM_CATEGORIES } from "../../../apps/api/src/domain/items/item-category.js";
import {
  InMemoryOpeningStockImportStore,
  type OpeningStockCategoryRepository,
} from "../../../apps/api/src/infrastructure/db/in-memory-opening-stock-import-store.js";
import { ExcelOpeningStockWorkbookParser } from "../../../apps/api/src/infrastructure/import/excel-opening-stock-workbook-parser.js";
import { openingStockCommitDraftFixture } from "../../helpers/opening-stock-import.js";

const parser = new ExcelOpeningStockWorkbookParser();

describe("InMemoryOpeningStockImportStore", () => {
  let state: InventoryMemoryState;
  let entryStore: InMemoryInventoryEntryStore;
  let itemRepository: InMemoryItemRepository;
  let periodStore: InMemoryAccountingPeriodStore;
  let store: InMemoryOpeningStockImportStore;

  beforeEach(() => {
    state = createInventoryMemoryState();
    entryStore = new InMemoryInventoryEntryStore(state);
    itemRepository = new InMemoryItemRepository();
    periodStore = new InMemoryAccountingPeriodStore();
    const warehouseRepository = new InMemoryWarehouseRepository([
      { id: "warehouse-1", code: "WH-01", name: "集团二楼仓库", isActive: true },
      { id: "warehouse-2", code: "WH-02", name: "内区1号仓库", isActive: true },
      { id: "warehouse-3", code: "WH-03", name: "1区车库后仓库", isActive: true },
    ]);
    const categoryRepository: OpeningStockCategoryRepository = {
      async list() {
        return CANONICAL_ITEM_CATEGORIES.map((category) => ({ ...category }));
      },
    };
    store = new InMemoryOpeningStockImportStore(
      itemRepository,
      warehouseRepository,
      categoryRepository,
      state,
      entryStore,
      periodStore,
    );
  });

  async function stateSnapshot() {
    return {
      items: await itemRepository.list(true),
      batches: entryStore.batches(),
      balances: entryStore.balances(),
      ledger: entryStore.ledger(),
      openingStockImport: state.openingStockImport,
    };
  }

  it("creates missing items and one positive opening balance while retaining zero statistics", async () => {
    const draft = await openingStockCommitDraftFixture(parser);

    const result = await store.commit(draft);

    expect(result).toMatchObject({
      createdItemCount: 81,
      inventoryRowCount: 243,
      positiveRowCount: 1,
      zeroRowCount: 242,
    });
    expect(await itemRepository.list(true)).toHaveLength(81);
    expect(entryStore.batches()).toHaveLength(1);
    expect(entryStore.ledger()).toEqual([
      expect.objectContaining({
        type: "OPENING_BALANCE",
        occurredAt: "2026-08-24T00:00:00.000Z",
      }),
    ]);
    await expect(store.getSnapshot()).resolves.toMatchObject({
      availability: "COMPLETED",
      completedImport: result,
    });
  });

  it("rejects a second import without changing state", async () => {
    const draft = await openingStockCommitDraftFixture(parser);
    await store.commit(draft);
    const before = await stateSnapshot();

    await expect(store.commit({ ...draft, fileSha256: "b".repeat(64) })).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(await stateSnapshot()).toEqual(before);
  });

  it("rejects a closed baseline period before any write", async () => {
    periodStore.save({ code: "2026-08", status: "CLOSED" });
    const draft = await openingStockCommitDraftFixture(parser);

    await expect(store.commit(draft)).rejects.toMatchObject({
      message: "期初库存所属会计期间已关闭",
      statusCode: 409,
    });
    expect(entryStore.ledger()).toEqual([]);
    expect(await itemRepository.list(true)).toEqual([]);
    expect(state.openingStockImport).toBeUndefined();
  });

  it("rejects any pre-existing ledger without changing state", async () => {
    state.ledger.push({
      id: "ledger-unrelated",
      warehouseId: "warehouse-1",
      itemId: "unrelated-item",
      batchId: "unrelated-batch",
      type: "INBOUND",
      quantity: "1",
      unitCost: "1",
      amount: "1.00",
      referenceType: "INBOUND_ORDER",
      referenceId: "unrelated-order",
      occurredAt: "2026-08-23T00:00:00.000Z",
    });
    const draft = await openingStockCommitDraftFixture(parser);
    const before = await stateSnapshot();

    await expect(store.commit(draft)).rejects.toMatchObject({ statusCode: 409 });

    expect(await stateSnapshot()).toEqual(before);
  });

  it("rejects an existing composite batch key without changing state", async () => {
    const draft = await openingStockCommitDraftFixture(parser);
    const firstItem = draft.items.find((item) => item.code === "BJ0001")!;
    await itemRepository.save({
      id: "item-existing-bj0001",
      code: firstItem.code,
      name: firstItem.name,
      specification: firstItem.specification,
      unit: firstItem.unit,
      categoryId: "category-bj",
      isActive: true,
    });
    await entryStore.recordOpeningStock({
      operatorId: "seed-admin",
      referenceId: "seed-opening",
      occurredAt: "2026-08-23T00:00:00.000Z",
      rows: [
        {
          warehouseId: "warehouse-1",
          itemId: "item-existing-bj0001",
          batchNo: draft.rows[0]!.batchNo,
          quantity: "1",
          unitCost: "1",
          purchasedAt: "2026-08-23T00:00:00.000Z",
        },
      ],
    });
    const before = await stateSnapshot();

    await expect(store.commit({ ...draft, createdItemCount: 80 })).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(await stateSnapshot()).toEqual(before);
  });
});
