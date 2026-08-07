# Admin Audit And HTTP Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared `/admin` mutation audit coverage and correct 4xx JSON business error semantics without changing Prisma schema or shared inventory state.

**Architecture:** Route registration for `/admin` mutations will move through a shared helper that records audit success/failure with sanitized payloads. A global admin error handler will classify known business failures into 400/404 while preserving 500 for unknown faults.

**Tech Stack:** Fastify, TypeScript, Vitest, Playwright, Prisma runtime adapter

## Global Constraints

- Do not modify Prisma schema.
- Do not modify the shared inventory memory state shape.
- Cover `/admin` POST/PATCH/PUT/DELETE routes for items, warehouses, inbound, opening-stock, outbound confirm/cancel, transfers, returns, stocktake, period-close, and approval resync.
- Return admin business validation and not-found failures as JSON `{ error: message }`.
- Keep unknown errors as 500.
- Run full unit/integration/e2e, typecheck/build, and `git diff --check` before completion.

---

### Task 1: Write red tests for admin audit and 4xx semantics

**Files:**
- Modify: `tests/integration/master-data-routes.test.ts`
- Modify: `tests/integration/inventory/master-data-validation.test.ts`
- Modify: `tests/integration/inventory/outbound-service.test.ts`
- Modify: `tests/integration/inventory/stocktake-close.test.ts`
- Create: `tests/integration/admin/admin-audit.test.ts`

**Interfaces:**
- Consumes: `buildServer(): FastifyInstance`
- Produces: failing tests that expect audit metadata and `{ error }` admin business failures

- [ ] **Step 1: Write failing integration tests**

```ts
expect(response.statusCode).toBe(400);
expect(response.json()).toEqual({ error: "warehouse is inactive or not found" });

expect(audit.events).toContainEqual(expect.objectContaining({
  actorUserId: expect.any(String),
  actorRole: "ADMIN",
  action: "ITEM_CREATED",
  entityType: "ITEM",
  entityId: expect.any(String),
  requestId: expect.any(String),
  status: "SUCCEEDED",
}));
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `corepack pnpm vitest run tests/integration/master-data-routes.test.ts tests/integration/inventory/master-data-validation.test.ts tests/integration/inventory/outbound-service.test.ts tests/integration/inventory/stocktake-close.test.ts tests/integration/admin/admin-audit.test.ts`

Expected: FAIL because admin routes still return 500 and no admin mutation audit helper exists

### Task 2: Implement shared admin audit types and helper

**Files:**
- Modify: `apps/api/src/infrastructure/audit/audit-service.ts`
- Create: `apps/api/src/routes/admin/admin-mutation-route.ts`
- Create: `apps/api/src/routes/admin/admin-request-context.ts`

**Interfaces:**
- Consumes: `AuditService.record(event)`
- Produces: `registerAdminMutationRoute(app, options)` and `getAdminRequestActor(request)`

- [ ] **Step 1: Write the failing unit coverage for audit payload shape if needed**

```ts
await service.record({
  actorUserId: "u-1",
  actorRole: "ADMIN",
  action: "ITEM_CREATED",
  entityType: "ITEM",
  entityId: "item-1",
  requestId: "req-1",
  occurredAt: "2026-08-07T00:00:00.000Z",
  status: "SUCCEEDED",
  afterData: { secret: "hidden", visible: true },
});
```

- [ ] **Step 2: Run the audit unit test to verify it fails if new fields are asserted**

Run: `corepack pnpm vitest run tests/unit/auth/audit-service.test.ts`

Expected: FAIL until the audit event shape and storage are expanded

- [ ] **Step 3: Implement minimal shared audit event shape and mutation helper**

```ts
registerAdminMutationRoute(app, {
  method: "POST",
  url: "/admin/items",
  action: "ITEM_CREATED",
  entityType: "ITEM",
  handler: async (request, reply) => reply.code(201).send(await itemService.create(request.body)),
  getEntityId: ({ result }) => result.id,
  getAfterData: ({ result }) => result,
});
```

- [ ] **Step 4: Run focused audit tests to verify they pass**

Run: `corepack pnpm vitest run tests/unit/auth/audit-service.test.ts tests/integration/admin/admin-audit.test.ts`

Expected: PASS

### Task 3: Implement global admin error handler and migrate admin mutation routes

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/admin/items.ts`
- Modify: `apps/api/src/routes/admin/warehouses.ts`
- Modify: `apps/api/src/routes/admin/inbound.ts`
- Modify: `apps/api/src/routes/admin/opening-stock.ts`
- Modify: `apps/api/src/routes/admin/outbound.ts`
- Modify: `apps/api/src/routes/admin/transfers.ts`
- Modify: `apps/api/src/routes/admin/returns.ts`
- Modify: `apps/api/src/routes/admin/stocktake.ts`
- Modify: `apps/api/src/routes/admin/period-close.ts`
- Modify: `apps/api/src/routes/admin/approvals-resync.ts`
- Create: `apps/api/src/application/errors/business-rule-error.ts`

