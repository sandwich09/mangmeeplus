# Logout and Session Device Security Implementation Plan

## Status

Implemented and automated-verification complete on 2026-07-01. UX refined on 2026-07-04 so the header profile menu is now the authenticated entry point for password/security actions. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 02B.

Implementation covered Phase 1 through Phase 3. Verification commands are recorded below; a live browser smoke test is still recommended before production deployment because this feature includes user-menu click behavior.

## Linked Spec

- Spec: [[specs/session-logout-security-spec|Logout and Session Device Security Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 02B
- Related specs: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]], [[specs/forgot-password-reset-spec|Forgot Password and Self-Service Reset Spec]], [[specs/permission-matrix|Permission Matrix]]
- Related guidelines: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]], [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]], [[guidelines/security-implementation-guideline|Security Implementation Guideline]]

## Purpose

Fix a live bug (the web "Sign out" button does nothing) and add self-service "log out of all other devices," reusing the same session-revocation behavior that [[plans/forgot-password-reset-plan|Forgot Password and Self-Service Reset Plan]] needs for its own force-logout-on-reset step.

## Current Repository Context

Verified directly against the current codebase (2026-07-01):

- Backend `POST /v1/auth/logout` already worked correctly before this pass: `apps/api/src/modules/auth/presentation/auth.controller.ts` + `logout.use-case.ts` extract the `tokenId` from the bearer token and revoke that one `AuthSession` row. Permission: `account.session.read` (existing key, no change needed).
- Implementation update 2026-07-01: `AuthGuard` now rejects sid-backed WatchDog/dev tokens whose `AuthSession` row is missing, revoked, expired, or belongs to another user. This closes the practical gap where a revoked access token could otherwise work until JWT expiry.
- Implementation update 2026-07-01: WatchDog/dev JWT verifiers now reject refresh tokens as request authorization tokens, so refresh tokens cannot be used against protected routes.
- The frontend entry point was broken before this pass: `apps/web/src/common/components/app-shell/AppHeader.tsx` rendered a "Sign out" menu item whose `onClick` only called `setUserMenuOpen(false)` — no API call, no `localStorage` clear, no navigation. This is now implemented through `apps/web/src/common/auth/session.ts`.
- Token storage today is inconsistent across features: most call sites read `localStorage.getItem('watchdog.accessToken')` with a fallback to a legacy `watchdog.auth.accessToken` key (see e.g. `apps/web/src/features/employee-access/employee-access.api.ts`, `apps/web/src/features/ledger/ledger.api.ts`, and others). `LoginPage.tsx` only ever writes the `watchdog.accessToken`/`watchdog.refreshToken` keys. The logout fix must clear all keys any current call site might read, not just the ones `LoginPage` writes.
- `AuthSession` (`apps/api/prisma/schema.prisma`) already has everything needed for "revoke all but this one": `userId`, `tokenId` (unique), `status` (ACTIVE/REVOKED/EXPIRED), no schema change required.

## Implementation Rules

- Follow [[plans/master-implementation-checklist|Master Implementation Checklist]].
- Reuse the existing `account.session.read` permission key — do not add a new permission for a self-service action on the caller's own sessions.
- Factor the "revoke N sessions for a user" query into one shared helper used by both this plan's `revoke-others` use case and [[plans/forgot-password-reset-plan|Forgot Password and Self-Service Reset Plan]]'s force-logout-on-reset step (that plan revokes all sessions; this plan revokes all except the current one) — do not write the query twice.
- Client-side token clearing and redirect must happen even if the server-side revoke call fails or times out.
- LINE/AI must never be able to call either logout endpoint on a user's behalf.

## Scope

### In Scope

- Wiring `AppHeader.tsx`'s profile-menu actions to a real logout call, full local-token clear (all known keys), redirect to `/login`, and routing `Reset password` to the shared Account Security page.
- New `POST /v1/auth/sessions/revoke-others` endpoint and shared session-revocation helper.
- "Log out of all other devices" section on the Account Security settings page (shared with [[plans/forgot-password-reset-plan|Forgot Password and Self-Service Reset Plan]]).
- Audit for `revoke-others`.

### Out of Scope

- A full session/device list UI with per-device metadata and individual revoke (existing non-goal, see spec).
- Any change to token issuance, access/refresh token structure, or session TTL.
- Admin-initiated "force logout another user" capability. This plan remains self-service only.

## Phase 1: Fix the Web Sign-Out Button

### Goal

- Make the header profile menu's account actions actually work — `Sign out` for the current session and `Reset password` routing into Account Security. This is the highest-value, lowest-risk part of this plan and should ship first, independently of Phase 2/3.

### Tasks

- [x] `apps/web/src/common/auth/session.ts`: added `logoutCurrentSession()` — calls `POST /v1/auth/logout` via `createWebApiClient`, then clears every known local token key (`watchdog.accessToken`, `watchdog.refreshToken`, `watchdog.auth.accessToken`, `watchdog.auth.refreshToken`, `watchdog_access_token`, `watchdog_refresh_token`), and redirects to `/login` even if the API call rejects.
- [x] `apps/web/src/common/components/app-shell/AppHeader.tsx`: replaced the dead sign-out click with a handler that closes the dropdown, calls the common logout helper, and shows a signing-out label while in flight.
- [x] `apps/web/src/common/components/app-shell/AppHeader.tsx` + `WorkspaceShell.tsx`: added `Reset password` to the profile menu above `Sign out`, routing authenticated users to `/companies/:companyId/settings/security`.
- [x] `WorkspaceShell.tsx` now passes `companyId` through to `AppHeader` for the `Reset password` route, while `AppHeader` still imports the common logout helper directly for sign-out behavior.

