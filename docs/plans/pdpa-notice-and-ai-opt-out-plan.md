# Plan: PDPA privacy notice page + per-employee AI opt-out

Spec: `docs/specs/pdpa-notice-and-ai-opt-out-spec.md`. Ponytail full: shortest correct
diff, existing patterns only, no new dependency, no new permission key.

## Steps

1. **Schema + migration**
   - `apps/api/prisma/schema.prisma`: `aiAssistantOptOutAt DateTime?` on `User`.
   - New migration `20260728??????_user_ai_assistant_opt_out/migration.sql`, idempotent
     (`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "aiAssistantOptOutAt" TIMESTAMP(3);`)
     with the why-comment, matching `l01_refresh_token_family` style.
2. **Enforcement** — `process-line-webhook.use-case.ts`
   - Const `AI_OPT_OUT_REPLY` next to `UNLINKED_REPLY`.
   - Text path (~after line 512) and media path (~after line 1116): if
     `identity.user.aiAssistantOptOutAt` → deliverReply + `updateEventLog(id,
     'ai_opt_out', LINE_AI_ERROR_CODES.FORBIDDEN)` + return. No audit spam per message
     (user's own standing choice, not a security event; the event log row is the record).
3. **API self-service** — auth module
   - `get-account-security-state.use-case.ts`: select + return `aiAssistantOptOutAt`.
   - New `set-ai-assistant-preference.use-case.ts`: update own `User` row, audit
     `account.ai_assistant.updated` (result SUCCESS, riskLevel LOW, metadata
     `{ enabled }`).
   - `auth.controller.ts`: `POST account/ai-assistant`, 204,
     `@RequirePermissions('account.password.change')`, DTO `{ enabled: boolean }` in the
     auth dtos file; register use-case in `auth.module.ts`.
4. **Web** — `auth.api.ts`: extend `AccountSecurityState` type + `setAiAssistantEnabled()`.
   `AccountSecurityPage.tsx`: AI assistant card (status + toggle + Thai copy).
5. **Privacy page** — `apps/web/app/privacy/page.tsx` (server component, static Thai
   content per spec G1) + footer link on the login page.
6. **Docs** — register §3.1 objection route + §6 gap items; task memory file.

## Verification

- Extend `process-line-webhook.use-case.spec.ts` (already in the api test list — no
  registration needed): opted-out text event → deterministic reply, no gateway call,
  event log `ai_opt_out`; control: null opt-out proceeds.
- Extend `auth.controller.spec.ts` or use-case spec for the toggle round-trip.
- `tsc --noEmit` api + web; api targeted specs then full suite; web spec if the page
  has logic worth testing (toggle handler).
- Browser check: `/privacy` without a session; Settings → Security toggle visible.
- e2e DB: migrate before any e2e run (new column; known trap).

## Deploy notes (not this change)

- Migration is additive/idempotent — safe under the dirty-tree drift heal pattern.
- No template-sync needed (no new permission). No gateway deploy needed.
