# Agent Memory: line-support-thread (แชทในเคสคำขอคุยกับเจ้าหน้าที่)

Status: IMPLEMENTED on branch `codex/line-support-thread-20260920` (from `origin/develop` 0103ae37), ported from the owner's stale local checkout via three-way apply of this task's hunks only. Verification (worktree) recorded below. Delivery: develop PR + main PR, then Kamal UAT per runbook.
Owner: thawatchai (Owner ask 2026-09-20: "ทำเป็นแบบ stream chat คล้าย module CRM กดดูรูปที่ลูกค้าส่งมาได้ เริ่มเมื่อลูกค้าส่งขอความช่วยเหลือ จบเมื่อปิดเคส")
Scope: `apps/api` (prisma schema + migration, external-signup admin use case/controller, line-ai webhook media/text lanes, LIFF support use case, partner LINE message), `packages/contracts`, `apps/web` (`system-support-requests` feature), docs.

Decisions:
- Owner decision overrides spec v2 §3 "ไม่เก็บรูป": bytes of customer photos/files ARE stored now, in `LineSupportMessageBlob` (Postgres, same reasoning as `AttachmentBlob`), and deleted with the request by cascade at the existing 90-day CLOSED purge. Not `AttachmentObject`: that model requires a `companyId`, and the asker most in need of a human often has none.
- The thread is a NEW table (`LineSupportMessage`), not CRM `CrmMessage`: CRM is company-scoped on a company's own LINE OA; support runs on the platform OA and may have no company.
- Photo semantics from review 2026-09-06 N1 are untouched: a photo still stamps `lastMediaAt` only (no reopen, no clock move, no pause re-arm) and the media lane still processes it as a receipt. The thread write is a separate best-effort step AFTER the marker; existing assertions on the marker write shape (`Object.keys(update.data) === ['lastMediaAt']`) still hold.
- Media rows are CLAIMED (unique `(requestId, lineMessageId)`) before any LINE content download, mirroring `ensurePendingMedia`: a redelivered webhook cannot store a second copy, and a fake Prisma without the model short-circuits before any network call.
- Customer text in the thread keeps the full sentence (≤2000); the request row keeps its 200-char summary. Staff replies are upserted by `(requestId, operationId)` so a same-key retry updates status instead of adding a bubble.
- `signup-admin-queue.use-case.ts` (REQUEST_INFO case creation) deliberately NOT touched: the owner has uncommitted work there, and spec v2 item 5 already says the staff question is shown from the signup relation, which the thread header does.
- `GET :id/thread` returns BOTH the fresh `SupportRequestItemDto` and the messages, so the modal polls one endpoint and never renders a stale status after an action. `list()` mapping was extracted into `toItems()` for that.
- UI is a `Modal` (existing component) over the table rather than a CRM-style two-pane page: the table already carries 5 columns and every claim/clock affordance; the ask is the chat view, not a layout change.

Open questions:
- None blocking. Possible follow-up: when a support request is live, acknowledge a customer photo in LINE ("ส่งรูปถึงทีมงานแล้ว") instead of only the receipt copy — not asked, not done.

Artifacts:
- Spec: `docs/specs/line-support-request-spec-th.md` (สัญญา v3 ข้อ 9–12)
- Plan: `docs/plans/line-support-thread-plan-th.md`
- Migration: `apps/api/prisma/migrations/20260920120000_line_support_thread/migration.sql`
- Web: `apps/web/src/features/system-support-requests/SupportThreadModal.tsx`

