# Task 5 Report

Date of execution: Saturday, August 8, 2026

## DONE

- Added a persistence runtime seam at [apps/api/src/infrastructure/db/runtime.ts](/D:/桌面/仓库/apps/api/src/infrastructure/db/runtime.ts) with:
  - `PERSISTENCE_DRIVER=memory|prisma`
  - startup configuration checks
  - Prisma-backed repository/adapter seam handles for users, warehouses, items, approvals, batches, ledger entries, outbound orders, transfers, returns, stocktakes, periods, and audit logs
  - durable Prisma audit service seam
  - default local development remains runnable with in-memory persistence
- Rewired [apps/api/src/server.ts](/D:/桌面/仓库/apps/api/src/server.ts) to use runtime config and the new persistence seam without claiming a live PostgreSQL production runtime.
- Added a startup guard in [apps/api/src/infrastructure/db/runtime.ts](/D:/桌面/仓库/apps/api/src/infrastructure/db/runtime.ts): `PERSISTENCE_DRIVER=prisma` now fails fast with an explicit error because the core inventory flows are not all durably wired. A fake Prisma `/health` service cannot start.
- Hardened local bypass auth in:
  - [apps/api/src/application/auth/local-auth.ts](/D:/桌面/仓库/apps/api/src/application/auth/local-auth.ts)
  - [apps/api/src/routes/auth/local-auth.ts](/D:/桌面/仓库/apps/api/src/routes/auth/local-auth.ts)
  - only non-production
  - only loopback / allowed local hosts
  - explicit dev/test role switching for `ADMIN`, `FINANCE`, `APPLICANT`
- Restored `WarehouseService.listActive()` in [apps/api/src/application/warehouses/warehouse-service.ts](/D:/桌面/仓库/apps/api/src/application/warehouses/warehouse-service.ts) so the existing warehouse selector contract still passes.
- Tightened [prisma/schema.prisma](/D:/桌面/仓库/prisma/schema.prisma):
  - explicit decimal precision for quantity / unit cost / amount
  - approval applicant → user relation
  - restrictive deletes on confirmed/audit-critical relations
  - required `StockAdjustment.stocktake` and `InventoryLedgerEntry.batch` relations with `onDelete: Restrict`
  - stock balance unique scope updated to `warehouseId + itemId + batchId`
- Updated docs/config:
  - [README.md](/D:/桌面/仓库/README.md)
  - [.env.example](/D:/桌面/仓库/.env.example)
  - migration/seed instructions
  - HTTPS Enterprise WeChat callback checklist
  - explicit statement that production Enterprise WeChat connectivity is not claimed here
- Added/updated tests for:
  - runtime config seam
  - db schema contract
  - local auth role/permission integration
  - local auth unit coverage
  - roles e2e

## PARTIALLY COMPLETED

- The repository/adapter seam now exists for all core entities, and item/warehouse/audit are wired into the in-memory server bootstrap.
- Inventory movement / outbound / transfer / return / stocktake / report business flows still run on existing in-memory stores. Because these flows are not all durably wired, `PERSISTENCE_DRIVER=prisma` is deliberately blocked at API startup; it is not a production persistence mode in this delivery.

## BLOCKERS / NOT CLAIMED

- `PERSISTENCE_DRIVER=prisma` is intentionally blocked with `PERSISTENCE_DRIVER=prisma is disabled until all core inventory flows use durable persistence`; no API `/health` endpoint is exposed under a falsely advertised Prisma runtime.
- `corepack pnpm exec prisma db seed` failed with `ECONNREFUSED` on Saturday, August 8, 2026 because this environment does not have a reachable PostgreSQL instance at the configured `DATABASE_URL`.
- I did **not** claim:
  - live PostgreSQL production persistence
  - successful production Prisma migration against a real database
  - live Enterprise WeChat production callback connectivity

## VERIFICATION EVIDENCE

- `corepack pnpm test`
  - PASS
  - 33 passed test files / 125 passed tests
- `corepack pnpm typecheck`
  - PASS
- `corepack pnpm build`
  - PASS
- `corepack pnpm test:e2e --reporter=line tests/e2e/auth/roles.spec.ts`
  - PASS
  - 6 passed
- `corepack pnpm exec prisma validate`
  - PASS
- `corepack pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`
  - PASS
  - SQL diff rendered successfully
  - `StockAdjustment.stocktakeId` and `InventoryLedgerEntry.batchId` are `TEXT NOT NULL`
  - both foreign keys render `ON DELETE RESTRICT`
- `corepack pnpm exec prisma db seed`
  - FAIL
  - `PrismaClientKnownRequestError`
  - `code: 'ECONNREFUSED'`
- `git diff --check`
  - PASS
  - only CRLF conversion warnings, no diff-check whitespace failure

## CHANGED FILES

- [apps/api/src/infrastructure/db/runtime.ts](/D:/桌面/仓库/apps/api/src/infrastructure/db/runtime.ts)
- [apps/api/src/server.ts](/D:/桌面/仓库/apps/api/src/server.ts)
- [apps/api/src/application/auth/local-auth.ts](/D:/桌面/仓库/apps/api/src/application/auth/local-auth.ts)
- [apps/api/src/routes/auth/local-auth.ts](/D:/桌面/仓库/apps/api/src/routes/auth/local-auth.ts)
- [apps/api/src/application/warehouses/warehouse-service.ts](/D:/桌面/仓库/apps/api/src/application/warehouses/warehouse-service.ts)
- [prisma/schema.prisma](/D:/桌面/仓库/prisma/schema.prisma)
- [README.md](/D:/桌面/仓库/README.md)
- [.env.example](/D:/桌面/仓库/.env.example)
- [tests/unit/infrastructure/persistence-runtime.test.ts](/D:/桌面/仓库/tests/unit/infrastructure/persistence-runtime.test.ts)
- [tests/unit/auth/local-auth.test.ts](/D:/桌面/仓库/tests/unit/auth/local-auth.test.ts)
- [tests/integration/auth/local-auth-routes.test.ts](/D:/桌面/仓库/tests/integration/auth/local-auth-routes.test.ts)
- [tests/integration/db-schema.test.ts](/D:/桌面/仓库/tests/integration/db-schema.test.ts)
- [tests/e2e/auth/roles.spec.ts](/D:/桌面/仓库/tests/e2e/auth/roles.spec.ts)

## COMMIT

- Previous Task 5 implementation commit: `9f564457000cc16accd07719801028f13fe60499`
- Reviewer fix commit: `042f7f3f443369df6c46d7bf26fbc51bc460f260`
- Report update commit: follows this reviewer fix commit
