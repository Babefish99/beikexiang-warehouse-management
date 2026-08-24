# 期初库存 Excel 预览与一次性事务导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在电脑端交付固定格式期初库存 Excel 的服务端预览校验、短时确认凭证、缺失物品建档与一次性 Serializable 事务导入。

**Architecture:** 浏览器只上传文件和展示服务端结果；ExcelJS 在 API 内解析固定模板，应用服务组合文件校验和主数据快照，提交时使用绑定管理员与文件摘要的 HMAC 凭证并重新解析。内存与 Prisma 存储实现同一 `OpeningStockImportStore` 接口，Prisma 在单个 Serializable 事务中创建导入摘要、缺失物品、三仓期初订单、批次、余额、明细和流水。

**Tech Stack:** Node.js 24+、TypeScript 5.9、Fastify 5.5、`@fastify/multipart` 10.1.1、ExcelJS 4.4.0、Prisma 7.9、PostgreSQL、React 19、Vitest 3.2、Playwright 1.55。

**Spec:** `docs/superpowers/specs/2026-08-24-opening-stock-excel-import-design.md`

## Global Constraints

- 只接受一个不超过 5 MB 的 `.xlsx`；不接受 `.xls`、`.xlsm`、CSV 或压缩包。
- 工作簿必须恰好包含固定顺序的五张表、81 条物品和 243 条三仓盘点行。
- `填写说明!B6` 是权威盘点基准日期；批次、金额和校验状态由服务端重算，不信任公式缓存。
- `0` 数量行必须完成校验和统计，但不得创建批次、余额、明细或流水；空白数量阻止整批导入。
- 缺失物品与非零期初库存必须在同一事务创建；已有编码只校验，不静默更新。
- 分类固定为 `BJ=白酒`、`HJ=红酒`、`CY=茶饮`、`WP=其他物品`。
- 正式导入只允许成功一次；已有任意库存流水时也不得再初始化。
- 操作人只取已认证管理员；财务复核人是必填人工记录，提交前必须明确勾选共同复核。
- 不保存或审计 Excel Buffer、完整业务行、预览凭证或其他敏感内容。
- 不读取、输出或修改 `.env.production`、`WE_COM_SECRET`、`SESSION_SECRET` 或其他密钥。
- 本计划只修改本地代码、迁移、测试和文档；不得部署、修改生产配置或导入生产数据。
- 所有行为变更遵循红—绿—重构；每个任务提交前运行其最窄有效测试。

---

## File Structure

### Canonical master data and persistence

- Create `apps/api/src/domain/items/item-category.ts`: one canonical category definition shared by seed, runtime, validation and tests.
- Modify `prisma/schema.prisma`: add the immutable one-time `OpeningStockImport` summary model and nullable `InboundLine.remark` for positive-row reasons.
- Create `prisma/migrations/20260824170000_opening_stock_import/migration.sql`: create the summary table without touching inventory history.
- Modify `prisma/seed.ts`: seed four canonical item categories and retain structural-only behavior.

### Import application boundary

- Create `apps/api/src/application/inventory/opening-stock-import-contract.ts`: all parser, preview, commit, status, issue, snapshot and store interfaces.
- Create `apps/api/src/application/inventory/opening-stock-preview-token-service.ts`: HMAC token creation and verification.
- Create `apps/api/src/application/inventory/opening-stock-import-service.ts`: stateless preview/commit orchestration and database-independent master-data validation.

### Import infrastructure

- Create `apps/api/src/infrastructure/import/excel-opening-stock-workbook-parser.ts`: bounded ExcelJS parsing and workbook-only validation.
- Create `apps/api/src/infrastructure/db/in-memory-opening-stock-import-store.ts`: local/test store sharing the existing item repository and inventory memory state.
- Create `apps/api/src/infrastructure/db/prisma-opening-stock-import-store.ts`: Prisma snapshot queries and atomic commit.
- Modify `apps/api/src/application/inventory/inventory-memory-state.ts`: retain the one-time in-memory import summary.
- Modify `apps/api/src/infrastructure/db/runtime.ts`: expose and construct `openingStockImportStore` for both drivers.

### HTTP and UI

- Create `apps/api/src/routes/admin/opening-stock-import.ts`: status, preview, commit and retired single-row handlers.
- Modify `apps/api/src/server.ts`: register multipart, instantiate the parser/token/service and register routes.
- Create `apps/web/src/features/opening-stock/opening-stock-import.ts`: response types, commit gating and display helpers.
- Replace `apps/web/src/pages/OpeningStockPage.tsx`: status-driven upload, preview, confirmation and immutable completion UI.
- Modify `apps/web/src/styles.css`: scoped desktop import layout and issue/summary styles.

### Tests and docs

- Create `tests/helpers/opening-stock-workbook.ts`: synthetic 81-item/243-row workbook generator with no production data.
- Create `tests/helpers/opening-stock-import.ts`: normalized commit/result fixtures derived from the synthetic workbook.
- Create `tests/helpers/multipart.ts`: deterministic Fastify inject multipart Buffer builder.
- Create focused parser, token, service, store, route, UI and Playwright test files named in the tasks below.
- Modify existing schema, seed, restart-persistence, audit and mobile tests only where their prior single-row assumptions change.
- Modify `README.md`, `PROJECT_STATUS.md`, `docs/项目状态与发布交接.md` and `docs/superpowers/specs/2026-08-24-initial-inventory-excel-template-design.md` after verification.

---

### Task 1: Canonical categories and one-time import schema

**Files:**
- Create: `apps/api/src/domain/items/item-category.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260824170000_opening_stock_import/migration.sql`
- Modify: `prisma/seed.ts`
- Modify: `tests/unit/infrastructure/seed.test.ts`
- Modify: `tests/integration/db-schema.test.ts`

**Interfaces:**
- Produces: `CANONICAL_ITEM_CATEGORIES`, `CanonicalItemCategory`, and Prisma delegate `prisma.openingStockImport`.
- Consumes: no feature-specific interface.

- [ ] **Step 1: Write failing category and schema contract tests**

Add these assertions to the existing tests:

```ts
const openingImportMigrationPath = resolve(process.cwd(), "prisma/migrations/20260824170000_opening_stock_import/migration.sql");
const openingImportMigration = existsSync(openingImportMigrationPath) ? readFileSync(openingImportMigrationPath, "utf8") : "";

expect(getStructuralSeedData().categories).toEqual([
  { id: "category-bj", code: "CATEGORY_BJ", prefix: "BJ", name: "白酒" },
  { id: "category-hj", code: "CATEGORY_HJ", prefix: "HJ", name: "红酒" },
  { id: "category-cy", code: "CATEGORY_CY", prefix: "CY", name: "茶饮" },
  { id: "category-wp", code: "CATEGORY_WP", prefix: "WP", name: "其他物品" },
]);

expect(schema).toContain("model OpeningStockImport {");
const importModel = modelBody("OpeningStockImport");
expect(importModel).toMatch(/^\s*id\s+String\s+@id\s*$/m);
expect(importModel).toMatch(/totalQuantity\s+Decimal\s+@db\.Decimal\(18,\s*4\)/);
expect(importModel).toMatch(/totalAmount\s+Decimal\s+@db\.Decimal\(18,\s*2\)/);
expect(modelBody("InboundLine")).toMatch(/^\s*remark\s+String\?\s*$/m);
expect(openingImportMigration).toContain('CREATE TABLE "OpeningStockImport"');
expect(openingImportMigration).toContain('CONSTRAINT "OpeningStockImport_pkey" PRIMARY KEY ("id")');
expect(openingImportMigration).toContain('ALTER TABLE "InboundLine" ADD COLUMN "remark" TEXT');
```

Update the mocked `itemCategory.upsert` call count and expected codes to include `CATEGORY_HJ`.

- [ ] **Step 2: Run the focused tests and confirm the expected failures**

Run:

```powershell
corepack pnpm test -- tests/unit/infrastructure/seed.test.ts tests/integration/db-schema.test.ts
```

Expected: FAIL because `HJ` and `OpeningStockImport` do not exist and `BJ` still has the old name.

- [ ] **Step 3: Add the canonical category module**

Create:

```ts
export const CANONICAL_ITEM_CATEGORIES = [
  { id: "category-bj", code: "CATEGORY_BJ", prefix: "BJ", name: "白酒" },
  { id: "category-hj", code: "CATEGORY_HJ", prefix: "HJ", name: "红酒" },
  { id: "category-cy", code: "CATEGORY_CY", prefix: "CY", name: "茶饮" },
  { id: "category-wp", code: "CATEGORY_WP", prefix: "WP", name: "其他物品" },
] as const;

export type CanonicalItemCategory = (typeof CANONICAL_ITEM_CATEGORIES)[number];
```

Import this constant from `prisma/seed.ts` and return cloned category objects so the seed remains deterministic and structural-only.

- [ ] **Step 4: Add the Prisma model and checked-in migration**

Add this exact model:

```prisma
model OpeningStockImport {
  id                String   @id
  fileSha256        String
  sourceFileName    String
  baselineDate      DateTime
  operatorId        String
  financeReviewer   String
  itemCount         Int
  createdItemCount  Int
  inventoryRowCount Int
  positiveRowCount  Int
  zeroRowCount      Int
  totalQuantity     Decimal  @db.Decimal(18, 4)
  totalAmount       Decimal  @db.Decimal(18, 2)
  importedAt        DateTime @default(now())
}
```

Also add `remark String?` to the existing `InboundLine` model. The migration must create all summary columns with PostgreSQL `TEXT`, `INTEGER`, `DECIMAL(18,4)`, `DECIMAL(18,2)` and `TIMESTAMP(3)` types, make every summary field non-null, default `importedAt` to `CURRENT_TIMESTAMP`, create only the primary key on `OpeningStockImport.id`, and add nullable `TEXT` column `InboundLine.remark` without rewriting prior rows.

- [ ] **Step 5: Generate Prisma types and rerun tests**

Run:

```powershell
corepack pnpm exec prisma generate
corepack pnpm test -- tests/unit/infrastructure/seed.test.ts tests/integration/db-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the schema foundation**

```powershell
git add -- apps/api/src/domain/items/item-category.ts prisma/schema.prisma prisma/migrations/20260824170000_opening_stock_import/migration.sql prisma/seed.ts tests/unit/infrastructure/seed.test.ts tests/integration/db-schema.test.ts
git commit -m "feat: add opening stock import schema"
```

---

### Task 2: Workbook structure, date and item parser

**Files:**
- Modify: `package.json`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/api/src/application/inventory/opening-stock-import-contract.ts`
- Create: `apps/api/src/infrastructure/import/excel-opening-stock-workbook-parser.ts`
- Create: `tests/helpers/opening-stock-workbook.ts`
- Create: `tests/unit/inventory/opening-stock-workbook-parser.test.ts`

**Interfaces:**
- Produces: `OpeningStockWorkbookParser.parse(input)`, `ParsedOpeningStockWorkbook`, `OpeningStockImportIssue`, `ParsedOpeningStockItem`, and `ParsedOpeningStockRow`.
- Consumes: `CANONICAL_ITEM_CATEGORIES` from Task 1.

- [ ] **Step 1: Install ExcelJS in the API and root test package**

