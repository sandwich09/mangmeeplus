# Agent Memory: MVP 1 — CRM LINE Bill-Capture Sequence (Dev A lane)

Status: IN PROGRESS. Reconstructed 2026-07-09 as the canonical evidence log for the MVP 1
two-dev parallel plan (the referenced `plans/mvp-1-crm-line-bill-capture-sequence` file was
missing; owner decision 2026-07-09: derive scope/exit criteria from
[[plans/crm-line-oa-customer-os-plan]] and rebuild this doc as canonical). This doc tracks the
**Dev A** lane (A1–A10 in `mvp-1-two-dev-parallel-plan.md`). Each task inherits the crm plan's
per-phase exit criteria + the Production Hardening Baseline.

Owner: supapron.wiroon@gmail.com. Implemented via Claude (Opus 4.8).
Scope: Dev A tasks — web wire-up, revenue-loop APIs/UI, notification/delivery/queue plumbing,
appointments, dashboard, PDPA purge, infra/cutover. Spec: [[specs/crm-line-oa-customer-os-spec]].

## Owner decisions (2026-07-09)

- Execution: sequential, one complete + unit-tested task at a time, dependency order
  A1→A2→A6→A4→A5→A3→A7→A8→A9; A10 documented (infra/ops, not code from repo).
- PDPA retention (A6): text messages purged after **24 months**, media blobs after **12 months**,
  anything linked to a finance document (payment proof, tax evidence) **never** auto-purged; admin
  manual purge + on-demand erasure always audited.
- Exit criteria: crm plan per-phase criteria are canonical; this doc holds the evidence.

## A1 — Inbox wire-up — DONE (verify only)