### Tests

- Component/manual: opening the header profile menu shows `Reset password` and `Sign out`; clicking "Sign out" results in the logout API being called, all known local token keys cleared, and a redirect to `/login` — verify live in a browser (this bug is specifically about real UI wiring, so a unit test alone is not sufficient verification).

### Exit Criteria

- Users can actually log out of the web app. This phase alone already closes the concrete bug found during discovery and can ship independently of Phase 2/3.

## Phase 2: Revoke-Others Endpoint

### Goal

- Add self-service "log out of all other devices" on the backend.

### Tasks

- [x] `apps/api/src/modules/auth/domain/logic/session-revocation.logic.ts`: added `revokeActiveSessions(authSession, { userId, exceptTokenId? })`, reusable by reset-confirm or any future revoke-all flow.
- [x] `apps/api/src/modules/auth/application/use-cases/revoke-other-sessions.use-case.ts`: input `{ userId, currentTokenId, requestId }`; calls the shared helper; audits `auth.session.revoke_others` (MEDIUM, metadata `{ revokedCount }`).
- [x] `apps/api/src/modules/auth/presentation/auth.controller.ts`: added `POST sessions/revoke-others`, `@RequirePermissions('account.session.read')`, extracting `currentTokenId` from the bearer token.
- [x] `apps/api/src/modules/audit/domain/models/audit-action.ts`: added `AUTH_SESSION_REVOKE_OTHERS`.
- [x] `apps/api/src/modules/auth/presentation/auth.guard.ts`: validates `AuthSession` by JWT `sid` for WatchDog/dev tokens so revoked sessions are blocked on protected routes.
- [x] `apps/api/src/modules/auth/infrastructure/watchdog-jwt-verifier.adapter.ts` and `dev-jwt-verifier.adapter.ts`: reject refresh tokens as protected-route authorization tokens.

### Tests

- Unit: revoking with the current session excluded never revokes that session; revoking with zero other active sessions returns `revokedCount: 0` with no error; audit row records the correct count.
- Integration: a token from a separately-issued (simulated second) session is rejected on its next request after `revoke-others`; the calling session's own token keeps working.

### Exit Criteria

- `POST /v1/auth/sessions/revoke-others` is live, self-service, audited, and cannot revoke the calling session itself.

## Phase 3: Account Security UI Section

### Goal

- Expose "log out of all other devices" in the web app.

### Tasks

- [x] Created `apps/web/src/features/account-security/AccountSecurityPage.tsx` and the route wrapper at `apps/web/app/(workspace)/companies/[companyId]/settings/security/page.tsx`.
- [x] Added a "Log out of all other devices" button with a short confirmation dialog, scoped loading state, endpoint call via `createWebApiClient`, and a success confirmation including `revokedCount`.
- [x] `apps/web/src/common/i18n/workspace-dictionary.ts`: added Thai/English copy for the button, confirmation dialog, success message, and sign-out loading label.

### Tests

- Manual/E2E: clicking the button with another active session open elsewhere actually logs that other session out on its next request, verified live against a real local Postgres + booted API, not just a unit test.

### Exit Criteria

- A user can log out of every device except the current one from the web UI in one click.

## Integration Verification

- Backend/API contract: `POST /v1/auth/sessions/revoke-others` is documented through Swagger decorators, matching existing controller conventions.
- Web journey: sign-out helper and revoke-others UI are implemented. Live browser click-smoke was not run in this Codex turn; run before production deployment if a full local runtime is available.
- Loading/error/permission states: revoke-others loading/disabled and success count states are implemented in `AccountSecurityPage.tsx`.
- Commands passed on 2026-07-01:
- `corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/auth.guard.spec.ts src/modules/auth/auth-endpoints.spec.ts` -> 25/25 pass.
- `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/common/auth/session.spec.ts` -> 2/2 pass.
- `corepack pnpm --filter @watchdog-bms/api typecheck` -> pass.
- `corepack pnpm --filter @watchdog-bms/web typecheck` -> pass.
- `corepack pnpm --filter @watchdog-bms/api test` -> 652/652 pass.
- `corepack pnpm --filter @watchdog-bms/web test` -> 111/111 pass.

## Risks

- If Phase 1 (the button fix) and Phase 2/3 of [[plans/forgot-password-reset-plan|Forgot Password and Self-Service Reset Plan]] are picked up by different implementers at different times, there is a real risk of two competing `AccountSecurityPage.tsx` files being created independently — mitigated by the explicit cross-reference in both plans, but worth a quick check ("does this file already exist?") before starting Phase 3 here.
- Clearing local tokens even when the server-side logout call fails means a session could remain technically `ACTIVE` server-side after the user believes they are logged out on that device — acceptable, since the alternative (blocking logout on a successful network round trip) is a worse user experience, and the session still expires naturally per its own TTL.

## Open Questions

- None for the implemented code path. Live browser smoke remains a release-check recommendation because the feature includes header profile-menu click behavior and a settings confirmation modal.