Run:

```powershell
corepack pnpm --filter @warehouse/api add exceljs@4.4.0
corepack pnpm add -D -w exceljs@4.4.0
```

Verify only `package.json`, `apps/api/package.json` and `pnpm-lock.yaml` change.

- [ ] **Step 2: Define the parser contract before implementation**

Create these public types:

```ts
export type OpeningStockIssueSeverity = "ERROR" | "WARNING";

export interface OpeningStockImportIssue {
  severity: OpeningStockIssueSeverity;
  code: string;
  sheet?: string;
  row?: number;
  field?: string;
  message: string;
}

export interface ParsedOpeningStockItem {
  sheetRow: number;
  code: string;
  name: string;
  categoryLabel: string;
  categoryPrefix: "BJ" | "HJ" | "CY" | "WP" | "";
  unit: string;
  specification?: string;
  referenceUnitCost?: string;
}

export interface ParsedOpeningStockRow {
  sheetRow: number;
  warehouseCode: string;
  itemCode: string;
  quantity?: string;
  unitCost?: string;
  remark?: string;
  batchNo?: string;
  amount?: string;
  disposition?: "IMPORT" | "SKIP_ZERO";
}

export interface ParsedOpeningStockWorkbook {
  baselineDate?: string;
  items: ParsedOpeningStockItem[];
  rows: ParsedOpeningStockRow[];
  issues: OpeningStockImportIssue[];
}

export interface OpeningStockWorkbookParser {
  parse(input: { fileName: string; buffer: Buffer }): Promise<ParsedOpeningStockWorkbook>;
}
```

- [ ] **Step 3: Build a deterministic synthetic official workbook helper**

The helper must create exactly five sheets and use these deterministic code sets:

```ts
const WORKSHEET_NAMES = ["填写说明", "仓库清单", "物品资料", "期初库存", "核对汇总"] as const;
const WORKSHEET_HEADERS = {
  仓库清单: ["仓库编码", "仓库名称", "状态"],
  物品资料: ["物料编号", "物品名称", "类别", "单位", "规格", "参考单价", "数据状态", "问题说明"],
  期初库存: ["仓库编码", "仓库名称", "物料编号", "物品名称", "类别", "单位", "规格", "批次号", "实盘数量", "确认单价", "金额", "备注", "校验状态", "错误说明"],
  核对汇总: ["物料编号", "物品名称", "原综合期末库存", "三仓实盘合计", "数量差异", "三仓金额合计", "核对状态", "问题说明"],
} as const;

const ALLOWED_WORKBOOK_CATEGORY_LABELS = {
  BJ: ["白酒"],
  HJ: ["红酒"],
  CY: ["茶叶", "陈皮"],
  WP: ["物品", "烟"],
} as const;

const ITEM_CODES = [
  ...Array.from({ length: 20 }, (_, index) => `BJ${String(index + 1).padStart(4, "0")}`),
  ...Array.from({ length: 20 }, (_, index) => `HJ${String(index + 1).padStart(4, "0")}`),
  ...Array.from({ length: 20 }, (_, index) => `CY${String(index + 1).padStart(4, "0")}`),
  ...Array.from({ length: 21 }, (_, index) => `WP${String(index + 1).padStart(4, "0")}`),
];
```

Export:

```ts
export async function buildOpeningStockWorkbook(
  mutate?: (workbook: ExcelJS.Workbook) => void,
): Promise<Buffer>;
```

Use `2026-08-24T00:00:00.000Z` in `填写说明!B6`. For every synthetic item, use name `测试物品 <code>`, unit `个`, blank specification and reference unit cost `10`. Choose workbook labels from `ALLOWED_WORKBOOK_CATEGORY_LABELS`: `BJ=白酒`, `HJ=红酒`, alternate `CY` rows between `茶叶/陈皮`, and alternate `WP` rows between `物品/烟` while forcing `WP0010=物品`. Give the first inventory row quantity `2`, unit cost `10`, remark `实盘确认`; give the other 242 rows quantity `0` and blank unit cost. Tests will mutate `WP0010` to `个` when exercising the blocker.

- [ ] **Step 4: Write failing structure, date and item tests**

Include these concrete cases:

```ts
it("parses the fixed five-sheet contract and normalizes 81 items", async () => {
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer: await buildOpeningStockWorkbook() });
  expect(result.baselineDate).toBe("2026-08-24");
  expect(result.items).toHaveLength(81);
  expect(result.rows).toHaveLength(243);
  expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
});

it("reports a missing sheet without throwing away other issues", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => workbook.removeWorksheet(workbook.getWorksheet("物品资料")!.id));
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues).toContainEqual(expect.objectContaining({ code: "WORKBOOK_SHEETS_INVALID", severity: "ERROR" }));
});

it("rejects changed headers and extra authoritative business rows", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => {
    workbook.getWorksheet("物品资料")!.getCell("C1").value = "分类";
    workbook.getWorksheet("物品资料")!.getCell("A83").value = "BJ9999";
    workbook.getWorksheet("期初库存")!.getCell("A245").value = "WH-01";
  });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
    "WORKSHEET_HEADERS_INVALID",
    "ITEM_ROW_COUNT_INVALID",
    "INVENTORY_ROW_COUNT_INVALID",
  ]));
});

it("ignores styled blank rows outside the fixed business ranges", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => {
    workbook.getWorksheet("物品资料")!.getRow(1000).height = 18;
    workbook.getWorksheet("期初库存")!.getRow(1000).height = 18;
  });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
});

it("requires an authoritative baseline date in 填写说明!B6", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => { workbook.getWorksheet("填写说明")!.getCell("B6").value = null; });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues).toContainEqual(expect.objectContaining({ code: "BASELINE_DATE_REQUIRED", sheet: "填写说明", row: 6, field: "盘点基准日期" }));
});

it("rejects non-ISO text dates", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => { workbook.getWorksheet("填写说明")!.getCell("B6").value = "2026/08/24"; });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues).toContainEqual(expect.objectContaining({ code: "BASELINE_DATE_INVALID", sheet: "填写说明", row: 6 }));
});

it.each([
  ["baseline date", "填写说明", "B6", { formula: "TODAY()", result: new Date("2026-08-24T00:00:00.000Z") }],
  ["item code", "物品资料", "A2", { formula: "\"BJ0001\"", result: "BJ0001" }],
])("rejects a formula in authoritative %s even with a cached result", async (_label, sheetName, cell, value) => {
  const buffer = await buildOpeningStockWorkbook((workbook) => { workbook.getWorksheet(sheetName)!.getCell(cell).value = value; });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues).toContainEqual(expect.objectContaining({ code: "AUTHORITATIVE_FORMULA_NOT_ALLOWED", sheet: sheetName }));
});

it("blocks duplicate and malformed item codes", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => {
    const sheet = workbook.getWorksheet("物品资料")!;
    sheet.getCell("A2").value = "bad";
    sheet.getCell("A3").value = "bad";
  });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["ITEM_CODE_INVALID", "ITEM_CODE_DUPLICATE"]));
});

it("reports duplicate names and missing reference cost as non-blocking warnings", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => {
    const sheet = workbook.getWorksheet("物品资料")!;
    sheet.getCell("B3").value = "测试物品 BJ0001";
    sheet.getCell("F3").value = null;
  });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "DUPLICATE_ITEM_NAME", severity: "WARNING" }),
    expect.objectContaining({ code: "REFERENCE_UNIT_COST_MISSING", severity: "WARNING", row: 3 }),
  ]));
  expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
});
```

- [ ] **Step 5: Run the parser test and confirm it fails**

Run:

```powershell
corepack pnpm test -- tests/unit/inventory/opening-stock-workbook-parser.test.ts
```

Expected: FAIL because the parser module does not exist.

- [ ] **Step 6: Implement bounded workbook structure, date and item parsing**

Implement `ExcelOpeningStockWorkbookParser` with the exact `WORKSHEET_NAMES`/`WORKSHEET_HEADERS` constants above, a strict UTC date normalizer, and row-numbered issues. Validate 81 item slots (rows 2–82) and 243 inventory slots (rows 2–244), then scan later rows only for nonblank authoritative cells; do not use ExcelJS `rowCount` or styled blank rows as the business-row count. Reject formula objects in every authoritative input cell (`填写说明!B6`, item source cells and inventory A/C/I/J/L); never consume their cached `result`. Ignore derived formula columns B/D/E/F/G/H/K/M/N completely. Catch ExcelJS load failures and throw `new BusinessRuleError("无法解析期初库存 Excel", 400)`; return structured issues for a readable workbook with bad business data.

For item codes, normalize with `trim().toUpperCase()`, derive the four allowed prefixes, validate the workbook label against `ALLOWED_WORKBOOK_CATEGORY_LABELS` (the later database category still comes only from the prefix), report empty name/unit, duplicate code, invalid category label and missing reference price, and never mutate the workbook. After parsing all 81 rows, group normalized names and emit a non-blocking `DUPLICATE_ITEM_NAME` warning for each name used by more than one distinct code.

- [ ] **Step 7: Run focused tests and typecheck**

```powershell
corepack pnpm test -- tests/unit/inventory/opening-stock-workbook-parser.test.ts
corepack pnpm --filter @warehouse/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit parser foundation**

```powershell
git add -- package.json apps/api/package.json pnpm-lock.yaml apps/api/src/application/inventory/opening-stock-import-contract.ts apps/api/src/infrastructure/import/excel-opening-stock-workbook-parser.ts tests/helpers/opening-stock-workbook.ts tests/unit/inventory/opening-stock-workbook-parser.test.ts
git commit -m "feat: parse opening stock workbook contract"
```

---

### Task 3: Inventory row validation and deterministic preview totals

**Files:**
- Modify: `apps/api/src/application/inventory/opening-stock-import-contract.ts`
- Modify: `apps/api/src/infrastructure/import/excel-opening-stock-workbook-parser.ts`
- Modify: `tests/helpers/opening-stock-workbook.ts`
- Modify: `tests/unit/inventory/opening-stock-workbook-parser.test.ts`

**Interfaces:**
- Consumes: `ParsedOpeningStockItem` and `ParsedOpeningStockRow` from Task 2.
- Produces: `OpeningStockWorkbookSummary`, fully normalized `batchNo`, `amount`, `disposition`, and complete file-level issues.

- [ ] **Step 1: Add the summary contract**

```ts
export interface OpeningStockWorkbookSummary {
  itemCount: number;
  inventoryRowCount: number;
  positiveRowCount: number;
  zeroRowCount: number;
  totalQuantity: string;
  totalAmount: string;
}
```

Add `summary: OpeningStockWorkbookSummary` to `ParsedOpeningStockWorkbook`.

- [ ] **Step 2: Write failing row and formula-independence tests**

```ts
it("recomputes batch and amount instead of trusting formula cells", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => {
    const row = workbook.getWorksheet("期初库存")!.getRow(2);
    row.getCell(8).value = { formula: "\"TAMPERED\"", result: "TAMPERED" };
    row.getCell(11).value = { formula: "999999", result: 999999 };
  });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.rows[0]).toMatchObject({
    batchNo: "OPEN-20260824-WH01-BJ0001",
    quantity: "2",
    unitCost: "10",
    amount: "20.00",
    disposition: "IMPORT",
  });
  expect(result.summary).toMatchObject({ positiveRowCount: 1, zeroRowCount: 242, totalQuantity: "2", totalAmount: "20.00" });
});

