# Agent Memory: web-session-recovery-redirect-loop-fix

Status: DEPLOYED AND PRODUCTION-SMOKED 2026-07-13 — local E2E browser matrix remains blocked by the recorded local API/Prisma runtime crash.
Owner: Codex harness (acceptance); Claude Opus 4.8 (implementation writer/tester, model id `claude-opus-4-8`)
Scope: Production web auth redirect/session recovery, protected company/system layouts, CSRF recovery, redirect sanitization, focused tests, canonical session docs.

Decisions:
- Cookie presence is never proof of authentication; `GET /v1/auth/me` is the only authentication boundary. Middleware keeps its cheap presence gate for cookie-less protected routes but no longer decides that anyone IS signed in, and no longer gates `/login` at all.
- `ServerSessionResult` gains `unavailable`. 401 = signed out, 403 = forbidden, everything else (5xx/404/network/bad body) = unavailable. Company and system layouts throw an honest server error for unavailable instead of redirecting to `/login` (which would bounce back) or `notFound()` (which would lie).
- Follow-up 2026-07-13: company-layout forbidden now renders a branded access-unavailable state rather than `notFound()`; see `web-access-error-handling.md`.
- `/system/*` now validates the real session and fails closed for non-`SYSTEM_ADMIN` users, rendering an access-denied screen instead of the platform shell (matching the wording SYS-05 already asserts).
- Silent refresh recovery on `/login` is attempted exactly once, marked spent by `?recovered=1`. This bounds the one remaining loop risk: a browser that refuses to store the rotated cookies gets the form, not an infinite reload.
- The impossible page-level refresh-cookie inference (`?fresh=1`, derived from `watchdog_home`) is deleted: `watchdog_refresh` is path-scoped to `/api/auth` and can never be observed on a page request.
- CSRF stays fail-closed. The middleware rejection now carries a stable `code: 'csrf_token_invalid'`; the browser client self-recovers from that code only — one refresh (which reissues the cookie) plus one retry. Business/permission 403s carry no code and are never retried.
- httpOnly cookie model preserved. Docs corrected rather than security weakened.

Open questions:
- None for this scope. Owner decided 2026-07-13 that an unreachable BFF must keep the user on the current page and show a retryable logout failure. `logoutCurrentSession()` now returns `false` without redirecting or clearing legacy storage; all three shell callers re-enable the action and alert the user. A successful BFF response still clears storage and redirects to `/login`.

Artifacts:
- Plan: `docs/plans/web-session-recovery-redirect-loop-fix-plan.md`
- Code: `apps/web/proxy.ts`, `apps/web/app/login/page.tsx`, `apps/web/app/system/layout.tsx`,
  `apps/web/app/(workspace)/companies/[companyId]/layout.tsx`,
  `apps/web/src/common/auth/session-gate.logic.ts` (new), `apps/web/src/common/auth/server-session.ts`,
  `apps/web/src/common/auth/auth-cookies.constants.ts`, `apps/web/src/common/api/authed-fetch.ts`,
  `apps/web/src/features/auth/LoginPage.tsx`, `apps/web/src/features/auth/ChangePasswordPage.tsx`
- Tests: `apps/web/src/common/auth/proxy.spec.ts` (new), `apps/web/src/common/auth/session-gate.logic.spec.ts` (new),
  `apps/web/src/common/api/authed-fetch.spec.ts` (extended), `apps/web/src/common/auth/session.spec.ts` (extended)
- Docs: `docs/specs/session-logout-security-spec.md` (httpOnly/BFF alignment)
- E2E: `e2e/login.spec.ts`, `e2e/system-admin.spec.ts` — dropped the now-dead `?fresh=1` param.

## Acceptance evidence matrix

