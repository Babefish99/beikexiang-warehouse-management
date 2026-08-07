# Final fix report: local development auth host binding

Date: 2026-08-07
Branch: `feat/warehouse-system`
Base HEAD at start: `436ac16`

## Finding verification

Verified against the current code before changes:

- `apps/api/src/routes/auth/local-auth.ts` allowed `/auth/local` when `LOCAL_AUTH_BYPASS` was enabled and `request.ip` was loopback.
- `apps/api/src/server.ts` listens on `0.0.0.0`.
- There was no `Host` validation on `/auth/local`, so a loopback request with a hostile `Host` header could still receive the local ADMIN session cookie and redirect.

## Files changed

- `apps/api/src/application/auth/local-auth.ts`
- `apps/api/src/routes/auth/local-auth.ts`
- `apps/api/src/server.ts`
- `tests/integration/auth/local-auth-routes.test.ts`
- `tests/unit/auth/local-auth.test.ts`

## RED

Command:

`corepack pnpm exec vitest run tests/integration/auth/local-auth-routes.test.ts tests/unit/auth/local-auth.test.ts`

Result:

- Exit code: `1`
- `tests/integration/auth/local-auth-routes.test.ts`
  - New regression failed as expected: `rejects loopback local login when Host is not allowed`
  - Observed `302` instead of expected `404`
- `tests/unit/auth/local-auth.test.ts`
  - New policy test failed as expected because `isAllowedLocalAuthHost` did not exist yet

## GREEN

Command:

`corepack pnpm exec vitest run tests/integration/auth/local-auth-routes.test.ts tests/unit/auth/local-auth.test.ts`

Result:

- Exit code: `0`
- Test files: `2 passed`
- Tests: `11 passed`

Additional verification command:

`corepack pnpm --filter @warehouse/api typecheck`

Result:

- Exit code: `0`
- Output: `tsc -p tsconfig.json --noEmit`

## Behavior now covered

- `/auth/local` still works for loopback requests on `localhost:3001`
- `/auth/local` still works for loopback requests on `127.0.0.1:3001`
- `/auth/local` now rejects loopback requests with `Host: attacker.example`
- The allowlist also supports the configured `API_BASE_URL` host and port
- `/auth/wecom/authorize` metadata tests now assert that `authorizeUrl` is still present

## Scope guardrails honored

- Did not modify frontend files
- Did not modify local `.env`
- Did not implement the isolated-process startup test suggestion
- Did not refactor cookie serialization

## Concerns

- The new host gate intentionally checks the direct `Host` header used by the app, not proxy-forwarded host headers. That keeps the local bypass narrow for direct local-development use, but if deployment ever puts this route behind a trusted reverse proxy, the policy should be reviewed explicitly rather than widened implicitly.