it("distinguishes blank quantity from counted zero", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => { workbook.getWorksheet("期初库存")!.getCell("I3").value = null; });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues).toContainEqual(expect.objectContaining({ code: "QUANTITY_REQUIRED", sheet: "期初库存", row: 3, field: "实盘数量" }));
  expect(result.rows[0]!.disposition).toBe("IMPORT");
});

it("accepts zero with blank cost but requires a remark for positive zero cost", async () => {
  const zeroResult = await parser.parse({ fileName: "期初库存.xlsx", buffer: await buildOpeningStockWorkbook() });
  expect(zeroResult.issues).not.toContainEqual(expect.objectContaining({ row: 3, code: "UNIT_COST_REQUIRED" }));

  const freeBuffer = await buildOpeningStockWorkbook((workbook) => {
    const sheet = workbook.getWorksheet("期初库存")!;
    sheet.getCell("J2").value = 0;
    sheet.getCell("L2").value = null;
  });
  const freeResult = await parser.parse({ fileName: "期初库存.xlsx", buffer: freeBuffer });
  expect(freeResult.issues).toContainEqual(expect.objectContaining({ code: "ZERO_COST_REMARK_REQUIRED", row: 2 }));
});

it("requires each item and warehouse combination exactly once", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => { workbook.getWorksheet("期初库存")!.getCell("A3").value = "WH-01"; });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["INVENTORY_COMBINATION_DUPLICATE", "INVENTORY_COMBINATION_MISSING"]));
});

it("rejects formulas in authoritative input cells even when they have cached results", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => {
    workbook.getWorksheet("期初库存")!.getCell("I2").value = { formula: "1+1", result: 2 };
  });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues).toContainEqual(expect.objectContaining({ code: "AUTHORITATIVE_FORMULA_NOT_ALLOWED", row: 2, field: "实盘数量" }));
});
```

Add this table-driven validation matrix:

```ts
it.each([
  ["negative quantity", "I2", -1, "QUANTITY_NEGATIVE"],
  ["quantity precision", "I2", "1.23456", "QUANTITY_PRECISION_INVALID"],
  ["quantity overflow", "I2", "123456789012345.1234", "QUANTITY_OUT_OF_RANGE"],
  ["negative unit cost", "J2", -1, "UNIT_COST_NEGATIVE"],
  ["unit cost precision", "J2", "1.23456", "UNIT_COST_PRECISION_INVALID"],
])("reports %s", async (_label, cell, value, code) => {
  const buffer = await buildOpeningStockWorkbook((workbook) => { workbook.getWorksheet("期初库存")!.getCell(cell).value = value; });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues).toContainEqual(expect.objectContaining({ code, severity: "ERROR" }));
});

it("reports positive quantity without cost and unknown workbook item", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => {
    const sheet = workbook.getWorksheet("期初库存")!;
    sheet.getCell("J2").value = null;
    sheet.getCell("C3").value = "BJ9999";
  });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["UNIT_COST_REQUIRED", "INVENTORY_ITEM_UNKNOWN"]));
});

it("rejects a derived row amount that cannot fit Decimal(18,2)", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => {
    const sheet = workbook.getWorksheet("期初库存")!;
    sheet.getCell("I2").value = "99999999999999.9999";
    sheet.getCell("J2").value = "99999999999999.9999";
  });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues).toContainEqual(expect.objectContaining({ code: "AMOUNT_OUT_OF_RANGE", row: 2, severity: "ERROR" }));
});

it.each([
  ["quantity", "50000000000000", "1", "TOTAL_QUANTITY_OUT_OF_RANGE"],
  ["amount", "100", "60000000000000", "TOTAL_AMOUNT_OUT_OF_RANGE"],
])("rejects an overflowing %s summary", async (_label, quantity, unitCost, code) => {
  const buffer = await buildOpeningStockWorkbook((workbook) => {
    const sheet = workbook.getWorksheet("期初库存")!;
    for (const row of [2, 3]) {
      sheet.getCell(`I${row}`).value = quantity;
      sheet.getCell(`J${row}`).value = unitCost;
    }
  });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues).toContainEqual(expect.objectContaining({ code, severity: "ERROR" }));
});

it("blocks the known WP0010 category anomaly", async () => {
  const buffer = await buildOpeningStockWorkbook((workbook) => { workbook.getWorksheet("物品资料")!.getCell("C71").value = "个"; });
  const result = await parser.parse({ fileName: "期初库存.xlsx", buffer });
  expect(result.issues).toContainEqual(expect.objectContaining({ code: "ITEM_CATEGORY_INVALID", severity: "ERROR" }));
});
```

- [ ] **Step 3: Run tests and verify failure**

```powershell
corepack pnpm test -- tests/unit/inventory/opening-stock-workbook-parser.test.ts
```

Expected: FAIL on missing summary and row validation.

- [ ] **Step 4: Implement row normalization and summary calculation**

Use `decimal.js` for every quantity, unit cost and amount. Reject exponent notation and values with more than four fractional digits before constructing `Decimal`. Format per-row amount with `quantity.mul(unitCost).toFixed(2)`, then verify the normalized value fits `Decimal(18,2)`. Sum normalized quantities for `totalQuantity` and the two-decimal row amounts for `totalAmount`; verify the final totals fit `Decimal(18,4)` and `Decimal(18,2)` respectively before allowing commit.

Generate batch numbers only with:

```ts
export function openingStockBatchNo(baselineDate: string, warehouseCode: string, itemCode: string): string {
  return `OPEN-${baselineDate.replaceAll("-", "")}-${warehouseCode.replaceAll("-", "")}-${itemCode}`;
}
```

Build the expected 243 combination keys from parsed item codes and the three fixed warehouse codes, compare them with actual keys, and report both duplicate and missing keys. Set `disposition="SKIP_ZERO"` only for a valid explicit zero; do not give rows with errors an import disposition.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
corepack pnpm test -- tests/unit/inventory/opening-stock-workbook-parser.test.ts
corepack pnpm --filter @warehouse/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit completed workbook validation**

```powershell
git add -- apps/api/src/application/inventory/opening-stock-import-contract.ts apps/api/src/infrastructure/import/excel-opening-stock-workbook-parser.ts tests/helpers/opening-stock-workbook.ts tests/unit/inventory/opening-stock-workbook-parser.test.ts
git commit -m "feat: validate opening stock workbook rows"
```

---

### Task 4: Admin-bound preview token

**Files:**
- Create: `apps/api/src/application/inventory/opening-stock-preview-token-service.ts`
- Create: `tests/unit/inventory/opening-stock-preview-token-service.test.ts`

**Interfaces:**
- Produces: `issue(input): { token: string; expiresAt: string }` and `verify(token, expected): OpeningStockPreviewTokenPayload`.
- Consumes: `BusinessRuleError` for stable 409 responses.

- [ ] **Step 1: Write failing token tests with an injected clock**

```ts
let currentTime: Date;
let service: OpeningStockPreviewTokenService;

beforeEach(() => {
  currentTime = new Date("2026-08-24T08:00:00.000Z");
  service = new OpeningStockPreviewTokenService("test-session-secret", {
    now: () => new Date(currentTime),
    ttlMs: 30 * 60 * 1000,
  });
});

function expectTokenError(run: () => unknown, message: string): void {
  let thrown: unknown;
  try { run(); } catch (error) { thrown = error; }
  expect(thrown).toMatchObject({ message, statusCode: 409 });
}

it("binds a token to actor and file for thirty minutes", () => {
  const issued = service.issue({ actorId: "admin-1", fileSha256: "a".repeat(64) });
  expect(issued.expiresAt).toBe("2026-08-24T08:30:00.000Z");
  expect(service.verify(issued.token, { actorId: "admin-1", fileSha256: "a".repeat(64) })).toMatchObject({ version: 1, actorId: "admin-1" });
});

it.each([
  ["another admin", { actorId: "admin-2", fileSha256: "a".repeat(64) }],
  ["another file", { actorId: "admin-1", fileSha256: "b".repeat(64) }],
])("rejects %s", (_label, expected) => {
  const issued = service.issue({ actorId: "admin-1", fileSha256: "a".repeat(64) });
  expect(() => service.verify(issued.token, expected)).toThrowError("期初库存预览凭证无效，请重新预览");
});
```

Add explicit tampered-signature and expired-clock assertions:

```ts
it("rejects a tampered signature", () => {
  const issued = service.issue({ actorId: "admin-1", fileSha256: "a".repeat(64) });
  expectTokenError(
    () => service.verify(`${issued.token.slice(0, -1)}x`, { actorId: "admin-1", fileSha256: "a".repeat(64) }),
    "期初库存预览凭证无效，请重新预览",
  );
});

it("rejects an expired token", () => {
  const issued = service.issue({ actorId: "admin-1", fileSha256: "a".repeat(64) });
  currentTime = new Date("2026-08-24T08:30:00.001Z");
  expectTokenError(
    () => service.verify(issued.token, { actorId: "admin-1", fileSha256: "a".repeat(64) }),
    "期初库存预览凭证已过期，请重新预览",
  );
});
```

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm test -- tests/unit/inventory/opening-stock-preview-token-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement versioned base64url HMAC tokens**

Use this public payload:

```ts
export interface OpeningStockPreviewTokenPayload {
  version: 1;
  actorId: string;
  fileSha256: string;
  issuedAt: string;
  expiresAt: string;
}
```

Serialize the payload once, encode with base64url, sign `opening-stock-preview.v1.<encodedPayload>` using `createHmac("sha256", secret)`, and return the exact token format `v1.<encodedPayload>.<base64urlSignature>`. Verification must require exactly three segments, reject any prefix other than `v1`, decode both signatures to Buffers, check equal byte lengths before `timingSafeEqual`, and only then parse/validate the payload. Reject malformed JSON, wrong version, wrong actor/hash, bad signature or expiry with the same `BusinessRuleError` message and status 409. Never include the secret in errors.

- [ ] **Step 4: Run tests and typecheck**

```powershell
corepack pnpm test -- tests/unit/inventory/opening-stock-preview-token-service.test.ts
corepack pnpm --filter @warehouse/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit token support**

```powershell
git add -- apps/api/src/application/inventory/opening-stock-preview-token-service.ts tests/unit/inventory/opening-stock-preview-token-service.test.ts
git commit -m "feat: sign opening stock previews"
```

---

### Task 5: Preview service and master-data snapshot validation

**Files:**
- Modify: `apps/api/src/application/inventory/opening-stock-import-contract.ts`
- Create: `apps/api/src/application/inventory/opening-stock-import-service.ts`
- Create: `tests/helpers/opening-stock-import.ts`
- Create: `tests/integration/inventory/opening-stock-import-service.test.ts`

**Interfaces:**
- Produces: `OpeningStockImportStore`, `OpeningStockImportService.getStatus()`, `preview()`, reusable `validateOpeningStockMasterData()` and API-ready preview/status types.
- Consumes: parser from Tasks 2–3, token service from Task 4, and the existing `AccountingPeriodStore` for read-only preview checks.

