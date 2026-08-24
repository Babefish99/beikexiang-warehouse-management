import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OpeningStockImportCommitDraft,
  OpeningStockImportResult,
  OpeningStockImportStore,
  OpeningStockMasterDataSnapshot,
} from "../../../apps/api/src/application/inventory/opening-stock-import-contract.js";
import { OpeningStockImportService } from "../../../apps/api/src/application/inventory/opening-stock-import-service.js";
import { OpeningStockPreviewTokenService } from "../../../apps/api/src/application/inventory/opening-stock-preview-token-service.js";
import { InMemoryAccountingPeriodStore } from "../../../apps/api/src/application/periods/period-close-service.js";
import { CANONICAL_ITEM_CATEGORIES } from "../../../apps/api/src/domain/items/item-category.js";
import { ExcelOpeningStockWorkbookParser } from "../../../apps/api/src/infrastructure/import/excel-opening-stock-workbook-parser.js";
import { buildOpeningStockWorkbook } from "../../helpers/opening-stock-workbook.js";

const completedImportFixture: OpeningStockImportResult = {
  id: "INITIAL_OPENING_STOCK",
  fileSha256: "a".repeat(64),
  sourceFileName: "期初库存.xlsx",
  baselineDate: "2026-08-24",
  operatorId: "admin-1",
  financeReviewer: "财务甲",
  itemCount: 81,
  createdItemCount: 81,
  inventoryRowCount: 243,
  positiveRowCount: 1,
  zeroRowCount: 242,
  totalQuantity: "2",
  totalAmount: "20.00",
  importedAt: "2026-08-24T08:05:00.000Z",
};

class FakeOpeningStockImportStore implements OpeningStockImportStore {
  snapshot: OpeningStockMasterDataSnapshot = {
    availability: "AVAILABLE",
    warehouses: [
      { id: "warehouse-1", code: "WH-01", name: "集团二楼仓库", isActive: true },
      { id: "warehouse-2", code: "WH-02", name: "内区1号仓库", isActive: true },
      { id: "warehouse-3", code: "WH-03", name: "1区车库后仓库", isActive: true },
    ],
    categories: CANONICAL_ITEM_CATEGORIES.map((category) => ({ ...category })),
    items: [],
    existingBatchKeys: [],
  };
  readonly commits: OpeningStockImportCommitDraft[] = [];

  async getSnapshot(): Promise<OpeningStockMasterDataSnapshot> {
    return structuredClone(this.snapshot);
  }

  async commit(input: OpeningStockImportCommitDraft): Promise<OpeningStockImportResult> {
    this.commits.push(structuredClone(input));
    return { ...input, importedAt: "2026-08-24T08:05:00.000Z" };
  }
}

