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
  let currentTime: Date;
  let tokenService: OpeningStockPreviewTokenService;
  let fakeStore: FakeOpeningStockImportStore;
  let service: OpeningStockImportService;
  let validBuffer: Buffer;
  let periodStore: InMemoryAccountingPeriodStore;

  beforeEach(async () => {
    vi.restoreAllMocks();
    currentTime = new Date("2026-08-24T08:00:00.000Z");
    tokenService = new OpeningStockPreviewTokenService("test-session-secret", {
      now: () => new Date(currentTime),
    });
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

  it("requires finance reviewer and explicit joint confirmation", async () => {
    const preview = await validPreview();

    await expect(
      service.commit({
        actorId: "admin-1",
        fileName: "期初库存.xlsx",
        buffer: validBuffer,
        previewToken: preview.previewToken!,
        financeReviewer: "",
        confirmed: true,
      }),
    ).rejects.toMatchObject({ message: "财务复核人不能为空", statusCode: 400 });
    await expect(
      service.commit({
        actorId: "admin-1",
        fileName: "期初库存.xlsx",
        buffer: validBuffer,
        previewToken: preview.previewToken!,
        financeReviewer: "财务甲",
        confirmed: false,
      }),
    ).rejects.toMatchObject({ message: "请确认已与财务共同复核", statusCode: 400 });
    await expect(
      service.commit({
        actorId: "admin-1",
        fileName: "期初库存.xlsx",
        buffer: validBuffer,
        previewToken: preview.previewToken!,
        financeReviewer: "财".repeat(101),
        confirmed: true,
      }),
    ).rejects.toMatchObject({ message: "财务复核人不能超过 100 个字符", statusCode: 400 });
    expect(fakeStore.commits).toEqual([]);
  });

  it("reparses the same file and commits positive rows only", async () => {
    const preview = await validPreview();

    const result = await service.commit({
      actorId: "admin-1",
      fileName: "期初库存.xlsx",
      buffer: validBuffer,
      previewToken: preview.previewToken!,
      financeReviewer: "财务甲",
      confirmed: true,
    });

    expect(fakeStore.commits[0]).toMatchObject({
      operatorId: "admin-1",
      financeReviewer: "财务甲",
      positiveRowCount: 1,
      zeroRowCount: 242,
    });
    expect(fakeStore.commits[0]!.rows).toHaveLength(1);
    expect(result.inventoryRowCount).toBe(243);
  });

  it("rejects changed file bytes", async () => {
    const preview = await validPreview();
    const changedBuffer = Buffer.concat([validBuffer, Buffer.from([0])]);

    await expect(
      service.commit({
        actorId: "admin-1",
        fileName: "期初库存.xlsx",
        buffer: changedBuffer,
        previewToken: preview.previewToken!,
        financeReviewer: "财务甲",
        confirmed: true,
      }),
    ).rejects.toMatchObject({
      message: "期初库存文件或系统状态已变化，请重新预览",
      statusCode: 409,
    });
    expect(fakeStore.commits).toEqual([]);
  });

  it("rejects a token owned by another actor", async () => {
    const preview = await validPreview();

    await expect(
      service.commit({
        actorId: "admin-2",
        fileName: "期初库存.xlsx",
        buffer: validBuffer,
        previewToken: preview.previewToken!,
        financeReviewer: "财务甲",
        confirmed: true,
      }),
    ).rejects.toMatchObject({
      message: "期初库存文件或系统状态已变化，请重新预览",
      statusCode: 409,
    });
    expect(fakeStore.commits).toEqual([]);
  });

  it("rejects an expired preview", async () => {
    const preview = await validPreview();
    currentTime = new Date("2026-08-24T08:30:00.001Z");

    await expect(
      service.commit({
        actorId: "admin-1",
        fileName: "期初库存.xlsx",
        buffer: validBuffer,
        previewToken: preview.previewToken!,
        financeReviewer: "财务甲",
        confirmed: true,
      }),
    ).rejects.toMatchObject({
      message: "期初库存文件或系统状态已变化，请重新预览",
      statusCode: 409,
    });
    expect(fakeStore.commits).toEqual([]);
  });

  it("rejects a batch conflict introduced after preview", async () => {
    const preview = await validPreview();
    fakeStore.snapshot.items.push({
      id: "item-1",
      code: "BJ0001",
      name: "测试物品 BJ0001",
      unit: "个",
      categoryId: "category-bj",
      isActive: true,
    });
    fakeStore.snapshot.existingBatchKeys.push(
      "warehouse-1\u0000item-1\u0000OPEN-20260824-WH01-BJ0001",
    );

    await expect(
      service.commit({
        actorId: "admin-1",
        fileName: "期初库存.xlsx",
        buffer: validBuffer,
        previewToken: preview.previewToken!,
        financeReviewer: "财务甲",
        confirmed: true,
      }),
    ).rejects.toMatchObject({
      message: "期初库存文件或系统状态已变化，请重新预览",
      statusCode: 409,
    });
    expect(fakeStore.commits).toEqual([]);
  });

  it("rejects a parser error introduced after preview", async () => {
    const preview = await validPreview();
    const parse = parser.parse.bind(parser);
    vi.spyOn(parser, "parse").mockImplementationOnce(async (input) => {
      const parsed = await parse(input);
      return {
        ...parsed,
        issues: [
          ...parsed.issues,
          {
            severity: "ERROR" as const,
            code: "QUANTITY_REQUIRED",
            sheet: "期初库存",
            row: 3,
            field: "实盘数量",
            message: "实盘数量未填写",
          },
        ],
      };
    });

    await expect(
      service.commit({
        actorId: "admin-1",
        fileName: "期初库存.xlsx",
        buffer: validBuffer,
        previewToken: preview.previewToken!,
        financeReviewer: "财务甲",
        confirmed: true,
      }),
    ).rejects.toMatchObject({
      message: "期初库存文件或系统状态已变化，请重新预览",
      statusCode: 409,
    });
    expect(fakeStore.commits).toEqual([]);
  });
});