- [ ] **Step 1: Add exact store and response contracts**

```ts
export type OpeningStockImportAvailability = "AVAILABLE" | "BLOCKED_BY_ACTIVITY" | "COMPLETED";

export interface OpeningStockImportResult {
  id: "INITIAL_OPENING_STOCK";
  fileSha256: string;
  sourceFileName: string;
  baselineDate: string;
  operatorId: string;
  financeReviewer: string;
  itemCount: number;
  createdItemCount: number;
  inventoryRowCount: number;
  positiveRowCount: number;
  zeroRowCount: number;
  totalQuantity: string;
  totalAmount: string;
  importedAt: string;
}

export interface OpeningStockImportStatus {
  availability: OpeningStockImportAvailability;
  completedImport?: OpeningStockImportResult;
}

export interface OpeningStockImportCommitRow {
  sheetRow: number;
  warehouseCode: string;
  itemCode: string;
  batchNo: string;
  quantity: string;
  unitCost: string;
  amount: string;
  remark?: string;
}

export interface OpeningStockImportCommitDraft extends Omit<OpeningStockImportResult, "importedAt"> {
  items: ParsedOpeningStockItem[];
  rows: OpeningStockImportCommitRow[];
}

export interface OpeningStockImportPreviewRow {
  sheetRow: number;
  warehouseCode: string;
  itemCode: string;
  itemName: string;
  batchNo: string;
  quantity: string;
  unitCost: string;
  amount: string;
  remark?: string;
  disposition: "IMPORT" | "SKIP_ZERO" | "INVALID";
}

export interface OpeningStockMasterDataSnapshot {
  availability: OpeningStockImportAvailability;
  completedImport?: OpeningStockImportResult;
  warehouses: Array<{ id: string; code: string; name: string; isActive: boolean; isPlaceholder?: boolean }>;
  categories: Array<{ id: string; code: string; prefix: string; name: string }>;
  items: Array<{ id: string; code: string; name: string; specification?: string; unit: string; categoryId: string; isActive: boolean }>;
  existingBatchKeys: string[];
}

export interface OpeningStockImportStore {
  getSnapshot(): Promise<OpeningStockMasterDataSnapshot>;
  commit(input: OpeningStockImportCommitDraft): Promise<OpeningStockImportResult>;
}

export interface OpeningStockImportPreview {
  baselineDate?: string;
  canCommit: boolean;
  fileSha256: string;
  previewToken?: string;
  previewExpiresAt?: string;
  summary: OpeningStockWorkbookSummary & { newItemCount: number; existingItemCount: number };
  issues: OpeningStockImportIssue[];
  rows: OpeningStockImportPreviewRow[];
}
```

Create the shared fixture factory used by later store tests:

```ts
export async function openingStockCommitDraftFixture(
  parser: OpeningStockWorkbookParser,
  options: {
    fileSha256?: string;
    operatorId?: string;
    financeReviewer?: string;
    mutateWorkbook?: (workbook: ExcelJS.Workbook) => void;
  } = {},
): Promise<OpeningStockImportCommitDraft> {
  const workbook = await buildOpeningStockWorkbook(options.mutateWorkbook);
  const parsed = await parser.parse({ fileName: "期初库存.xlsx", buffer: workbook });
  if (!parsed.baselineDate || parsed.issues.some((issue) => issue.severity === "ERROR")) throw new Error("invalid opening stock test fixture");
  const rows: OpeningStockImportCommitRow[] = parsed.rows.filter((row) => row.disposition === "IMPORT").map((row) => {
    if (!row.batchNo || row.quantity === undefined || row.unitCost === undefined || !row.amount) throw new Error(`invalid positive test row: ${row.sheetRow}`);
    return { sheetRow: row.sheetRow, warehouseCode: row.warehouseCode, itemCode: row.itemCode, batchNo: row.batchNo, quantity: row.quantity, unitCost: row.unitCost, amount: row.amount, remark: row.remark };
  });
  return {
    id: "INITIAL_OPENING_STOCK",
    fileSha256: options.fileSha256 ?? "a".repeat(64),
    sourceFileName: "期初库存.xlsx",
    baselineDate: parsed.baselineDate,
    operatorId: options.operatorId ?? "admin-1",
    financeReviewer: options.financeReviewer ?? "财务甲",
    itemCount: parsed.summary.itemCount,
    createdItemCount: parsed.summary.itemCount,
    inventoryRowCount: parsed.summary.inventoryRowCount,
    positiveRowCount: parsed.summary.positiveRowCount,
    zeroRowCount: parsed.summary.zeroRowCount,
    totalQuantity: parsed.summary.totalQuantity,
    totalAmount: parsed.summary.totalAmount,
    items: parsed.items,
    rows,
  };
}
```

- [ ] **Step 2: Write failing preview and snapshot tests using a typed fake store**

Define the fake at the top of the test file so every referenced helper is concrete:

```ts
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
  async getSnapshot() { return structuredClone(this.snapshot); }
  async commit(input: OpeningStockImportCommitDraft) {
    this.commits.push(structuredClone(input));
    return { ...input, importedAt: "2026-08-24T08:05:00.000Z" };
  }
}

const parser = new ExcelOpeningStockWorkbookParser();
const tokenService = new OpeningStockPreviewTokenService("test-session-secret", { now: () => new Date("2026-08-24T08:00:00.000Z") });
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

const validPreview = () => service.preview({ actorId: "admin-1", fileName: "期初库存.xlsx", buffer: validBuffer });
```

```ts
it("returns a signed preview with new/existing item counts", async () => {
  const getOrCreate = vi.spyOn(periodStore, "getOrCreate");
  const preview = await service.preview({ actorId: "admin-1", fileName: "期初库存.xlsx", buffer: await buildOpeningStockWorkbook() });
  expect(preview).toMatchObject({
    canCommit: true,
    fileSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    previewToken: expect.any(String),
    previewExpiresAt: "2026-08-24T08:30:00.000Z",
    summary: { itemCount: 81, newItemCount: 81, existingItemCount: 0, positiveRowCount: 1, zeroRowCount: 242 },
  });
  expect(getOrCreate).not.toHaveBeenCalled();
});

it("blocks placeholder or mismatched warehouses", async () => {
  fakeStore.snapshot.warehouses[0] = { id: "warehouse-1", code: "WH-01", name: "待配置仓库一", isActive: true, isPlaceholder: true };
  const preview = await service.preview({ actorId: "admin-1", fileName: "期初库存.xlsx", buffer: await buildOpeningStockWorkbook() });
  expect(preview.canCommit).toBe(false);
  expect(preview.previewToken).toBeUndefined();
  expect(preview.issues).toContainEqual(expect.objectContaining({ code: "WAREHOUSE_MASTER_DATA_MISMATCH" }));
});

it("does not overwrite an existing item conflict", async () => {
  fakeStore.snapshot.items.push({ id: "item-1", code: "BJ0001", name: "冲突名称", unit: "瓶", categoryId: "category-bj", isActive: true });
  const preview = await service.preview({ actorId: "admin-1", fileName: "期初库存.xlsx", buffer: await buildOpeningStockWorkbook() });
  expect(preview.issues).toContainEqual(expect.objectContaining({ code: "ITEM_MASTER_DATA_CONFLICT", field: "物品名称" }));
});

it("counts an exactly matching active item as existing without scheduling an update", async () => {
  fakeStore.snapshot.items.push({ id: "item-1", code: "BJ0001", name: "测试物品 BJ0001", unit: "个", categoryId: "category-bj", isActive: true });
  const preview = await validPreview();
  expect(preview).toMatchObject({ canCommit: true, summary: { itemCount: 81, newItemCount: 80, existingItemCount: 1 } });
  expect(preview.previewToken).toEqual(expect.any(String));
});

it("blocks a closed baseline period without creating a period during preview", async () => {
  await periodStore.save({ code: "2026-08", status: "CLOSED" });
  const getOrCreate = vi.spyOn(periodStore, "getOrCreate");
  const preview = await validPreview();
  expect(preview.canCommit).toBe(false);
  expect(preview.previewToken).toBeUndefined();
  expect(preview.issues).toContainEqual(expect.objectContaining({ code: "ACCOUNTING_PERIOD_CLOSED", severity: "ERROR" }));
  expect(getOrCreate).not.toHaveBeenCalled();
});
```

Add this snapshot matrix; each case must produce no token:

```ts
it.each([
  ["missing category", (snapshot: OpeningStockMasterDataSnapshot) => { snapshot.categories = snapshot.categories.filter((category) => category.prefix !== "HJ"); }, "ITEM_CATEGORY_MASTER_DATA_MISMATCH"],
  ["renamed category", (snapshot: OpeningStockMasterDataSnapshot) => { snapshot.categories[0]!.name = "办公用品"; }, "ITEM_CATEGORY_MASTER_DATA_MISMATCH"],
  ["inactive item", (snapshot: OpeningStockMasterDataSnapshot) => { snapshot.items.push({ id: "item-1", code: "BJ0001", name: "测试物品 BJ0001", unit: "个", categoryId: "category-bj", isActive: false }); }, "ITEM_INACTIVE"],
  ["existing batch", (snapshot: OpeningStockMasterDataSnapshot) => { snapshot.items.push({ id: "item-1", code: "BJ0001", name: "测试物品 BJ0001", unit: "个", categoryId: "category-bj", isActive: true }); snapshot.existingBatchKeys.push("warehouse-1\u0000item-1\u0000OPEN-20260824-WH01-BJ0001"); }, "BATCH_ALREADY_EXISTS"],
  ["inventory activity", (snapshot: OpeningStockMasterDataSnapshot) => { snapshot.availability = "BLOCKED_BY_ACTIVITY"; }, "OPENING_STOCK_BLOCKED_BY_ACTIVITY"],
  ["completed import", (snapshot: OpeningStockMasterDataSnapshot) => { snapshot.availability = "COMPLETED"; snapshot.completedImport = completedImportFixture; }, "OPENING_STOCK_ALREADY_IMPORTED"],
])("blocks %s", async (_label, mutate, code) => {
  mutate(fakeStore.snapshot);
  const preview = await service.preview({ actorId: "admin-1", fileName: "期初库存.xlsx", buffer: validBuffer });
  expect(preview.canCommit).toBe(false);
  expect(preview.previewToken).toBeUndefined();
  expect(preview.issues).toContainEqual(expect.objectContaining({ code, severity: "ERROR" }));
});
```

Define `completedImportFixture` with the exact `OpeningStockImportResult` fields before the matrix; the `beforeEach` construction above prevents table cases from leaking store state.

- [ ] **Step 3: Run and verify failure**

```powershell
corepack pnpm test -- tests/integration/inventory/opening-stock-import-service.test.ts
```

Expected: FAIL because the service and store contract are missing.

- [ ] **Step 4: Implement preview evaluation**

Compute `fileSha256` with Node `createHash("sha256")`. Compare the snapshot with these exact warehouse names:

```ts
const EXPECTED_WAREHOUSES = new Map([
  ["WH-01", "集团二楼仓库"],
  ["WH-02", "内区1号仓库"],
  ["WH-03", "1区车库后仓库"],
]);
```

