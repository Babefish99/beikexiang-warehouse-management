# Task 7 Report — 企业微信窄屏、焦点、软键盘与桌面回归门禁

## Scope and isolation

- Worktree: `D:\桌面\仓库\.worktrees\mobile-responsive`
- Base: `a7ccdbf1ce44972386991e3c2e97ee2b9b9c1cc3`
- Isolated stack: API `http://127.0.0.1:3301`, Web `http://127.0.0.1:5474`
- API settings: `PERSISTENCE_DRIVER=memory`, `LOCAL_AUTH_BYPASS=true`
- No production database, secret, deployment, main worktree, port `3001/5174`, or push was touched.

## TDD RED

Command:

```powershell
$env:API_BASE_URL='http://127.0.0.1:3301'
$env:WEB_BASE_URL='http://127.0.0.1:5474'
$env:PERSISTENCE_DRIVER='memory'
$env:LOCAL_AUTH_BYPASS='true'
corepack pnpm playwright test tests/e2e/mobile/mobile-viewport-matrix.spec.ts --workers=1
```

Exact result: exit `1`; `9 passed / 2 failed` in `14.8s` (`17.3s` wall time).

Expected product failures:

1. After a failed inbound confirmation, the visible `role="alert"` could not receive focus. Playwright reported `Expected: focused; Received: inactive`.
2. At `390x844` with a WeCom/MicroMessenger UA, some real form controls computed to `14px`, so the `>=16px` anti-zoom contract failed. The generic mobile rule lost to the more-specific `.form-grid` rule.

The other nine new checks passed at RED and therefore characterize already-correct behavior rather than justify production changes.

## Minimal production fixes

- `ModalDialog` now observes newly rendered dialog errors, makes the first `role="alert"` or `aria-invalid="true"` target programmatically focusable when necessary, focuses it, and scrolls it into the nearest visible part of the dialog. The observer is disconnected on close.
- The mobile CSS rule now matches `.form-grid input/select/textarea` at sufficient specificity so WeCom mobile form controls compute to `16px`.

No inventory query race, outbound 409 route behavior, stock allocation logic, or other deferred business logic was changed.

## GREEN and regression evidence

### Focused viewport matrix

Same command as RED. Exact result: exit `0`; `11 passed` in `8.6s`.

### Full mobile E2E

```powershell
corepack pnpm playwright test tests/e2e/mobile --workers=1
```

Initial full result: exit `0`; `47 passed` in `25.7s`. Fresh pre-commit verification: exit `0`; `47 passed` in `29.6s`.

### Desktop navigation and env-aware inbound permission regression

```powershell
corepack pnpm playwright test tests/e2e/navigation/dashboard.spec.ts tests/e2e/navigation/workspace-tools.spec.ts tests/e2e/admin/inbound.spec.ts --workers=1
```

Initial result: exit `0`; `11 passed` in `13.5s`. Fresh pre-commit verification: exit `0`; `11 passed` in `15.1s`.

### Notification/outbound deferred checks

- Notification completion race with a controlled request-release handshake: `1 passed` in `4.5s`.
- Outbound persisted draft scenarios using `webBaseUrl` instead of fixed `5474`: `2 passed` in `5.2s`.

### Build and typecheck

```powershell
corepack pnpm --filter @warehouse/web build
corepack pnpm --filter @warehouse/web typecheck
```

Exact result: exit `0`; initial Vite build transformed `1612` modules in `2.09s`; the fresh pre-commit build transformed `1612` modules in `2.22s`; TypeScript build/typecheck exited `0`. After tightening the error observer to react only to added error nodes, the two Modal matrix tests passed in `5.4s` and a fresh typecheck exited `0`.

## Matrix coverage

| Surface | Coverage and result |
| --- | --- |
| `320x568`, `390x844`, `430x932`, `820x900` | Exactly one mobile navigation tree, desktop sidebar hidden, no document horizontal overflow, fixed bottom navigation aligned to the viewport, content bottom padding clears it, all bottom targets `>=44px`; PASS |
| `821x900` | Mobile navigation unmounted and desktop sidebar visible; PASS |
| `820 -> 821` | Long warehouse/item/batch/purchaser draft remains in the same mounted page state while only the presentation tree switches; PASS |
| Safe height / bottom safe area | Mobile frame is at least viewport height; bottom navigation and content clearance remain usable. Existing CSS retains ordered `100vh` then `100dvh` fallback plus `env(safe-area-inset-bottom)`; PASS in current Chromium |
| Bottom navigation coordination | Every icon is `18px`, label `12px`, target `>=44px`, and content is not obscured; PASS |
| Inventory table-to-card | Mobile uses cards rather than the desktop table and wraps long Chinese warehouse/specification and long batch values without document overflow; PASS |
| Modal dismiss mode | Initial close-button focus, body scroll lock, Tab/Shift+Tab loop, Escape close, focus restoration; PASS |
| Modal confirm mode | Cancel/confirm controls present, initial focus and Escape/focus restoration verified; failed confirmation focuses and scrolls the alert; PASS |
| Browser history | Back returns from inventory to the previous page when no modal is open; PASS |
| Enterprise WeChat web behavior | Chromium context with `MicroMessenger/8.0.50 wxwork/4.1.30`, `390x844`: one mobile tree, `innerWidth`/`visualViewport.width=390`, all form controls `>=16px`, no overflow; PASS |
| Notification stale response | Fixed sleeps replaced by deterministic started/release promises; PASS |
| Env-aware isolation | Outbound fixed Web URL and admin inbound fixed API URL replaced by shared helpers; PASS on `3301/5474` |

