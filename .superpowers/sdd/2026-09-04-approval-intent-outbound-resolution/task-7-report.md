# Task 7 Report: Administrator routes and operational exception visibility

## Status

Implemented the authenticated outbound confirmation contract, sanitized approval synchronization failure reads, unresolved/revocation operational counts, and distinct actionable approval-exception notifications. The Task 8 outbound form/workflow was intentionally not changed.

## Delivered behavior

- `POST /admin/outbound/confirm` accepts `{ approvalId, decisions }`, obtains `operatorId` only from `getAdminRequestActor(request)`, defensively returns 401 when the actor is absent, and rejects the removed flat allocation shape with 400.
- Confirmation business validation maps invalid integer, unit, and approval-line input to 400; already-closed, changed-stock, and concurrent conflicts remain 409. Existing admin authentication continues to provide 401/403.
- Confirmation audit data is built from explicit request/result allowlists. Client-added credentials, callback data, headers, and other unknown fields are not retained.
- `GET /admin/approvals/sync-failures` reads failed attempts newest-first from both memory and Prisma, applies a default limit of 20 and maximum of 100, and returns only `{ weComSpNo, attemptedAt, error }`.
- Only exact, internally defined parser/domain/gateway errors are mapped to Chinese public messages. Every empty or unknown persisted message receives the same generic Chinese fallback. The Prisma query explicitly selects only the three response fields.
- Pending-work/month-close counts include `PENDING_OUTBOUND` and `REAPPLY_REQUIRED` in both persistence modes. `REVOCATION_EXCEPTION` is counted separately and emits `APPROVAL_EXCEPTION` linked to `/admin/outbound`.
- The web client recognizes `APPROVAL_EXCEPTION`, makes it actionable, and displays labels for `REAPPLY_REQUIRED` and `REVOCATION_EXCEPTION`.
- Removed the Task 5 transitional flat confirmation adapter and its `system` actor fallback from `OutboundService`.

## RED evidence

1. Outbound route tests initially reported 5 failures and 23 passes. The failures proved that the route trusted a forged client `operatorId`, lacked an audit allowlist, allowed a missing actor, still accepted the flat allocation request, and mapped unit mismatch to 500.
2. The first Prisma synchronization-failure test failed at module resolution because the query service did not exist.
3. The pending-count, notification, and status-label target set initially reported 4 failures and 45 passes: memory omitted `REAPPLY_REQUIRED`, both new labels fell back to raw status values, and no distinct approval-exception notification was emitted.
4. The shared-memory regression exposed its old flat confirmation fixture (1 failure, 3 passes). The fixture was migrated to decisions after the route contract became green.
5. The first notification E2E update exposed the expected task-count change (1 failure, 10 passes); the assertion was updated from five to six real tasks.

## GREEN and verification evidence

- Brief target command through bundled `pnpm.cmd`, with a disposable real PostgreSQL 16 database: 3 Vitest files, 67/67 tests passed. The repository Vitest include pattern does not collect `tests/e2e/**/*.spec.ts`, so that file was verified with Playwright instead.
- Prisma business-store target against real PostgreSQL: 33/33 passed.
- Broader affected Vitest regression against real PostgreSQL: 12 files, 152/152 passed.
- A valid headless Playwright run of `approval-sync.spec.ts` and `notification-tasks.spec.ts`: 11/11 passed.
- API typecheck: passed. Web typecheck: passed. `git diff --check`: passed (only the repository's LF-to-CRLF notices were printed).
- Final target Vitest and both typechecks were rerun after the final error-classification refinement and passed.

One later Playwright repetition was invalidated by the manually started API missing the test/local-auth environment: server evidence showed `/auth/local` returned 404, so mobile tests remained on the unauthenticated page. That run was aborted, its services were stopped, and it is not treated as product-test evidence. It occurred after only a backend error-regex refinement; the relevant web implementation and tests were unchanged from the valid 11/11 run.

## Security self-review

- Authentication identity crosses the HTTP boundary in one direction only: request context to service. A forged body `operatorId` is ignored, and no `system` fallback remains.
- Global admin authorization still rejects unauthenticated and unauthorized callers before handlers; the confirmation handler also rejects an absent actor defensively.
- Confirmation audits retain only approval/decision/allocation identifiers, quantities, variance reasons, and allowlisted result facts. Credentials and unfiltered external payload fields are excluded.
- Synchronization-failure persistence queries never select callback payloads. Public results contain exactly approval number, attempt time, and sanitized business error text.
- Error projection is default-deny rather than keyword-based: Authorization/Bearer, password, API key, URL, SQL, high-entropy, and ordinary unknown messages all receive the same public fallback. Test fixtures contain synthetic sentinel values only; no real credential values were added to source, tests, this report, or the commit.
- Read limits are positive, bounded, and safe in both service and persistence implementations.
- Memory and Prisma implementations preserve the existing atomic attempt-write paths; the new failure method is read-only.

## Deviations and concerns

- `outbound-service.ts` was changed in addition to the brief's route seam because Task 5 explicitly left the flat adapter and `system` fallback for Task 7 removal.
- `business-rule-error.ts` was changed to map the specific approval-unit mismatch to 400 without broadening unrelated error classification.
- Additional affected tests cover shared-memory route usage, status labels, and mobile notification behavior.
- Until Task 8 migrates the outbound form, its current legacy flat submit shape will receive the intentional 400 response. No Task 8 workflow/UI implementation was modified here.

## Review fix round 1

### RED

- Added a dedicated query-service test before implementation. The allowlisted business mapping and seven unsafe/unknown cases all failed: 8/8 new query assertions were red because the previous keyword denylist returned unrecognized persisted messages verbatim.
- Added nested route validation and failed-audit tests before implementation. Twelve assertions were red: malformed nested values either returned 500 or exposed runtime `TypeError` text in 400 responses. The combined RED run was 20 failed and 29 passed across 49 tests.
- Unsafe query cases cover Authorization/Bearer, password, API key, an internal URL, SQL detail, an unlabelled high-entropy value, and an ordinary unknown upstream error.

### GREEN

- Replaced the denylist with an exact internal-error allowlist mapped to Chinese public messages. Unknown values now fail closed to `审批同步失败，请检查审批内容或同步配置后重试`.
- Added explicit nested parsing for decision/allocation objects, required arrays, non-empty string identifiers and quantity, and optional selected-item/reason types. The route constructs a fresh `OutboundDecisionInput[]` before calling the service.
- The failed-mutation audit test proves a 400 response, a safe validation error, and allowlisted request data only; synthetic password, Authorization, callback, and API-key fields do not appear in the audit event.
- Core route/query GREEN: 2 files, 49/49 passed.
- Real PostgreSQL route/query/sync/notification regression: 5 files, 118/118 passed, including proof that querying leaves the raw historical attempt payload and error unchanged while returning only the safe three-field projection.
- Effective headless Playwright run used an API with local auth enabled (`NODE_ENV=development`, `LOCAL_AUTH_BYPASS=true`) plus an isolated Vite server: 11/11 passed. An intermediate 10/11 run identified only a stale English fallback expectation; it was corrected and the entire set rerun.
- API and web typechecks passed. The disposable PostgreSQL container and both isolated test servers were removed after verification.
