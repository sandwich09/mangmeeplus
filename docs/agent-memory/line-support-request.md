# Agent Memory: line-support-request

Status: IMPLEMENTED on `codex/line-support-request` (branched from `origin/develop` f44b0519,
which already contains `codex/line-signup-stale-identity`). Pushed, no PR. Not deployed.

Owner: Owner · spec `docs/specs/line-support-request-spec-th.md` (APPROVED-FOR-BUILD 2026-09-05)

Scope: `apps/api` (line-ai webhook, external-signup notify/ops-alert/inbox, auth mailer port +
three adapters, both LINE unlink writers), `packages/contracts`, `apps/web`
(`/system/support-requests` + system nav badge), Prisma migration `20260905170000_line_support_request`,
`.github/workflows/ci.yml` (one more pg spec in the existing Postgres step), docs.

## Decisions

1. **Owner 2026-09-05, mid-build — the web inbox is the PRIMARY channel.** Owner asked why operators
   cannot simply see and answer on the web, given none of them are LINE-linked. This overrides spec
   §2.2.2–§2.2.3 and is written up as "§2.2 delta" in the spec file on this branch. Consequences:
   the request row is created before any notification; notification = nav badge (always) + support
   mailbox email + optional LINE push; `notifiedAdminCount` became `lineNotifiedCount` +
   `emailSent`; "unreachable" means BOTH rails delivered nothing (the inbox does not count as
   having told anybody).
2. **The shop is re-derived on every tap**, never read from `LineCompanyContext`. That row is the
   UAT E2 mechanism. `resolveCompanyForLineUser` already encodes the tie-breaker the spec wants;
   its `needsSelection` answer falls back to the oldest ACTIVE membership, because a support ticket
   cannot ask a question.
3. **Dedupe is per OPEN request, not per Bangkok day.** The old key meant an answered-and-closed
   morning request blocked the same customer until tomorrow.
4. **Pause upserts** the context row. The old `updateMany` silently paused nobody when the customer
   had never used the company switcher — the common single-shop case.
5. **Support mailbox rides `AuthMailerPort`**, one new method + three adapters (the H-02 pattern).
   No new mailer. The disabled adapter returns `false` rather than a polite no-op, because that
   boolean is half of the unreachable alarm.
6. **All three /system endpoints use `system.partner_company.update`** — the partner message box's
   key, including the GET. A page whose list and buttons check different keys renders rows it will
   403 on, and answering is the only thing this page does.
7. **No new outbox event type.** `LINE_SUPPORT_NOTICE_EVENT_TYPE` is reused with a new key and a
   `schemaVersion: 2` payload, so `workflow-outbox-drain.use-case.ts` needs no change. A legacy
   v1 row (no `supportRequestId`) settles as published rather than failing — it describes a notice
   whose subject never existed as a row.
8. **Migration renamed** `20260905160000` → `20260905170000`: the local dev database already had a
   sibling branch's `20260905160000_expense_line_charge_kind`, and two migrations sharing a
   timestamp make apply order ambiguous.

## Open questions

- The signup queue has **no** OPEN-count badge, so there was no pattern to reuse; the badge built
  here (`SystemHeader.tsx`, fail-silent on 403/outage) is the first one and is the pattern the
  signup queue could adopt.
- `AiTurn.userMessagePreview` is the only durable record of what a customer typed, so
  `lastMessageText` is populated for a LINKED asker only. An unlinked prospect has none — the
  operator sees "—". Nothing else keeps it (the buffer is in-process; `LineWebhookEventLog.payloadJson`
  clears at every terminal status).
- `ANSWERED` has no automatic exit. The expiry sweep and the customer's resume both act on OPEN
  only, so an answered request rests in the ANSWERED tab as history. Matches the spec; flagged in
  case Owner wants it closed after N days.

## Artifacts

- Prisma: `apps/api/prisma/schema.prisma` (`LineSupportRequest`, `LineSupportRequestStatus`),
  `apps/api/prisma/migrations/20260905170000_line_support_request/migration.sql`
- API: `process-line-webhook.use-case.ts` (`handleStaffContact`, `resolveSupportAsker`,
  `pendingSignupFor`, `pauseAssistant`, `handleAssistantResume`), `line-staff-menu.logic.ts`
  (`RESUME_AI_COMMAND`, `RESUME_AI_ALT_COMMAND`, `'resume_ai'`),
  `line-signup-notify.service.ts` (`enqueueSupportRequest`, `deliverSupportNotice`,
  `sweepExpiredSupportRequests`, `supportAskerLabelTh`), `signup-admin-notify.service.ts`
  (`pushToLinkedAdmins` returns a count; `SUPPORT_QUEUE_PATH`, `SUPPORT_MAILBOX_EMAIL`),
  `signup-ops-alert.service.ts` (`support_unreachable`), `support-request-admin.use-case.ts`,
  `system-support-request.controller.ts`, `auth-mailer.port.ts` + 3 adapters,
  `unlink-line-identity.use-case.ts`, `partner-member-line-unlink.use-case.ts`,
  `send-partner-line-message.use-case.ts`
- Contracts: `packages/contracts/src/external-signup.ts` (`SupportRequestItemDto`,
  `SupportRequestQueueDto`, `SupportRequestActionDto`, `SupportRequestStatus`)
- Web: `apps/web/app/system/support-requests/page.tsx`,
  `apps/web/src/features/system-support-requests/*`, `SystemHeader.tsx`
- Docs: this file, spec §2.2 delta, P10-L §8 delta, support playbook section

## Verification

- `pnpm --filter @watchdog-bms/api test` — see the branch's final report for exact counts.
- `pnpm --filter @watchdog-bms/contracts test`, `apps/web` tests + `next build`, `pnpm -r typecheck`,
  `prisma validate`, `node infra/security/sync-production-maintenance-release-pins.mjs --check`
  (status=current; no pinned file touched).
- Real Postgres: `src/modules/external-signup/line-support-request.pg.spec.ts`, 7/7 against a
  throwaway `postgres:16-alpine` on 127.0.0.1:15444 (`LINE_SUPPORT_TEST_DATABASE_URL`), dropped
  afterwards. Wired into the existing CI Postgres step, one invocation of its own.
- Mutations, all reverted: stale context instead of membership (5 failures), drop the unreachable
  alert (3), resume not clearing the pause (5), unlink not clearing the context (3), day-keyed
  notice instead of request-keyed (1).

## Next

- Merge order matters only against `codex/line-support-request-docs`: the spec file is duplicated
  on this branch to carry the §2.2 delta. Take either side, then re-apply the delta section.
- Not done: no LIFF/status-card copy change (neither mentions contacting staff), no
  `line-ai-security-eval.ts` fixture (that corpus is the prepared-plan orchestrator lane; the
  exact-match/injection cases live in `line-staff-menu.logic.spec.ts`), no local LINE-fake drive.
- Before UAT: confirm `SES_FROM_ADDRESS` and the SES sandbox allow `contact@mangmeeplus.com` as a
  destination, or every request will read "แจ้งไม่สำเร็จ" until it does.