## Browser-plugin rendered QA

The in-app browser checked `http://127.0.0.1:5474/admin/inbound` at `390x844`:

- URL and title were correct (`集团仓库管理系统`).
- DOM contained the meaningful `登记入库` screen and no framework overlay.
- Console collection returned zero warnings/errors.
- Screenshot showed the mobile sheet within the viewport (`left=12`, `right=378`, width `366`) and no page overflow.
- More sheet initial focus was `关闭更多功能`; body overflow was `hidden`; Shift+Tab/Tab cycled between the last and first focusable controls; Escape restored focus to `更多` and body overflow to the prior empty value.

The plugin does not support `networkidle` in its `waitForLoadState` wrapper; the QA used an explicit visible heading wait instead. A first screenshot call used the wrong wrapper API and was immediately corrected to `tab.screenshot`; no product issue resulted.

## Cannot validate equivalently

- Desktop Chromium can emulate the Enterprise WeChat UA and CSS viewport but cannot reproduce the native WeCom JS bridge, real iOS/Android on-screen keyboard resize/close behavior, hardware safe-area inset values, or WeCom WebView engine/version quirks. These require a physical-device pass.
- Current Chromium supports `dvh`; it cannot demonstrate the legacy engine's actual `100vh` fallback selection. The rendered height/bottom-clearance behavior is covered, and the ordered fallback declarations remain present.
- The brief's whole `tests/e2e/admin` command was not run against the isolated stack because many legacy admin specs still hard-code port `3001`. Running them would violate this task's explicit main-stack isolation. The ledger-owned `tests/e2e/admin/inbound.spec.ts` was made env-aware and passed; bulk migration of unrelated admin specs was not attempted.

## Review, ports, and concerns

- `git diff --check`: exit `0` before report creation.
- An independent code-review subagent was requested, but the team concurrency limit was already full. A local requirements/diff review found no Critical or Important issue; this resource limitation is recorded rather than silently omitted.
- The QA server cells left two child listeners after parent termination. Their exact command lines were verified to belong to this worktree before terminating only PIDs `15556` (API) and `30520` (Web). Final port check: `3301 FREE`, `5474 FREE`.
- Remaining risk is the physical WeCom/native-keyboard and legacy-WebView boundary described above.

## Commit

The final local commit is the Git commit containing this report; its hash is supplied in the Task 7 handoff message so the worktree can remain clean without a self-referential amend.

---

## FixRound1/5 — Review Important findings

### Base and scope

- Base commit: `e7adcf5e501688386f6b55494dec7390d97a4352`.
- Scope remained Task 7 viewport, Modal accessibility/history, deterministic notification race coverage, and env-aware regression gates.
- No full-admin port migration, inventory query race, outbound 409 business behavior, production database, secret, deployment, or push was included.

### TDD RED evidence

The first focused run selected eight review-driven browser tests:

```powershell
corepack pnpm playwright test tests/e2e/mobile/mobile-viewport-matrix.spec.ts --grep "820 to 821|readable cards|dismiss and confirm|browser Back closes|programmatic modal close|aria-invalid|reduced viewport|enterprise WeChat" --workers=1
```

Exact result: exit `1`; `4 passed / 4 failed` in `26.1s` (`27.6s` wall time).

Expected product failures:

1. Back while the dismiss Modal was open navigated from inbound to `about:blank` instead of closing the Modal in place.
2. A real existing element changing to `aria-invalid="true"` did not receive focus.
3. After reducing the viewport to `390x360`, the focused unit-cost input bottom was `360.25` while the fixed navigation top was `303`, so the input remained obscured.
4. The rendered viewport meta was `width=device-width, initial-scale=1.0`, without `viewport-fit=cover`.