| Plan acceptance case | Covered by | Result |
| --- | --- | --- |
| No cookie: `/login` renders; protected routes redirect once | `proxy.spec.ts` (never redirects away from `/login`; cookie-less `/companies/*` + `/system/*` → one 307 with exact `next`) | PASS |
| Cookie present but expired/revoked/malformed: no redirect away from `/login` | `proxy.spec.ts` (valid, chunked, and malformed cookies all render `/login`) | PASS |
| Valid access on `/login?next=<safe>` → safe target | `session-gate.logic.spec.ts` `resolveLoginLanding` | PASS |
| Valid session with **missing `watchdog_home`** → own dashboard (no loop) | `session-gate.logic.spec.ts` "lands a valid session with no watchdog_home cookie" | PASS |
| Default landing: `SYSTEM_ADMIN` → `/system/partners`, else company dashboard | `session-gate.logic.spec.ts` | PASS |
| **Missing access cookie + valid refresh** → recovery attempted once, returns through `/login` for re-validation | `session-gate.logic.spec.ts` "session recovery bounce" (`shouldAttemptSessionRecovery`, `recoveryReturnUrl`); `proxy.spec.ts` (cookie-less protected → `/login?next=…`) | PASS (unit); browser path blocked, see below |
| Failed refresh → cookies cleared, form renders, no loop | Existing BFF `refresh/route.ts` `clearAuthCookies` on 401 (unchanged) + one-shot `recovered=1` marker | PASS (unit) |
| 403 stays forbidden; 5xx/network is unavailable and never redirects to login/404 | `session-gate.logic.spec.ts` `mapAuthMeStatus` | PASS |
| Non-system-admin cannot render the `/system/*` shell | `session-gate.logic.spec.ts` `isSystemAdmin` + `app/system/layout.tsx` fail-closed branch | PASS (unit); SYS-05 browser check blocked |
| `next=//example.com` never navigates off-origin (login **and** change-password) | `session-gate.logic.spec.ts` `resolveLoginLanding`, `recoveryReturnUrl`, `resolvePasswordChangeTarget` (`//evil`, absolute URL, `/\`, `/login`, `/`) | PASS |
| Missing CSRF cannot mutate; recovery is one refresh + one retry | `proxy.spec.ts` (fail-closed 403 + stable code) and `authed-fetch.spec.ts` (recovers once; second rejection returned) | PASS |
| **Business 403 is never retried** | `authed-fetch.spec.ts` "never retries a business permission 403" (asserts a single fetch call) | PASS |

## Verification

Commands run 2026-07-13 (Node v22.14.0):

- `pnpm --filter @watchdog-bms/web test` → **263 tests / 76 suites, 263 pass, 0 fail** (includes two offline-logout outcome tests added after the owner decision).
- Focused auth/session set → **40 pass, 0 fail**.
- `pnpm --filter @watchdog-bms/web typecheck` → clean.
- `pnpm --filter @watchdog-bms/web build` → compiled successfully; `/login` and `/system/*` now render dynamically (ƒ), as required by the server-side session gate.
- `git diff --check` → clean.

### E2E blocker (local API runtime)

`npx playwright test e2e/login.spec.ts e2e/system-admin.spec.ts` → 3 passed, 6 failed. **The local API process crashes at runtime with an uncaught Prisma client error** (raw `@prisma/client/runtime/client.js` dump), after which every BFF auth call returns `502 {"message":"Cannot reach the authentication service."}` and `loginViaDevBff` fails. Evidence that this is an API/runtime blocker rather than a deterministic web assertion failure:

- The diff touches zero API files (`apps/web`, `docs`, `e2e` only); the Prisma failure itself was not traced to a code change in this task.
- `LOGIN-03` passes in isolation and fails in a full run — the API dies partway through, it is not a deterministic assertion failure.
- The e2e DB on `:5432` is present and seeded (8 users, 4 companies), so this is not missing seed data.
- The failures surface *through* the new code working correctly: with the API down, `SystemLayout` throws the new `unavailable` error instead of looping to `/login` — which is the intended behavior for an auth outage.

Not investigated further per harness instruction. **Open for Codex/owner:** fix or re-provision the local API/Prisma runtime, then re-run `e2e/login.spec.ts` and `e2e/system-admin.spec.ts` (especially SYS-05, whose denial screen changed from a client-side 403 message to the server-rendered access-denied screen).

Codex final review:
- Re-read the complete auth-gate, recovery, CSRF, redirect, docs, and E2E diff after the Opus writer and independent critic passes; no additional in-scope correctness or security gap found.
- Independently re-ran the focused tests after the logout decision: **40 passed, 0 failed**.
- Independently re-ran the full web suite with Node v22.14.0: **263 passed, 0 failed**.
- Independently re-ran web typecheck: clean. `git diff --check`: clean.

Next:
1. Re-run the two E2E specs once the API crash is resolved.

## Commit and production deployment

- Runtime/docs commit: `839bbb2c` (`fix(web): prevent stale-session redirect loops`), pushed to `origin/develop`.
- ECS Express api-web image: `ecs-api-web-839bbb2c-20260713140923`.
- Target service revision: `8986116930241320259`.
- Deployment `hIVvEPEdLNEV-wJyLLQEW` finished `SUCCESSFUL` at 2026-07-13 14:22:42 Asia/Bangkok; target task 1/1 running at 100% production traffic, source tasks drained to 0, circuit breaker and rollback alarm both `MONITORING_COMPLETE`, no triggered alarms.
- Production health: `GET https://mangmeeplus.com/v1/health` → HTTP 200 with DB `ok`.
- Redirect regression smoke with `watchdog_token=invalid.stale.token`: `https://mangmeeplus.com/` → exactly one redirect → `https://mangmeeplus.com/login` → HTTP 200. Direct `/login` also returned HTTP 200 with both no cookie and stale cookie.
