# MVP 1 Execution Sequence: CRM LINE + Bill Capture

## Status

Draft owner sequence, created 2026-07-08. Owner update 2026-07-08: MVP 1 ships straight to PRODUCTION — the exit bar for every item below includes the Production Hardening Baseline (security, log redaction, durable flow), not a deferred final pass. Code reconciliation 2026-07-08 found the MVP1 web surfaces are currently Mangmee static prototypes at the live routes (see Current Baseline); the go-forward plan (owner decision A) is to wire those prototypes to the existing real APIs.

Status update 2026-07-10: the mock-UI framing above is HISTORICAL — inbox/bookings/daily-brief/expenses are wired to real APIs (see `docs/agent-memory/mvp1-launch-codex-handoff.md`, commits `04425bab`…`21667250`). The CRM AI agent family, §27 Level-0 auto-reply, gated auto-booking (availability-first, spec §28 supersedes trust>80 here), and B9 customer LIFF registration are SHIPPED. Remaining launch work is the gap-closure harness `docs/plans/mvp1-prod-gap-closure-codex-handoff.md` (consent/confidence gates, webhook durability, reply-token-first, booking race safety, channel autonomy controls + fallback, rate limiter, appointment lifecycle UI, Daily Brief §9.5 completion, LIFF branding, e2e). Deploy deferred by owner 2026-07-10.

This plan does not replace the canonical build order in [[plans/master-implementation-checklist|Master Implementation Checklist]]. It is the product sequence for closing MVP 1 across already-related items: company LINE OA CRM, WatchDog shared LINE OA, and bill/receipt capture.

## MVP 1 Product Shape

MVP 1 has two daily-use loops:

1. CRM LINE loop: an end customer chats with the company's own LINE OA, the message lands in the web CRM monitor/inbox, staff can reply and convert the conversation into customer work, and AI helps with drafts, summaries, and toggle-gated auto-replies.
2. Bill capture loop: an internal linked user sends a receipt/bill/slip/photo/PDF/text note or signature image through WatchDog shared LINE OA or web, AI creates only reviewable drafts or pending tickets, and finance finishes review/confirmation in web.

The first demo should prove these loops from real channel input to web source-of-truth records and back to LINE with clear, natural Thai responses.

## Hard Boundaries

- Company LINE OA is for end customers. It uses the CRM/company-OA webhook path and resolves company from the channel record.
- WatchDog shared LINE OA is for internal users. It handles login/linking, alerts, natural-language AI, and approved capture workflows. It must resolve company from linked identity and selected company context, not from channel id.
- CRM monitor means the web CRM inbox/Customer 360 workspace. LINE is the customer chat channel, not the full staff CRM UI.
- "Bill" must stay split:
  - Item 09 owns expense-side receipt/bill/tax-invoice/transfer-slip/expense-note capture, signature assets, accountant evidence view, and reviewable expense drafts.
  - Item 08 owns sales-side quotations, invoices, receipts, tax invoices, payments, and official document lifecycle.
- LINE/AI cannot confirm, pay, post ledger, file tax, export, approve signatures, change permissions, or finalize accounting.
- CRM customer-facing AI auto-reply is now MVP 1 scope, but only behind a per-company/per-channel ON/OFF toggle that defaults OFF. Toggle OFF always means staff-draft mode. Toggle ON may auto-send only after trust score > 80 plus consent/quota/confidence/safety gates pass, and every auto-sent reply is audited and visible in the inbox thread as AI-sent.
- AI appointment booking remains separate from simple auto-reply and still waits for the appointment source module and booking guardrails.

## Current Baseline

