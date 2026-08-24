import { createHash } from "node:crypto";

import { BusinessRuleError } from "../errors/business-rule-error.js";
import type { AccountingPeriodStore } from "../periods/period-close-service.js";
import { CANONICAL_ITEM_CATEGORIES } from "../../domain/items/item-category.js";
import type {
  OpeningStockImportIssue,
  OpeningStockImportCommitDraft,
  OpeningStockImportPreview,
  OpeningStockImportPreviewRow,
  OpeningStockImportResult,
  OpeningStockImportStatus,
  OpeningStockImportStore,
  OpeningStockMasterDataSnapshot,
  OpeningStockWorkbookParser,
  ParsedOpeningStockWorkbook,
} from "./opening-stock-import-contract.js";
import { OpeningStockPreviewTokenService } from "./opening-stock-preview-token-service.js";

const EXPECTED_WAREHOUSES = new Map([
  ["WH-01", "集团二楼仓库"],
  ["WH-02", "内区1号仓库"],
  ["WH-03", "1区车库后仓库"],
]);
const STALE_PREVIEW_MESSAGE = "期初库存文件或系统状态已变化，请重新预览";

export interface OpeningStockMasterDataValidation {
  issues: OpeningStockImportIssue[];
  newItemCount: number;
  existingItemCount: number;
}

interface OpeningStockEvaluation {
  fileSha256: string;
  parsed: ParsedOpeningStockWorkbook;
  snapshot: OpeningStockMasterDataSnapshot;
  issues: OpeningStockImportIssue[];
  rows: OpeningStockImportPreviewRow[];
  newItemCount: number;
  existingItemCount: number;
  canCommit: boolean;
}

function normalizedCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizedText(value: string | undefined): string {
  return value?.trim() ?? "";
}

function issue(
  code: string,
  message: string,
  details: Partial<Pick<OpeningStockImportIssue, "sheet" | "row" | "field">> = {},
): OpeningStockImportIssue {
  return { severity: "ERROR", code, message, ...details };
}

export function validateOpeningStockMasterData(
  parsed: ParsedOpeningStockWorkbook,
  snapshot: OpeningStockMasterDataSnapshot,
): OpeningStockMasterDataValidation {
  const issues: OpeningStockImportIssue[] = [];

  if (snapshot.availability === "BLOCKED_BY_ACTIVITY") {
    issues.push(
      issue(
        "OPENING_STOCK_BLOCKED_BY_ACTIVITY",
        "系统已存在库存业务活动，不能再执行期初库存初始化",
      ),
    );
  } else if (snapshot.availability === "COMPLETED") {
    issues.push(issue("OPENING_STOCK_ALREADY_IMPORTED", "期初库存已经完成导入，不能重复初始化"));
  }

  const warehousesByCode = new Map(
    snapshot.warehouses.map((warehouse) => [normalizedCode(warehouse.code), warehouse]),
  );
  for (const [code, expectedName] of EXPECTED_WAREHOUSES) {
    const warehouse = warehousesByCode.get(code);
    if (
      !warehouse ||
      normalizedText(warehouse.name) !== expectedName ||
      !warehouse.isActive ||
      warehouse.isPlaceholder
    ) {
      issues.push(
        issue(
          "WAREHOUSE_MASTER_DATA_MISMATCH",
          `仓库 ${code} 必须配置为启用的“${expectedName}”`,
          { field: "仓库" },
        ),
      );
    }
  }

  const categoriesByPrefix = new Map(
    snapshot.categories.map((category) => [normalizedCode(category.prefix), category]),
  );
  for (const canonical of CANONICAL_ITEM_CATEGORIES) {
    const category = categoriesByPrefix.get(canonical.prefix);
    if (
      !category ||
      category.id !== canonical.id ||
      normalizedCode(category.code) !== canonical.code ||
      normalizedText(category.name) !== canonical.name
    ) {
      issues.push(
        issue(
          "ITEM_CATEGORY_MASTER_DATA_MISMATCH",
          `物品分类 ${canonical.prefix} 必须配置为“${canonical.name}”`,
          { field: "类别" },
        ),
      );
    }
  }

  const existingItemsByCode = new Map(
    snapshot.items.map((item) => [normalizedCode(item.code), item]),
  );
  let newItemCount = 0;
  let existingItemCount = 0;
  for (const parsedItem of parsed.items) {
    const existing = existingItemsByCode.get(normalizedCode(parsedItem.code));
    if (!existing) {
      newItemCount += 1;
      continue;
    }
    existingItemCount += 1;
    if (!existing.isActive) {
      issues.push(
        issue("ITEM_INACTIVE", `已有物料 ${parsedItem.code} 已停用`, {
          sheet: "物品资料",
          row: parsedItem.sheetRow,
          field: "物料编号",
        }),
      );
    }

    const expectedCategoryId = CANONICAL_ITEM_CATEGORIES.find(
      (category) => category.prefix === parsedItem.categoryPrefix,
    )?.id;
    const conflicts: Array<{ field: string; matches: boolean }> = [
      { field: "物品名称", matches: normalizedText(existing.name) === normalizedText(parsedItem.name) },
      { field: "单位", matches: normalizedText(existing.unit) === normalizedText(parsedItem.unit) },
      {
        field: "规格",
        matches: normalizedText(existing.specification) === normalizedText(parsedItem.specification),
      },
      { field: "类别", matches: existing.categoryId === expectedCategoryId },
    ];
    for (const conflict of conflicts) {
      if (conflict.matches) continue;
      issues.push(
        issue(
          "ITEM_MASTER_DATA_CONFLICT",
          `已有物料 ${parsedItem.code} 的${conflict.field}与工作簿不一致，系统不会自动覆盖`,
          { sheet: "物品资料", row: parsedItem.sheetRow, field: conflict.field },
        ),
      );
    }
  }

  const existingBatchKeys = new Set(snapshot.existingBatchKeys);
  for (const row of parsed.rows) {
    if (row.disposition !== "IMPORT" || !row.batchNo) continue;
    const warehouse = warehousesByCode.get(normalizedCode(row.warehouseCode));
    const item = existingItemsByCode.get(normalizedCode(row.itemCode));
    if (!warehouse || !item) continue;
    const batchKey = `${warehouse.id}\u0000${item.id}\u0000${row.batchNo}`;
    if (existingBatchKeys.has(batchKey)) {
      issues.push(
        issue("BATCH_ALREADY_EXISTS", `期初批次 ${row.batchNo} 已存在`, {
          sheet: "期初库存",
          row: row.sheetRow,
          field: "批次号",
        }),
      );
    }
  }

  return { issues, newItemCount, existingItemCount };
}