**Interfaces:**
- Consumes: existing admin services and new route helper
- Produces: consistent admin mutation registration plus admin-only `{ error }` error mapping

- [ ] **Step 1: Add failing assertions for `{ error }` on known admin business errors**

```ts
expect(rejected.json()).toEqual({ error: "item code cannot change after ledger activity" });
expect(stocktakeResponse.json()).toEqual({ error: "closed period: 2026-08" });
```

- [ ] **Step 2: Run focused integration tests to verify the failures**

Run: `corepack pnpm vitest run tests/integration/master-data-routes.test.ts tests/integration/inventory/master-data-validation.test.ts tests/integration/inventory/outbound-service.test.ts tests/integration/inventory/stocktake-close.test.ts`

Expected: FAIL until the global handler maps known business failures

- [ ] **Step 3: Implement the admin error classifier and migrate routes to the mutation helper**

```ts
app.setErrorHandler((error, request, reply) => {
  if (!request.url.startsWith("/admin")) throw error;
  const classified = classifyAdminError(error);
  if (!classified) return reply.code(500).send({ error: error.message });
  return reply.code(classified.statusCode).send({ error: classified.message });
});
```

- [ ] **Step 4: Run focused integration tests to verify they pass**

Run: `corepack pnpm vitest run tests/integration/master-data-routes.test.ts tests/integration/inventory/master-data-validation.test.ts tests/integration/inventory/outbound-service.test.ts tests/integration/inventory/stocktake-close.test.ts tests/integration/auth/local-auth-routes.test.ts`

Expected: PASS

### Task 4: Verify full suite, write report, and commit

**Files:**
- Create: `docs/superpowers/plans/2026-08-08-warehouse-mvp-audit-report.md`

**Interfaces:**
- Consumes: completed code changes and fresh command outputs
- Produces: final report and one scoped commit

- [ ] **Step 1: Run full verification**

Run: `corepack pnpm test`
Run: `corepack pnpm test:e2e`
Run: `corepack pnpm typecheck`
Run: `corepack pnpm build`
Run: `git diff --check`

Expected: all commands exit 0

- [ ] **Step 2: Write the implementation report with exact verification results**

```md
- Added shared admin mutation audit helper and admin error classifier.
- Verified with unit, integration, e2e, typecheck, build, and git diff --check.
```

- [ ] **Step 3: Commit only the relevant files**

```bash
git add apps/api/src tests docs/superpowers/specs/2026-08-07-admin-audit-and-http-semantics-design.md docs/superpowers/plans/2026-08-07-admin-audit-and-http-semantics.md docs/superpowers/plans/2026-08-08-warehouse-mvp-audit-report.md
git commit -m "fix: audit admin mutations and normalize admin error semantics"
```
