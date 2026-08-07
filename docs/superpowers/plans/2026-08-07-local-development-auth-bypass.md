# Local Development Auth Bypass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a loopback-only, non-production local administrator login for development when VPN prevents stable Enterprise WeChat API access, while preserving Enterprise WeChat login as the default production path.

**Architecture:** Add a small auth policy module for the local bypass flag, loopback validation, and fixed local administrator identity. Register a backend `/auth/local` route that reuses the existing encrypted session and audit services, expose its URL only from the existing authorization metadata response, and render a conditional frontend link. Keep the bypass disabled by default and enable it only in the ignored local `.env` for this workstation.

**Tech Stack:** Fastify 5, TypeScript 5.9, React 19, Vitest 3, Playwright.

## Global Constraints

- Local bypass identity is fixed as “本地管理员” with `ADMIN` permissions.
- Existing Enterprise WeChat login remains available and unchanged by default.
- The bypass requires an explicit environment variable.
- Production must always reject the bypass, even if the variable is accidentally enabled.
- Only loopback requests may use the bypass route.
- Reuse the existing session Cookie, session service, permission policy, and login audit.
- Do not commit local bypass settings or real Enterprise WeChat credentials.

---

### Task 1: Add and test local-auth policy primitives

**Files:**
- Create: `apps/api/src/application/auth/local-auth.ts`
- Create: `tests/unit/auth/local-auth.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces `isLocalAuthEnabled(options: { bypassEnabled: boolean; nodeEnv?: string }): boolean`.
- Produces `isLoopbackAddress(address: string): boolean`.
- Produces `localAdminUser(): AuthenticatedUser`.

- [ ] **Step 1: Write the failing tests**

Create tests covering the policy contract:

```ts
it("enables local auth only when the flag is true outside production", () => {
  expect(isLocalAuthEnabled({ bypassEnabled: true, nodeEnv: "development" })).toBe(true);
  expect(isLocalAuthEnabled({ bypassEnabled: false, nodeEnv: "development" })).toBe(false);
  expect(isLocalAuthEnabled({ bypassEnabled: true, nodeEnv: "production" })).toBe(false);
});

it("recognizes only loopback IP addresses", () => {
  expect(isLoopbackAddress("127.0.0.1")).toBe(true);
  expect(isLoopbackAddress("::1")).toBe(true);
  expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  expect(isLoopbackAddress("192.168.1.10")).toBe(false);
});

it("returns the fixed local administrator identity", () => {
  expect(localAdminUser()).toEqual({ id: "local-admin", weComUserId: "local-admin", name: "本地管理员", role: "ADMIN" });
});
```

- [ ] **Step 2: Run the focused test and verify the expected RED failure**

Run: `corepack pnpm exec vitest run tests/unit/auth/local-auth.test.ts`

Expected: FAIL because `local-auth.ts` and its exported functions do not exist yet.

- [ ] **Step 3: Implement the minimal policy module**

Implement the three exported functions. Treat an omitted `nodeEnv` as development, compare production case-insensitively, accept `127.0.0.1`, `::1`, and IPv4-mapped loopback addresses, and return a fresh local administrator object on each call.

- [ ] **Step 4: Add the committed configuration default**

Append this line to `.env.example`:

```text
LOCAL_AUTH_BYPASS=false
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/auth/local-auth.test.ts`

Expected: all local-auth policy tests pass.

- [ ] **Step 6: Commit the policy unit**

```bash
git add apps/api/src/application/auth/local-auth.ts tests/unit/auth/local-auth.test.ts .env.example
git commit -m "feat: add guarded local auth policy"
```

### Task 2: Register the guarded local login route

**Files:**
- Create: `apps/api/src/routes/auth/local-auth.ts`
- Create: `tests/integration/auth/local-auth-routes.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- `registerLocalAuthRoutes(app: FastifyInstance, dependencies: { enabled: boolean; webBaseUrl: string; sessionService: Pick<SessionService, "createSession" | "cookieOptions">; auditService: Pick<InMemoryAuditService, "record"> }): void`.
- `GET /auth/local?returnTo=/admin/items` creates a local admin session only when enabled and the request IP is loopback, then redirects to the sanitized return path.
- `GET /auth/wecom/authorize` returns `localAuthUrl` only when local auth is enabled; the existing `authorizeUrl` remains unchanged.

- [ ] **Step 1: Write the failing route tests**

Create a Fastify integration test that imports `buildServer` without starting a network listener. The test must set `NODE_ENV=test`, set the Enterprise WeChat fields to harmless test values, and use `vi.stubEnv` to toggle `LOCAL_AUTH_BYPASS` before each `buildServer()` call. Cover:

```ts
it("creates an ADMIN session and redirects for a loopback local login", async () => {
  vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
  const app = buildServer();
  const response = await app.inject({ method: "GET", url: "/auth/local?returnTo=/admin/items" });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe("http://localhost:5174/admin/items");
  expect(response.headers["set-cookie"]).toEqual(expect.arrayContaining([expect.stringContaining("warehouse_session=")]));
});

it("does not expose or execute local login when the flag is disabled", async () => {
  vi.stubEnv("LOCAL_AUTH_BYPASS", "false");
  const app = buildServer();
  const metadata = await app.inject({ method: "GET", url: "/auth/wecom/authorize?returnTo=/" });
  const local = await app.inject({ method: "GET", url: "/auth/local" });
  expect(metadata.json()).not.toHaveProperty("localAuthUrl");
  expect(local.statusCode).toBe(404);
});
```

