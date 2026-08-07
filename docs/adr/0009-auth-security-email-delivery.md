# ADR 0009: Auth-Security Email Delivery via AWS SES

## Status

Accepted

## Context

[[specs/forgot-password-reset-spec|Forgot Password, Email Capture, and Self-Service Reset]] needs to deliver a password-reset link and an email-verification link to a user outside of any authenticated session. No email or SMS sending capability exists anywhere in the codebase today (`apps/workers`' notification delivery adapters cover only `WEB` and `LINE`; `docs/specs/dashboard-notification-spec.md` explicitly defers email to a future feature). Without some real delivery mechanism, "self-service" password recovery cannot work end to end — the alternative is staying dependent on an administrator to hand off credentials, which is the exact limitation this feature exists to remove.

This decision is bigger than one feature: it introduces email as a new, first-class outbound channel for WatchDog-BMS, alongside the existing web and LINE channels recorded in [[adr/0008-line-ai-access-and-auth|ADR 0008]]. That is why it gets its own ADR rather than living only inside the feature's plan — it will outlast this one feature and other modules (e.g. item 18 Reports/BI's deferred "email delivery for report/export" backlog note) will eventually want to reuse the same foundation.

## Decision

Add AWS SES as the email provider, behind a provider port/adapter boundary, scoped narrowly to **auth-security transactional email only** (password-reset links, email-verification links, and later an optional "your password was changed" notice) — not a general-purpose notification, marketing, or reports email system.

- `EMAIL_PROVIDER=disabled|ses` env var, defaulting to `disabled`, mirroring the existing `MODEL_PROVIDER=disabled|bedrock|openai` idiom already established for AI Gateway providers.
- `disabled` is a true no-op in every environment; a separate local-dev-only console-log adapter (gated on `APP_ENV=local`, never reachable in staging/production) lets developers see the link without a real mailbox.
- AWS SES is chosen over a third-party transactional email API because it fits the already-decided AWS-first hosting stack ([[adr/0005-aws-first-hosting-and-deployment-strategy|ADR 0005]]) — same account, same region, same IAM/Secrets Manager boundary as everything else, no new vendor relationship.
- Scope stays narrow on purpose: this ADR does not approve a general email-notification system, digest emails, or marketing email. Any future feature that wants to send email should reuse the SES account/sending-domain setup this ADR establishes, but needs its own scoping decision about content, frequency, and unsubscribe/compliance handling — those are materially different concerns from a one-time security link.

## Consequences

### Positive

- Self-service password recovery becomes genuinely usable by real users, not just complete-in-code.
- Reuses the AWS-first hosting decision instead of introducing a second cloud vendor relationship.
- The `disabled`-by-default, adapter-behind-a-port shape means shipping without real delivery (Phase 5 of the linked plan not yet started) is a fully valid, secure state — nothing breaks by deferring it.
- Establishes a reusable foundation (verified sending domain, DKIM, IAM permissions) for any future email need, without committing to build that future need now.

### Trade-offs

- New external dependency: AWS SES sandbox limits (verified-recipients-only, low sending rate) apply until production access is requested and granted for the target AWS account/region — this can make the feature look broken in a fresh environment if not planned for explicitly.
- Bounce/complaint handling, sending-domain verification, and DKIM setup are new operational surface area that did not exist before this decision.
- Email as a channel introduces a new place secrets/PII can leak if logging discipline slips (the raw reset/verification link must never be logged outside the explicitly-gated local-dev adapter) — this is a new category the existing "never log secrets/tokens" rule now has to cover for a new payload shape.

## Alternatives Considered

### Third-party transactional email API (e.g. a dedicated email-as-a-service vendor)

Rejected for this pass. Would add a second external vendor relationship and a second secret-management surface when AWS SES already fits the existing AWS-first hosting decision with no new vendor onboarding.

### No email; admin-approved reset queue instead

Considered and explicitly offered to the product owner as an option (no new infrastructure, but not truly self-service — still requires a human in the loop, functionally identical to the existing admin-regenerate-credential flow). Rejected because it does not close the actual gap the feature exists to close: a user who cannot reach an admin still cannot recover access.

### Reuse the item-06 dashboard-notification pipeline for delivery

Rejected. That pipeline (`NotificationEvent`/`NotificationRecipient`) is company-scoped end to end; a password-reset email is a user-level, possibly-company-less event (a user may belong to zero companies, e.g. `SYSTEM_ADMIN`). Forcing it through that pipeline would mean firing a company-scoped event for something that is not a company event.

## Implementation Notes

- Provider port lives in `apps/api/src/modules/auth/domain/ports/auth-mailer.port.ts`; adapters in `apps/api/src/modules/auth/infrastructure/`.
- Never log the raw reset/verification link or token outside the explicitly `APP_ENV=local`-gated console adapter.
- `validateProductionConfig` must require `SES_REGION`/`SES_FROM_ADDRESS` (or equivalent) whenever `EMAIL_PROVIDER=ses`, matching how `MODEL_PROVIDER=openai`/`bedrock` already requires their own provider-specific secrets.
- Sending domain verification, DKIM, and (if the account starts in the SES sandbox) a production-access request are infrastructure prerequisites, not application code — track them as an operational checklist item before Phase 5 of the linked plan ships in any environment beyond local dev.

## Test Requirements

- SES adapter unit tests use a mocked AWS SDK client for both success and failure paths.
- Confirm no test or log output ever contains a raw reset/verification token or link outside the local-dev adapter's explicitly-gated path.
- `disabled` provider remains the default in every automated test run; no test depends on real SES connectivity.

## Follow-up Questions

- Should AWS SES production sending access be requested proactively before Phase 5 starts, or only once a real staging/production rollout is scheduled?
- If a future feature (e.g. item 18 Reports/BI's deferred email-export idea) wants to reuse this SES setup, does it need its own ADR, or is an addendum to this one sufficient? Lean toward a new ADR if the content/frequency/compliance profile differs materially from one-time security links.