export class OpeningStockImportService {
  constructor(
    private readonly parser: OpeningStockWorkbookParser,
    private readonly store: OpeningStockImportStore,
    private readonly tokenService: OpeningStockPreviewTokenService,
    private readonly periodStore: AccountingPeriodStore,
  ) {}

  async getStatus(): Promise<OpeningStockImportStatus> {
    const snapshot = await this.store.getSnapshot();
    return snapshot.completedImport
      ? { availability: snapshot.availability, completedImport: snapshot.completedImport }
      : { availability: snapshot.availability };
  }

  async preview(input: {
    actorId: string;
    fileName: string;
    buffer: Buffer;
  }): Promise<OpeningStockImportPreview> {
    const evaluation = await this.evaluate(input);
    const signed = evaluation.canCommit
      ? this.tokenService.issue({ actorId: input.actorId, fileSha256: evaluation.fileSha256 })
      : undefined;
    return {
      baselineDate: evaluation.parsed.baselineDate,
      canCommit: evaluation.canCommit,
      fileSha256: evaluation.fileSha256,
      previewToken: signed?.token,
      previewExpiresAt: signed?.expiresAt,
      summary: {
        ...evaluation.parsed.summary,
        newItemCount: evaluation.newItemCount,
        existingItemCount: evaluation.existingItemCount,
      },
      issues: evaluation.issues,
      rows: evaluation.rows,
    };
  }

