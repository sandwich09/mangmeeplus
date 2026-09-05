# Agent Memory: line-support-request

Status: IMPLEMENTED on `codex/line-support-request`, rebased onto `origin/develop` 91704151
(contains `codex/line-signup-stale-identity` and the LIFF UX batch #430). Pushed, no PR.
Not deployed.

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
9. **Review round 2 (29da5003) — `notifiedAt` is its OWN migration** (`20260905180000`), not an edit
   to `…170000`: reviewers had already applied that file, and changing an applied migration's bytes
   fails the checksum check on their next `migrate deploy`.
10. **The amplification floor answers, it does not throw.** Every other bucket in
    `AuthRateLimitService` guards an HTTP endpoint where a 429 is right; this one guards a chat
    message from somebody asking for help. Fails OPEN when Redis is absent — it bounds cost, it
    does not protect anything. Charged where a row is CREATED, so a repeat tap on an open request
    (which costs nothing) can never spend the last slot.
11. **`notifyState` is derived, not stored.** A stored third state could disagree with the counters
    it summarises; `notifiedAt IS NULL` is the whole distinction.
12. **The badge has two sources**: the cheap `/count` endpoint on navigation, plus a module-level
    subscription the inbox page publishes into after every read. `[pathname]` alone never fires
    when a request is answered from that very page.

## Review round 2 — findings addressed (2026-09-05, on 29da5003)

HIGH: table rendered under the error banner and `items` survived a failure (403 read as "empty
queue"); overlapping reads let the slower one paint; nav badge went stale after an action.
MED: no 90-day PDPA deletion; unbounded tap → resume → tap amplification; red "แจ้งไม่สำเร็จ" on a
row whose notice had not drained; 200 Thai chars pushing the action column off 390px; "รอมานาน"
counting on settled rows; `SupportRowActions` exported for a spec that did not exist.
LOW: `take: 1000` with no `orderBy`; an untrue `pauseAssistant` comment; no log for a dropped
schemaVersion-1 notice; no M7 DISABLED-company probe.

One assertion was itself too weak and was tightened: the read-sequence QA check matched the copy in
`catch`, so a mutation that removed the guard from the SUCCESS path — the one that paints rows —
still passed.

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

- `pnpm --filter @watchdog-bms/api test` — pretest 30 tests / 16 pass / 0 fail / 14 skipped;
  main 6535 tests / 6436 pass / 0 fail / 99 skipped (the skips are the `.pg.spec.ts` files that
  self-skip without their database env var).
- `pnpm --filter @watchdog-bms/contracts test` — 206 / 206 / 0.
- `apps/web` tests — 1508 / 1508 / 0; `next build --webpack` green,
  `/system/support-requests` renders dynamic (ƒ).
- `pnpm -r typecheck` clean; `prisma validate` valid;
  `node infra/security/sync-production-maintenance-release-pins.mjs --check` → status=current,
  and none of the 45 pinned files is in the diff (`apps/web/app/system/layout.tsx` is pinned —
  the nav lives in `SystemHeader.tsx`, which is not).
- Real Postgres: `src/modules/external-signup/line-support-request.pg.spec.ts`, 10/10 against a
  throwaway `postgres:16-alpine` on 127.0.0.1:15444 (`LINE_SUPPORT_TEST_DATABASE_URL`), dropped
  afterwards. Wired into the existing CI Postgres step, one invocation of its own.
- Mutations, all applied, run and reverted — each killed by at least one test:
  stale context instead of membership (4 failures), drop the unreachable alert (3), resume not
  clearing the pause (5), unlink not clearing the context (3), day-keyed notice instead of
  request-keyed (1), remove the amplification floor (2), purge keyed on `requestedAt` so OPEN rows
  are deleted (2), `queued` collapsed into `unreachable` (2), remove the web error gate + item
  clearing + read sequencing (2 — after tightening the assertion; see below), badge without the
  page subscription (2).
- Heavy jobs (typechecks, full suites, `next build`) were serialized behind a shared
  `/tmp/mangmee-heavy.lock` mutex: the machine could not hold two 8 GB `tsc` runs at once.

## Next

- Merge order matters only against `codex/line-support-request-docs`: the spec file is duplicated
  on this branch to carry the §2.2 deltas. Take either side, then re-apply the delta sections.
- **`apps/api/package.json` will conflict with slice B**: both branches append a spec path to the
  single-line `test` script, which git resolves as a whole-line conflict. Resolution is mechanical
  — keep BOTH appended paths on one line — and it already happened once against #430
  (`liff-page-contrast.spec.ts`) during the rebase onto 91704151.
- Not done: no LIFF/status-card copy change (neither mentions contacting staff), no
  `line-ai-security-eval.ts` fixture (that corpus is the prepared-plan orchestrator lane; the
  exact-match/injection cases live in `line-staff-menu.logic.spec.ts`), no local LINE-fake drive.
- Before UAT: confirm `SES_FROM_ADDRESS` and the SES sandbox allow `contact@mangmeeplus.com` as a
  destination, or every request will read "แจ้งไม่สำเร็จ" until it does.
