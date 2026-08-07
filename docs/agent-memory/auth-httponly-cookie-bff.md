# Agent Memory: auth-httponly-cookie-bff

Status: Implemented and verified (2026-07-04). Remaining: user-driven browser pass + full Playwright run.
Owner: Claude (with owner decision: httpOnly cookie BFF approach, chosen 2026-07-04)
Scope: Fix `401 Missing authentication token.` correctly/securely and finish the login flow, per `docs/plans/auth-httponly-cookie-bff-plan.md`.

## Decisions

- **httpOnly cookie BFF** (no interim localStorage phase). Browser only talks same-origin: `/api/auth/*` = Next BFF route handlers (set/clear cookies), `/api/v1/*` = existing Next rewrite → ERP API. Tokens never touch browser JS (XSS-safe).
- **Cookies**: `watchdog_token` (access, httpOnly, SameSite=Lax, Path=/, Max-Age=900), `watchdog_refresh` (httpOnly, **Path=/api/auth** so it never rides data calls, 7d), `watchdog_csrf` (readable, double-submit), `watchdog_home` (httpOnly, post-login home path for /login redirects). `Secure` on when NODE_ENV=production.
- **Access token is CHUNKED into `watchdog_token.0..N`** (3500 B chunks, max 6): the access JWT embeds the permission list → seed OWNER token is **9,392 bytes**, over the 4,096 B per-cookie browser limit; browsers silently drop oversized cookies (would have caused an infinite login loop). Chunk join implemented in: web middleware presence check, `server-session.ts`, BFF logout route, and API `accessTokenFromCookies()` (guard + sid extraction). NextAuth-style pattern.
- **Refresh strategy**: reactive. `authed-fetch` retries once after `POST /api/auth/refresh` on 401 (single-flight — API refresh **rotates tokenId on the same session row**, so concurrent refreshes must share one attempt). Page navigations with an expired access cookie bounce to `/login`, which runs a **silent refresh on mount** and returns (refresh cookie is path-scoped, invisible to middleware). `?fresh=1` from middleware skips the attempt when no session trace exists.
- **CSRF**: middleware enforces same-origin (`Origin` host vs `x-forwarded-host`/`host`, else `Sec-Fetch-Site`) on all mutating `/api/*`, plus double-submit `x-csrf-token` for mutating `/api/v1/*` **when the access cookie is present** (Bearer-only automation unaffected).
- **Fake local-owner session removed** (`local-owner-session.ts` deleted). Workspace layout now fetches the real session server-side via `GET /v1/auth/me` (Bearer from cookie) and redirects to `/login` when invalid. Local preview replaced by **`POST /api/auth/dev-login`** (dev-build-only + API `dev/token` 404s outside APP_ENV=local) with a button on the login page.
- `/auth/me` now also returns `membershipId` (was already in RequestContext).

## Key files

