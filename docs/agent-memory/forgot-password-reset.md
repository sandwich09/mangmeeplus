# Agent Memory: forgot-password-reset

Status: Core implementation landed on 2026-07-01. Web/API flow is now present in repo; checklist item 02A remains open for follow-up hardening.
Owner: Codex.
Scope: Self-service password reset for [[plans/master-implementation-checklist|Master Implementation Checklist]] item 02A. Added self-service email capture/verification, `PasswordResetToken` + `EmailVerificationToken`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/account/security`, `/auth/account/email`, `/auth/account/email/resend`, `/auth/account/email/verify`, feature-scoped rate limiting, and the web pages for forgot/reset/verify + Account Security email management.
UX update 2026-07-04: authenticated users now enter password/security management from the header profile menu `Reset password` action. The login page keeps only the compact public `Forgot password?` link and no longer shows a separate reset-password promo card.

Decisions:
- Self-service reset is allowed for `TEMPORARY`/expired credentials, not just `ACTIVE` ones — safe because `User.email` is only ever set by the account holder themselves post-first-login (never admin-entered or self-reported pre-first-login), so there is no "attacker races the legitimate user to claim an email" window.
- Verify-then-claim token ordering (matches the one existing precedent, `complete-employee-line-link.use-case.ts`), not claim-first.
- Auto-login (fresh token pair) after a successful reset, since all other sessions are force-revoked as part of the same action.
- `reset_confirm` audit write is fail-closed (HIGH risk); `reset_request` audit/mailer calls stay fire-and-forget to preserve uniform response timing across eligible/ineligible/not-found branches (anti-enumeration).
- Reset token TTL is a hardcoded 30-minute constant, not an env var; rate-limit thresholds stay env-configurable.
- LINE "password changed" push and auto-revoke-on-disable are both deferred to optional Plan Phase 6 — not required to ship.
- Current implementation keeps the `EMAIL_PROVIDER=disabled|ses` config shape but only ships the disabled/local-console adapter path; SES adapter/bootstrap is still follow-up work.
- Current implementation ships a process-local limiter (`AuthRateLimitService`) instead of Redis-backed distributed rate limiting; safe for local/single-instance flows but still a follow-up for horizontally scaled environments.
- User confirmed via AskUserQuestion: add self-service email capture for all users (not Owner/Admin-only), and keep AWS SES as the planned real-delivery target.

Accepted assumptions:
- `EMAIL_PROVIDER=disabled` (local-console-log adapter in local dev only) is the current safe ship state until SES is added.

Open questions:
- When should Phase 5 (real SES delivery) be scheduled, and should bootstrap fail hard or soft when `EMAIL_PROVIDER=ses` is selected before the adapter is added?
- Phase 6's LINE-push mechanism (new BullMQ producer vs. direct synchronous call from `apps/api`) needs a pick before Phase 6 starts, not before the core feature.

Artifacts:
- [[specs/forgot-password-reset-spec|Forgot Password, Email Capture, and Self-Service Reset Spec]]
- [[plans/forgot-password-reset-plan|Forgot Password, Email Capture, and Self-Service Reset Plan]]
- [[adr/0009-auth-security-email-delivery|ADR 0009: Auth-Security Email Delivery]]
- [[plans/master-implementation-checklist|Master Implementation Checklist]] item 02A
- `docs/account-security-self-service-summary-th.md` (Thai implementation summary, flow explanation, sequence diagrams, data dictionary, and user stories for this feature plus 02B)

Verification:
- `corepack pnpm --filter @watchdog-bms/api exec prisma generate`
- `corepack pnpm --filter @watchdog-bms/api typecheck`
- `corepack pnpm --filter @watchdog-bms/web typecheck`
- `node --import tsx --test src/modules/auth/auth-endpoints.spec.ts src/modules/auth/auth.guard.spec.ts src/modules/auth/application/use-cases/forgot-password-reset.use-case.spec.ts` -> 32/32 passing
- `node --import tsx --test src/common/api/api-error.spec.ts src/common/auth/session.spec.ts src/features/auth/auth.logic.spec.ts` -> 29/29 passing
- Browser smoke / real SES delivery are still pending.

Next:
- Schedule the remaining follow-up for SES delivery, distributed rate limiting, and live browser verification before checking item 02A complete.