describe("OpeningStockImportService preview", () => {
  const parser = new ExcelOpeningStockWorkbookParser();
  const tokenService = new OpeningStockPreviewTokenService("test-session-secret", {
    now: () => new Date("2026-08-24T08:00:00.000Z"),
  });
  let fakeStore: FakeOpeningStockImportStore;
  let service: OpeningStockImportService;
  let validBuffer: Buffer;
  let periodStore: InMemoryAccountingPeriodStore;

  beforeEach(async () => {
    fakeStore = new FakeOpeningStockImportStore();
    periodStore = new InMemoryAccountingPeriodStore();
    service = new OpeningStockImportService(parser, fakeStore, tokenService, periodStore);
    validBuffer = await buildOpeningStockWorkbook();
  });

  const validPreview = () =>
    service.preview({
      actorId: "admin-1",
      fileName: "期初库存.xlsx",
      buffer: validBuffer,
    });

  it("returns a signed preview with new/existing item counts", async () => {
    const getOrCreate = vi.spyOn(periodStore, "getOrCreate");

    const preview = await validPreview();

    expect(preview).toMatchObject({
      canCommit: true,
      fileSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      previewToken: expect.any(String),
      previewExpiresAt: "2026-08-24T08:30:00.000Z",
      summary: {
        itemCount: 81,
        inventoryRowCount: 243,
        newItemCount: 81,
        existingItemCount: 0,
        positiveRowCount: 1,
        zeroRowCount: 242,
      },
    });
    expect(preview.rows).toHaveLength(243);
    expect(preview.rows[0]).toMatchObject({ itemName: "测试物品 BJ0001", disposition: "IMPORT" });
    expect(preview.rows[1]).toMatchObject({ itemName: "测试物品 BJ0001", disposition: "SKIP_ZERO" });
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it("reports the persisted one-time import status", async () => {
    expect(await service.getStatus()).toEqual({ availability: "AVAILABLE" });
    fakeStore.snapshot.availability = "COMPLETED";
    fakeStore.snapshot.completedImport = completedImportFixture;

    expect(await service.getStatus()).toEqual({
      availability: "COMPLETED",
      completedImport: completedImportFixture,
    });
  });

  it("blocks placeholder or mismatched warehouses", async () => {
    fakeStore.snapshot.warehouses[0] = {
      id: "warehouse-1",
      code: "WH-01",
      name: "待配置仓库一",
      isActive: true,
      isPlaceholder: true,
    };

    const preview = await validPreview();

    expect(preview.canCommit).toBe(false);
    expect(preview.previewToken).toBeUndefined();
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ code: "WAREHOUSE_MASTER_DATA_MISMATCH" }),
    );
  });

  it("does not overwrite an existing item conflict", async () => {
    fakeStore.snapshot.items.push({
      id: "item-1",
      code: "BJ0001",
      name: "冲突名称",
      unit: "瓶",
      categoryId: "category-bj",
      isActive: true,
    });

    const preview = await validPreview();

    expect(preview.issues).toContainEqual(
      expect.objectContaining({ code: "ITEM_MASTER_DATA_CONFLICT", field: "物品名称" }),
    );
  });

  it("counts an exactly matching active item as existing without scheduling an update", async () => {
    fakeStore.snapshot.items.push({
      id: "item-1",
      code: "BJ0001",
      name: "测试物品 BJ0001",
      unit: "个",
      categoryId: "category-bj",
      isActive: true,
    });

    const preview = await validPreview();

    expect(preview).toMatchObject({
      canCommit: true,
      summary: { itemCount: 81, newItemCount: 80, existingItemCount: 1 },
    });
    expect(preview.previewToken).toEqual(expect.any(String));
  });

  it("blocks a closed baseline period without creating a period during preview", async () => {
    await periodStore.save({ code: "2026-08", status: "CLOSED" });
    const getOrCreate = vi.spyOn(periodStore, "getOrCreate");

    const preview = await validPreview();

    expect(preview.canCommit).toBe(false);
    expect(preview.previewToken).toBeUndefined();
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ code: "ACCOUNTING_PERIOD_CLOSED", severity: "ERROR" }),
    );
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing category",
      (snapshot: OpeningStockMasterDataSnapshot) => {
        snapshot.categories = snapshot.categories.filter((category) => category.prefix !== "HJ");
      },
      "ITEM_CATEGORY_MASTER_DATA_MISMATCH",
    ],
    [
      "renamed category",
      (snapshot: OpeningStockMasterDataSnapshot) => {
        snapshot.categories[0]!.name = "办公用品";
      },
      "ITEM_CATEGORY_MASTER_DATA_MISMATCH",
    ],
    [
      "inactive item",
      (snapshot: OpeningStockMasterDataSnapshot) => {
        snapshot.items.push({
          id: "item-1",
          code: "BJ0001",
          name: "测试物品 BJ0001",
          unit: "个",
          categoryId: "category-bj",
          isActive: false,
        });
      },
      "ITEM_INACTIVE",
    ],
    [
      "existing batch",
      (snapshot: OpeningStockMasterDataSnapshot) => {
        snapshot.items.push({
          id: "item-1",
          code: "BJ0001",
          name: "测试物品 BJ0001",
          unit: "个",
          categoryId: "category-bj",
          isActive: true,
        });
        snapshot.existingBatchKeys.push(
          "warehouse-1\u0000item-1\u0000OPEN-20260824-WH01-BJ0001",
        );
      },
      "BATCH_ALREADY_EXISTS",
    ],
    [
      "inventory activity",
      (snapshot: OpeningStockMasterDataSnapshot) => {
        snapshot.availability = "BLOCKED_BY_ACTIVITY";
      },
      "OPENING_STOCK_BLOCKED_BY_ACTIVITY",
    ],
    [
      "completed import",
      (snapshot: OpeningStockMasterDataSnapshot) => {
        snapshot.availability = "COMPLETED";
        snapshot.completedImport = completedImportFixture;
      },
      "OPENING_STOCK_ALREADY_IMPORTED",
    ],
  ])("blocks %s", async (_label, mutate, code) => {
    mutate(fakeStore.snapshot);

    const preview = await validPreview();

    expect(preview.canCommit).toBe(false);
    expect(preview.previewToken).toBeUndefined();
    expect(preview.issues).toContainEqual(expect.objectContaining({ code, severity: "ERROR" }));
  });
});
