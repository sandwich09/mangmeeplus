# Agent Memory: PDPA notice page + per-employee AI opt-out

Status: Implemented, tested, committed on `develop` (`aaa77719`).
LIVE VERIFICATION COMPLETE 2026-07-28 ~17:05: after the RedisRateLimitService DI fix
landed (other lane), api-verify booted; toggle round-trip verified at every layer —
GET null → POST 204 → GET timestamp → POST 204 → GET null; junk body 400; two
`auth.ai_assistant.preference_update` audit rows in the real DB (psql); UI card on
Settings → Security flips ปิด→เปิด with the timestamped Thai copy, via dev sign-in on
web-verify-3004/api-verify-3012. Local DB needed the two L-01 AuthSession columns
applied directly (their idempotent SQL) because `migrate deploy` still dies earlier on
the non-idempotent objectVersionId migration. Remaining live check: opted-out LINE
webhook reply needs a real LINE-signed request — covered by unit tests only.
Owner: thawatchai (order 2026-07-28); executed by Claude session.
Scope: closes the two `[GAP]` items in
`docs/security-evidence/p1-ai-processor-lawful-basis-register.md` §6.

Decisions:
- Opt-out is **user-level** (`User.aiAssistantOptOutAt DateTime?`), not per-company:
  the LINE assistant resolves the user before the company, and the objection is personal.
- Gate sits in `process-line-webhook.use-case.ts` on both entry paths (text + media),
  immediately after identity resolution — `identity.user` is already loaded there, so the
  check costs zero extra queries and runs before any model/tool/gateway involvement.
  Event-log status `ai_opt_out` (error code reuses `FORBIDDEN`; the status string is the
  discriminator — no contracts change, no dist rebuild).
- Media intake opts out too (it is part of the assistant); **web** receipt upload (P2,
  legal-obligation basis) deliberately unaffected.
- Self-service endpoint follows the `account/email` precedent exactly: write gated by
  `account.password.change` (the established self-service account-write key) — no new
  permission key, no ROLE_GRANTS churn, no template-sync ops at deploy.
- Audit action registered: `auth.ai_assistant.preference_update` (typed AuditAction).
- Privacy page is static/public fact-only content; unsubscribe keywords are quoted
  byte-identical to `CONSENT_DEFAULTS.unsubscribeKeywords` (`ยกเลิกข่าวสาร`, `หยุดโปร`,
  `STOP`) — publishing a keyword the code does not recognise would advertise an opt-out
  that silently does nothing.

Artifacts:
- Spec `docs/specs/pdpa-notice-and-ai-opt-out-spec.md`, plan
  `docs/plans/pdpa-notice-and-ai-opt-out-plan.md`.
- API: schema + migration `20260728200000_user_ai_assistant_opt_out` (idempotent
  ADD COLUMN IF NOT EXISTS), webhook gate, `set-ai-assistant-preference.use-case.ts`,
  `account/security` response field, `POST account/ai-assistant`, module wiring.
- Web: `/privacy` page, login footer link, Settings → Security AI card,
  `setAiAssistantEnabled()` client.
- Tests: 2 gate tests in `process-line-webhook.use-case.spec.ts`; 3 preference tests in
  `auth.controller.spec.ts` (both files already in the hand-maintained api test list —
  nothing to register). Controller-spec positional constructors updated for the new
  constructor param (3 sites, +1 stub each).

Verification:
- api 2695/2695, web 397/397, `tsc --noEmit` clean both.
- Local DB: column applied + verified via `prisma db execute` (explicit DATABASE_URL —
  known apps/api/.env trap).
- Browser: `/privacy` renders publicly with full Thai content on web-verify-3004;
  login page shows the notice link. The "1 Issue" dev overlay is the pre-existing
  CSP/eval dev-mode warning, unrelated.
- NOT verified live: toggle round-trip + opted-out LINE reply (needs a booting API).

Blockers (not this task's code):
- **The working tree currently fails API boot**: Nest DI error —
  `RedisRateLimitService` (concurrent M-12/L-* lane WIP) injects config typed as
  `Pick<AppConfigService, ...>`, which emits no runtime DI token
  (`UnknownDependenciesException` at index [0]). Unit suites pass because they never
  boot Nest. Reproduce: api-verify launch (swc build + node dist) — fails in seconds.
  HEAD may share the pattern; a boot check belongs in that lane's verification.
- `prisma migrate deploy` on the local dev DB fails earlier on a different lane's
  non-idempotent migration (`AttachmentObject.objectVersionId` already exists — local
  drift). My column was applied directly (idempotent SQL) instead.

Riders included in this commit (concurrent lane, additive + green, attributed):
- schema `AuthSession.familyId` hunk + untracked migration
  `20260728192000_l01_refresh_token_family` (inseparable same-file hunk; HEAD has zero
  familyId references, so the pair is unused-but-consistent).
- `auth.controller.ts` L-10 hunk (`await this.audit?.log` on denied login).

Next:
- Once the RedisRateLimitService DI is fixed by its lane: boot api-verify, log in, flip
  the toggle, confirm GET reflects it, and (if feasible) send a LINE text as the
  opted-out user to see the deterministic refusal; then mark the live check done here.
- Deploy: migration is additive/idempotent; no template-sync; web + api deploy together.
- Legal review of the notice wording rides the register §3 decision.
