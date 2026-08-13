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
