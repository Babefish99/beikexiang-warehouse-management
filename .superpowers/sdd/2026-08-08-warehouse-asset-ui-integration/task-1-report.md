# Task 1 Report — Warehouse report filtering

## Files changed

- `apps/api/src/application/reports/report-query-service.ts`
- `apps/api/src/routes/admin/reports.ts`
- `tests/unit/reports/report-query.test.ts`

## RED

Command:

```bash
corepack pnpm vitest run tests/unit/reports/report-query.test.ts
```

Output:

```text
 RUN  v3.2.7  D:/桌面/仓库

 ❯ tests/unit/reports/report-query.test.ts (6 tests | 2 failed) 73ms
   ✓ inventory report queries > keeps quantity and amount separate and calculates month-end balances cumulatively 11ms
   × inventory report queries > filters month-end summary to one warehouse 28ms
     → expected [ { itemId: 'item-1', …(2) } ] to deeply equal [ { itemId: 'item-1', …(2) } ]
   ✓ inventory report queries > keeps transfer, return, and adjustment rows separately 18ms
   ✓ inventory report queries > returns all transaction groups with quantity and amount columns for the selected period 4ms
   × inventory report queries > filters transactions to one warehouse without changing the default query 8ms
     → expected [ Array(2) ] to deeply equal [ ObjectContaining{…} ]
   ✓ inventory report queries > keeps transaction details filtered to the requested month 2ms

 Test Files 1 failed (1)
      Tests 2 failed | 4 passed (6)
   Start at 11:33:53
   Duration 2.29s (transform 174ms, setup 0ms, collect 193ms, tests 73ms, environment 1ms, prepare 487ms)
```

## GREEN

Command:

```bash
corepack pnpm vitest run tests/unit/reports/report-query.test.ts
```

Output:

```text
 RUN  v3.2.7  D:/桌面/仓库

 ✓ tests/unit/reports/report-query.test.ts (6 tests) 28ms

 Test Files 1 passed (1)
      Tests 6 passed (6)
   Start at 11:34:38
   Duration 1.32s (transform 129ms, setup 0ms, collect 157ms, tests 28ms, environment 0ms, prepare 370ms)
```

## GREEN integration verification

Command:

```bash
corepack pnpm vitest run tests/unit/reports/report-query.test.ts tests/integration/reports/excel-export.test.ts
```

Output:

```text
 RUN  v3.2.7  D:/桌面/仓库

 ✓ tests/unit/reports/report-query.test.ts (6 tests) 35ms
stdout | tests/integration/reports/excel-export.test.ts
[dotenv@16.6.0] injecting env (14) from .env

 ✓ tests/integration/reports/excel-export.test.ts (3 tests) 474ms
   ✓ report export integration > wires the report summary to the current in-memory stock ledger 354ms

 Test Files 2 passed (2)
      Tests 9 passed (9)
   Start at 11:34:55
   Duration 3.13s (transform 704ms, setup 0ms, collect 1.75s, tests 509ms, environment 1ms, prepare 668ms)
```

## Self-review

- Added a single warehouse-matching predicate that treats `undefined`, empty, and `all` as no filter.
- Applied warehouse filtering before period/type filtering in the report services.
- Passed `warehouseId` through the summary, transactions, and export routes.
- Kept the default no-warehouse behavior unchanged.
- Preserved the existing export filename and all current integration assertions.

## Concerns

- None for this slice.
- Unrelated UI work in the working tree was left untouched.