Validate all four canonical categories, match existing items by normalized code, compare normalized name/unit/specification/category, and check `warehouseId\0itemId\0batchNo` keys only after code-to-ID resolution. If parsing produced a baseline date, derive `YYYY-MM`, call only `periodStore.get(code)`, and add `ACCOUNTING_PERIOD_CLOSED` when it returns `CLOSED`; preview must never call `getOrCreate()` or `save()`. Merge workbook, period and snapshot issues, calculate new/existing counts, and map all 243 parsed rows to `OpeningStockImportPreviewRow`: look up `itemName`, use empty strings for missing display values, preserve `IMPORT`/`SKIP_ZERO`, and mark any row with a row-level `ERROR` as `INVALID`. Sign only when no `ERROR` and availability is `AVAILABLE`.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
corepack pnpm test -- tests/integration/inventory/opening-stock-import-service.test.ts
corepack pnpm --filter @warehouse/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit preview orchestration**

```powershell
git add -- apps/api/src/application/inventory/opening-stock-import-contract.ts apps/api/src/application/inventory/opening-stock-import-service.ts tests/helpers/opening-stock-import.ts tests/integration/inventory/opening-stock-import-service.test.ts
git commit -m "feat: preview opening stock imports"
```

---

### Task 6: Commit orchestration and shared in-memory store

**Files:**
- Modify: `apps/api/src/application/inventory/opening-stock-import-service.ts`
- Modify: `apps/api/src/application/inventory/inventory-memory-state.ts`
- Create: `apps/api/src/infrastructure/db/in-memory-opening-stock-import-store.ts`
- Modify: `tests/integration/inventory/opening-stock-import-service.test.ts`
- Create: `tests/integration/inventory/in-memory-opening-stock-import-store.test.ts`

**Interfaces:**
- Produces: fully implemented `OpeningStockImportService.commit()` and `InMemoryOpeningStockImportStore`.
- Consumes: `OpeningStockImportStore` contract, `InMemoryInventoryEntryStore`, item/warehouse repositories and period store.

- [ ] **Step 1: Write failing commit-service tests**

```ts
it("requires finance reviewer and explicit joint confirmation", async () => {
  const preview = await validPreview();
  await expect(service.commit({ actorId: "admin-1", fileName: "期初库存.xlsx", buffer: validBuffer, previewToken: preview.previewToken!, financeReviewer: "", confirmed: true }))
    .rejects.toMatchObject({ message: "财务复核人不能为空", statusCode: 400 });
  await expect(service.commit({ actorId: "admin-1", fileName: "期初库存.xlsx", buffer: validBuffer, previewToken: preview.previewToken!, financeReviewer: "财务甲", confirmed: false }))
    .rejects.toMatchObject({ message: "请确认已与财务共同复核", statusCode: 400 });
  await expect(service.commit({ actorId: "admin-1", fileName: "期初库存.xlsx", buffer: validBuffer, previewToken: preview.previewToken!, financeReviewer: "财".repeat(101), confirmed: true }))
    .rejects.toMatchObject({ message: "财务复核人不能超过 100 个字符", statusCode: 400 });
});

it("reparses the same file and commits positive rows only", async () => {
  const preview = await validPreview();
  const result = await service.commit({ actorId: "admin-1", fileName: "期初库存.xlsx", buffer: validBuffer, previewToken: preview.previewToken!, financeReviewer: "财务甲", confirmed: true });
  expect(fakeStore.commits[0]).toMatchObject({ operatorId: "admin-1", financeReviewer: "财务甲", positiveRowCount: 1, zeroRowCount: 242 });
  expect(fakeStore.commits[0]!.rows).toHaveLength(1);
  expect(result.inventoryRowCount).toBe(243);
});
```

Add these exact commit-service cases; every case must reject with HTTP semantics `409`, use the message `期初库存文件或系统状态已变化，请重新预览` at the service boundary, and leave `fakeStore.commits` empty:

| Test name | Arrange after a successful preview | Commit input/assertion |
| --- | --- | --- |
| `rejects changed file bytes` | Append one byte to a copy of `validBuffer` | Commit with the changed Buffer and the original token. |
| `rejects a token owned by another actor` | No snapshot change | Commit as `admin-2` with `admin-1`'s token. |
| `rejects an expired preview` | Advance the injected clock to `2026-08-24T08:30:00.001Z` | Commit the original actor, token and Buffer. |
| `rejects a batch conflict introduced after preview` | Add the resolved `warehouse-1/item-1/OPEN-20260824-WH01-BJ0001` key and matching existing item to `fakeStore.snapshot` | Commit the original actor, token and Buffer. |
| `rejects a parser error introduced after preview` | Configure the parser fake to return the valid parse once, then an `ERROR` issue on its second call | Commit the original actor, token and Buffer. |

- [ ] **Step 2: Run commit tests and verify failure**

```powershell
corepack pnpm test -- tests/integration/inventory/opening-stock-import-service.test.ts
```

Expected: FAIL because `commit()` is not implemented.

- [ ] **Step 3: Implement commit orchestration**

Validate confirmation fields, compute the current hash, verify the token, call a private `evaluate()` that does not issue a new token, reject any new `ERROR` with `BusinessRuleError("期初库存文件或系统状态已变化，请重新预览", 409)`, and call `store.commit()` with all 81 items but only rows where `disposition === "IMPORT"`. The draft's `createdItemCount` must come from that second evaluation, not from the earlier preview response.

- [ ] **Step 4: Write failing in-memory atomicity tests**

```ts
it("creates missing items and one positive opening balance while retaining zero statistics", async () => {
  const draft = await openingStockCommitDraftFixture(parser);
  const result = await store.commit(draft);
  expect(result).toMatchObject({ createdItemCount: 81, inventoryRowCount: 243, positiveRowCount: 1, zeroRowCount: 242 });
  expect(await itemRepository.list(true)).toHaveLength(81);
  expect(entryStore.batches()).toHaveLength(1);
  expect(entryStore.ledger()).toEqual([expect.objectContaining({ type: "OPENING_BALANCE", occurredAt: "2026-08-24T00:00:00.000Z" })]);
});

it("rejects a second import without changing state", async () => {
  const draft = await openingStockCommitDraftFixture(parser);
  await store.commit(draft);
  await expect(store.commit({ ...draft, fileSha256: "b".repeat(64) })).rejects.toMatchObject({ statusCode: 409 });
  expect(entryStore.ledger()).toHaveLength(1);
  expect(await itemRepository.list(true)).toHaveLength(81);
});

it("rejects a closed baseline period before any write", async () => {
  periodStore.save({ code: "2026-08", status: "CLOSED" });
  const draft = await openingStockCommitDraftFixture(parser);
  await expect(store.commit(draft)).rejects.toMatchObject({ message: "期初库存所属会计期间已关闭", statusCode: 409 });
  expect(entryStore.ledger()).toEqual([]);
  expect(await itemRepository.list(true)).toEqual([]);
});
```

Add two explicit pre-write atomicity tests:

- `rejects any pre-existing ledger`: seed one unrelated `INBOUND` ledger entry in the shared memory state, snapshot item/batch/balance/ledger counts, call `store.commit(draft)`, expect `409`, and assert every snapshotted count plus `state.openingStockImport` is unchanged.
- `rejects an existing composite batch key`: seed an item matching the first positive draft row and call `entryStore.recordOpeningStock()` with that warehouse/item/batch tuple, snapshot all five state counts, call `store.commit(draft)`, expect `409`, and assert the item, batch, balance, ledger and import-summary state exactly equals the snapshot.

- [ ] **Step 5: Add in-memory import state and store**

Add `openingStockImport?: OpeningStockImportResult` to `InventoryMemoryState`. The store constructor accepts narrow item/warehouse/category repositories, the shared `InventoryMemoryState`, shared `InMemoryInventoryEntryStore`, and shared `AccountingPeriodStore`.

Commit order must be:

1. build and validate an immutable snapshot and all generated IDs;
2. reject marker, ledger, period, master data or batch conflicts, and recompute the missing-item set so it exactly matches `createdItemCount`;
3. call `recordOpeningStock()` with positive rows and generated item IDs;
4. save new items using the non-throwing in-memory repository;
5. set the one-time import summary.

Because all possible business failures occur before step 3 and in-memory saves do not perform I/O, no partial state is observable.

- [ ] **Step 6: Run service/store tests and typecheck**

```powershell
corepack pnpm test -- tests/integration/inventory/opening-stock-import-service.test.ts tests/integration/inventory/in-memory-opening-stock-import-store.test.ts
corepack pnpm --filter @warehouse/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit commit orchestration and memory support**

```powershell
git add -- apps/api/src/application/inventory/opening-stock-import-service.ts apps/api/src/application/inventory/inventory-memory-state.ts apps/api/src/infrastructure/db/in-memory-opening-stock-import-store.ts tests/integration/inventory/opening-stock-import-service.test.ts tests/integration/inventory/in-memory-opening-stock-import-store.test.ts
git commit -m "feat: commit opening stock imports in memory"
```

---

### Task 7: Prisma Serializable import transaction

**Files:**
- Create: `apps/api/src/infrastructure/db/prisma-opening-stock-import-store.ts`
- Create: `tests/integration/inventory/prisma-opening-stock-import.test.ts`
- Modify: `tests/integration/inventory/prisma-business-stores.test.ts`
- Modify: `tests/integration/db/prisma-restart-persistence.test.ts`

**Interfaces:**
- Produces: `PrismaOpeningStockImportStore implements OpeningStockImportStore`.
- Consumes: `validateOpeningStockMasterData()`, `assertPrismaPeriodOpen()`, `runInventoryTransaction()` and Task 1 Prisma model.

- [ ] **Step 1: Add the new migration to isolated PostgreSQL test setup**

Append this path to every explicit migration list used by the affected integration tests:

```ts
"prisma/migrations/20260824170000_opening_stock_import/migration.sql"
```

Add `await prisma.openingStockImport.deleteMany()` before deleting dependent inventory fixture data.

- [ ] **Step 2: Write failing Prisma transaction tests**

```ts
it("atomically creates import summary, missing items and positive inventory", async () => {
  const draft = await openingStockCommitDraftFixture(parser);
  const result = await store.commit(draft);
  expect(result).toMatchObject({ id: "INITIAL_OPENING_STOCK", createdItemCount: 81, inventoryRowCount: 243, positiveRowCount: 1, zeroRowCount: 242 });
  await expect(prisma.openingStockImport.findUniqueOrThrow({ where: { id: "INITIAL_OPENING_STOCK" } })).resolves.toMatchObject({ operatorId: "admin-1", financeReviewer: "财务甲" });
  await expect(prisma.item.count()).resolves.toBe(81);
  await expect(prisma.inboundOrder.count({ where: { source: "OPENING_STOCK" } })).resolves.toBe(1);
  await expect(prisma.procurementBatch.count()).resolves.toBe(1);
  await expect(prisma.stockBalance.count()).resolves.toBe(1);
  await expect(prisma.inboundLine.findFirstOrThrow()).resolves.toMatchObject({ remark: "实盘确认" });
  await expect(prisma.inventoryLedgerEntry.count({ where: { type: "OPENING_BALANCE" } })).resolves.toBe(1);
});