Verification (2026-09-20, local, all green):
- `pnpm --filter @watchdog-bms/api exec prisma validate` — valid; `prisma generate` — client regenerated (untracked `src/generated/prisma`).
- Task-owned temporary Postgres (`docker run … postgres:16-alpine`, port 15499, DB `watchdog_bms`, removed after the run): `prisma migrate deploy` applied every migration including `20260920120000_line_support_thread` (and the owner's two uncommitted WIP migrations, which precede it). `prisma migrate diff --from-config-datasource --to-schema` mentions `LineSupportMessage`/`LineSupportMessageBlob` ZERO times; the drift it does report (`RemoteReleaseMutationIntent`, `DataRightsCase`, `DocumentDeliveryLink`) is pre-existing and untouched here.
- `pnpm --filter @watchdog-bms/contracts build` — ok.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @watchdog-bms/api exec tsc --noEmit -p tsconfig.json` — exit 0 (the default heap aborts with SIGABRT on this machine, unrelated to this change).
- `pnpm --filter @watchdog-bms/web typecheck` — ok.
- API specs (tsx --test): `support-request-admin.use-case.spec.ts` + `partner-support-tools.spec.ts` 51/51; `line-first-signup-webhook.spec.ts` 89/89 (7 new: full sentence on thread keyed by lineMessageId, tap writes no bubble, thread outage never turns "recorded" into "none", claim-before-download + honest `media_fetch_failed`, PNG stored through the lane's checks, SVG-in-PNG refused as `media_security_rejected`, P2002 redelivery stores nothing); `process-line-webhook.use-case.spec.ts` exit 0 (353 dots); `line-intake-dispatch.use-case.spec.ts`, `line-signup-notify.service.spec.ts`, `public-line-signup.controller.spec.ts`, `signup-admin-queue.use-case.spec.ts` 116/116.
- `LINE_SUPPORT_TEST_DATABASE_URL=… tsx --test line-support-request.pg.spec.ts` on the temporary Postgres — 20/20, including: staff bubble SENT beside the reply; nudge + photo read back through `admin.thread()` and `admin.messageContent()` byte-for-byte with no LINE message id in the DTO; redelivered photo stored once; LINE 404 → `media_fetch_failed` with no blob; purge of a 91-day CLOSED case removes messages and blob by cascade.
- Web specs: `SupportRowActions.spec.ts` (6 new render tests), `support-requests.logic.spec.ts` (composer mode + media error), `SupportRequestsPage.qa.spec.ts` — all pass.
- `git diff --check` — clean.
- Port to `origin/develop` (worktree `../mangmeeplus-support-thread-20260920`): all 16 hunk sets applied cleanly with `git apply --3way`; one adaptation needed — upstream `downloadLineMedia` now returns `LineMediaDownloadResult` (`{ ok, media | reason }`), so `storeSupportMedia` maps every `!ok` reason to `media_fetch_failed`. Re-verified there: api tsc exit 0, web typecheck exit 0, api specs 596/596 across the touched and neighbouring files (later 110/110 after the adaptation for the two support specs), main webhook spec exit 0, web specs 65/65, pg spec 20/20 on a fresh temporary Postgres with every migration applied and zero `LineSupport` drift.
- Review round (owner asked for bug/gap/impact): added per-request ceilings — 500 bubbles and 50 stored files per case (an unlinked stranger can otherwise fill Postgres from one LINE account); new bounded code `media_limit_reached`; empty-thread copy no longer claims a case pre-dates the chat (REQUEST_INFO-created cases also have no bubbles).
- Code review pass (8 angles, high effort) on the branch: 8 findings, 6 fixed in the follow-up commit — phone-height composer clipping (list floor `min-h-40` on phones), composer focus from the row's reply button, media ceiling now counts claimed media rows including the current claim, polled row whose status left the tab reloads the list instead of sitting under the wrong heading, stale comment, and partner-page bubble tests (42/42). The two efficiency notes were then applied too: the support thread's download is handed to the receipt lane on the event (`SUPPORT_MEDIA_DOWNLOAD`, the `SAVED_LINE_RECEIPT` pattern) so a photo on a live case is fetched once, and the bubble ceiling runs under the request's advisory xact lock in one transaction (the tap's own pattern) so it is exact. Re-verified: api tsc 0, specs 482/482, main webhook spec exit 0, pg spec 20/20.
- NOT run: Playwright `e2e/system-support-resolution.spec.ts` (needs the full stack; its row buttons and the resolve prompt are unchanged, and "เปิดแชท" is additive) and a live browser look at the modal. First finding during verification: the media lane's default file name `line-receipt-<lineMessageId>.png` leaked the LINE message id into `fileName`; fixed by not persisting the synthesized name (customer-supplied names for files are kept; nameless downloads get `support-<id>.<ext>`).

Next:
- Review diff, commit on a feature branch, run CI (pg spec `line-support-request.pg.spec.ts` is in the Postgres step), then follow the UAT/production deployment runbook (additive migration + matching API/web).