- CRM 15A: Phase 2 inbox core and Customer 360 read model/timeline first slice were built and verified against real APIs. IMPORTANT — code reality 2026-07-08: the later Mangmee prototype merge (PR #6) re-pointed `/inbox`, `/customers`, `/bookings`, `/broadcast`, `/crm-reports` (and other workspace routes) to STATIC prototype pages with mock data; the real API-wired `InboxPage.tsx` is bypassed. Owner decision (A): Mangmee prototype is the go-forward UI, so the near-term CRM front-end task is wiring these prototypes to the existing real APIs (`crm-inbox.api`, contracts). Still real at route: `/crm`, Customer 360 detail `/crm/customers/[id]`, `/settings/line-oa`, `/dashboard`. Remaining backend CRM work is Phase 3 remainder, then AI Assist plus toggle-gated auto-reply, Daily Brief, appointments, customer LIFF registration, and gated auto-booking.
- Bill/receipt item 09: Paypers-like LINE capture, Typhoon OCR, semantic text-note capture, signature ticket intake, owner-approved signature assets, accountant evidence view/package, and real production LINE receipt-photo smoke are implemented and verified. Remaining MVP work is mostly acceptance polish and variant smoke.
- Accounting documents item 08: web-owned quotation/invoice/receipt/tax-invoice/payment workflow is implemented. CRM should link to it; receipt OCR should not try to own official sales-document lifecycle.
- WatchDog shared LINE OA: item 07/10B base natural-language AI path exists, message buffering is implemented, and 10F multi-intent/value grounding is implemented behind default-off flags pending dev-OA journeys and production rollout checks.

## Production Hardening Baseline (cross-cutting — every MVP1-x exit gate)

MVP 1 is production. These are not a final phase; each item below must satisfy them before merge to prod. Pulled forward from CRM plan Phase 9.

Security:

- Server-side tenant + permission + ABAC on every route (web = UX only); cross-tenant test battery added per phase, not deferred.
- Webhook/upload payload bounds + oversized reject; rate limits on webhook, LIFF registration, auto-reply, and campaign paths.
- XSS-inert rendering of all customer-supplied text/media.
- Credential vault: AES-GCM, masked DTOs, reveal = step-up + audit; encryption key in SSM, never baked into the image/env.

Logging / audit / observability:

- Log redaction sweep per phase: no credential, token, PII, or customer message body in logs.
- Audit + outbox on every mutation (already in place — keep).
- Metrics/alerts before prod: webhook rate anomaly, send-queue failure/DLQ depth, SLA scanner health, auto-reply sent volume.
- PDPA retention — DECIDED 2026-07-09 (owner-approved): chat text kept 24 months from the customer's last activity then redacted to preview+hash (item-07 style); media blobs kept 12 months then deleted (metadata stays); payment-proof marking copies evidence into item 08/09 finance records (≥5-year accounting retention) before any chat purge; erasure requests = audited admin purge per customer keeping legally-required business records; LIFF/registration privacy notice states these windows. Implement as one purge sweep job (~1 day) — does not block other tracks.

Flow robustness:

- Webhook enqueue-then-200 on a durable queue; inbound media/profile enrichment moved to the BullMQ workers app (today they run as in-process `void` tasks — lost on deploy, no retry).
- Send queue: retry/backoff + DLQ + delivery status; handle LINE 429 (Retry-After) and token-expiry (401) explicitly (today the adapter returns a generic error and the send is inline).
- Idempotency on message ingest (done), reminders, booking (double-book guard), and campaign per-recipient.
- Kill switch: global auto-reply off + soft channel disable (inbound rejected + audit).
- Every UI: loading / error / permission / empty states.

## Front-End Wire-Up Track (owner decision A — prerequisite folded into MVP1-1, then reused)

The Mangmee prototype pages are the go-forward UI. Before MVP1-1's loop can close on prod, wire the static prototypes to the existing real APIs:

- `/inbox` `InboxPrototypePage` -> `crm-inbox.api` (conversation list/detail, send, notes, assign, status, tags, SLA); the real `InboxPage.tsx` already implements this against the API and is the reference/fallback.
- `/customers` `CustomersPrototypePage` -> item 15 customer list + `summary360`.
- `/bookings` `BookingsPrototypePage` -> MVP1-6 appointment APIs (wire when that module lands).
- Keep the Mangmee visual design as the source of truth; replace mock `mangmee-crm-data` reads with API-backed hooks, preserving loading/error/permission/empty states.

## Ordered Work

### MVP1-0 - Freeze Demo Boundary and Data

Goal: stop scope drift before coding.

Do:

- Production pilot DECIDED 2026-07-09: bombam company (existing customer; technology-services business). Remaining to close this item: verify/complete bombam's 10A onboarding on prod + `crm_line_inbox` entitlement, obtain LINE Developers access for its company OA (Channel ID/Secret/Access Token, Messaging API + webhook enabled), check OA plan/push quota, pick the owner/staff LINE identities to link to the WatchDog shared OA, and record the verification script with bombam data.
- Rich menu DECIDED 2026-07-09 (owner override of the item-07 four-slot default): three slots — แจ้งเตือน / สรุปค่าใช้จ่าย / เปิดเว็บ. No Ask AI button (free typing already reaches the natural-language path) and no Link Account button — first-run/unlinked users must get an account-link prompt reply on any interaction (existing QR/link-page flow).
- Confirm which demo documents matter: receipt photo, tax invoice, transfer slip, text note, signature image, quotation/invoice send-to-customer.
- Record the demo script in the relevant memory file before implementation starts.

Exit: everyone can say which OA receives which message and which web screen owns the resulting record.

### MVP1-1 - Close CRM Monitor Revenue Loop

Goal: customer chat becomes sales/accounting work without leaving the CRM monitor.

Prerequisite (Front-End Wire-Up Track): wire `InboxPrototypePage` to the real `crm-inbox.api` (or re-point `/inbox` to `InboxPage.tsx` and restyle to the Mangmee design) so the loop runs on real data, not mock.

Build next from [[plans/crm-line-oa-customer-os-plan|CRM + Company LINE OA Customer OS Plan]] Phase 3 remainder:

- Create deal from conversation.
- Create follow-up task from conversation.
- Create quotation draft from conversation through item 15/08 boundary.
- Send quotation/invoice/receipt link or document message back through the company LINE OA.
- Payment-proof queue: inbound image can be marked as payment proof and routed to finance review.
- Fill the inbox Customer 360 sidebar with latest deal, open tasks, finance redaction, and quick actions.
- Prod gates (Production Hardening Baseline): add a consumer for `crm.conversation.message_received`/`created` so staff get a new-conversation notification (today these outbox events have no consumer); move reply send to a retry/backoff worker queue with LINE 429/401 handling; move inbound media/profile enrichment off the in-process `void` path onto the durable workers app; wire item 06 LINE push delivery so alerts reach staff LINE (committed 2026-07-09 — API delivery logic already implemented, missing only the due-delivery sweep, `line` default channel, and failure backoff; design: [[agent-memory/notification-line-push-wiring|LINE Push Delivery Wiring]]).

Exit: prod flow passes on real data (not mock): customer LINE message -> staff notified -> sees in CRM inbox -> opens Customer 360 -> creates deal/task/quotation draft -> sends document to customer LINE (send tracked, retried on transient failure) -> payment proof is visible for finance.

### MVP1-2 - Make WatchDog Shared OA Feel Like a Product

Goal: internal users get a useful LINE surface, not just a raw webhook.

Do:

- Implement the decided rich menu (แจ้งเตือน = deep link to the web notification center; สรุปค่าใช้จ่าย = message action feeding the existing 10B/item-09 expense-read journey "ดูค่าใช้จ่าย"; เปิดเว็บ = deep link to the workspace) and first-run link/account states — unlinked users tapping anything get the account-link prompt (existing QR/link-page flow).
- Lock Thai natural-answer style: short answer first, source refs or web link next, caveat only when needed.
- Run dev-OA journeys for fragmented input, multi-command input, unsupported/final-mutation refusal, receipt capture, and "ดูค่าใช้จ่าย".
- Decide whether to turn on 10F flags for MVP 1 after dev-OA evidence.

Exit: internal user can open WatchDog OA, link account, ask a natural Thai question, receive a source-backed answer, and tap a web deep link; multi-bubble questions do not split into bad answers.

### MVP1-3 - Bill Capture Acceptance Polish

Goal: prove the bill-capture loop is stable enough for demo and first users.

Do:

- Re-smoke core variants: receipt photo, text note such as `ค่ากาแฟ 65 บาท`, signature image ticket, mutation refusal, and expense read query.
- Verify evidence download/preview behavior in the current storage path.
- Verify web review states: tax evidence status, category, substitute receipt, signature approval/fill, accountant evidence view/package.
- Keep all final confirmation/payment/export/posting actions on web.

Exit: bill/receipt/photo/text/signature inputs create only the correct draft/ticket, with a Thai LINE reply and web review link.

### MVP1-4 - CRM AI Assist + Toggle-Gated Auto-Reply

> Status 2026-07-10: SHIPPED (agent family + staff assist + §27 Level-0 auto-reply, commit `5f10df3b`). The trust>80 auto-reply gate below is superseded by spec §27 (autonomy ladder) + §28 (availability-first booking; consent/confidence gates hardened by GC1). The greenfield note in this section is historical. Remaining: per-channel toggle API/UI (harness GC5).

Build Phase 4 plus the owner-pulled-forward auto-reply toggle:

- Dedicated CRM customer AI agent family in AI Gateway, separate from shared-OA employee agents.
- Staff-assist endpoints for summary, reply draft, tone adjustment, sentiment/intent, lead score, and next action.
- `CrmTrustScoreAgent` first pass for auto-reply eligibility: AI-computed score + bounded reasoning stored on `CrmCustomer`; unscored or score <= 80 stays staff-draft.
- Initial/periodic trust-score trigger (NOT booking-only): score on registration and/or after N inbound messages and/or a scheduled sweep. Without this, no customer is scored before MVP1-7 bookings exist and the auto-reply ON path is dead. (The dedicated CRM AI agent family does not exist in ai-gateway yet — only compiled contracts — so this whole slice is greenfield.)
- Build order (committed 2026-07-09; design: [[agent-memory/crm-customer-ai-agent-family|CRM Customer AI Agent Family]]): B1 gateway scaffold + contracts + separation tests -> B2 `CrmCustomerIntakeAgent` -> B3 staff-assist endpoints + web AI panel (requires the wired Mangmee inbox) -> B4 `CrmTrustScoreAgent` + initial trigger -> B5 toggle-gated auto-reply. `CrmBookingAgent` stays MVP1-7/Phase 8C.
- Web AI panel with Insert to composer, Copy, Regenerate, feedback, unavailable/uncertain states.
- Per-company/per-channel auto-reply toggle in LINE OA/CRM settings, default OFF, managed by `crm.channel.manage`.
- Autonomous reply path uses the same dedicated CRM customer AI family but is physically separate from staff-assist endpoints.
- Deterministic API gate: toggle ON, trust score > 80, customer consent safe, quota safe, confidence sufficient, route eligible for customer reply, no unsupported media, no complaint/escalation risk, and no final business mutation.
- Toggle OFF, unscored/customer score <= 80, low confidence, missing consent, quota risk, complaint/escalation, or unsafe intent always creates a staff draft/notification instead of auto-sending.
- Every auto-sent message is appended to the conversation as AI-sent, audited, and visible to staff. Prod: global auto-reply kill switch + sent-volume metric/alert (real customers — guard against runaway sends).
- Route-table tests proving staff-assist cannot auto-send and the shared WatchDog OA cannot reach CRM customer auto-reply agents.

Exit: with toggle OFF, AI drafts can be inserted and edited, but the send action is staff-initiated. With toggle ON and trust score > 80, a safe normal customer question can receive an audited AI-sent reply; unsafe/uncertain/unscored cases fall back to staff draft.

### MVP1-5 - Owner Daily Brief and Monitoring

> Status 2026-07-10: endpoint + dashboard tiles SHIPPED with 5 widgets (unanswered, SLA, new customers, appointments, payment proof). Remaining widgets (pipeline value, quotations awaiting, overdue payments, complaints, response time) = harness GC9; AI Daily Insight + campaign results = post-launch per spec §28.

Build Phase 5:

- Dashboard widgets for unanswered chats, SLA breaches, new customers, pipeline value, quotations awaiting, payments waiting/overdue, appointments today, and response time.
- AI Daily Insight with cited sources and links to filtered queues.
- WatchDog shared OA push via item 06 delivery (committed 2026-07-09 — reuses the LINE push wiring shipped with MVP1-1).

Exit: owner sees a 30-second CRM/business brief in web and can jump to each queue; LINE push is source-linked if enabled.

### MVP1-6 - Appointments Before Any Auto-Booking

> Status 2026-07-10: backend + reminders + web create/cancel SHIPPED; reschedule/done/no-show UI + `NO_SHOW` status = harness GC8 (in progress).

Build Phase 6 before Phase 8C:

- Appointment model/API/calendar/status transitions.
- Conflict warnings and idempotency.
- Reminder scheduler to customer company OA and staff notification.
- Customer 360 appointment tab.

Exit: staff can create/reschedule/cancel/no-show appointments in web, reminders work, and every booking state is audited.

### MVP1-7 - Customer Registration and Auto-Booking

> Status 2026-07-10: B9 LIFF registration (commit `2bfd8b0d`) + gated auto-booking (commit `a47c3618`, availability-first per §28) SHIPPED. Remaining: LIFF tenant branding + real display name (GC10), auto-book channel-default fallback (GC6).

Build Phase 8B, then the booking part of Phase 8C:

- Customer LIFF registration under company branding with PDPA consent.
- No internal principal, role, session, or ERP permission for customers.
- Trust score is recomputed after every successful booking.
- Appointment booking is the only AI final execute, and only after semantic customer confirmation plus deterministic slot/tenant/idempotency guardrails.

Exit: a registered/known customer can confirm a proposed slot and get an audited AI-created appointment only when booking guardrails pass. Auto-reply toggle behavior was already shipped in MVP1-4.

### MVP1-8 - Production Cutover and Full Review

Goal: MVP 1 = production, so this is the closing review gate, NOT where security first appears (that lives in the Production Hardening Baseline, enforced per item above).

Do:

- Full cross-tenant/security battery across all MVP1 surfaces (webhook, inbox, 360, auto-reply, LIFF registration, booking).
- Confirm web/API/worker/AI Gateway envs, provider keys, LINE webhook paths, encryption key, and secrets are present in prod without printing secrets.
- Verify durable-queue health (send, inbound media, reminders), DLQ handling, and notification delivery on prod-shaped services.
- Rollback/canary plan per repo precedent (ECS Express canary + RollbackAlarm; do not probe the endpoint during bake).
- Record verification in the relevant agent memory docs; do not tick any checklist item unless implementation and verification evidence exists.

Exit: the real MVP1 production flow passes end to end on prod-shaped services, security/observability gates are green, and docs state what remains deferred.

## Deferred After MVP 1

- Campaign/broadcast unless owner explicitly pulls it in; it has higher blast risk and depends on good CRM identities/consent.
- Facebook/IG/web chat channels.
- Voice/video customer message support; voice-to-text comes before playback UI.
- Full staff CRM UI inside LINE.
- Customer LIFF booking/quotation-view pages beyond registration.
- Google Drive/public folder sharing.
- Any LINE/AI final accounting, tax, payment, export, permission, signature-approval, or ledger mutation.

## Next Implementation Prompt

Start with MVP1-1 (front-end wire-up first), then MVP1-4 must include auto-reply toggle unless owner changes priority:

> Continue WatchDog-BMS MVP 1 (production target) from `docs/plans/mvp-1-crm-line-bill-capture-sequence.md`. Implement MVP1-1 only. FIRST wire `InboxPrototypePage` to the real `crm-inbox.api`/contracts (owner decision A: Mangmee prototype is the go-forward UI; the real `InboxPage.tsx` is the reference), so the inbox runs on real data not mock. THEN close the CRM monitor revenue loop: deal/task/quotation draft from conversation, send document to customer LINE, payment-proof queue, real Customer 360 sidebar. Also close the MVP1-1 prod gates: new-conversation notification consumer, reply-send retry queue with LINE 429/401 handling, inbound media/enrichment on the durable workers app. Reuse `docs/plans/crm-line-oa-customer-os-plan.md` Phase 3 remainder and `docs/agent-memory/crm-line-oa-customer-os-15a.md`, and honor the Production Hardening Baseline. Keep company OA/customer path separate from WatchDog shared OA/internal path. Verify with focused API/web tests plus one live/browser smoke, then update relevant memory and checklist notes only when evidence exists.