it("rolls back the import marker, new items and first row when a later row write fails", async () => {
  const draft = await openingStockCommitDraftFixture(parser, {
    mutateWorkbook: (workbook) => {
      const sheet = workbook.getWorksheet("期初库存")!;
      sheet.getCell("I5").value = 1;
      sheet.getCell("J5").value = 10;
      sheet.getCell("L5").value = "第二条正库存";
    },
  });
  // Persistence-only fault injection: the application parser never emits a Decimal(18,4) overflow.
  draft.rows[1]!.unitCost = "123456789012345.1234";
  draft.rows[1]!.amount = "123456789012345.12";
  await expect(store.commit(draft)).rejects.toBeDefined();
  await expect(prisma.openingStockImport.count()).resolves.toBe(0);
  await expect(prisma.item.findUnique({ where: { code: "BJ0001" } })).resolves.toBeNull();
  await expect(prisma.inboundOrder.count({ where: { source: "OPENING_STOCK" } })).resolves.toBe(0);
  await expect(prisma.procurementBatch.count()).resolves.toBe(0);
  await expect(prisma.stockBalance.count()).resolves.toBe(0);
  await expect(prisma.inventoryLedgerEntry.count({ where: { referenceType: "OPENING_STOCK" } })).resolves.toBe(0);
  await expect(prisma.accountingPeriod.findUnique({ where: { periodCode: "2026-08" } })).resolves.toBeNull();
});
```

Add this exact Prisma matrix, resetting the database between cases:

| Test name | Arrange | Required assertions |
| --- | --- | --- |
| `blocks initialization after unrelated inventory activity` | Insert one valid unrelated ledger graph before `store.commit(draft)` | Reject `409`; import marker, imported item codes and `OPENING_BALANCE` rows remain absent. |
| `rolls back when the baseline period is closed` | Insert `AccountingPeriod { periodCode: "2026-08", status: "CLOSED" }` | Reject `409`; marker/item/order/batch/balance/line/ledger counts are unchanged. |
| `rejects an existing composite batch key before writing` | Seed a matching `BJ0001` item and its `WH-01/OPEN-20260824-WH01-BJ0001` batch without a ledger | Reject `409`; the seeded item/batch remain, while marker, other workbook items, opening orders and opening ledger rows remain absent. |
| `rejects a second completed import` | Commit once, record every affected table count, then commit the same draft again | Second call rejects `409`; every recorded count is unchanged. |
| `allows exactly one concurrent first commit` | Run `Promise.allSettled([store.commit(draft), store.commit(structuredClone(draft))])` | Exactly one result is fulfilled, exactly one is rejected with `statusCode: 409`, and the database contains one marker, 81 items and one opening ledger row. |

- [ ] **Step 3: Run the Prisma test and confirm failure or environment skip**

```powershell
corepack pnpm test -- tests/integration/inventory/prisma-opening-stock-import.test.ts
```

Expected with `TEST_DATABASE_URL`: FAIL because the store does not exist. Without it: the suite is explicitly skipped; continue with schema/unit tests and record the missing database verification for Task 11.

- [ ] **Step 4: Implement snapshot queries**

`getSnapshot()` must query the fixed import marker, inventory ledger count, warehouses, categories, items and existing batches. Return `COMPLETED` when the marker exists, otherwise `BLOCKED_BY_ACTIVITY` when ledger count is nonzero, otherwise `AVAILABLE`. Convert every Prisma `Decimal` and `Date` in the completed result to API strings.

- [ ] **Step 5: Implement the Serializable commit**

Inside one `runInventoryTransaction()` callback:

1. query `OpeningStockImport` by fixed ID and reject when present;
2. count ledger entries and reject a nonzero count;
3. call `assertPrismaPeriodOpen(transaction, baselineDate)`;
4. reload canonical categories, warehouses, items and batch keys and run the shared validator without treating the current transaction as completed; reject `409` if the transaction's missing-item count differs from `input.createdItemCount`;
5. create `OpeningStockImport` with fixed ID `INITIAL_OPENING_STOCK` and all known summary fields, making the primary key the concurrent-commit claim;
6. create missing items and build a code-to-ID map;
7. create one `InboundOrder` per warehouse containing positive rows;
8. create each `ProcurementBatch`, `StockBalance`, `InboundLine` and `InventoryLedgerEntry` with the baseline UTC date and two-decimal stored amount; copy only the positive row's trimmed `remark` to `InboundLine.remark`;
9. return the persisted summary.

Convert a closed-period result in both stores to `new BusinessRuleError("期初库存所属会计期间已关闭", 409)`. Map Prisma `P2002` on the import primary key or batch composite key to `new BusinessRuleError("期初库存已导入或批次已存在", 409)`. Let `P2034` use the existing retryable transaction error, which already maps to conflict behavior.

- [ ] **Step 6: Replace old route-based setup in restart persistence test**

The restart test currently posts one manual opening row. Keep its prior API-created item, update `WH-01` to `集团二楼仓库`, then replace the opening POST with a direct `PrismaOpeningStockImportStore.commit()` draft containing that existing item and one `TASK4-OPENING` positive row (`createdItemCount=0`, `inventoryRowCount=1`, `positiveRowCount=1`, `zeroRowCount=0`). Retrieve `batchId` afterward with `prisma.procurementBatch.findFirstOrThrow({ where: { batchNo: "TASK4-OPENING" } })`. Keep the remainder of the restart assertions unchanged, and add an assertion after reconstruction that `openingStockImport.findUnique({ id: "INITIAL_OPENING_STOCK" })` still exists.

- [ ] **Step 7: Run focused Prisma and existing inventory tests**

```powershell
corepack pnpm test -- tests/integration/inventory/prisma-opening-stock-import.test.ts tests/integration/inventory/prisma-business-stores.test.ts tests/integration/db/prisma-restart-persistence.test.ts
corepack pnpm --filter @warehouse/api typecheck
```

Expected: PASS when PostgreSQL is available; otherwise Prisma suites report skips and API typecheck passes.

- [ ] **Step 8: Commit Prisma transaction support**

```powershell
git add -- apps/api/src/infrastructure/db/prisma-opening-stock-import-store.ts tests/integration/inventory/prisma-opening-stock-import.test.ts tests/integration/inventory/prisma-business-stores.test.ts tests/integration/db/prisma-restart-persistence.test.ts
git commit -m "feat: import opening stock transactionally"
```

---

### Task 8: Multipart routes, runtime wiring and safe audit

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/src/infrastructure/db/runtime.ts`
- Create: `apps/api/src/routes/admin/opening-stock-import.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/admin/opening-stock.ts`
- Create: `tests/helpers/multipart.ts`
- Create: `tests/integration/inventory/opening-stock-import-routes.test.ts`
- Modify: `tests/integration/admin/admin-audit.test.ts`

**Interfaces:**
- Produces: authenticated status/preview/commit HTTP endpoints and deprecated 410 single-row response.
- Consumes: service/store/parser/token modules from Tasks 2–7.

- [ ] **Step 1: Install the Fastify multipart plugin**

```powershell
corepack pnpm --filter @warehouse/api add @fastify/multipart@10.1.1
```

- [ ] **Step 2: Create a deterministic multipart inject helper**

Export:

```ts
export function multipartPayload(input: {
  fields?: Record<string, string>;
  file?: { fieldName?: string; fileName: string; contentType: string; buffer: Buffer };
}): { boundary: string; headers: { "content-type": string }; payload: Buffer };
```

Build CRLF-separated parts with a fixed random-safe boundary and `Buffer.concat`; include string fields and at most one binary file. This helper is test-only and must not decode or log file contents.

- [ ] **Step 3: Write failing route and audit tests**

Define the route-test helpers explicitly:

```ts
async function createSessionCookie(app: ReturnType<typeof buildServer>, role: "ADMIN" | "FINANCE" | "APPLICANT" = "ADMIN"): Promise<string> {
  const response = await app.inject({ method: "GET", url: `/auth/local?returnTo=/admin/opening-stock&role=${role}`, remoteAddress: "127.0.0.1", headers: { host: "localhost:3001" } });
  if (response.statusCode !== 302) throw new Error(`local login failed: ${response.statusCode}`);
  const cookie = response.headers["set-cookie"];
  return Array.isArray(cookie) ? cookie[0]! : cookie!;
}

async function configureFormalWarehouses(app: ReturnType<typeof buildServer>, cookie: string): Promise<void> {
  for (const [id, name] of [["warehouse-1", "集团二楼仓库"], ["warehouse-2", "内区1号仓库"], ["warehouse-3", "1区车库后仓库"]] as const) {
    const response = await app.inject({ method: "PATCH", url: `/admin/warehouses/${id}`, headers: { cookie }, payload: { name, isActive: true } });
    if (response.statusCode !== 200) throw new Error(`warehouse setup failed: ${id}`);
  }
}
```

```ts
it("previews and commits the same workbook for an authenticated admin", async () => {
  const cookie = await createSessionCookie(app, "ADMIN");
  await configureFormalWarehouses(app, cookie);
  const file = await buildOpeningStockWorkbook();
  const previewBody = multipartPayload({ file: { fileName: "期初库存.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file } });
  const preview = await app.inject({ method: "POST", url: "/admin/opening-stock/import/preview", headers: { cookie, ...previewBody.headers }, payload: previewBody.payload });
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toMatchObject({ canCommit: true, previewToken: expect.any(String), previewExpiresAt: expect.any(String) });

  const commitBody = multipartPayload({ fields: { previewToken: preview.json().previewToken, financeReviewer: "财务甲", confirmed: "true" }, file: { fileName: "期初库存.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file } });
  const commit = await app.inject({ method: "POST", url: "/admin/opening-stock/import/commit", headers: { cookie, ...commitBody.headers }, payload: commitBody.payload });
  expect(commit.statusCode).toBe(201);
  expect(commit.json()).toMatchObject({ id: "INITIAL_OPENING_STOCK", operatorId: "local-admin", financeReviewer: "财务甲", inventoryRowCount: 243, positiveRowCount: 1, zeroRowCount: 242 });
});
```

Add the following route matrix with exact responses and state assertions:

| Route case | Expected result |
| --- | --- |
| Anonymous preview and commit | `401`; no parser/store commit call. |
| Authenticated non-admin preview and commit | `403`; no parser/store commit call. |
| Preview filename `期初库存.xls` | `400`; response names `.xlsx`; no store commit. |
| Preview with an extra scalar field, or commit with duplicate/unknown/missing scalar fields | `400`; no store commit. |
| Preview with `Buffer.from("not an xlsx")` | `400`; stable `无法解析期初库存 Excel`; no store commit. |
| Preview with `5 * 1024 * 1024 + 1` bytes | `413`; request is fully drained/closed; no store commit. |
| Commit with changed file bytes or mismatched token | `409`; no import summary or inventory ledger. |
| A second valid commit | First `201`, second `409`; one import summary and one positive ledger row. |
| Status lifecycle | Fresh server returns `AVAILABLE`; a seeded unrelated ledger returns `BLOCKED_BY_ACTIVITY`; a successful commit returns `COMPLETED` with the immutable result. |
| Legacy `POST /admin/opening-stock` | `410` with the Excel guidance; batch/balance/ledger counts stay unchanged. |