Also cover `NODE_ENV=production` with the flag true, and a non-loopback request to `/auth/local`; neither may create a session.

- [ ] **Step 2: Refactor server startup just enough for route testing and verify RED**

Move the existing bottom-of-file listen block into an exported `startServer()` function and invoke it only when `process.env.NODE_ENV !== "test"`. Run:

`corepack pnpm exec vitest run tests/integration/auth/local-auth-routes.test.ts`

Expected: FAIL because the route registration and local-auth response fields do not exist yet.

- [ ] **Step 3: Implement the local route with existing session and audit services**

Register `/auth/local` with the existing `SessionService` and `InMemoryAuditService`. Return `404 { error: "local_auth_unavailable" }` when disabled or the source is not loopback. For an allowed request, create `localAdminUser()`, set the existing `warehouse_session` cookie with the same attributes as the WeCom callback, record `LOGIN`, and redirect to `WEB_BASE_URL + oauthClient.decodeReturnTo(base64url(returnTo))` so external and malformed return paths are rejected.

- [ ] **Step 4: Wire the route and metadata response in `server.ts`**

Compute:

```ts
const localAuthEnabled = isLocalAuthEnabled({
  bypassEnabled: process.env.LOCAL_AUTH_BYPASS === "true",
  nodeEnv: process.env.NODE_ENV,
});
```

Register the route with `sessionService`, `auditService`, and the configured web base URL. Extend the successful `/auth/wecom/authorize` response with:

```ts
...(localAuthEnabled ? { localAuthUrl: `${apiBaseUrl}/auth/local?returnTo=${encodeURIComponent(request.query.returnTo ?? "/")}` } : {})
```

Do not alter the generated Enterprise WeChat authorization URL.

- [ ] **Step 5: Run the route tests and verify GREEN**

Run: `corepack pnpm exec vitest run tests/integration/auth/local-auth-routes.test.ts`

Expected: all enabled, disabled, production, and source-IP tests pass.

- [ ] **Step 6: Commit the backend route**

```bash
git add apps/api/src/application/auth/local-auth.ts apps/api/src/routes/auth/local-auth.ts apps/api/src/server.ts tests/unit/auth/local-auth.test.ts tests/integration/auth/local-auth-routes.test.ts
git commit -m "feat: add loopback local admin login"
```

### Task 3: Show the conditional local login entry and enable it locally

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/LoginPage.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `tests/e2e/auth/roles.spec.ts`
- Modify: local ignored file `D:/桌面/仓库/.env`

**Interfaces:**
- `LoginPage` accepts `{ authorizeUrl: string; localAuthUrl?: string }`.
- The API metadata response drives whether the local button is rendered; the frontend does not independently infer or enable bypass mode.

- [ ] **Step 1: Add the failing browser assertion**

Add an end-to-end test that opens `/`, clicks `本地开发登录`, and expects the authenticated dashboard text `库存总览`. Keep the existing assertion for `使用企业微信登录` so the Enterprise WeChat entry remains visible.

- [ ] **Step 2: Run the focused E2E test and verify RED**

Set the local `.env` flag only after this RED run. First run:

`corepack pnpm exec playwright test tests/e2e/auth/roles.spec.ts --grep "本地开发登录"`

Expected: FAIL because the API does not yet expose a frontend local URL and the login page does not render the link.

- [ ] **Step 3: Implement the conditional frontend link**

Store `localAuthUrl` from the `/auth/wecom/authorize` JSON response, pass it to `LoginPage`, and render a secondary full-width anchor named `本地开发登录` only when the value exists. Add a small visual gap between the two login anchors without changing the existing primary login styling.

- [ ] **Step 4: Enable the bypass only in the ignored local environment**

Append this line to `D:/桌面/仓库/.env`:

```text
LOCAL_AUTH_BYPASS=true
```

Do not modify or print any existing credential lines.

- [ ] **Step 5: Run the focused E2E test and verify GREEN**

Restart the API and web dev servers so the new environment value is loaded, then run:

`corepack pnpm exec playwright test tests/e2e/auth/roles.spec.ts --grep "本地开发登录"`

Expected: the test passes and the page reaches the admin dashboard as `本地管理员`.

- [ ] **Step 6: Commit the frontend and tracked test changes**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/LoginPage.tsx apps/web/src/styles.css tests/e2e/auth/roles.spec.ts
git commit -m "feat: expose local development login"
```

The ignored `.env` change stays local and is not committed.

### Task 4: Full verification and handoff

**Files:**
- Modify only if verification exposes a regression.

- [ ] **Step 1: Run the complete unit and integration suite**

Run: `corepack pnpm test`

Expected: all Vitest tests pass with zero failures.

- [ ] **Step 2: Run type checking and production builds**

Run: `corepack pnpm typecheck` and `corepack pnpm build`

Expected: both commands exit 0 for API and web packages.

- [ ] **Step 3: Run the complete E2E suite**

Run: `corepack pnpm test:e2e --reporter=line`

Expected: all existing authentication and admin workflow tests pass, including local login.

- [ ] **Step 4: Verify the runtime manually**

With the ignored local `.env` flag enabled, open `http://127.0.0.1:5174`, click `本地开发登录`, verify the dashboard and an admin page load, then inspect `/auth/session` to confirm `role: "ADMIN"`. Do not print session cookies or environment secrets.

- [ ] **Step 5: Review the final diff and status**

Run: `git status --short` and `git diff HEAD~3 --stat`

Expected: only tracked source, tests, and documentation are committed; `.env` and real credentials remain ignored.