Already shipped on branch `redesign-ui-and-remove-menu-fogot-password` (commit 77e9d4e "rewire
Inbox to the real crm-inbox-backed InboxPage"). Verified 2026-07-09: route
`apps/web/app/(workspace)/companies/[companyId]/inbox/page.tsx` mounts the real
`features/crm-inbox/InboxPage.tsx`, which imports only `./crm-inbox.api` (authed-fetch to the live
crm-inbox controllers) + `features/crm/crm.api`. No `InboxPrototypePage` exists in source (only
stale `.next` build cache). The plan's "prod ยังชี้ mock" note was deploy-lag, resolved on this
branch. Web spec suite for crm-inbox passes (22/22).

## A2 — MVP1-0 pilot-tenant setup — DONE

Deliverables:
- `apps/api/src/modules/crm-inbox/domain/crm-inbox.constants.ts`: `CRM_INBOX_ENTITLEMENT_KEY = 'crm'`
  (the key that actually gates the inbox — see below) + canonical `PDPA_CONSENT_NOTICE_TH` /
  `PDPA_CONSENT_NOTICE_TEXT` (single source of truth; five PDPA elements).
- `apps/api/src/modules/crm-inbox/domain/logic/mvp1-0-setup.logic.ts`: pure `evaluateMvp10Setup()`
  (PASS/WARN/FAIL per check) + `missingPdpaElements`/`isPdpaNoticeComplete`. Unit-tested (11 tests).
- `apps/api/prisma/crm-mvp1-0-setup.ts`: runnable verify/`--apply` script; `pnpm --filter
  @watchdog-bms/api crm:mvp1-0-setup <companyId> [--apply]`. Idempotent entitlement upsert.

Key correctness decision: the plan names entitlement `crm_line_inbox`, but the LIVE gate is the
`crm` feature key — `feature-gate.logic.ts` PREFIX_FEATURE_RULES strips the whole `crm.*`
permission prefix unless `crm` is enabled. The dedicated `crm_line_inbox`/`crm_scheduling` flags are
Phase-9 vocabulary nothing honours yet; enabling only those would STRIP the inbox. So setup enables
`crm`. Entitlement semantics mirror `loadEntitledFeatureKeys()`: zero rows = legacy fail-open
(WARN, inbox still works); rows present without `crm` = FAIL (permissions stripped).

`bombam tenant` = the owner's pilot company (created via onboarding, no fixed seed ID) — the script
is parameterized by companyId, not a hardcoded seed. LINE OA connect (10A) is Dev B (B1); A2 only
reports channel presence (WARN when none) so the checklist is honest about go-live blockers.

Verification (2026-07-09, local): api unit suite for the new logic 11/11 pass; `apps/api` full
typecheck clean; script arg-guard smoke (no companyId → usage + exit 1). DB-dependent run pending a
real pilot companyId (owner to supply) — logic is DB-independent and fully unit-tested.

## A6 — PDPA purge job + erasure path — DONE

No migration (reuses existing nullable/soft-delete columns). Retention: text 24mo, media 12mo,
finance-linked (message.accountingDocumentRef set OR attachment has any AttachmentLink) always
retained. Deliverables:
- Constants (crm-inbox.constants.ts): `PDPA_TEXT_RETENTION_MONTHS=24`, `PDPA_MEDIA_RETENTION_MONTHS=12`,
  batch limit 500, purge marker, erased display name.
- Pure logic `crm-pdpa-purge.logic.ts`: `subtractMonths` (clamps short months, UTC, no clock dep),
  `retentionCutoffs`, `isAttachmentPurgeable` (ACTIVE + zero links). 5 unit tests.
- Repo methods (prisma-crm-inbox.repository.ts): `purgeExpiredMessageText` (redact-in-place: null
  contentText + marker contentJson; selecting `contentText not null` guarantees sweep progress),
  `clearExpiredConversationPreviews`, `purgeExpiredMedia` (relation filter returns only purgeable
  blobs → efficient + progresses; deletes bytes, soft-deletes object, drops message media meta),
  `findCustomerMediaAttachments`, `eraseCustomerData` (one transaction; JSON PII cleared with
  `Prisma.DbNull` — `undefined` would SKIP not clear, a leak bug fixed), plus customer/conversation
  lookups.
- Use-cases `crm-pdpa.use-case.ts`: `PurgeCrmPdpaUseCase` (cross-company sweep, HIGH system audit
  only when >0 purged) + `EraseCrmCustomerUseCase` (CRITICAL audit, NotFound guard, idempotent).
- Endpoints: `POST /v1/internal/crm/pdpa-purge` (X-Worker-Token) + `POST
  /companies/:companyId/crm/customers/:id/erase` under new permission `crm.customer.erase`
  (CRITICAL; granted ADMIN, OWNER auto).
- Worker `apps/workers/src/modules/crm-inbox/crm-pdpa-worker.ts`: daily repeat, drains batches until
  a pass purges 0 (cap 200 passes/run). Wired in workers main.ts (`crm_pdpa_worker_started`).
- Web: `eraseCrmCustomer` api client + guarded erase button on Customer 360 consent tab (confirm
  dialog; permission threaded via server session in the page).

Verification (2026-07-09): api unit 15 new tests pass (5 logic + 10 use-case); full crm-inbox spec
set 157/157; permission-registry + resolver + feature-gate 29/29 (new permission gated under `crm`);
api typecheck clean; workers typecheck clean; web typecheck clean. Env reuses WORKER_INTERNAL_TOKEN
+ INTERNAL_API_URL (already set for the SLA worker). No migration; `sync-permissions` at boot picks
up `crm.customer.erase`. DB-level purge run pending real aged data (logic fully unit-tested).

## A4 — LINE push delivery sweep + line default + backoff + new-conversation scan — DONE

No migration. Closes the item-06 dispatch gap (deliveries were created QUEUED but nothing enqueued
`delivery.process`, so LINE pushes never left the queue). Deliverables:
- notification.model.ts: `crm_new_conversation` added to IMPLEMENTED_TRIGGER_KEYS; `DEFAULT_ENABLED_CHANNELS
  = ['web','line']` (line default — staff get pushes without first setting prefs; opt-out still works);
  backoff/sweep/retryable-code constants.
- notification.logic.ts: `isRetryableDeliveryError` (RATE_LIMIT/NETWORK_ERROR/HTTP_5xx retry; HTTP_4xx
  terminal — matches pushLineMessage's actual codes), `computeDeliveryBackoffAt` (30s×2ⁿ cap 1h),
  `resolveDeliveryOutcome` (retryable+attempts-left → QUEUED with backoff; else terminal FAILED). Tested.
- ProcessQueuedDeliveryUseCase: LINE failure now runs through resolveDeliveryOutcome (backoff requeue).
- New `ProcessDueNotificationDeliveriesUseCase` (cross-company sweep) + repo `findDue` (QUEUED & due) +
  `POST /v1/internal/notifications/delivery-sweep` (new InternalNotificationSweepController, X-Worker-Token).
- New `ScanCrmNewConversationsUseCase` (notify inbox managers of new unassigned/unanswered chats; dedup+
  cooldown collapse the short overlapping scan window to one alert; SLA scanner escalates ageing ones) +
  repo `findNewUnassignedConversations` + `POST /v1/internal/crm/new-conversation-scan`.
- Workers: notification worker schedules repeatable `delivery.sweep` (30s) → sweep endpoint; crm-inbox
  worker adds repeatable `newconv.scan` (60s) → new-conversation endpoint (renamed runner to postScan()).

Verification (2026-07-09): 17 new unit tests (logic backoff/retry + sweep use-case + new-conv scan);
dashboard-notifications + crm-inbox spec sets 174/174; api typecheck clean; workers typecheck clean +
jobs spec 2/2. Live LINE push still needs a physical channel + linked identity (standing external
blocker) — the send adapter path is unit-covered. Env reuses WORKER_INTERNAL_TOKEN + INTERNAL_API_URL.

## A5 — reply-send retry + durable inbound media/profile — DONE

Migration `20260709030000_item15a_crm_reply_retry`: CrmMessage += `deliveryAttemptCount`,
`deliveryNextAttemptAt` + sweep index. Durability follows the repo's established scanner pattern
(no API-side BullMQ producer exists — deliberate, consistent with SLA/delivery sweeps).
- Pure logic (crm-inbox.logic.ts): `isRetryableLineError` (line_api_429/5xx/unreachable retry;
  invalid_access_token/4xx terminal), `computeReplySendBackoffAt` (30s×2ⁿ cap 1h),
  `resolveReplySendOutcome` (SENT / PENDING+backoff / terminal FAILED), `isTerminalMediaError`.
- SendCrmInboxMessageUseCase: transient push failure now stays PENDING+backoff (was silently FAILED);
  terminal stays FAILED. (Behaviour change — updated the existing send-failure test + added a terminal case.)
- `RetryCrmInboxDeliveriesUseCase` (cross-company): retryReplies (re-push due PENDING replies, advance
  conversation on success, terminal on disabled-channel/unfollowed), retryMedia (re-fetch orphaned/
  transient-failed inbound media within a 30s..24h window, skip terminal size/type errors, persist
  failure marker), enrichProfiles (re-enrich placeholder-name LINE identities, never overwrite a
  staff-edited name). Repo: findRetryableReplies / findMediaFetchCandidates / findProfileEnrichCandidates.
- Endpoint `POST /v1/internal/crm/inbox-retry-scan`; crm-inbox worker repeatable `retry.scan` (60s).

Verification (2026-07-09): prisma validate + generate clean; migration authored. Full api suite
1220/1220 (added ~15 A5 tests: logic + retry use-case; updated 2 send-path tests; also fixed 3
PRE-EXISTING stale auth mocks in line-linking.spec.ts — missing `status:'ACTIVE'`, unrelated to A5).
api + workers typecheck clean. Migration deploy + live LINE retry pending a physical channel.

## A3 — Phase 3 revenue loop — CORE DONE (2 sub-items deferred, documented)

No migration (reuses item-15 create flows + AttachmentLink). Delivered:
- **Create-from-conversation** (deal / follow-up task / quotation draft): `CreateFromConversationUseCase`
  reuses the item-15 `CreateCrmOpportunity/FollowUp/QuotationDraft` use-cases (exported from CrmModule),
  prefills the customer from the conversation, and drops a SYSTEM internal note in the thread (the
  conversation "source ref"). Endpoints `POST .../conversations/:id/create-{deal,task,quotation}` on new
  `CrmConversationActionsController`, each gated on the item-15 create permission. Scope-checked. 5 tests.
- **Payment-proof queue**: `CrmPaymentProofUseCase.flag` links the inbound image/file as an AttachmentLink
  (purpose `payment_proof`) — feeds the finance queue AND makes it PDPA-exempt (A6 synergy) — notifies
  inbox managers (`crm_payment_proof` trigger) + in-thread note; `.list` returns the finance queue with
  customer context. Endpoints `POST .../messages/:id/flag-payment-proof` + `GET .../crm/payment-proofs`.
  New audit action `crm.payment_proof.flag`. Idempotent. 6 tests.
- **Web**: crm-inbox.api client for all 5 endpoints; `QuickActions` panel in the inbox sidebar (deal/task/
  quotation buttons, permission-gated, prompt-based input).

DEFERRED (documented, backend-ready where noted):
- **Send quotation/invoice to LINE**: needs a customer-facing short-lived signed-link primitive (customers
  have no session; the existing attachment download is cookie-auth). Not built to avoid inventing signed-URL
  infra mid-MVP — the send path itself (LINE push + DOCUMENT message) already exists to build on.
- **Sidebar latest-deal / open-tasks read-back** + payment-proof web flag button/queue page: API client +
  backend are ready; only the read widgets / button remain (low-risk web follow-up).

Verification (2026-07-09): full api suite 1231/1231 (+11 A3 tests); api + web typecheck clean.

## A7 — Appointments — DONE (built on existing CrmBooking)

Pre-existing (มั่งมี Flow A bookings): model + CRUD + calendar week query + conflict enforcement
(`findOverlappingBooking` → ConflictException) + `BookingsPrototypePage` already wired to the real API.
So A7 = the genuine gaps:
- **Reminder scheduler** (the core): migration `20260709040000_item15a_booking_reminder` (CrmBooking +=
  `reminderSentAt` + `@@index([status,startAt])`). `ScanCrmBookingRemindersUseCase` (crm-inbox — has both
  LINE push infra and the booking read via CrmModule): mark-first race-safe claim, customer LINE push via
  company OA (`bookingReminderText`, Asia/Bangkok), staff + inbox-manager notification (`crm_booking_reminder`
  trigger). Lead 1h, scan every 60s. Endpoint `POST /v1/internal/crm/booking-reminder-scan`; crm-inbox
  worker repeatable `reminder.scan`. Customer-push best-effort; never aborts the sweep.
- **Customer 360 appointments tab**: `ListCrmCustomerBookingsUseCase` + `GET .../crm/bookings/by-customer/:id`
  + web `AppointmentsTab` replaces the placeholder.
- Pure logic `formatBookingWhen` / `bookingReminderText` (Bangkok) in crm-booking.logic.ts.

Verification (2026-07-09): prisma validate + generate clean; migration authored; full api suite 1238/1238
(+7 A7 tests: 5 reminder scanner + 2 booking formatting); api + web + workers typecheck clean. Live LINE
reminder push pending a physical channel (adapter path unit-covered).

## A8 — Daily Brief — DONE (inbox-operations widgets)

No migration. `CrmDailyBriefUseCase` (crm-inbox) + `bangkokDayBounds`/`buildDailyBriefWidgets` (pure,
tested): 5 deep-linked widgets — unanswered, SLA breaches, new customers today, appointments today,
payment proofs — each with severity for coloring. Endpoint `GET .../crm/daily-brief` (crm.inbox.read;
new `CrmDailyBriefController`). Count repo methods: inbox (unanswered/sla/payment-proofs) + crm
(customersSince/bookingsBetween). Web `CrmDailyBriefCard` on the dashboard (permission-gated). Push
reuses A4 (item-06 delivery). Kept under crm.inbox.read (owner/manager) — coherent, no crm.report.read
entanglement.

DEFERRED (documented): pipeline value / quotations-awaiting widgets (already in the CRM *sales*
dashboard under crm.report.read) + response-time median (needs a first-response delta aggregate).
AI Daily Insight card is Dev B (B8).

Verification (2026-07-09): full api suite 1243/1243 (+6 A8 tests); api + web typecheck clean.

## A9 — Web review of LINE-captured evidence — DONE

Reuses A3's payment-proof backend (enriched `listPaymentProofs` with `messageId` so the review page
previews inline via the existing cookie-authed content route). `PaymentProofReviewPage` at
`/companies/:id/crm/payment-proofs`: image preview + download + review state ("รอตรวจสอบ") + deep link
to the conversation for context; 403 → ForbiddenState. Verification of the payment itself stays in
items 08/09/13. The broader accounting review states (tax evidence/category/signature/accountant view)
already live in items 08/09/13/14 — A9 adds the NEW LINE-captured-evidence review surface.

Verification (2026-07-09): api + web typecheck clean; payment-proof use-case 6/6 (repo shape change safe).

## A10 — Cutover runbook — DONE (docs/ops)

`docs/runbooks/mvp-1-dev-a-cutover-runbook.md`: consolidated cutover for A1–A9 — build/test gates, the
2 additive migrations, permission sync (`crm.customer.erase`), env verify (no new required vars — reuses
WORKER_INTERNAL_TOKEN/INTERNAL_API_URL/REDIS_URL), the new repeatable worker jobs (newconv/retry/reminder
scans + delivery sweep + pdpa purge), pilot setup script, queue/DLQ health, cross-tenant battery, canary +
RollbackAlarm per the 2026-07-06 precedent, and the deferred-items list. Actual prod execution is owner/ops.

## Dev A lane — COMPLETE (A1–A10, 2026-07-09)

All ten tasks delivered. Full api suite 1243/1243; api + web + workers typecheck clean. Two additive
migrations authored. ~60 new unit tests. Standing external blocker: real-LINE end-to-end needs Dev B's
physical OA connect (all LINE push/fetch paths unit-covered). Deferred sub-items (A3 send-doc-to-LINE +
sidebar widgets, A8 pipeline/response-time widgets) documented above and in the runbook.

---

## Appendix — MVP1 sequencing & decisions (merged from `develop`)

> Preserved from the parallel planning/sequencing note that develop kept at this
> same path. The Dev A evidence log above is the current execution record; this appendix
> retains the cross-item sequencing decisions for reference.

### Agent Memory: MVP 1 CRM LINE + Bill Capture Sequence

Status: Draft plan created 2026-07-08. Owner update same day: auto-reply with ON/OFF toggle is now MVP 1 scope, pulled forward into the CRM AI slice. Owner update 2026-07-08 (2): MVP 1 ships to PRODUCTION (not a demo) — security, logging, and flow robustness are per-phase exit gates, not a final pass. Code reconciliation 2026-07-08: reviewed live code vs plan and found the Mangmee prototype merge (PR #6) swapped the MVP1 web surfaces to static mocks (see Code Reconciliation section). Direction confirmed (A): Mangmee prototype is the go-forward UI; remaining MVP1 front-end work is wiring prototypes to the existing real APIs. Owner update 2026-07-09: committed to closing the LINE-push-notification and CRM-AI-agent-family gaps; implement-ready designs recorded in [[agent-memory/notification-line-push-wiring]] and [[agent-memory/crm-customer-ai-agent-family]]. No code implementation in this pass.
Owner: Product owner / Codex planning pass.
Scope: Cross-item MVP 1 sequencing for company LINE OA CRM, WatchDog shared LINE OA natural AI UX, and receipt/bill/signature capture.

Decisions:
- MVP 1 is product-sequenced around two loops: CRM LINE customer conversation and internal bill/receipt capture.
- The company LINE OA and WatchDog shared LINE OA remain separate channels with separate audiences, authorization rules, and webhook paths.
- CRM monitor means the web CRM inbox and Customer 360 workspace, not a full staff UI inside LINE.
- "Bill" is intentionally split: item 09 handles expense-side receipt/bill/slip/text/signature capture; item 08 handles official sales-side quotations, invoices, receipts, tax invoices, payments, and document lifecycle.
- Next implementation should start with MVP1-1, the CRM Phase 3 remainder, because it closes the customer conversation -> revenue/document workflow before customer-facing AI starts sending replies.
- WatchDog shared OA UX and natural AI should be validated as a product surface after the CRM loop is closed: rich menu, account link, source-backed Thai answers, fragmented-input buffering, and multi-command journeys.
- Item 09 is already broad and verified for the core real LINE receipt-photo path; MVP 1 bill work should be acceptance polish and variant smoke unless a real gap is found.
- Customer-facing CRM AI auto-reply is no longer late MVP 1. It must ship with a per-company/per-channel toggle that defaults OFF. Toggle OFF means staff-draft mode; toggle ON can auto-send only safe normal replies after trust score > 80 and deterministic API gates pass, with audit and AI-sent thread markers. *(Trust>80 part SUPERSEDED 2026-07-09 — trust now gates booking only; see the autonomy-ladder decision below / spec §27.)*
- AI auto-booking remains later than simple auto-reply because it depends on the appointment source module, semantic confirmation, slot re-checking, idempotency, and booking audit.
- MVP 1 target is production with real customers, real payment proofs, and PDPA-governed data. Security, log redaction, and durable flow are exit criteria on every MVP1-x — pulled forward from CRM plan Phase 9 into a cross-cutting Production Hardening Baseline (see sequence doc).
- Mangmee prototype is the go-forward UI (owner decision A, 2026-07-08). The dominant remaining MVP1 front-end task is wiring the prototype pages (`InboxPrototypePage`, `CustomersPrototypePage`, `BookingsPrototypePage`) to the already-shipped real APIs (`crm-inbox.api`, contracts), NOT building new backend. The real API-wired `InboxPage.tsx` is currently bypassed at the `/inbox` route.
- Two push lanes must never be conflated: staff/owner notification push = WatchDog shared OA via item 06 delivery + `ExternalIdentity`; customer-facing AI auto-reply = company OA via the crm-inbox send path. Different channel, identity, and adapter.
- LINE push notification is wiring, not new build (verified 2026-07-09): `CreateOrUpdateNotificationEventUseCase` already fans out `line` delivery rows and `ProcessQueuedDeliveryUseCase` already implements preference/quiet-hours/identity/token/push with suppressed/skipped semantics. Missing only: a due-delivery sweep (no producer enqueues `delivery.process`), `line` in default enabled channels, and failure backoff (`nextAttemptAt` never set on fail). Design: [[agent-memory/notification-line-push-wiring]].
- CRM AI agent family is confirmed greenfield (no gateway module/agents, no `crm-ai` contracts, no `crm.ai.*` permission keys, no trust-score columns — `leadScore`/`leadScoreUpdatedAt` is the column pattern to mirror; `CrmMessageAuthorType` needs an additive `AI` value). Build order B1 scaffold+separation tests -> B2 intake -> B3 staff assist -> B4 trust score + initial trigger -> B5 toggle-gated auto-reply; booking stays MVP1-7/8C. Design: [[agent-memory/crm-customer-ai-agent-family]].
- PDPA retention (owner-approved 2026-07-09): chat text 24 months from the customer's last activity → redact to preview+hash (item-07 style); media blobs 12 months → delete blob, keep metadata; marking an image as payment proof copies evidence into item 08/09 finance records (their own ≥5-year accounting retention) before any chat purge; erasure = audited admin purge per customer (chat/media purged, legally-required business records kept); LIFF/registration privacy notice must state these windows and the legitimate-interest basis for chat-initiated profile fetch. Implementation = one purge sweep job on the existing worker pattern (~1 day) + notice text.
- Production pilot (owner decision 2026-07-09): bombam company — existing customer, technology-services business. Fit: service business matches appointments/quotation/payment-proof flows. Repo note: "bombam" appears in-repo only as the Mangmee design-handoff author's machine path (e.g. docs/specs/mangmee-system-ui-alignment-spec.md), so the pilot is the design collaborator's company; the tenant record itself lives in the prod DB via 10A onboarding and must be verified/created there during MVP1-0. To close MVP1-0: LINE Developers access for bombam's company OA + quota/plan check, owner/staff shared-OA identities, verification script, PDPA notice acceptance.
- Shared-OA rich menu (owner decision 2026-07-09, overrides the item-07 four-slot default): three slots — แจ้งเตือน / สรุปค่าใช้จ่าย / เปิดเว็บ. No Ask AI button (free typing reaches the natural-language path anyway) and no Link Account button — first-run/unlinked users get an account-link prompt reply on any interaction (existing QR/link-page flow). สรุปค่าใช้จ่าย = message action that feeds the existing 10B/item-09 expense-read journey ("ดูค่าใช้จ่าย"), so the whole menu is LINE config + one image, ~zero new backend.
- AI reply brand voice + auto-reply daily cap (owner-approved 2026-07-09): voice = existing data only (`brandName ?? name` + channel `displayName` + active `CrmMessageTemplate` bodies as few-shot + fixed polite-Thai house style; no new schema — `Company` has no businessType column, templates carry business context); cap = `autoReplyDailyCap Int @default(50)` column beside the toggle on `CompanyMessagingChannel` (per-tenant, no-redeploy; `0` = paused; count `CrmMessage` `authorType='AI'` per Asia/Bangkok day). Details in [[agent-memory/crm-customer-ai-agent-family]] Resolved Decisions.
- Autonomy ladder + deterministic trust (owner-approved 2026-07-09, spec §27; supersedes the trust>80 auto-reply gate above): AI answers ALL customers — including new/unscored — on toggle-ON channels, but only grounded QUESTION turns (complaint/booking/spam/needs-human/low-confidence → staff path + fixed holding message); linked-identity journeys stay deterministic API reads; trust>80 gates ONLY auto-booking (8C). Trust score becomes a deterministic API-side formula over stored facts (LLM classifies events, code aggregates; chat-only signals can never cross 80 — unit-tested); `CrmTrustScoreAgent` = optional narrative. Auto-reply trigger becomes event-driven from the webhook using the free LINE replyToken (push fallback under caps — protects the ~300/mo free-tier push quota that staff notifications also draw from). Caps: per-channel 50/day + per-conversation 5/day. Details: [[agent-memory/crm-customer-ai-agent-family]].

Open questions:
- None — all MVP1 pre-implementation decisions closed as of 2026-07-09 (PDPA retention, pilot = bombam company, rich menu 3 ช่อง, brand voice, auto-reply daily cap).
Code Reconciliation 2026-07-08 (live code vs plan):
- Web regression (verify before prod): the Mangmee prototype merge (commits 73dd44fd / ef93ddb1, PR #6) re-pointed 16 workspace routes to STATIC prototype components with mock data, including the whole MVP1 surface — `/inbox` (`InboxPrototypePage`), `/customers` (`CustomersPrototypePage`), `/bookings` (`BookingsPrototypePage`), `/broadcast`, `/crm-reports`. They import static `mangmee-crm-data` + `inbox-prototype.model` and call NO API. The real API-wired `apps/web/src/features/crm-inbox/InboxPage.tsx` (uses `crm-inbox.api`) is bypassed. Still real at route: `/crm`, `/crm/customers/[id]` (Customer 360 detail), `/settings/line-oa` (channel connect wizard), `/dashboard`. So CRM plan Phase 2/3 status ("3-column inbox live-verified at companies/[companyId]/inbox") is STALE at the route level.
- Correction 2026-07-09 (route audit — the bullet above under-counted: the bill/receipt loop is mocked too, not only the CRM surface): `/expenses` (item 09) and `/sales-documents` (item 08) ALSO render Mangmee mocks, through `MangmeeModulePrototypePage` (`moduleKey` `expenses`/`salesdoc`) — a generic static module placeholder, distinct from the `mangmee-crm-data` CRM prototypes. **Item 09 = HARD gap:** the real `apps/web/src/features/expenses/ExpensesPages.tsx` is mounted at NO route (grep-confirmed) and the sidebar (`web-core-workspace.constants.ts`, `key: 'expenses'`) links to the mocked `/expenses`, so on prod finance CANNOT review/confirm/pay LINE-captured receipts in web — LINE capture + backend stay real/verified (item 09 memory), only the web review surface is mock. **Item 08 = softer:** `/sales-documents` is mocked but the real `AccountingPages.tsx` still serves at `/accounting` (which the nav also lists), so item 08 is reachable and `/sales-documents` is just a mock duplicate to re-point or drop. `/sales` (`moduleKey=sales`) is likewise mocked but sits outside the MVP1 launch scope. Net: BOTH launch loops (CRM + bill/receipt/reimbursement) carry a web wire-up regression; only `/reimbursements` (ใบเบิก item 14, real `ReimbursementsPages.tsx`) and `/accounting` (item 08) are already real at route.
- Timing: originally assessed 2026-07-08 as not-yet-deployed (prototype commits newer than deploy df49a553). SUPERSEDED same day 23:19 — a concurrent session deployed `ef93ddb1` to prod (api-web canary SUCCESSFUL, service `ef93ddb1-20260708230509`; see [[agent-memory/mangmee-system-ui-alignment]] Deploy 2026-07-08). PROD NOW SERVES the static prototype pages at `/inbox`/`/customers`/`/bookings`/etc. Backend webhook/ingestion is unaffected (real conversations keep landing in the DB), but staff-facing CRM web surfaces on prod are mock until the wire-up ships — the MVP1-1 wire-up is now a live-prod UI regression fix, not pre-prod work.
- Backend is real and mostly solid (verified in code):
  - Inbound `process-inbound-line-message.use-case.ts`: idempotency solid (findMessageByProviderId short-circuit + unique (companyId, providerMessageId) + append returns null on dup); bounded contentJson (never raw body); media/profile fetched as in-process `void` background (keeps the 200 fast) — but NOT a durable queue, so lost on deploy/restart with no retry (self-noted at line 214).
  - Send `crm-conversation.use-case.ts`: persist PENDING -> push -> SENT/FAILED + deliveryError + audit both ways (graceful). But INLINE, no worker queue, no auto-retry/DLQ (documented deviation).
  - `line-messaging.adapter.ts`: handles 401 (invalid_access_token); LINE 429 returns generic `line_api_429` with NO Retry-After/backoff.
  - Notifications: `crm.conversation.message_received`/`created` outbox events are appended but have NO consumer (grep confirms) -> staff get no "new chat" alert. Only `crm-sla-worker` ships (SLA-breach, in-app) notifications. This is the notification dispatch gap.
- Gaps confirmed still open for prod: (1) initial/periodic trust-score trigger absent — no CRM AI agent family in ai-gateway yet (only compiled contracts), so the auto-reply toggle would be a dead path; (2) PDPA retention policy for full customer message + media undefined (CRM stores full content, unlike item 07 preview+hash); (3) profile fetch runs without an explicit consent gate.

Artifacts:
- [[plans/mvp-1-crm-line-bill-capture-sequence|MVP 1 Execution Sequence: CRM LINE + Bill Capture]]
- [[plans/implementation-roadmap|Implementation Roadmap]] link to the MVP 1 sequence.
- [[agent-memory/notification-line-push-wiring|LINE Push Delivery Wiring]] — implement-ready design (2026-07-09).
- [[agent-memory/crm-customer-ai-agent-family|CRM Customer AI Agent Family]] — implement-ready scaffold design (2026-07-09).
- [[plans/mvp-1-two-dev-parallel-plan|MVP 1 Two-Dev Parallel Plan]] — Dev A (core system) / Dev B (AI agents + LINE external) lanes, handshakes, ownership map (2026-07-09, uncommitted by owner instruction).

Verification:
- Docs-only planning pass. Run `git diff --check -- docs/plans/mvp-1-crm-line-bill-capture-sequence.md docs/agent-memory/mvp-1-crm-line-bill-capture-sequence.md docs/plans/implementation-roadmap.md` after edits.

Next:
- MVP1-1 inbox wire-up: **DONE 2026-07-09** (A1/B5 — `/inbox`+`/customers`+`/crm-reports`+AI panel committed `eacd8984`/`274c5028`/`a580f324`/`d67d24c5`; awaiting owner-gated canary deploy). Superseded the "wire `InboxPrototypePage`" slice below. Evidence: [[agent-memory/mvp1-a1-web-wireup]].
- Revenue loop + durable flow + `/expenses` re-point: harness ready 2026-07-09 — [[plans/mvp1-a3-a5-revenue-loop-durable-flow-plan]] / [[agent-memory/mvp1-a3-a5-revenue-loop-durable-flow]] (lanes A3/A4/A5 + item-06 push, 9 phases). Folds in the former Track 1 (visibility: [[agent-memory/notification-line-push-wiring]] delivery sweep + `line` default + backoff + `crm_new_conversation`) and Track 2 (reliability: reply-send retry/DLQ + LINE 429/401; inbound media/profile → durable workers). ONE owner decision open: Phase 8 send-doc delivery form.
- Track 3 (MVP1-4 core, Dev B): B1–B4 gateway family + B3 staff-assist API + B4 trust score DONE (see [[agent-memory/crm-customer-ai-agent-family]]); B5 auto-reply pending, rides the Phase-6 send retry path (H3).
- CRM plan Phase 2/3 status reconciliation with prototype routes: done 2026-07-08; `/expenses`+`/sales-documents` under-count corrected 2026-07-09 (see Code Reconciliation Correction above).

Phase 3 wire-up evidence (2026-07-09):
- [[agent-memory/mvp1-a1-web-wireup]] Phase 3 implemented the B3 web AI panel and pure stored trust read endpoint behind `crm.ai.assist`; [[agent-memory/crm-customer-ai-agent-family]] cross-links the AI-family evidence.
- Verification in sandbox: contracts build OK; api/web typechecks OK; raw `pnpm ... test` scripts blocked by `tsx` IPC `listen EPERM`, but direct-loader fallbacks passed api **1200 pass / 0 fail** and web **237 pass / 0 fail**; `git diff --check` clean.

Phase 4 customer wire-up evidence (2026-07-09):
- [[agent-memory/mvp1-a1-web-wireup]] Phase 4 wired `/customers` route/session and `CustomersPrototypePage` to `listCrmCustomers(companyId, { search, status, page, pageSize })`; removed customer mock imports/banner and deleted tier/score/LTV mock behavior.
- Verification in sandbox: web typecheck OK; raw web test script blocked by `tsx` IPC `listen EPERM`, fallback passed **235 pass / 0 fail**; customer mock import grep clean; `git diff --check` not run because this task explicitly forbade git commands.