For audit, assert exactly one `OPENING_STOCK_IMPORTED` success event contains the import ID/hash/summary but JSON-stringified `afterData` does not contain `previewToken`, workbook bytes, `PK`, or an item-row dump. Add a failed-commit audit assertion with the same exclusions.

- [ ] **Step 4: Run route tests and verify failure**

```powershell
corepack pnpm test -- tests/integration/inventory/opening-stock-import-routes.test.ts tests/integration/admin/admin-audit.test.ts
```

Expected: FAIL because multipart/routes/runtime wiring is absent.

- [ ] **Step 5: Wire both persistence drivers**

Add `openingStockImportStore: OpeningStockImportStore` to `InventoryPersistence`. For memory, seed the category repository with cloned `CANONICAL_ITEM_CATEGORIES`, pass the live item/warehouse repositories, shared state, entry store and period store to `InMemoryOpeningStockImportStore`. For Prisma, instantiate `PrismaOpeningStockImportStore(prisma)`.

- [ ] **Step 6: Register bounded multipart and import services**

Register the plugin once:

```ts
void app.register(multipart, {
  limits: { files: 1, fields: 3, parts: 4, fieldSize: 4096, fileSize: 5 * 1024 * 1024 },
});
```

Instantiate `ExcelOpeningStockWorkbookParser`, `OpeningStockPreviewTokenService(config.sessionSecret)` and `OpeningStockImportService`, passing the already-constructed `periodStore` into the application service. Do not read or print the environment value outside the existing config path.

- [ ] **Step 7: Implement status, preview, commit and retired handlers**

Consume multipart parts fully and reject multiple/missing files, duplicate fields, unknown fields, preview requests with any scalar field, or commit requests missing any of `previewToken`/`financeReviewer`/`confirmed`. Derive `safeFileName = basename(filename).replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 255)`, and require `extname(safeFileName).toLowerCase() === ".xlsx"`. Pass only Buffer/name/scalar fields to the service. Wrap commit in `withAdminMutationAudit` using:

```ts
{
  action: "OPENING_STOCK_IMPORTED",
  entityType: "OPENING_STOCK_IMPORT",
  getEntityId: ({ result, request }) => result?.id ?? request.id,
  getAfterData: ({ result }) => result,
}
```

Return 200 for readable previews, 201 for commit, 410 for the retired single-row route, and let `BusinessRuleError`/multipart errors map to 400/409/413.

- [ ] **Step 8: Run routes, audit, bootstrap and typecheck**

```powershell
corepack pnpm test -- tests/integration/inventory/opening-stock-import-routes.test.ts tests/integration/admin/admin-audit.test.ts tests/integration/bootstrap.test.ts tests/integration/inventory/opening-stock.test.ts
corepack pnpm --filter @warehouse/api typecheck
```

Expected: PASS. The service-level legacy opening-stock tests may remain because they test internal transaction behavior; only HTTP single-row writing is retired.

- [ ] **Step 9: Commit the HTTP boundary**

```powershell
git add -- apps/api/package.json pnpm-lock.yaml apps/api/src/infrastructure/db/runtime.ts apps/api/src/routes/admin/opening-stock-import.ts apps/api/src/routes/admin/opening-stock.ts apps/api/src/server.ts tests/helpers/multipart.ts tests/integration/inventory/opening-stock-import-routes.test.ts tests/integration/admin/admin-audit.test.ts
git commit -m "feat: expose opening stock import workflow"
```

---

### Task 9: Status-driven desktop import page

**Files:**
- Create: `apps/web/src/features/opening-stock/opening-stock-import.ts`
- Replace: `apps/web/src/pages/OpeningStockPage.tsx`
- Modify: `apps/web/src/styles.css`
- Create: `tests/unit/web/opening-stock-import.test.ts`
- Create: `tests/e2e/admin/opening-stock-import.spec.ts`

**Interfaces:**
- Produces: `canCommitOpeningStockImport()`, typed preview/status/result models and the complete desktop UI.
- Consumes: Task 8 endpoints; no client-side Excel parser.

- [ ] **Step 1: Write failing pure UI-state tests**

```ts
const previewFixture = (overrides: Partial<OpeningStockImportPreview> = {}): OpeningStockImportPreview => ({
  canCommit: true,
  previewToken: "signed-preview",
  previewExpiresAt: "2026-08-24T08:30:00.000Z",
  fileSha256: "a".repeat(64),
  baselineDate: "2026-08-24",
  summary: { itemCount: 81, newItemCount: 81, existingItemCount: 0, inventoryRowCount: 243, positiveRowCount: 1, zeroRowCount: 242, totalQuantity: "2", totalAmount: "20.00" },
  issues: [],
  rows: [],
  ...overrides,
});

it("enables commit only for a valid unexpired preview and joint review", () => {
  expect(canCommitOpeningStockImport({
    preview: previewFixture({ previewExpiresAt: "2026-08-24T08:30:00.000Z" }),
    fileMatchesPreview: true,
    financeReviewer: "财务甲",
    confirmed: true,
    now: new Date("2026-08-24T08:10:00.000Z"),
  })).toBe(true);
});

it.each([
  ["errors", previewFixture({ canCommit: false })],
  ["missing token", previewFixture({ previewToken: undefined })],
  ["expired", previewFixture({ previewExpiresAt: "2026-08-24T07:59:59.000Z" })],
])("disables commit for %s", (_label, preview) => {
  expect(canCommitOpeningStockImport({ preview, fileMatchesPreview: true, financeReviewer: "财务甲", confirmed: true, now: new Date("2026-08-24T08:00:00.000Z") })).toBe(false);
});
```

Add these exact pure-state assertions:

```ts
it.each([
  ["blank reviewer", { fileMatchesPreview: true, financeReviewer: "   ", confirmed: true }],
  ["unchecked confirmation", { fileMatchesPreview: true, financeReviewer: "财务甲", confirmed: false }],
  ["changed File object", { fileMatchesPreview: false, financeReviewer: "财务甲", confirmed: true }],
])("disables commit for %s", (_label, input) => {
  expect(canCommitOpeningStockImport({ preview: previewFixture(), ...input, now: new Date("2026-08-24T08:00:00.000Z") })).toBe(false);
});

it("filters issues by severity without mutating their order", () => {
  const issues: OpeningStockImportIssue[] = [
    { severity: "WARNING", code: "W", message: "提醒" },
    { severity: "ERROR", code: "E", message: "错误" },
  ];
  expect(filterOpeningStockIssues(issues, "ERROR")).toEqual([issues[1]]);
  expect(filterOpeningStockIssues(issues, "WARNING")).toEqual([issues[0]]);
  expect(filterOpeningStockIssues(issues, "ALL")).toEqual(issues);
  expect(issues.map(({ code }) => code)).toEqual(["W", "E"]);
});
```

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm test -- tests/unit/web/opening-stock-import.test.ts
```

Expected: FAIL because the feature helper does not exist.

- [ ] **Step 3: Implement typed UI helpers**

Define response types exactly matching Task 8 and implement `canCommitOpeningStockImport()` as a pure conjunction over `preview.canCommit`, token, expiry, `fileMatchesPreview`, trimmed reviewer and confirmation. Export `filterOpeningStockIssues(issues, "ALL" | "ERROR" | "WARNING")` without mutating input. The browser must not hash or parse the file; the server remains responsible for SHA-256 verification.

- [ ] **Step 4: Write a failing browser test against the old manual page**

Define a concrete invalid preview fixture and test the first visible behavior before replacing the page:

```ts
const invalidPreviewFixture = {
  canCommit: false,
  fileSha256: "a".repeat(64),
  baselineDate: "2026-08-24",
  summary: { itemCount: 81, newItemCount: 81, existingItemCount: 0, inventoryRowCount: 243, positiveRowCount: 1, zeroRowCount: 242, totalQuantity: "2", totalAmount: "20.00" },
  issues: [{ severity: "ERROR", code: "QUANTITY_REQUIRED", sheet: "期初库存", row: 3, field: "实盘数量", message: "实盘数量未填写" }],
  rows: [],
};

test("shows row errors and keeps formal import disabled", async ({ page }) => {
  await page.route(apiUrl("/admin/opening-stock/import/status"), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ availability: "AVAILABLE" }) }));
  await page.route(apiUrl("/admin/opening-stock/import/preview"), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(invalidPreviewFixture) }));
  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fopening-stock"));
  await page.setInputFiles('input[type="file"]', { name: "期初库存.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("fixture") });
  await page.getByRole("button", { name: "预览校验" }).click();
  await expect(page.getByText("期初库存 · 第 3 行 · 实盘数量")).toBeVisible();
  await expect(page.getByRole("button", { name: "正式导入" })).toBeDisabled();
});
```

- [ ] **Step 5: Run the browser test and confirm the expected failure**

```powershell
corepack pnpm exec playwright test tests/e2e/admin/opening-stock-import.spec.ts
```

Expected: FAIL because the old page has no file input or preview workflow.

- [ ] **Step 6: Replace the manual page with status-driven UI**

The component state must include:

```ts
const [status, setStatus] = useState<OpeningStockImportStatus | null>(null);
const [file, setFile] = useState<File | null>(null);
const [previewFile, setPreviewFile] = useState<File | null>(null);
const [preview, setPreview] = useState<OpeningStockImportPreview | null>(null);
const [financeReviewer, setFinanceReviewer] = useState("");
const [confirmed, setConfirmed] = useState(false);
const [issueFilter, setIssueFilter] = useState<"ALL" | "ERROR" | "WARNING">("ALL");
const [busy, setBusy] = useState<"status" | "preview" | "commit" | null>("status");
const [error, setError] = useState<string | null>(null);
```

On mount, fetch status. On file change, clear `preview`, `previewFile` and confirmation. After a successful preview set `previewFile` to the exact selected `File` object; enable commit only while `file === previewFile`. When a preview has `previewExpiresAt`, schedule a cleanup-safe timeout for that instant so the component rerenders and disables the button even if the user makes no further input; recompute the gate with a fresh `new Date()` again inside the submit handler. Preview and commit must each build `FormData` and send that original `File` with `credentials: "include"`; commit adds `previewToken`, trimmed reviewer and `confirmed=true`. Never read the workbook with `FileReader`, `arrayBuffer()` or a browser Excel package.

Render:

- upload panel and template constraints for `AVAILABLE`;
- seven summary cards after preview;
- severity filter and accessible issue list containing sheet/row/field;
- a horizontally scrollable 243-row table with quantity, unit cost, amount, remark and write/skip/invalid status;
- finance reviewer plus checkbox and disabled-state explanation;
- immutable summary for `COMPLETED`;
- no form for `BLOCKED_BY_ACTIVITY`;
- `role="alert"` for failures and `role="status"` for success/loading.

Preserve file, preview, reviewer and checkbox after commit errors; replace status with completed result only after HTTP 201.

- [ ] **Step 7: Add scoped desktop styles**

Add `.opening-import-*` classes for a two-column summary grid, orange/green/red issue pills, bounded issue panel, scrollable preview table, confirmation panel and completed summary. Do not alter existing mobile breakpoints or the global desktop-only route gate.

- [ ] **Step 8: Run UI tests, browser test, web typecheck and build**

```powershell
corepack pnpm test -- tests/unit/web/opening-stock-import.test.ts
corepack pnpm exec playwright test tests/e2e/admin/opening-stock-import.spec.ts
corepack pnpm --filter @warehouse/web typecheck
corepack pnpm --filter @warehouse/web build
```

Expected: PASS.

- [ ] **Step 9: Commit the desktop UI**

```powershell
git add -- apps/web/src/features/opening-stock/opening-stock-import.ts apps/web/src/pages/OpeningStockPage.tsx apps/web/src/styles.css tests/unit/web/opening-stock-import.test.ts tests/e2e/admin/opening-stock-import.spec.ts
git commit -m "feat: add opening stock import page"
```

---

### Task 10: Browser acceptance and compatibility regression

**Files:**
- Modify: `tests/e2e/admin/opening-stock-import.spec.ts`
- Modify: `tests/e2e/mobile/desktop-only-routes.spec.ts`
- Modify: `tests/e2e/mobile/mobile-viewport-matrix.spec.ts`
- Modify: `tests/deployment/production-config.test.ts` only if package/runtime assertions require the new plugin.

**Interfaces:**
- Produces: browser proof for upload/preview/confirmation/failure/completion and retained mobile isolation.
- Consumes: Task 9 UI and Task 8 API shape.

- [ ] **Step 1: Extend Playwright coverage for commit failure and completion**

```ts
const validPreviewFixture = {
  canCommit: true,
  previewToken: "signed-preview",
  previewExpiresAt: "2099-08-24T08:30:00.000Z",
  fileSha256: "a".repeat(64),
  baselineDate: "2026-08-24",
  summary: { itemCount: 81, newItemCount: 81, existingItemCount: 0, inventoryRowCount: 243, positiveRowCount: 1, zeroRowCount: 242, totalQuantity: "2", totalAmount: "20.00" },
  issues: [],
  rows: [
    { sheetRow: 2, warehouseCode: "WH-01", itemCode: "BJ0001", itemName: "测试物品 BJ0001", batchNo: "OPEN-20260824-WH01-BJ0001", quantity: "2", unitCost: "10", amount: "20.00", disposition: "IMPORT" },
    { sheetRow: 3, warehouseCode: "WH-02", itemCode: "BJ0001", itemName: "测试物品 BJ0001", batchNo: "OPEN-20260824-WH02-BJ0001", quantity: "0", unitCost: "0", amount: "0.00", disposition: "SKIP_ZERO" },
  ],
};