  async commit(input: {
    actorId: string;
    fileName: string;
    buffer: Buffer;
    previewToken: string;
    financeReviewer: string;
    confirmed: boolean;
  }): Promise<OpeningStockImportResult> {
    const financeReviewer = input.financeReviewer.trim();
    if (financeReviewer === "") throw new BusinessRuleError("财务复核人不能为空", 400);
    if (financeReviewer.length > 100) {
      throw new BusinessRuleError("财务复核人不能超过 100 个字符", 400);
    }
    if (!input.confirmed) throw new BusinessRuleError("请确认已与财务共同复核", 400);

    const fileSha256 = createHash("sha256").update(input.buffer).digest("hex");
    try {
      this.tokenService.verify(input.previewToken, { actorId: input.actorId, fileSha256 });
    } catch {
      throw new BusinessRuleError(STALE_PREVIEW_MESSAGE, 409);
    }

    const evaluation = await this.evaluate(input);
    if (!evaluation.canCommit || !evaluation.parsed.baselineDate) {
      throw new BusinessRuleError(STALE_PREVIEW_MESSAGE, 409);
    }
    const rows = evaluation.parsed.rows
      .filter((row) => row.disposition === "IMPORT")
      .map((row) => {
        if (!row.batchNo || row.quantity === undefined || row.unitCost === undefined || !row.amount) {
          throw new BusinessRuleError(STALE_PREVIEW_MESSAGE, 409);
        }
        return {
          sheetRow: row.sheetRow,
          warehouseCode: row.warehouseCode,
          itemCode: row.itemCode,
          batchNo: row.batchNo,
          quantity: row.quantity,
          unitCost: row.unitCost,
          amount: row.amount,
          remark: row.remark,
        };
      });
    const draft: OpeningStockImportCommitDraft = {
      id: "INITIAL_OPENING_STOCK",
      fileSha256,
      sourceFileName: input.fileName,
      baselineDate: evaluation.parsed.baselineDate,
      operatorId: input.actorId,
      financeReviewer,
      itemCount: evaluation.parsed.summary.itemCount,
      createdItemCount: evaluation.newItemCount,
      inventoryRowCount: evaluation.parsed.summary.inventoryRowCount,
      positiveRowCount: evaluation.parsed.summary.positiveRowCount,
      zeroRowCount: evaluation.parsed.summary.zeroRowCount,
      totalQuantity: evaluation.parsed.summary.totalQuantity,
      totalAmount: evaluation.parsed.summary.totalAmount,
      items: evaluation.parsed.items,
      rows,
    };
    try {
      return await this.store.commit(draft);
    } catch (error) {
      if (error instanceof BusinessRuleError && error.statusCode === 409) {
        throw new BusinessRuleError(STALE_PREVIEW_MESSAGE, 409);
      }
      throw error;
    }
  }

  private async evaluate(input: {
    actorId: string;
    fileName: string;
    buffer: Buffer;
  }): Promise<OpeningStockEvaluation> {
    const fileSha256 = createHash("sha256").update(input.buffer).digest("hex");
    const [parsed, snapshot] = await Promise.all([
      this.parser.parse({ fileName: input.fileName, buffer: input.buffer }),
      this.store.getSnapshot(),
    ]);
    const validation = validateOpeningStockMasterData(parsed, snapshot);
    const issues = [...parsed.issues, ...validation.issues];

    if (parsed.baselineDate) {
      const periodCode = parsed.baselineDate.slice(0, 7);
      const period = await this.periodStore.get(periodCode);
      if (period?.status === "CLOSED") {
        issues.push(
          issue("ACCOUNTING_PERIOD_CLOSED", `期初库存所属会计期间 ${periodCode} 已关闭`, {
            sheet: "填写说明",
            row: 6,
            field: "盘点基准日期",
          }),
        );
      }
    }

    const itemNamesByCode = new Map(
      parsed.items.map((item) => [normalizedCode(item.code), item.name]),
    );
    const rows = parsed.rows.map((row): OpeningStockImportPreviewRow => {
      const hasRowError = issues.some(
        (current) =>
          current.severity === "ERROR" && current.sheet === "期初库存" && current.row === row.sheetRow,
      );
      return {
        sheetRow: row.sheetRow,
        warehouseCode: row.warehouseCode,
        itemCode: row.itemCode,
        itemName: itemNamesByCode.get(normalizedCode(row.itemCode)) ?? "",
        batchNo: row.batchNo ?? "",
        quantity: row.quantity ?? "",
        unitCost: row.unitCost ?? "",
        amount: row.amount ?? "",
        remark: row.remark,
        disposition: hasRowError ? "INVALID" : (row.disposition ?? "INVALID"),
      };
    });
    const canCommit =
      snapshot.availability === "AVAILABLE" && !issues.some((current) => current.severity === "ERROR");
    return {
      fileSha256,
      parsed,
      snapshot,
      issues,
      rows,
      newItemCount: validation.newItemCount,
      existingItemCount: validation.existingItemCount,
      canCommit,
    };
  }
}
