# Agent Memory: session-logout-security

Status: COMPLETE / AUTOMATED VERIFIED (implemented 2026-07-01). Live browser smoke still recommended before production deployment.
Owner: Codex.
Scope: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 02B — fix the web app's non-functional "Sign out" button and add self-service "log out of all other devices."

Role gate status:
- BA: Accepted journey is self-service only. Any authenticated web user can log out current session or revoke all other own sessions. LINE/AI cannot initiate logout or session revocation.
- SA: Reused `account.session.read`; no schema change. `AuthSession.tokenId` remains the session boundary. Added guard enforcement so revoked/expired sid-backed sessions fail protected requests. WatchDog/dev verifiers reject refresh tokens on protected routes.
- DEV: Implemented backend use case, shared revocation helper, controller endpoint, audit action, guard session-status validation, refresh-token verifier rejection, web logout helper, header profile-menu wiring, Account Security UI, route wrapper, i18n copy, and focused tests.
- Integration: Automated API/Web tests and typechecks pass. Live browser click-smoke was not run in this turn.

Decisions:
- `POST /v1/auth/sessions/revoke-others` reuses `account.session.read` because it only affects the caller's own sessions.
- Shared helper is `apps/api/src/modules/auth/domain/logic/session-revocation.logic.ts` with `revokeActiveSessions(authSession, { userId, exceptTokenId? })`; password reset can call the same helper later with no `exceptTokenId`.
- Client logout clears all known current and legacy token keys even if the server revoke call fails: `watchdog.accessToken`, `watchdog.refreshToken`, `watchdog.auth.accessToken`, `watchdog.auth.refreshToken`, `watchdog_access_token`, `watchdog_refresh_token`.
- Account Security page now exists at `apps/web/src/features/account-security/AccountSecurityPage.tsx`; forgot-password-reset should extend this page rather than creating a competing page.
- Header profile menu now contains both `Reset password` and `Sign out`, making the menu the authenticated entry point for account security actions.
- WatchDog/dev verifiers reject JWTs with `type: refresh` so refresh tokens cannot be used as protected-route authorization tokens.

Accepted assumptions:
- Local logout must prioritize clearing client tokens and redirecting to `/login` over waiting for a successful server round trip.
- sid-less legacy tokens remain JWT-validated but cannot participate in session-status validation; newly issued WatchDog/dev tokens include `sid` through `IssueTokenUseCase`.

Open questions:
- None for the implemented code path. Run a browser smoke test against a booted local web/API stack before production deployment.

Artifacts:
- `apps/api/src/modules/auth/domain/logic/session-revocation.logic.ts`
- `apps/api/src/modules/auth/application/use-cases/revoke-other-sessions.use-case.ts`
- `apps/api/src/modules/auth/presentation/auth.controller.ts`
- `apps/api/src/modules/auth/presentation/auth.guard.ts`
- `apps/web/src/common/auth/session.ts`
- `apps/web/src/common/components/app-shell/AppHeader.tsx`
- `apps/web/src/features/account-security/AccountSecurityPage.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/settings/security/page.tsx`
- [[specs/session-logout-security-spec|Logout and Session Device Security Spec]]
- [[plans/session-logout-security-plan|Logout and Session Device Security Plan]]
- [[plans/master-implementation-checklist|Master Implementation Checklist]] item 02B
- `docs/account-security-self-service-summary-th.md` (Thai implementation summary, flow explanation, sequence diagrams, data dictionary, and user stories shared with 02A)

Verification:
- `corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/auth.guard.spec.ts src/modules/auth/auth-endpoints.spec.ts` passed 25/25.
- `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/common/auth/session.spec.ts` passed 2/2.
- `corepack pnpm --filter @watchdog-bms/api typecheck` passed.
- `corepack pnpm --filter @watchdog-bms/web typecheck` passed.
- `corepack pnpm --filter @watchdog-bms/api test` passed 652/652.
- `corepack pnpm --filter @watchdog-bms/web test` passed 111/111.

Next:
- Before production deployment, run a browser smoke path: login, open profile menu, confirm `Reset password` routes to Account Security, click Sign out, verify `/login`; login in two browsers, run Account Security revoke-others, verify the other browser is rejected on next API request.