The same run directly passed the strengthened same-mount proof, long-value layout proof, confirm Tab/Shift+Tab loop, and pre-sentinel programmatic-close history test. These were test-coverage gaps rather than reasons for production changes.

A later busy-confirm sentinel test first errored because its link selector was ambiguous; after correcting the test to exact accessible-name matching, it produced a valid product RED: the first Back was blocked by the sentinel, but a second Back navigated away because a busy Modal whose `onClose` rejected dismissal did not re-arm protection. Exact valid result: exit `1`; `1 failed` in `6.0s` (`11.6s` wall time).

### Minimal fixes

- `ModalDialog` now serializes Modal history sentinels through one module-level coordinator. It delays the sentinel push past StrictMode's probe lifecycle, consumes the sentinel for Escape/close/cancel/backdrop closure, handles browser/Android Back before page navigation, queues consecutive Modals, and re-arms when a busy close callback leaves the Modal open.
- Back, Escape, dismiss-only and confirm modes preserve trigger-focus restoration. Confirm mode now has direct Tab and Shift+Tab loop coverage.
- Error focus observation includes `aria-invalid`/`role` attribute changes as well as added errors. Temporary `tabindex` values are tracked, restored on target change/valid state, and restored during Modal cleanup. The trap explicitly handles active focus that is not in the normal focusable list.
- Mobile controls and actions receive a bottom scroll margin equal to the fixed navigation plus safe-area/spacing allowance, allowing focused inputs and the current save action to scroll above the bar after repeatable viewport-height contraction.
- The viewport meta now opts into `viewport-fit=cover`; CSS continues to use `env(safe-area-inset-bottom)` without claiming that desktop Chromium supplies a non-zero hardware inset.
- The notification stale-response test now waits for the delayed `route.fulfill` promise to finish before asserting that the superseding empty state remains authoritative.

### Strengthened coverage that did not require production changes

- The `820 -> 821` test removes `warehouse.inbound.v1.local-admin` from sessionStorage after filling values and before resize. Warehouse, item, long batch, and long purchaser remain present while storage remains null, proving React state stayed mounted rather than being restored from a draft.
- Long Chinese specification, warehouse, and continuous batch values are explicitly rendered and measured within the inventory card and document viewport.
- The notification More-sheet-to-center transition has a Back test so only the latest Modal closes while the dashboard URL and trigger focus remain intact.

### GREEN and regression evidence

- Four original production REDs plus existing Modal regressions: `7 passed` in `8.0s`.
- Dismiss/confirm/programmatic/busy history cases after re-arm fix: `3 passed` in `6.1s`.
- Attribute-change/target-change/close-cleanup tabindex lifecycle: `1 passed` in `5.8s`.
- Notification latest-Modal Back plus delayed-response completion handshake: `2 passed` in `5.3s`.
- Full viewport matrix: `15 passed` in `11.2s` before the final busy/history and cleanup cases were added.
- Full mobile suite after all cases: `53 passed` in `30.9s`.
- Key desktop navigation and env-aware admin inbound: `11 passed` in `14.9s`.
- Web build: exit `0`, `1612` modules transformed, built in `2.21s`.
- Web typecheck and `git diff --check`: exit `0`.
- Isolation cleanup check: ports `3301` and `5474` both `FREE`.

The first combined pre-commit run exposed one genuine timing failure after `52/53` mobile tests: the dismiss Modal Back case could navigate to `about:blank` when Back occurred before the initially deferred sentinel push. No completion claim or commit was made. Root-cause tracing showed the `setTimeout(0)` created an unnecessary open-to-sentinel window for this application's normally-closed Modal instances. The sentinel push was made synchronous while retaining serialized StrictMode cleanup/consumption. The exact Back case then passed in five independent runs (`5/5`, each with a fresh Playwright server lifecycle), followed by the final fresh gates:

- Full mobile: `53 passed` in `30.9s`.
- Key desktop/env-aware admin: `11 passed` in `14.5s`.
- Web build: `1612` modules, `2.30s`; typecheck and diffcheck exit `0`.
- Final ports: `3301 FREE`, `5474 FREE`.

An independent review subagent was requested at the submit gate but could not be created because all team concurrency slots remained occupied. The failure was recorded at the tool boundary; no unbounded wait was used. The full diff was locally reviewed with emphasis on history ownership, pending/consuming sequencing, busy re-arm, temporary tabindex restoration, and focus restoration.

### Validation boundary

The reduced-height browser test is a repeatable layout approximation: it changes the actual Chromium viewport height, focuses the inbound input, scrolls the focused input/current action, and compares their bounding boxes to the fixed navigation top. It does not emulate a native WeCom keyboard, JS bridge, visualViewport event quirks, or a physical safe-area inset and is not reported as device-equivalent verification.
