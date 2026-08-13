# Task 6 Report — 移动通知 / 任务中心

## Status

Implemented and verified. The administrator notification surface now uses one live shared task source across the desktop popover, mobile task sheet, and mobile dashboard metrics. Finance retains no notification UI and makes no notification request.

## RED / GREEN evidence

- API RED: `corepack pnpm vitest run tests/unit/inventory/notification-service.test.ts tests/unit/inventory/alert-service.test.ts`
  - Result: exit 1; 2 test files failed, 3 tests failed / 2 passed.
  - Expected failures: low-stock output omitted `itemCode`; pending outbound used `/admin/outbound/pending`; low stock used `/admin/items` instead of the encoded inventory query.
- API GREEN: the same command.
  - Result: exit 0; 2 test files passed, 5 tests passed.
- UI RED: isolated E2E after making Playwright env-aware:
  - Result: exit 1; 3 tests failed.
  - Expected failures: no mobile notification entry/sheet, business-completed produced no second request, and the desktop trigger exposed no task count.
- UI GREEN: `API_BASE_URL=http://127.0.0.1:3301 WEB_BASE_URL=http://127.0.0.1:5474 corepack pnpm playwright test tests/e2e/mobile/notification-tasks.spec.ts`
  - Final grouped mobile result (with shell): exit 0; 12 tests passed.
- Shared-dashboard RED: targeted `dashboard notification metrics` case.
  - Result: exit 1; the API refreshed to zero tasks but the dashboard notification metric remained stale.
- Shared-dashboard GREEN: the same targeted case after subscribing the dashboard to the shared task snapshot.
  - Result: exit 0; 1 test passed.
- Strengthened business-race RED: business completion while the open-triggered refresh was already in flight.
  - Result: exit 1; expected at least 3 requests, received 2.
- Strengthened business-race GREEN: business-completed refresh explicitly supersedes any in-flight refresh and request sequencing discards the late old response.
  - Result in the final grouped mobile run: PASS.

## Permission, cache, and race review

- The service remains protected by the existing server role policy. `NotificationCenter` enables fetching only for `ADMIN`; the finance regression proves zero `/admin/notifications` requests.
- Removed the one-second result cache and AppShell-local unread state. There is one shared external-store snapshot for AppShell, mobile More, and the dashboard.
- Ordinary concurrent reads share one in-flight request. A forced refresh (open, poll, visibility, or business completion) can supersede an ordinary in-flight request. Monotonic request sequencing prevents an older response from overwriting a newer refresh.
- `loadInventoryNotifications()` waits for a newer active refresh before returning, preventing the dashboard from copying an already-superseded response.
- Successful inbound, outbound confirmation, and outbound cancellation announce `warehouse:business-completed` after the server mutation succeeds.

## Mobile / desktop self-review

- Mobile: full-width bottom dialog, readable cards, explicit loading/error/empty states, retry action, 44px minimum controls, encoded real routes, and desktop-only hints for stocktake/period/anomaly.
- Viewport regression covers 320 / 390 / 430 / 820 without document horizontal overflow.
- Desktop keeps the popover interaction and Escape behavior; local “全部已读” was removed because tasks reflect server truth.
- The implementation uses standard browser APIs supported by the enterprise WeChat embedded browser target; no popup-only or unsupported navigation mechanism was introduced.

## Final verification

- `corepack pnpm vitest run tests/unit/inventory/notification-service.test.ts tests/unit/inventory/alert-service.test.ts` — 2 files / 5 tests passed.
- isolated `corepack pnpm playwright test tests/e2e/mobile/notification-tasks.spec.ts tests/e2e/mobile/mobile-shell.spec.ts` — 12 tests passed.
- isolated `corepack pnpm playwright test tests/e2e/navigation/workspace-tools.spec.ts` — 8 tests passed.
- `corepack pnpm typecheck` — API and web passed.
- `git diff --check` — exit 0.

## Commit / concerns / cleanup

- Implementation commit: `94f15cb` (`feat: turn mobile notifications into live tasks`).
- Concern: the requested independent reviewer could not be spawned because all agent slots were occupied. A bounded local diff review found and fixed the stale dashboard notification metric with its own RED/GREEN E2E.
- Ports: pending final cleanup check for isolated 3301 / 5474.

## FixRound1 — identity isolation and desktop popover coordination

### Scope

- Bound every notification-store read, subscription, refresh, and dashboard load to `user.id + role`.
- Identity or enabled-state changes now clear the shared snapshot, increment its generation, detach the previous in-flight request, and prevent late responses from publishing.
- Kept Finance disabled with zero notification fetches and passed the same identity to NotificationCenter, Mobile More, and Dashboard consumers.
- Made the desktop NotificationCenter controlled by AppShell so the bell toggles and warehouse, search, notification, and user popovers remain mutually exclusive. Mobile retains its internal ModalDialog state.

### TDD evidence

- Store RED: the original module-global implementation retained loading/in-flight state across disable and had no identity-aware store API; the final focused RED was 3/3 failing because `createNotificationTaskStore` did not exist.
- Store GREEN: `corepack pnpm vitest run tests/unit/web/notification-tasks.test.ts` — 3/3 passed, covering Admin A late-response invalidation after Finance/disabled, Admin B starting from an empty snapshot, and disabled identities making no request.
- Desktop interaction GREEN: isolated workspace case passed 1/1, covering bell toggle plus warehouse/search/user mutual exclusion.

### FixRound1 verification

- `corepack pnpm vitest run tests/unit/web/notification-tasks.test.ts tests/unit/inventory/notification-service.test.ts tests/unit/inventory/alert-service.test.ts` — 3 files / 8 tests passed.
- isolated mobile notification + shell suite on 3301 / 5474 — 12/12 passed.
- isolated desktop workspace suite on 3301 / 5474 — 9/9 passed.
- `corepack pnpm typecheck` — API and web passed.
- `git diff --check` — exit 0.