test("preserves reviewer and confirmation when commit returns a conflict", async ({ page }) => {
  await page.route(apiUrl("/admin/opening-stock/import/status"), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ availability: "AVAILABLE" }) }));
  await page.route(apiUrl("/admin/opening-stock/import/preview"), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(validPreviewFixture) }));
  await page.route(apiUrl("/admin/opening-stock/import/commit"), (route) => {
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data; boundary=");
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "期初库存文件或系统状态已变化，请重新预览" }) });
  });
  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fopening-stock"));
  await page.setInputFiles('input[type="file"]', { name: "期初库存.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("fixture") });
  await page.getByRole("button", { name: "预览校验" }).click();
  await page.getByLabel("财务复核人").fill("财务甲");
  await page.getByRole("checkbox", { name: "已与财务共同核对" }).check();
  await page.getByRole("button", { name: "正式导入" }).click();
  await expect(page.getByRole("alert")).toContainText("系统状态已变化");
  await expect(page.getByLabel("财务复核人")).toHaveValue("财务甲");
  await expect(page.getByRole("checkbox", { name: "已与财务共同核对" })).toBeChecked();
});

test("switches to the immutable completed summary after HTTP 201", async ({ page }) => {
  await page.route(apiUrl("/admin/opening-stock/import/status"), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ availability: "AVAILABLE" }) }));
  await page.route(apiUrl("/admin/opening-stock/import/preview"), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(validPreviewFixture) }));
  await page.route(apiUrl("/admin/opening-stock/import/commit"), (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "INITIAL_OPENING_STOCK", fileSha256: "a".repeat(64), sourceFileName: "期初库存.xlsx", baselineDate: "2026-08-24", operatorId: "local-admin", financeReviewer: "财务甲", itemCount: 81, createdItemCount: 81, inventoryRowCount: 243, positiveRowCount: 1, zeroRowCount: 242, totalQuantity: "2", totalAmount: "20.00", importedAt: "2026-08-24T08:05:00.000Z" }) }));
  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fopening-stock"));
  await page.setInputFiles('input[type="file"]', { name: "期初库存.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("fixture") });
  await page.getByRole("button", { name: "预览校验" }).click();
  await expect(page.getByText("81", { exact: true }).first()).toBeVisible();
  await page.getByLabel("财务复核人").fill("财务甲");
  await page.getByRole("checkbox", { name: "已与财务共同核对" }).check();
  await page.getByRole("button", { name: "正式导入" }).click();
  await expect(page.getByText("INITIAL_OPENING_STOCK")).toBeVisible();
  await expect(page.getByText("后续差错请通过盘点调整处理")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("hides upload controls when inventory activity already blocks initialization", async ({ page }) => {
  await page.route(apiUrl("/admin/opening-stock/import/status"), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ availability: "BLOCKED_BY_ACTIVITY" }) }));
  await page.goto(apiUrl("/auth/local?returnTo=%2Fadmin%2Fopening-stock"));
  await expect(page.getByText("已有库存业务，不能再初始化期初库存")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});
```

In the first valid-preview test, assert all seven summary labels and values (`物品 81`, `新建 81`, `已有 0`, `盘点 243`, `写入 1`, `零库存 242`, `总金额 20.00`) before enabling the reviewer controls.

- [ ] **Step 2: Add explicit mobile no-request coverage**

At a `390 × 844` viewport, route `/admin/opening-stock/import/**` to a counter, navigate to `/admin/opening-stock`, assert the existing “请在电脑端处理” notice, no file input, and zero import API requests. Keep the existing `821px+` desktop route assertion.

- [ ] **Step 3: Run the extended acceptance and compatibility tests**

```powershell
corepack pnpm exec playwright test tests/e2e/admin/opening-stock-import.spec.ts tests/e2e/mobile/desktop-only-routes.spec.ts tests/e2e/mobile/mobile-viewport-matrix.spec.ts
```

Expected: PASS when Task 9 meets the accepted UI contract. If an assertion fails, preserve the failing evidence and correct only that selector, state transition or mobile request leak.

- [ ] **Step 4: Make only targeted accessibility/selector/state fixes**

Adjust the page to expose stable accessible names, row locations, busy states and disabled explanations required by the tests. Do not broaden mobile behavior or add client-side parsing.

- [ ] **Step 5: Rerun focused E2E and compatibility tests**

```powershell
corepack pnpm exec playwright test tests/e2e/admin/opening-stock-import.spec.ts tests/e2e/mobile/desktop-only-routes.spec.ts tests/e2e/mobile/mobile-viewport-matrix.spec.ts
corepack pnpm test -- tests/deployment/production-config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit browser acceptance**

```powershell
git add -- tests/e2e/admin/opening-stock-import.spec.ts tests/e2e/mobile/desktop-only-routes.spec.ts tests/e2e/mobile/mobile-viewport-matrix.spec.ts apps/web/src/pages/OpeningStockPage.tsx apps/web/src/styles.css tests/deployment/production-config.test.ts
git commit -m "test: cover opening stock import acceptance"
```

If `tests/deployment/production-config.test.ts` is unchanged, omit it from `git add` rather than creating a no-op edit.

---

### Task 11: Documentation, full verification and review gate

**Files:**
- Modify: `docs/superpowers/specs/2026-08-24-initial-inventory-excel-template-design.md`
- Modify: `README.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `docs/项目状态与发布交接.md`

**Interfaces:**
- Produces: an implementation handoff that clearly separates local readiness from production import/deployment.
- Consumes: all implementation and test evidence from Tasks 1–10.

- [ ] **Step 1: Update the template contract wording**

Replace the earlier two-sheet read statement with this meaning:

```text
系统读取“填写说明!B6”作为盘点基准日期，并读取“物品资料”和“期初库存”作为业务数据；仓库清单和核对汇总仅供人工辅助审核。服务端重新计算批次、金额和校验状态，不信任公式缓存。
```

- [ ] **Step 2: Update README and handoff facts without claiming deployment**

Record all of these verified behaviors:

- admin-only 5 MB `.xlsx` preview and one-time commit;
- 81-item/243-row fixed contract;
- zero rows validated but skipped;
- missing items and positive inventory committed atomically;
- baseline date accounting and finance reviewer audit;
- old single-row HTTP endpoint retired;
- feature is local code only until a separately authorized production release and real-data import.

In `PROJECT_STATUS.md` and the handoff, move “Excel 预览/整批事务导入功能开发” from not-started to locally completed only after all tests pass. Keep “真实盘点填写、财务复核、生产数据库导入和部署” explicitly pending.

- [ ] **Step 3: Run fresh focused verification**

```powershell
corepack pnpm test -- tests/unit/inventory/opening-stock-workbook-parser.test.ts tests/unit/inventory/opening-stock-preview-token-service.test.ts tests/integration/inventory/opening-stock-import-service.test.ts tests/integration/inventory/in-memory-opening-stock-import-store.test.ts tests/integration/inventory/opening-stock-import-routes.test.ts tests/unit/web/opening-stock-import.test.ts
corepack pnpm exec playwright test tests/e2e/admin/opening-stock-import.spec.ts tests/e2e/mobile/desktop-only-routes.spec.ts tests/e2e/mobile/mobile-viewport-matrix.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run the repository-wide quality gate**

Invoke `superpowers:verification-before-completion`, then run:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

If `TEST_DATABASE_URL` is available, also run:

```powershell
corepack pnpm test -- tests/integration/inventory/prisma-opening-stock-import.test.ts tests/integration/db/prisma-restart-persistence.test.ts
```

Expected: all commands PASS. If PostgreSQL is unavailable, report the explicit skipped suites and do not claim fresh real-PostgreSQL proof.

- [ ] **Step 5: Request code review and resolve findings**

Invoke `superpowers:requesting-code-review` against the design spec and the diff since commit `5e71b66`. For every finding, invoke `superpowers:receiving-code-review`, reproduce or verify it, add a failing regression test when behavior changes, implement the smallest correction, and rerun the affected focused gate.

- [ ] **Step 6: Commit documentation and any reviewed corrections**

```powershell
git add -- README.md PROJECT_STATUS.md 'docs/项目状态与发布交接.md' docs/superpowers/specs/2026-08-24-initial-inventory-excel-template-design.md
git commit -m "docs: record opening stock import readiness"
```

If review corrections changed implementation files after their prior task commits, stage those exact files in a separate `fix: address opening stock import review` commit before the documentation commit.

- [ ] **Step 7: Confirm the final local boundary**

Run:

```powershell
git status --short
git log -n 12 --oneline
```

Expected: no new task-owned unstaged changes; pre-existing user-owned untracked files remain untouched. Report that implementation is locally verified, while actual workbook completion, production database import and deployment still require explicit user authorization.
