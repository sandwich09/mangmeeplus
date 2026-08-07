# Forgot Password, Email Capture, and Self-Service Reset Implementation Plan

## Status

Core implementation landed on 2026-07-01 for the web/API/user-flow parts of item 02A. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 02A.

Item 02A stays unchecked until the remaining hardening gaps are closed and verification is recorded. Specifically, the current repo now has self-service email verification, forgot/reset endpoints, UI pages, audit actions, and a feature-scoped process-local limiter, but still defers real SES delivery and Redis-backed multi-instance rate limiting. Phase 6 remains optional/deferred and does not block checking the item.

## Linked Spec

- Spec: [[specs/forgot-password-reset-spec|Forgot Password, Email Capture, and Self-Service Reset Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 02A
- Related specs: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]], [[specs/admin-company-onboarding-spec|Admin Company Onboarding Spec]], [[specs/employee-access-role-management-spec|Employee Access and Role Management Spec]], [[specs/session-logout-security-spec|Session Logout and Device Security Spec]], [[specs/permission-matrix|Permission Matrix]]
- Related guidelines: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]], [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]], [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs: [[adr/0009-auth-security-email-delivery|ADR 0009: Auth-Security Email Delivery]]

## Purpose

Implement self-service password recovery end to end: a user can add and verify their own email, then use it to request and complete a password reset without administrator involvement, closing the gap recorded in `Doc/watchdog-bms-login-task-status.md` ("Forgot password / reset password self-service" — Not done). This plan gives the implementer enough detail to build without reopening the product/security decisions already recorded in the linked spec.

## Current Repository Context

Verified directly against the current codebase snapshot used for implementation (2026-07-01):

- `apps/api/src/modules/auth/` already has the full password-credential foundation to build on: `UserCredential` (scrypt hash, `mustChangePassword`, `status`, `expiresAt`), `AuthSession`, `password-login.use-case.ts`, `change-password.use-case.ts`, `password-credential.logic.ts` (`hashPassword`/`verifyPassword`).
- `EmployeeLineLinkToken` (`apps/api/prisma/schema.prisma`) and `complete-employee-line-link.use-case.ts` are the one existing precedent for a short-lived, hashed, single-use token: raw token via `randomBytes(N).toString('base64url')`, SHA-256 hash stored, atomic `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'USED', usedAt } })` claim, verify-then-claim ordering (eligibility checked before the claim, not after).
- `User.email` exists in the schema but **nothing writes to it today** — confirmed by reading `create-company-onboarding.use-case.ts` (owner creation: only `displayName`+`username`) and `create-employee.use-case.ts` (employee creation: only `displayName`+`username`, contact is `phoneNumber`, not email). This is why Phase 1 below exists.
- `apps/web/src/features/auth/` has `LoginPage.tsx` and `ChangePasswordPage.tsx`, both flat files calling raw `fetch()` directly and managing `localStorage` tokens inline (`watchdog.accessToken`/`watchdog.refreshToken`, with some other features also checking a legacy `watchdog.auth.accessToken` fallback key). Shared-but-currently-unused primitives exist and should be adopted by new code: `common/api/http-client.ts` (`createWebApiClient`), `common/api/api-error.model.ts`/`api-error.logic.ts` (typed `ApiError`, currently has **no case for HTTP 429** — extend it), `common/components/field/Field.tsx` (`TextField`/`FieldError`), `common/components/button/Button.tsx`, `common/components/state/ErrorState.tsx` and `CoverLoader`.
- `RATE_LIMIT_ENABLED`/`RATE_LIMIT_WINDOW_SECONDS`/`RATE_LIMIT_MAX_REQUESTS` exist in `packages/config/src/index.ts` and are already asserted required in `validateProductionConfig` for the API — but are wired into **no actual guard anywhere**. This plan closes that gap for its own two endpoints only (not a generic all-routes limiter — that is explicitly out of scope, see below).
- `apps/ai-gateway`'s `MODEL_PROVIDER=disabled|bedrock|openai` is the established idiom in this repo for "new external provider, off by default, selected via config" — this plan's `EMAIL_PROVIDER` follows the same shape.
- No email/SMS sending capability exists anywhere in the codebase (`apps/workers`' notification delivery adapters cover only `WEB` and `LINE`). AWS SES is a new dependency, recorded in [[adr/0009-auth-security-email-delivery|ADR 0009]].
- `apps/api/src/modules/dashboard-notifications/` (item 06) is company-scoped end to end (`NotificationEvent.companyId` required) and does not fit a user-level, possibly-company-less event like "your password changed" — do not force this feature through that pipeline (see Phase 6).

## Implementation Rules

- Follow [[plans/master-implementation-checklist|Master Implementation Checklist]].
- Reuse the `EmployeeLineLinkToken` hash-store-claim pattern for both new token types in this plan; do not invent a second token idiom.
- Reuse `password-credential.logic.ts`'s scrypt hashing; do not add a second hashing algorithm.
- Keep controllers thin; `/forgot`, `/reset`, and the email-capture endpoints only map DTOs to use cases.
- Do not build a generic, all-routes rate limiter. Build a minimal guard scoped to this plan's endpoints only, using feature-scoped env vars, not the generic `RATE_LIMIT_*` vars (those describe a different, larger, separately-scoped effort).
- Do not build a general email/notification system. The mailer port is scoped to auth-security transactional messages only (reset link, verification link), per [[adr/0009-auth-security-email-delivery|ADR 0009]].
- LINE/AI must never be able to request, approve, or finalize a password reset or email change (hard constraint, not configurable).
- New frontend pages go through `common/api/http-client.ts` and shared `Field`/`Button`/`ErrorState`/`CoverLoader` components; new page components stay flat inside `features/auth/` (matching the existing local convention in that folder) but get their own `auth.api.ts`/`auth.logic.ts` rather than raw `fetch()`.

## Scope

### In Scope

- `User.emailVerifiedAt` column; `EmailVerificationToken` model; self-service email set/change/verify flow, re-authenticated with current password.
- `PasswordResetToken` model; `POST /v1/auth/password/forgot` (anti-enumeration, rate-limited); `POST /v1/auth/password/reset` (atomic single-use claim, session revocation, audit, auto-login).
- Feature-scoped rate limiting for the four new public/semi-public endpoints. Current implementation uses a process-local service; Redis-backed multi-instance hardening remains follow-up work.
- `EMAIL_PROVIDER=disabled|ses` config boundary, with `disabled` as the safe default and a local-dev-only console-log adapter. SES bootstrap/adapter is still deferred.
- New audit actions: `auth.email.change_request`, `auth.email.verified`, `auth.password.reset_request`, `auth.password.reset_confirm`, `auth.password.reset_failure`.
- Web: profile-menu `Reset password` entry for authenticated users, `ForgotPasswordPage`, `ResetPasswordPage`, `VerifyEmailPage`, the email section of `AccountSecurityPage` (shared with [[plans/session-logout-security-plan|Session Logout and Device Security Plan]]), and `LoginPage.tsx` recovery-link cleanup (compact `Forgot password?` link only, no separate promo card).
- Decision already recorded in the spec: self-service reset is allowed for `TEMPORARY`/expired credentials, gated only on having a verified email (see spec Business Rules).

### Out of Scope

- Public self-service signup (existing non-goal, unaffected).
- LINE-based reset initiation/finalization (existing non-goal, unaffected).
- A general email/notification system, SMS delivery, or reuse of the item-06 dashboard-notification pipeline for this feature's transactional email.
- Generic/global rate limiting for all public endpoints (existing `RATE_LIMIT_ENABLED`/`WINDOW`/`MAX_REQUESTS` vars) — separate, larger effort.
- The optional post-reset LINE informational push and auto-revoke-tokens-on-disable defense-in-depth hook — both captured as Phase 6, non-blocking.
- Any change to how admin-issued temporary passwords are created or handed off (`admin-company-onboarding-spec.md`, `employee-access-role-management-spec.md` flows are unchanged).
- A "list all my devices" UI — that belongs to [[specs/session-logout-security-spec|Session Logout and Device Security Spec]].

## Phase 0: Discovery and Alignment

### Goal

- Confirm this plan and the linked spec still match current code before writing migration/use-case code; add checklist entry.

### Tasks

- [ ] Read this plan, the linked spec, `auth-authorization-rbac-spec.md`, `permission-matrix.md`, and both code-style guidelines.
- [ ] Re-inspect `apps/api/src/modules/auth/`, `apps/api/prisma/schema.prisma`, and `packages/config/src/index.ts` for any drift since 2026-07-01.
- [ ] Confirm [[plans/master-implementation-checklist|Master Implementation Checklist]] item 02A is present and linked correctly.
- [ ] Record start-of-implementation state in `docs/agent-memory/forgot-password-reset.md`.

### Tests

- None unless discovery changes code.

### Exit Criteria

- Alignment confirmed; no contradictions found between this plan and current code.

## Phase 1: Email Capture and Verification

### Goal

- Give every user a self-service way to add and verify their own email — the prerequisite for everything else in this plan.

### Tasks

- [ ] `apps/api/prisma/schema.prisma`: add `emailVerifiedAt DateTime?` to `User`; add `EmailVerificationToken` model (`id`, `userId`, `newEmail`, `tokenHash @unique`, `status` enum `PENDING/USED/EXPIRED/REVOKED`, `expiresAt`, `usedAt`, `createdAt`, index `[userId, status, expiresAt]`). Migrate.
- [ ] `apps/api/src/modules/auth/domain/logic/email-verification-token.logic.ts`: pure `generateRawToken()`/`hashToken()` (same shape as the LINE-link token helper, extracted as an importable pure function since two flows in this plan need the identical hash/claim idiom).
- [ ] `apps/api/src/modules/auth/domain/ports/auth-mailer.port.ts`: `sendEmailVerification(input: { toEmail: string; rawToken: string; expiresAt: Date }): Promise<void>` and `sendPasswordResetLink(input: { toEmail: string; rawToken: string; expiresAt: Date }): Promise<void>` on one shared port (both are auth-security transactional emails, one adapter serves both).
- [ ] `apps/api/src/modules/auth/infrastructure/disabled-auth-mailer.adapter.ts` (no-op default) and `local-console-auth-mailer.adapter.ts` (logs the link; wired only when `config.isLocal === true`, never via a runtime branch inside the disabled adapter).
- [ ] `apps/api/src/modules/auth/application/use-cases/request-email-change.use-case.ts`: input `{ userId, currentPassword, newEmail }`; verifies current password (reuse `verifyPassword`); revokes any pending `EmailVerificationToken` for the user; creates a new one (15-minute TTL, matching the LINE-link token's interactive timeframe since this is an in-session action); sends verification email; audits `auth.email.change_request` (MEDIUM).
- [ ] `apps/api/src/modules/auth/application/use-cases/confirm-email-verification.use-case.ts`: verify-then-claim ordering; on success, sets `User.email = token.newEmail`, `User.emailVerifiedAt = now()`; audits `auth.email.verified` (MEDIUM).
- [ ] `packages/config/src/index.ts`: add `EMAIL_PROVIDER: z.enum(['disabled', 'ses']).default('disabled')`; `apps/api/src/common/config/app-config.service.ts`: add `emailProvider` getter.
- [ ] `apps/api/src/modules/auth/presentation/auth.controller.ts` (or a new small `account-security.controller.ts` in the same module — decide at implementation time, keep it inside `auth` module either way): `GET /v1/auth/account/security`, `POST /v1/auth/account/email` (authenticated, `account.password.change`-style re-auth), optional `POST /v1/auth/account/email/resend`, and `POST /v1/auth/account/email/verify` (`@Public()`, token is the proof).
- [ ] `apps/api/src/modules/audit/domain/models/audit-action.ts`: add `AUTH_EMAIL_CHANGE_REQUEST`, `AUTH_EMAIL_VERIFIED`.

### Tests

- Unit: request-email-change rejects wrong current password; supersedes a prior pending token; confirm-verification rejects expired/used/unknown token with a uniform error; successful verification sets both `email` and `emailVerifiedAt` atomically.
- Integration: authenticated `POST /account/email` without a valid session returns 401; full change -> verify -> `emailVerifiedAt` non-null journey.

### Exit Criteria

- A logged-in user can add an email, receive a (locally logged, in dev) verification link, and end up with a verified email — with no reset functionality yet.

## Phase 2: Request-Reset Endpoint (`/forgot`)

### Goal

- Implement `POST /v1/auth/password/forgot`: anti-enumeration, eligibility-gated on Phase 1's verified email, rate-limited.

### Tasks

- [ ] `apps/api/prisma/schema.prisma`: add `PasswordResetToken` (no `companyId` — user-level, not company-scoped). Migrate.
- [ ] `apps/api/src/modules/auth/domain/logic/password-reset-token.logic.ts`: reuse the same generate/hash shape as Phase 1's token logic (consider a single shared `secure-token.logic.ts` used by both, rather than duplicating).
- [ ] `apps/api/src/common/redis/redis.module.ts` (new — first direct `ioredis` usage inside `apps/api`; `ioredis` is already a dependency via `apps/workers`' BullMQ usage, `REDIS_URL` is already a required env var): a single Redis client provider.
- [ ] `apps/api/src/common/security/rate-limit.guard.ts` + `@RateLimit()` decorator: Redis `INCR`+`EXPIRE` guard. Fails **closed** (rejects the request) with a short timeout if Redis is unreachable — an explicit, deliberate choice over failing open, since failing open on a public auth endpoint during exactly the kind of infra stress an attacker might induce is the worse trade-off.
- [ ] `packages/config/src/index.ts`: add `PASSWORD_RESET_REQUEST_MAX_PER_IDENTIFIER` (default `3`), `PASSWORD_RESET_REQUEST_MAX_PER_IP` (default `10`), `PASSWORD_RESET_REQUEST_WINDOW_SECONDS` (default `900`). Reset token TTL (30 minutes) is a hardcoded constant in the logic file, not an env var — one knob nobody will realistically tune.
- [ ] `apps/api/src/modules/auth/application/use-cases/request-password-reset.use-case.ts`: lookup by `OR: [{ email: identifier }, { username: identifier }]`; eligibility = `user.status === 'ACTIVE'`, `credential !== null`, `credential.status !== 'DISABLED'`, `user.emailVerifiedAt !== null`; if eligible, `$transaction` (revoke existing PENDING tokens, create new one); fire-and-forget mailer call and audit write (never block the response on either, to keep response timing uniform across eligible/ineligible/not-found branches); always return the same generic body. Audit only "matched but ineligible" and "issued" — skip pure not-found.
- [ ] `apps/api/src/modules/auth/presentation/auth.controller.ts`: `POST password/forgot`, `@Public()`, guarded by the new rate limiter.
- [ ] `apps/api/src/modules/audit/domain/models/audit-action.ts`: add `AUTH_PASSWORD_RESET_REQUEST`.
- [ ] `.env.example`: document new vars with local-safe defaults.

### Tests

- Unit: eligible/ineligible/not-found all call (or don't call) the mailer correctly but return identical response shapes; existing PENDING token revoked before a new one issues; rate-limit guard returns 429 past threshold and resets after the window; Redis-unreachable path fails closed with a clear error, not a silent pass-through.
- Integration/controller: valid vs. invalid identifier produce identical status/shape; `@Public()` confirmed (no auth header needed); DTO rejects empty/oversized/extra-field input per the security guideline's required-tests checklist.

### Exit Criteria

- `/forgot` is live, generic, rate-limited, and audited per the rules above; no real email is sent yet (`EMAIL_PROVIDER=disabled` default, local console link for manual dev QA).

## Phase 3: Confirm-Reset Endpoint (`/reset`)

### Goal

- Implement `POST /v1/auth/password/reset`: atomic single-use claim, credential mutation, force session revocation, auto-login, full audit coverage of every outcome.

### Tasks

- [ ] `apps/api/src/modules/auth/application/use-cases/confirm-password-reset.use-case.ts`:
  - Lookup by `tokenHash`. Not-found/expired/already-used -> audit `auth.password.reset_failure` (DENIED, `actorUserId` null if unresolvable) -> one uniform client error (no distinction by cause).
  - **Verify-then-claim ordering** (matches the one existing precedent in `complete-employee-line-link.use-case.ts`): check user/credential eligibility first, then atomically claim (`updateMany({ where: { id, status: 'PENDING' }, data: { status: 'USED', usedAt } })`, require `count === 1`). If eligibility fails, do not claim — the token survives for a later legitimate retry if the account is re-enabled. If the atomic claim loses a race to a concurrent request, audit failure, uniform error.
  - On success, in one transaction: update `UserCredential` (new `passwordHash`, `status: 'ACTIVE'`, `mustChangePassword: false`, `expiresAt: null`), revoke every `ACTIVE` `AuthSession` row for the user.
  - Audit `auth.password.reset_confirm` (SUCCESS, HIGH, metadata includes `revokedSessionCount`, never the raw token or password) — **fail closed**: if this audit write throws, the whole use case must fail/roll back, per the existing "high-risk actions fail closed on audit failure" rule. This is different from Phase 2's request-side audit, which stays fire-and-forget to preserve uniform response timing.
  - Auto-issue a fresh access/refresh token pair via the existing `IssueTokenUseCase` (same call `password-login.use-case.ts` already makes) and return it in the same response shape as login.
- [ ] `apps/api/src/modules/auth/presentation/auth.controller.ts`: `POST password/reset`, `@Public()`, rate-limited (`PASSWORD_RESET_CONFIRM_MAX_PER_IP`, default `10`/`900s`, new config vars matching Phase 2's naming pattern).
- [ ] `apps/api/src/modules/audit/domain/models/audit-action.ts`: add `AUTH_PASSWORD_RESET_CONFIRM`, `AUTH_PASSWORD_RESET_FAILURE`.
- [ ] Confirm (no code change expected): `auth.guard.ts`'s existing `MUST_CHANGE_PASSWORD_EXEMPT_PREFIX = '/v1/auth/'` already covers these routes.

### Tests

- Unit: valid token + eligible user -> password updated, all `ACTIVE` sessions revoked, fresh tokens issued, audit SUCCESS/HIGH; expired/used/unknown token -> uniform failure, audit FAILED; eligible-at-lookup-but-disabled-at-claim (simulated race) -> uniform failure, token left unclaimed; two concurrent requests against the same valid token -> exactly one succeeds.
- Unit: forcing the audit write to throw on the success path causes the whole use case to fail (fail-closed check).
- Integration: full `/forgot` -> extract token (test-only Prisma read) -> `/reset` -> old session's access token now rejected (401) -> new login with the new password succeeds.
- Security-required-tests checklist: reused/expired/malformed token all rejected with the same message/status; malformed `newPassword` rejected by the existing `@MinLength(10)` rule.

### Exit Criteria

- `/reset` is live; single-use enforced and tested under concurrency; every outcome audited; success path fail-closed on audit; sessions force-revoked; user is auto-signed-in.

## Phase 4: Web UI

### Goal

- Ship `ForgotPasswordPage`, `ResetPasswordPage`, the email section of `AccountSecurityPage`, and the `LoginPage` recovery entry points.

### Tasks

- [ ] `apps/web/src/features/auth/auth.api.ts` (new): `requestPasswordReset(identifier)`, `confirmPasswordReset(token, newPassword)` — both via `createWebApiClient`, not raw `fetch`. Small inline request/response types live here rather than a separate `.model.ts` (too small to warrant one).
- [ ] `apps/web/src/features/auth/auth.logic.ts` (new): password confirm-match validator; `?token=` presence check; shared auth error helpers used by login/reset flows.
- [ ] `apps/web/src/features/auth/ForgotPasswordPage.tsx` (new, flat, matches existing sibling files): identifier field, generic always-shown "no email on file? ask your Owner/Admin" hint, `CoverLoader` on submit, uniform success panel with no resend affordance, inline 429 banner with a short client-side cooldown.
- [ ] `apps/web/src/features/auth/ResetPasswordPage.tsx` (new, flat): missing/empty `?token=` renders the invalid-link state immediately on mount (no form shown); new password + confirm-new-password fields (client-side match check only, never sent to the backend); on success, brief "signing you in..." page-scope `CoverLoader` then redirect to `redirectPath`/dashboard; invalid/expired/used token collapses into one `ErrorState`-shaped panel with a "Request a new link" action (navigates to `/forgot-password`, not a same-request retry).
- [ ] `apps/web/src/features/auth/VerifyEmailPage.tsx` (new, flat): public verification page that consumes `?token=` immediately and renders success/invalid-link states without requiring an existing session.
- [ ] `apps/web/app/forgot-password/page.tsx`, `apps/web/app/reset-password/page.tsx`, and `apps/web/app/verify-email/page.tsx` (new, thin route wrappers, mirroring `app/login/page.tsx`; reset/verify routes need `export const dynamic = 'force-dynamic'` since they read search params).
- [ ] `apps/web/src/features/auth/LoginPage.tsx`: keep a small "Forgot password?" link under the password field and do not render a separate reset-password promo/CTA card on the login screen.
- [ ] `apps/web/src/common/components/app-shell/AppHeader.tsx`: add `Reset password` to the header profile menu above `Sign out`, routing authenticated users to `/companies/:companyId/settings/security`.
- [ ] `apps/web/src/features/account-security/AccountSecurityPage.tsx` (new feature folder — this is an authenticated settings page, distinct from the public `auth/` pages): current email + verified/unverified badge, change-email form (current password + new email), "resend verification" action. **Coordinate with [[plans/session-logout-security-plan|Session Logout and Device Security Plan]] Phase 3, which adds the "log out of all other devices" section to this same page — do not build two competing pages.**
- [ ] `apps/web/src/common/api/api-error.logic.ts`: extend `mapResponseToApiError` with a `rate_limited` kind for HTTP 429 (currently falls through to `unknown`) — a small, backward-compatible common-layer fix that benefits future features too.
- [ ] `apps/web/src/common/i18n/workspace-dictionary.ts`: add a new `auth.*` key block (Thai + English) for every new string across `LoginPage`, `ForgotPasswordPage`, `ResetPasswordPage`, and the email section of `AccountSecurityPage` — see the spec's UI Behavior section for exact copy points; there is no existing `auth.*` namespace today (both existing auth pages hardcode English inline), so this introduces one cleanly rather than adding to that debt.

### Tests

- Component/unit: password confirm-match validator; temp-password-expired detection helper; token-presence empty-state logic.
- Manual/E2E browser check (per repo convention for non-trivial flows): full forgot -> (dev console link) -> reset -> auto-redirect journey; 429 banner appears and clears after cooldown; invalid-token state renders without a form.

### Exit Criteria

- A user can complete the entire self-service journey through the UI using the local console-log mailer adapter, with no real email provider required yet.

## Phase 5: Real Email Delivery (AWS SES)

### Goal

- Replace the `disabled`/local-console mailer with AWS SES per [[adr/0009-auth-security-email-delivery|ADR 0009]], so the feature is actually usable by real users in staging/production.

### Tasks

- [ ] `apps/api/src/modules/auth/infrastructure/ses-auth-mailer.adapter.ts`.
- [ ] `packages/config/src/index.ts`: `SES_REGION`, `SES_FROM_ADDRESS`; add a `validateProductionConfig` branch requiring these when `EMAIL_PROVIDER=ses`, mirroring the existing `MODEL_PROVIDER=openai`/`bedrock` required-var pattern.
- [ ] `AuthModule` factory: select the SES adapter when `config.emailProvider === 'ses'`.
- [ ] AWS-side prerequisites (infra, not code): verify sending domain/DKIM in the target region, request production sending access if the account starts in the SES sandbox, set a bounce/complaint handling policy (at minimum: log and alert; auto-suppression is a reasonable fast-follow, not required to ship).
- [ ] `.env.example` updates.

### Tests

- Unit: SES adapter with a mocked AWS SDK client — success and failure paths; confirm no raw token/secret is ever logged.

### Exit Criteria

- `EMAIL_PROVIDER=ses` is a supported, production-required-var-validated configuration; verification and reset emails are actually delivered. Until this phase ships, `EMAIL_PROVIDER=disabled` is a fully valid, secure end state — the feature is code-complete and safe, just not yet reaching real inboxes outside local dev.

## Phase 6 (Optional, non-blocking): LINE Notice and Defense-in-Depth

### Goal

- Nice-to-have hardening: notify the user on LINE (if linked) after a password reset, and proactively revoke any pending reset/verification token when an admin disables the account.

### Tasks

- [ ] Best-effort, fire-and-forget "your password was changed" LINE push after a successful `/reset` — implemented as either a new minimal BullMQ producer call from `apps/api` into `apps/workers` (architecturally cleaner, but `apps/api` has never produced into a `apps/workers`-owned queue before — verify this is not a bigger lift than it looks) or a direct synchronous best-effort call from `apps/api` using its existing `lineMessagingChannelAccessToken` config (simpler, slightly less consistent with current cross-app boundaries). Pick one before starting; either is acceptable.
- [ ] In the existing "disable employee/user" use case (`apps/api/src/modules/employee-access/...`, emitting `ACCESS_EMPLOYEE_DISABLE`), add a side effect that revokes any `PENDING` `PasswordResetToken`/`EmailVerificationToken` for that user.

### Tests

- Unit: disabling a user with a pending token results in that token becoming `REVOKED`; a subsequent attempt against it fails with the standard uniform error.

### Exit Criteria

- Can ship independently of Phases 0-5; safe to defer to a follow-up ticket if time-boxed.

## Integration Verification

- Backend/API contract: all four new/changed endpoints documented in Swagger, matching existing controller conventions.
- Web journey: full forgot -> reset -> auto-login, and separately email-change -> verify, both click-tested against a real local Postgres + booted API + Next.js web (not unit tests alone), per this repo's UI verification convention.
- Loading/error/permission states: generic-response uniformity, invalid-token empty state, 429 banner, and the temp-password-expired LoginPage branch all verified live in a browser.
- E2E/browser check: required before marking item 02A complete, per master-checklist convention for auth-adjacent features.
- Commands: `pnpm --filter api test`, `pnpm --filter web test` (or repo-equivalent script names — confirm exact scripts during Phase 0), `pnpm --filter api prisma migrate deploy` against a real local Postgres, repo-wide typecheck.

## Risks

- The core value of this feature depends entirely on Phase 1 (email capture) actually getting adopted by real users after they log in once — if nobody ever sets an email, self-service reset stays theoretically complete but practically unused. Consider a light, non-blocking prompt on first login encouraging email verification as a fast-follow product decision (not required to ship this plan).
- Introducing the first direct `ioredis` client inside `apps/api` needs a clear degrade-on-Redis-outage story; this plan chooses fail-closed (reject requests) over fail-open, which is the more defensible security trade-off for a low-traffic public auth endpoint, but it does mean a Redis outage takes down self-service password recovery entirely — acceptable, but worth an operational alert once monitoring exists.
- `reset_confirm`'s fail-closed-on-audit-failure rule could make a legitimate reset appear to fail during a transient audit-DB blip — acceptable given the HIGH risk classification, but should be monitored.
- AWS SES sandbox limits (verified-recipients-only, low sending rate) can make Phase 5 look broken in a fresh AWS account until production access is granted — plan for this explicitly rather than treating it as a bug during rollout.

## Open Questions

- Should Phase 5 (real SES delivery) ship in the same release as Phases 0-4, or follow once AWS domain/DKIM/production-access setup is confirmed ready? Recorded as phased-but-not-yet-scheduled in this plan; decide before starting Phase 5.
- Phase 6's LINE-push mechanism (new BullMQ producer vs. direct synchronous call) needs a pick before Phase 6 starts, not before Phase 0-5 — it does not block the core feature.
