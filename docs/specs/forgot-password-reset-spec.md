# Feature: Forgot Password, Email Capture, and Self-Service Reset

## 1. Status

- Roadmap/checklist item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 02A. Forgot Password, Email Capture, and Self-Service Reset
- Owner: Codex implementation pass completed for core web/API flow on 2026-07-01
- Date: 2026-07-01
- Implementation note: core self-service email verification, forgot-password, reset-password, verify-email, and Account Security email management are now in repo. Real SES delivery and distributed Redis-backed rate limiting are still follow-up hardening work; the current implementation uses the disabled/local-console mailer boundary and a process-local feature-scoped limiter.

## 2. Source Docs

- Product/overview: [[specs/sme-business-os-overview|SME Business OS Overview]]
- Related specs:
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/admin-company-onboarding-spec|Admin Company Onboarding and Partner Management Spec]]
  - [[specs/employee-access-role-management-spec|Employee Access and Role Management Spec]]
  - [[specs/session-logout-security-spec|Session Logout and Device Security Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
- Related plans: [[plans/forgot-password-reset-plan|Forgot Password and Self-Service Reset Plan]]
- Related ADRs: [[adr/0009-auth-security-email-delivery|ADR 0009: Auth-Security Email Delivery]], [[adr/0005-aws-first-hosting-and-deployment-strategy|ADR 0005: AWS-First Hosting]]
- Permission matrix: [[specs/permission-matrix|Permission Matrix]]

## 3. Goal

Close a documented gap: `Doc/watchdog-bms-login-task-status.md` records "Forgot password / reset password self-service" as **Not done**, with no reset endpoint anywhere in `auth.controller.ts`, and no self-service remedy when a temporary password is lost or expires (`admin-company-onboarding-spec.md` today only offers admin-run regeneration).

Give any user with a verified email on file a way to recover account access without administrator intervention: request a reset link, receive it by email, and set a new password themselves. Because **no account-creation path in the codebase sets `User.email` today** (verified directly against `create-company-onboarding.use-case.ts` and `create-employee.use-case.ts` — the column exists, nothing writes to it), this feature also has to add the missing prerequisite: a self-service way for any authenticated user to add and verify their own email address. Without that prerequisite, "self-service reset" would have zero eligible accounts on day one.

## 4. Non-goals

- Public self-service signup. Account creation stays admin/system-admin driven, per the existing non-goal in `admin-company-onboarding-spec.md`.
- LINE-based password reset initiation or finalization. This is an existing, explicit non-goal (`admin-company-onboarding-spec.md`: "LINE-based password reset ... is a non-goal"). LINE may only carry an optional, informational, read-only "your password was changed" notice after the fact — never the reset link, never the confirmation step.
- General-purpose email/notification infrastructure (marketing, reports, digests). This feature adds email as a channel scoped strictly to auth-security transactional messages (see [[adr/0009-auth-security-email-delivery|ADR 0009]]). Reuse by other modules is a separate future decision.
- SMS delivery.
- A visual "list every active session/device" UI. That is explicitly scoped to [[specs/session-logout-security-spec|Session Logout and Device Security Spec]], which this feature depends on only for its shared session-revocation behavior, not for its own goal.
- Changing how admin-issued temporary passwords are created or handed off. That flow (`admin-company-onboarding-spec.md`, `employee-access-role-management-spec.md`) is unchanged; this feature adds a parallel self-service path, it does not replace the admin-assisted one.

## 5. User Roles

- Owner: can self-verify email and self-serve reset, same as any user.
- Admin: same as Owner.
- Manager / Staff / Accountant or finance: same self-service path as any user; if they have no verified email, they still fall back to the existing admin-assisted "regenerate credential" flow (unchanged, out of scope here).
- AI assistant user: not applicable. LINE/AI must refuse any request to initiate, approve, or finalize a password reset or an email change — these are account-mutation actions and must stay web-only per existing platform policy.

## 6. Business Journey

### 6a. Email capture and verification / authenticated reset entry (prerequisite)

1. Trigger: an authenticated user opens the user menu from their name at the bottom of the sidebar, clicks **Reset password**, lands on the shared **Account Security** settings page, and enters an email address (first time) or changes an existing one.
2. Main user action: submit email, confirmed with current password (same re-authentication pattern as `change-password`).
3. System response: creates a short-lived, single-use, hashed verification token for the pending email and sends a verification email. If the user already had a verified recovery email, that currently-verified address stays active until the pending email is confirmed.
4. Review or approval: user clicks the emailed verification link, which opens the public `/verify-email?token=...` flow.
5. Completion state: `User.email` and `User.emailVerifiedAt` are updated; the new email is now eligible for password-reset delivery.
6. Exception path: user never clicks the link — email stays unverified and is silently ignored by the reset-request lookup (see Business Rules).

### 6b. Forgot password (request)

1. Trigger: user on the login page cannot sign in (forgotten password, or a temporary/expired password with no admin nearby) and clicks the compact "Forgot password?" link under the password field.
2. Main user action: enters their email or username on `/forgot-password`.
3. System response: **always** returns an identical, generic acknowledgement ("if we found an eligible account, we've sent a link"), regardless of match. Internally, if-and-only-if the identifier resolves to a `User` that is `ACTIVE`, has a `UserCredential` that is not `DISABLED`, and has a **verified** email, a single-use reset token is issued and emailed.
4. Review or approval: none (self-service, no human gate).
5. Completion state: user has a live 30-minute reset link in their inbox, or (silently) nothing happens if ineligible.
6. Exception path: no verified email on file -> generic response still shown; user must ask their company Owner/Admin for a credential regeneration (existing flow, unchanged).

### 6c. Reset password (confirm)

1. Trigger: user opens the emailed link (`/reset-password?token=...`).
2. Main user action: enters and confirms a new password (min 10 characters, matching the existing `change-password` rule).
3. System response: validates the token is unexpired/unused and the account is still eligible, atomically marks the token used, updates the credential, force-revokes every other active session for that user, and auto-issues a fresh token pair (same shape as normal login).
4. Review or approval: none.
5. Completion state: user is signed in with their new password; all other sessions are logged out.
6. Exception path: expired/used/unknown token -> one uniform "this link is no longer valid, request a new one" message (no distinction between the three causes, to avoid leaking token state).

## 7. Business Rules

- Rule: `/forgot` always responds identically (status, shape, and — as far as practical — timing) whether or not the identifier matches a real, eligible account. No enumeration signal may leak through this endpoint.
- Rule: only a **verified** email (`emailVerifiedAt` non-null) is eligible for reset delivery. A new email is kept in `EmailVerificationToken.newEmail` until the user confirms it, so an attacker with a hijacked session cannot make an unverified address eligible for password reset.
- Rule: reset tokens are single-use, enforced by an atomic claim (matching the existing `EmployeeLineLinkToken` hash-store-claim pattern), and expire after 30 minutes (longer than the 15-minute LINE-link token, because email delivery and inbox-checking are slower than an in-app QR scan).
- Rule: requesting a new reset link revokes any still-pending token for that user first — only one live reset token per user at a time.
- Rule: a successful reset force-revokes every other active session for that user (industry-standard "password reset invalidates other sessions" behavior) and clears `mustChangePassword`/`expiresAt`, exactly like the existing forced-change flow.
- Rule: self-service reset is **allowed** for accounts still in `TEMPORARY` credential status, including expired temporary passwords. Rationale: `User.email` is only ever set by the account holder themselves, post-first-login, through the re-authenticated Account Security flow in 6a — never self-reported pre-first-login, and never admin-entered on someone else's behalf. There is therefore no "attacker races the legitimate employee to claim an email before they ever log in" window: an account with no verified email simply cannot be reset self-service, regardless of credential status, and an account that already has a verified email got it through a channel the legitimate holder controlled. This directly closes the gap the status doc flags ("no self-service reset if forgotten or expired") without reopening the onboarding trust model. Recorded here as a deliberate decision, not a default, since it changes the edge-case behavior documented in `admin-company-onboarding-spec.md` (system-admin-regenerate is no longer the *only* remedy).
- Exception: if a `User`/`CompanyMembership` becomes suspended/disabled between request and confirm, the confirm step must deny even a validly-claimed token (fail closed).
- Audit requirement: every outcome of `/reset` (success, expired, used, unknown, ineligible) is audited. `/forgot` audits only "matched a real user but ineligible" and "issued" outcomes — pure not-found lookups are not audited, to avoid flooding the audit log with ordinary typos.
- Approval or threshold: none — this is deliberately un-gated self-service, by design.

## 8. Boundary and Ownership

- Web owns: the sidebar footer user-menu `Reset password` entry for authenticated users, the public `/forgot-password`, `/reset-password`, and `/verify-email` pages, the Account Security settings page (email capture/verification, shared with [[specs/session-logout-security-spec|Session Logout and Device Security]]'s "log out of all other devices" action), and all password/email mutation UI.
- LINE/LIFF owns: nothing in this flow except an optional, best-effort, informational "your password was changed" push if the user already has LINE linked. LINE cannot request, approve, or view reset state.
- Backend/API owns: `PasswordResetToken` and email-verification-token lifecycle, eligibility checks, rate limiting, credential mutation, session revocation, audit, and the email-delivery port/adapter.
- AI Gateway owns: nothing. AI tools must refuse any password/email-mutation request.
- Workers/notifications own: the optional LINE informational push only (deferred, see plan Phase 5); real email sending goes through the API's own mailer adapter (AWS SES), not the workers' notification pipeline, because that pipeline (`dashboard-notifications`) is company-scoped and this is a user-level, possibly-company-less event.
- Out of boundary: SMS, marketing email, general notification-center integration.

## 9. Data Model Draft

- Entity: `User` (existing, extended)
  - field: `emailVerifiedAt` (new, nullable `DateTime`)
  - lifecycle/status: null until the user completes the verification-link flow in 6a; reset to null on every email change.
  - source of truth: `apps/api` Prisma schema.
- Entity: `EmailVerificationToken` (new)
  - field: `id`, `userId`, `newEmail` (the pending, not-yet-committed address), `tokenHash` (SHA-256, unique), `status` (PENDING/USED/EXPIRED/REVOKED), `expiresAt`, `usedAt`, `createdAt`.
  - lifecycle/status: mirrors `EmployeeLineLinkToken`'s hash-store-claim pattern; claiming the token is what actually writes `User.email` + `emailVerifiedAt`.
  - source of truth: `apps/api` Prisma schema.
- Entity: `PasswordResetToken` (new)
  - field: `id`, `userId`, `tokenHash` (SHA-256, unique), `status` (PENDING/USED/EXPIRED/REVOKED), `expiresAt`, `usedAt`, `createdAt`. No `companyId` — password/credential is a `User`-level concept (a `User` may have zero companies, e.g. `SYSTEM_ADMIN`).
  - lifecycle/status: single-use via atomic claim; superseded on each new `/forgot` request.
  - source of truth: `apps/api` Prisma schema.

## 10. Permission and Audit

- Read permission: none required — `/forgot` and `/reset` are `@Public()` by definition (the user cannot authenticate; that is the whole premise of the feature). The email-capture endpoint is authenticated and reuses `account.password.change`-equivalent re-auth (current password required), no new permission key needed.
- Create/update permission: n/a (public routes); email-set endpoint requires an active session only (self-service, own account only — no admin permission needed to manage your own email).
- Approve/export/admin permission: none — this feature is deliberately un-gated self-service.
- ABAC/ownership rules: a user may only ever set/verify/reset their own account; there is no "reset on behalf of another user" path in this feature (that remains the existing admin-regenerate-credential flow).
- Sensitive actions to audit:
  - `auth.email.change_request` (MEDIUM) — new/changed email submitted, pending verification.
  - `auth.email.verified` (MEDIUM) — verification completed.
  - `auth.password.reset_request` (MEDIUM) — issued only when a real, eligible account matched.
  - `auth.password.reset_confirm` (HIGH — higher than `account.password.change`'s existing MEDIUM, because there is no proof-of-current-password in this flow) — must fail closed if the audit write itself fails (matches existing "high-risk actions must fail closed" rule).
  - `auth.password.reset_failure` (MEDIUM) — any denied/expired/used/unknown-token outcome of `/reset`.

## 11. API Behavior

- Endpoint: `POST /v1/auth/password/forgot` — Permission: `@Public()`. Validation: `identifier` non-empty string (email or username), rate-limited per-identifier and per-IP. Success response: identical generic 200 body regardless of match. Error cases: 429 on rate limit; 422 on missing/invalid identifier. Idempotency: repeated calls are safe (each supersedes the prior pending token).
- Endpoint: `POST /v1/auth/password/reset` — Permission: `@Public()`. Validation: `token` non-empty, `newPassword` min 10 chars. Success response: same shape as password-login (`accessToken`, `refreshToken`, `passwordChangeRequired: false`, `companyId`, `redirectPath`) — the user is auto-signed-in. Error cases: one uniform 400/403 for any invalid/expired/used/unknown token (no distinguishing detail); 422 for a too-short password; 429 on rate limit. Concurrency: exactly one of two simultaneous requests against the same token succeeds (atomic claim).
- Endpoint: `POST /v1/auth/account/email` (exact path decided at implementation time under the auth or a new `account-security` module) — Permission: authenticated session, current-password required in body. Validation: email format, current password matches. Success response: 202/204, verification email sent. Error cases: 401 wrong current password; 422 invalid email format; 429 rate-limited to prevent verification-email spam.
- Endpoint: `POST /v1/auth/account/email/resend` — Permission: authenticated session. Validation: none beyond the active session; resends the latest still-pending verification link for the current user. Error cases: 404 if there is no pending verification request; 429 on rate limit.
- Endpoint: `POST /v1/auth/account/email/verify` — Permission: `@Public()` (token itself is the proof). Validation: token non-empty. Success response: commits `User.email`/`emailVerifiedAt`. Error cases: uniform invalid/expired-token error.

## 12. UI Behavior

### Web

- Main screen: sidebar footer user menu with `Reset password` for authenticated users; `ForgotPasswordPage` (single field + submit, generic success panel, no retry/resend affordance to avoid implying "did it work?"); `ResetPasswordPage` (new password + confirm-new-password, auto-redirect to dashboard on success); `VerifyEmailPage` (public one-click verification state); `AccountSecurityPage` (current email + verified/unverified state, change-email form, resend action, shared with the logout feature's "log out of all other devices" action).
- List/detail/form pattern: simple single-purpose forms, no list views.
- Loading/cover loader scope: form-scoped `CoverLoader` on every submit; page-scoped transitional loader during the post-reset auto-redirect.
- Empty/error/forbidden/readonly states: the login page keeps only the compact `Forgot password?` link and no longer renders a separate reset-password promo card. Missing/invalid `?token=` on page load renders the invalid-link state immediately, without showing a form the user could fill in against a dead request. Rate-limit (429) shows a distinct inline banner, not a full error-page swap, so the form stays usable after cooldown.
- Admin actions: none — this feature has no admin surface. The existing admin "regenerate credential" screen is unchanged and remains the fallback for accounts without a verified email.

### LINE/LIFF

- AI question or alert: none in this flow.
- Summary response: not applicable.
- Deep link to web: not applicable.
- Permission/error state: LINE/AI must explicitly refuse any password-reset or email-change request routed to it, with a message pointing the user to the web login page.
- Mutation boundary: LINE never touches this feature's state. The only allowed LINE involvement is an optional, deferred, best-effort "your password was changed" informational push (Phase 5, not required for MVP).

## 13. Edge Cases

- Case: identifier matches a real user with no verified email -> generic success response shown, nothing actually sent.
- Case: identifier matches a `SUSPENDED`/`DISABLED` user, or a credential with `status = DISABLED` -> generic success response shown, nothing sent, but the internal denial is audited (identifier resolved to a real row).
- Case: user requests two reset links in a row -> first token is revoked when the second is issued; only the newest link works.
- Case: account is disabled by an admin between request and confirm -> confirm denies with the uniform error even though the token itself was still technically live; token is left unclaimed (verify-then-claim ordering) so a legitimately-re-enabled account is not forced to request a brand-new link.
- Case: user changes their email a second time before verifying the first change -> the newer pending change wins; the first `EmailVerificationToken` is superseded/revoked (mirrors the reset-token superseding rule).
- Case: user with `TEMPORARY`/expired credential and a verified email uses self-service reset -> allowed by design (see Business Rules); this is the exact gap the feature exists to close.

## 14. Acceptance Criteria

- [ ] Business journey matches product scope: self-service email verification, then self-service reset, both without admin involvement, while LINE never finalizes either.
- [ ] Web/LINE/AI boundaries are explicit: LINE only ever gets an optional informational push, never a mutation path.
- [ ] Permission, audit, loading, error, and empty states are covered, including the anti-enumeration generic-response requirement and the fail-closed audit rule on `reset_confirm`.

## 15. Test Cases

- Unit: token generation/hash determinism; eligibility gating (active+credential-not-disabled+email-verified) for `/forgot`; verify-then-claim atomic behavior for `/reset` under concurrent claims.
- Integration: full request -> confirm -> auto-login -> old-session-revoked journey; rate limiting triggers 429 after threshold; audit rows written for every `/reset` outcome and fail-closed on audit-write failure for `reset_confirm`.
- UI: generic success screen never varies by input; invalid-token state renders immediately on page load with no `?token=`; rate-limit banner leaves the form usable after cooldown.
- Permission: unauthenticated requests to `/forgot`/`/reset` succeed (they are meant to be public); authenticated-only email-change endpoint rejects a missing/invalid session and a wrong current password.
- Edge case: identifier not found vs. found-but-ineligible both produce byte-identical client-visible responses.

## 16. Open Questions

- Question: should `EMAIL_PROVIDER=ses` (see [[adr/0009-auth-security-email-delivery|ADR 0009]]) ship in the same delivery as the core reset flow, or land as a fast-follow once AWS SES domain/DKIM/sending-limit setup is ready? The plan phases this explicitly so the rest of the feature is not blocked on AWS account setup.
- Question: should the optional post-reset LINE informational push (Phase 5) reuse a new BullMQ producer path from `apps/api`, or a direct synchronous best-effort call using the API's existing (currently unused for outbound push) LINE Messaging credentials? Deferred until Phase 5 is actually scheduled.