- API: `main.ts` (cookie-parser), `auth/presentation/auth-cookie.constants.ts` (chunk join), `auth.guard.ts`, `auth.controller.ts` (extractSid from header **or** cookie for logout/revoke-others).
- Web BFF: `app/api/auth/{login,refresh,logout,reset-password,dev-login}/route.ts`, `src/common/auth/auth-cookies.{constants,server}.ts`.
- Guard: `apps/web/middleware.ts` + `src/common/auth/middleware.logic.ts` (pure, spec'd).
- Client: `src/common/api/authed-fetch.ts` (prefix `/api/v1`, strips legacy `/v1`, CSRF header, 401→refresh-once→retry→/login; 403 password-change redirect). All **15 feature `*.api.ts` clients migrated** by script; `http-client.ts` gained CSRF + credentials for auth.api public calls.
- Login UX: `LoginPage.tsx` (Thai, silent refresh, `?next=`, dev sign-in), `ChangePassword/ResetPassword` on cookie flow, logout already wired in `AppHeader` → `logoutCurrentSession()` → BFF.
- e2e: `business-smoke.spec.ts` seeds **chunked** cookies via `context().addCookies` (localStorage injection removed).
- Ops utility: `apps/api/prisma/add-system-admin.ts` — grant SYSTEM_ADMIN to a new/existing user (env-driven, no secrets in file; also doubles as local admin password reset).

## Traps / gotchas discovered

1. **API cookie fallback was dead code** — `cookie-parser` was never installed; `req.cookies` was always undefined. Now wired in `main.ts`.
2. **4 KB per-cookie limit** vs 9.4 KB OWNER access token → chunking (above). Typical employees have few permissions → usually 1 chunk.
3. **curl caps its jar-generated `Cookie:` header at ~8 KB** and silently drops cookies that don't fit — smoke tests with a curl jar lose chunk `.2`. Manual `-H "Cookie: ..."` works; browsers/Playwright unaffected. Don't chase this as an app bug again.
4. **`NextResponse.cookies.set` percent-encodes values but `request.cookies.get` does NOT decode** → decode `watchdog_home` before path sanitation in middleware.
5. Total cookie weight ~9.5 KB rides every request; fine for Node (16 KB header limit) and CloudFront, but worth a follow-up: issue a **compact browser access token** (sub+sid only — AuthGuard resolves permissions from DB anyway; the permissions claim is only for the AI Gateway per `issue-token.use-case.ts` comment).

## Verification

- Unit: API 809 pass (incl. cookie-only, chunked, header-priority guard tests), web 147 pass (authed-fetch refresh/CSRF/single-flight, middleware logic, chunk split/join). `tsc` clean both apps; `next build` clean.
- Live (API container rebuilt via compose project **watchdogfresh**, web dev server on :3100 against it):
  - cookie-only + chunked `/v1/auth/me` → 200; no creds → 401.
  - no-cookie `/companies/...` → 307 `/login?next=…&fresh=1`; SSR dashboard + settings with chunked cookies → 200.
  - data via `/api/v1` rewrite + chunked cookies → 200 (the original bug scenario, fixed).
  - `/login` with session → 307 to home path; CSRF-less cookie mutation → 403; cross-origin mutation → 403; with CSRF → passes to API.
  - refresh → 204 + rotation; logout → 204, cookies cleared, protected page bounces to login.
- Not run: full Playwright suite (needs seeded DB + both webservers; spec updated for cookie auth).

## Deployment (local stack, done 2026-07-04 afternoon)

- User's `:3000` still showed the bug after code-complete → it was the **stale `watchdogfresh-web` container** (header said "Owner company" — a string that no longer exists in the new code; instant tell).
- Web Docker build OOM'd (exit 137) because **colima VM had 2 GB RAM** → resized to **6 GB / 4 CPU** (`colima start --memory 6 --cpu 4`, persisted in profile) → both `api` and `web` images rebuilt & deployed under compose project `watchdogfresh`.
- Extra fix found during deploy: container runs a production Next build over plain http://localhost, so `Secure` cookies would be dropped by Safari → `SECURE` now gates on `APP_ENV !== 'local'` (with `AUTH_COOKIE_SECURE` explicit override) instead of NODE_ENV alone.
- Live on :3000 (prod build): guard redirect ✅, BFF password login (seeded system admin) → 200 + cookies, no tokens in body ✅, settings/roles page + API (the exact screenshot scenario) → 200 with data ✅, refresh 204 with chunked non-Secure cookies ✅.
- Note: dev-login button/route is dead in the Docker prod build by design (`NODE_ENV=production`); it exists for host `pnpm dev` only. Docker-stack sign-in = real credentials (seeded system admin `thawatchai.watchdog`, or onboarded owner/employee users).

## Next

- User browser pass (hard-refresh old tabs; `/companies/owner-company/*` URLs now bounce to /login).
- Follow-up candidate: compact browser access token to shrink cookies to one chunk (see trap 5).
- LINE LIFF link pages intentionally untouched (separate token flow, out of scope per plan).
