# Production Readiness Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every automatable production-readiness gap, preserve an evidence trail, and identify only the business inputs that cannot be inferred safely.

**Architecture:** Use the existing production deployment, admin HTTP routes, WeCom administration page, database read-only checks, and deployment scripts. Keep approval synchronization idempotent and stop before any actual outbound transaction or unsupported inventory initialization.

**Tech Stack:** TypeScript, Vitest, Docker Compose, PostgreSQL 16, systemd, WeCom Approval API, ExcelJS.

**Spec:** `PROJECT_STATUS.md`

## Global Constraints

- Never print or commit production secrets, session tokens, callback tokens, or EncodingAESKey values.
- Preserve unrelated working-tree changes and the existing stash.
- Do not execute an actual outbound transaction while validating approval synchronization.
- Do not import opening stock until the fixed 81-item/243-row workbook passes preview and a named finance reviewer has confirmed the real quantities and costs.
- Every production mutation must be followed by a focused database or service-state verification.

---

### Task 1: Audit the opening-stock workbook

**Files:**
- Read: `D:/桌面/仓库/outputs/warehouse-initial-import-template/集团仓库期初数据导入模板.xlsx`
- Read: `apps/api/src/infrastructure/import/excel-opening-stock-workbook-parser.ts`

**Interfaces:**
- Consumes: the fixed five-sheet Excel contract.
- Produces: parser issue counts and an explicit list of human-owned missing inputs.

- [x] Run the production parser locally against the current workbook.
- [x] Verify the baseline date, 81 item rows, 243 inventory combinations, quantities, costs, and authoritative-column rules.
- [x] Do not upload or commit the workbook when blocking parser errors remain.

**Evidence:** 81 item rows exist, but only 204 of 243 warehouse/item combinations are present; 223 quantities remain blank. `WH-01 + BJ0008` lacks a confirmed unit cost, `WP0010` has an invalid category, duplicate names and the baseline date require human confirmation. Production import remains blocked.

### Task 2: Correct the acceptance item unit and resynchronize

**Files:**
- Read: `apps/api/src/routes/admin/items.ts`
- Read: `apps/api/src/infrastructure/db/prisma-approval-sync-store.ts`

**Interfaces:**
- Consumes: existing item `ACCEPT-61AD5B0-01` and approval `202609010007`.
- Produces: item unit `件` and the same pending approval line updated idempotently.

- [x] Read the existing item through the authenticated internal admin API.
- [x] PATCH only its unit to `件`, preserving all other fields.
- [x] Re-run approval `202609010007` synchronization.
- [x] Verify one approval line, unit `件`, `PENDING_OUTBOUND`, zero outbound orders, and zero outbound ledger rows.

**Evidence:** Approval `202609010007` is `APPROVED/PENDING_OUTBOUND`; the single line uses unit `件`, with `OUTBOUND_COUNT=0` and `LEDGER_COUNT=0`.

### Task 3: Enable WeCom automatic approval callbacks

**Files:**
- Read: `README.md`
- Read: `apps/api/src/routes/wecom/approval-callback.ts`

**Interfaces:**
- Consumes: the existing WeCom built-in Approval API settings and production callback endpoint.
- Produces: callback notification enabled for the `招待品领用` template.

- [x] Inspect the WeCom Approval API callback-template settings.
- [ ] Immediately before the notification subscription is saved, obtain the browser-required action-time confirmation.
- [ ] Select only `招待品领用`, save, and verify the saved state.
- [ ] Verify the production callback endpoint remains reachable without exposing callback credentials.

### Task 4: Install and verify automatic database backups

**Files:**
- Create: `deploy/systemd/warehouse-backup.service`
- Create: `deploy/systemd/warehouse-backup.timer`
- Modify: `tests/deployment/production-config.test.ts`

**Interfaces:**
- Consumes: `deploy/scripts/backup.sh` and `/opt/beikexiang-warehouse`.
- Produces: a persistent daily 02:30 systemd timer and a fresh scheduled backup with manifest.

- [x] Run `pnpm exec vitest run tests/deployment/production-config.test.ts` and verify the systemd contract passes.
- [x] Commit the unit files and contract test without including unrelated changes.
- [x] Deploy the exact commit with the standard backup/build/health workflow.
- [x] Install and enable the timer, then verify `systemctl is-enabled` and `systemctl list-timers`.
- [x] Start the oneshot service once and verify a new non-empty backup plus manifest.
- [x] Validate the backup gzip stream and SQL header; do not overwrite the production database.

**Evidence:** Commit `ae4bd80ef66445d9da0c44e0dfd2fc1b1ec5465f` is deployed as `20260901T090016Z-ae4bd80ef664-3056372`. The timer is active in `Asia/Shanghai`; backup `warehouse-20260901T092006Z-3074723.sql.gz` and its manifest are non-empty, `root:root 600`, and pass gzip/SHA-256 validation. An isolated restore drill is intentionally separate and still requires action-time confirmation.

### Task 5: Refresh repository and readiness evidence

**Files:**
- Modify: `PROJECT_STATUS.md`
- Modify: `docs/项目状态与发布交接.md`

**Interfaces:**
- Consumes: verified production release, approval synchronization, callback setting, backup timer, and workbook audit.
- Produces: current, non-stale operational handoff.

- [x] Record exact completed evidence and remaining human-owned business inputs.
- [x] Run focused tests, type checks, build, `git diff --check`, production health, and database state checks.
- [x] Commit and push the closeout documentation and implementation branch.

**Evidence:** Vitest passed 362 tests with 25 environment-gated skips; Chromium E2E passed 140/140. Lint, type checking, production build, and `git diff --check` passed. Public production health returned HTTP 200, and database checks confirmed the approved request remains `PENDING_OUTBOUND` with zero outbound and ledger records. Branch `codex/production-readiness` is pushed to origin; integration into protected branch `feat/warehouse-system` must proceed through CI-only PR checks.
