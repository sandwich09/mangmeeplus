# MVP1 Launch — Codex CLI Handoff Harness (re-scoped to ground truth)

Status: Implement-ready 2026-07-09. Supersedes the *remaining* items of [[plans/mvp1-a3-a5-revenue-loop-durable-flow-plan]] — a parallel session shipped ~90% of that plan's backend (A1–A10). This handoff covers ONLY what is genuinely still missing for the two launch loops, verified against live code by a 3-agent map + spot reads (2026-07-09).

Executor model: **Codex CLI under harness** — Codex codes + adds/updates tests + runs the listed verify commands per phase and self-reviews. **Claude reviews each phase for business completeness (diff-vs-intent + ponytail + boundary audit + browser rig), drives fixes. Owner/harness controls ALL commits — Codex never commits, never `git add`.**

Two launch loops (owner-confirmed): **A = full customer CRM** (incl. appointments/auto-booking/LIFF/daily-brief — all "CRM"); **B = company bill/receipt/reimbursement** (`ส่งบิล ใบเสร็จ ใบเบิก`). NOT the rest of the ERP.

---

## Ground-truth baseline — what EXISTS, do NOT rebuild

Loop A (CRM):
- **Inbox Customer-360 sidebar** (deals/tasks/quotations/finance) + create-deal/task/quotation-from-conversation + payment-proof flag — WIRED in `InboxPrototypePage.tsx` (**currently uncommitted — owner to commit; do NOT touch/rebuild**).
- **Appointments/Bookings** — real, wired (`BookingsPrototypePage` → `crm-booking.controller.ts`, permissions) + A7 LINE reminder sweep (`scan-crm-booking-reminders.use-case.ts`).
- **Daily brief** — real endpoint (`crm-daily-brief.use-case.ts`) + rendered dashboard tiles (`DashboardPages.tsx` `CrmDailyBriefCard`).
- **Payment-proof review queue** — real routed page (`PaymentProofReviewPage.tsx` → `CrmPaymentProofQueueController`). Review-only **by design** (reconciliation stays manual in accounting — NOT a gap).
- **New-conversation notification** — wired (`scan-crm-new-conversations.use-case.ts`, 60s scan). *Defect: body leaks message preview → H3.*
- **LINE push delivery** — wired + **verified correct** (`ProcessDueNotificationDeliveriesUseCase` + 30s sweep, default channels include `line`, backoff). The create/guard casing seam was a **false alarm** — the repo uppercases on write (`prisma-notification.repository.ts:209-210`) and the processor reads raw uppercase rows, so casing reconciles. See H1.
- **Reply-send durability** — durable columns + backoff + sweep + 429/401 distinction (`SendCrmInboxMessageUseCase`, `RetryCrmInboxDeliveriesUseCase`). *Defects: non-stable retryKey + no Retry-After → H2.*
- **Durable inbound media/profile** — backstop sweep via derived candidates (`retry-crm-inbox-deliveries.use-case.ts`). Hardening-only (P2), not a launch-blocker.

Loop B (bill/receipt/reimbursement):
- **Expense/bill capture** — real web (`ExpensesPages.tsx`) + backend + **image-receipt OCR** (`process-line-webhook.use-case.ts:1069` → `/internal/ai/receipt-ocr` → Typhoon). Ops-only: `TYPHOON_OCR_API_KEY` in prod.
- **/expenses + /sales-documents** re-point — DONE (`008e12c0`, undeployed).
- **Accounting documents** (item 08, quotation→invoice→receipt lifecycle) — real (`accounting-documents` module); `/sales-documents` == `/accounting`.
- **Reimbursement workflow** (item 14) — real module request→approval→finance-review→payment (`modules/reimbursements/**`). Missing only the *printable voucher document* → S1.

---

## Environment quirks (read before running anything)

- **Node**: shell defaults to v14. Prefix EVERY session: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- **Web**: `pnpm --filter @watchdog-bms/web typecheck` (runs `next typegen` first) / `test` (tsx `--test`, `src/**/*.spec.ts` auto-discovered).
- **API tests are a HAND-MAINTAINED explicit list** in `apps/api/package.json` `"test"` — **an unregistered new `*.spec.ts` silently never runs.** Every new API spec MUST be added to that list in the same phase.
- **Prisma/DB**: real DB is docker `:15432/watchdog_bms` (repo-root `.env`); `apps/api/.env` is stale. Pass `DATABASE_URL` explicitly from repo-root `.env` for any api test/prisma command. After editing `packages/contracts`: `pnpm --filter @watchdog-bms/contracts build` before dependent typechecks. After `schema.prisma`: `prisma validate` + `prisma generate` (explicit `DATABASE_URL`).
- **Sandbox fallback**: if `pnpm --filter … test` hits `tsx` IPC `listen EPERM`, use `node --import tsx --test <files>` with `DATABASE_URL` set.

## Hard rules (violating any = wrong implementation)

1. **No commits, no `git add -A`, explicit paths only** (shared-worktree: the dirty tree ships on deploy). Do not start dev servers (Claude runs the browser rig). Verification commands only.
2. **Do not touch the uncommitted `InboxPrototypePage.tsx`** 360-sidebar/create-action/payment-proof work (owner commits it) except where a phase below explicitly extends it.
3. **Contracts + existing clients only**: web data via `crm-inbox.api.ts`/`crm.api.ts`/`expenses.api.ts`/`accounting` clients, typed with `@watchdog-bms/contracts`, `authedApiFetch` (no direct `fetch`, no react-query/SWR). New contracts additive.
4. **Security/tenant/permission/audit explicit** on every new/changed route: server-side tenant + `@RequirePermissions` (deny-by-default AND-only guard — every route needs a gate) + ABAC scope + audit + outbox on mutations. New internal endpoints `X-Worker-Token`-guarded (mirror `CrmInternalController`).
5. **LINE/AI final-mutation ban**: LINE/AI cannot confirm/pay/post/approve. Payment-proof + document send route through human review/staff action only.
6. **PII**: notification/LINE-push bodies are **name/count only** — never customer message text.
7. **Migration lane** (two-dev): announce before any migration; **additive only**, timestamps strictly increasing; coordinate with the parallel session. Prefer reusing stable ids over new columns (see H2).
8. **XSS-inert**: customer-supplied text/media as text nodes / same-origin authed `<img>` only; no `dangerouslySetInnerHTML`.
9. **No new dependency** unless the capability genuinely requires it and it already exists elsewhere in the monorepo (see H4 — `@aws-sdk` is already used by ai-gateway).

---

# Phases (sequenced)

Owner decisions: **2026-07-09** — B9 + B10 launch-blocking. **2026-07-10** — S1 document renderer **REMOVED**: financial documents come from outside (manual — staff attaches the file in LINE themselves); the customer-reply need is only a **text reply with an AI-suggested formatted draft**, which is already shipped (see S1 below). Launch sequence: **H2–H4 ✅ → B7+B10 (P1→P4) → B9** (H1 non-issue; S1 removed). B7+B10 = the §27 auto-reply + auto-booking autonomy stack (owner 2026-07-10 "ลุยเต็ม"); B9 = customer LIFF.

## Core hardening — H2–H4 (launch-blockers, build first)

## H1 — Notification delivery casing — VERIFIED NON-ISSUE (reviewed 2026-07-09, no change)

Original concern: rows are created lowercase `'web'/'queued'` (`notification.use-cases.ts:226/228`) but the processor guards uppercase (`:286 ['QUEUED','FAILED']`, `:288 === 'WEB'`) and the Prisma enum is UPPERCASE — looked like a silent-drop seam on the path every notification flows through.

Verified FALSE on review: the repository reconciles casing. `PrismaNotificationDeliveryRepository.create` uppercases on write (`prisma-notification.repository.ts:209-210` — `data.channel.toUpperCase()` / `data.status.toUpperCase()`), so the lowercase create is stored as `WEB`/`QUEUED`; `ProcessQueuedDeliveryUseCase` reads the RAW row (`notification.use-cases.ts:281` `prisma.client…findFirst`) → uppercase → the guards match; the sweep queries `status:'QUEUED'` uppercase (`findDue:198`, `listQueued:194`). Delivery is never dropped. Lowercase-domain-value + repo-translation is the codebase convention (same repo's event/preference/alert creates).

Action: **none**. (A first Codex pass changed the create to `'WEB' as any` + added a mock-based spec — a functional no-op that defeated the domain type and whose test only "failed before" because the mock omitted the repo's `.toUpperCase()`. Reverted on review — see the review-gate finding.) Optional future hardening (NOT launch-blocking): route the processor read through the repo mapper, or add a `// ponytail:` note that the raw read expects uppercase.

## H2 — Reply-send idempotency: stable retryKey (P0, customer-facing duplicate messages)

> STATUS: implemented by Codex + reviewed **PASS** 2026-07-10 (deterministic UUID from message id at both send sites + Retry-After honored; typecheck 0, 91 specs pass; no migration/dep). Awaiting owner commit.

Business intent: retrying a failed LINE reply must not send the customer the same message twice.

Root cause: `randomUUID()` per attempt → a fresh `X-Line-Retry-Key` on the initial send (`crm-conversation.use-case.ts:241`) AND every sweep retry (`retry-crm-inbox-deliveries.use-case.ts:71`), defeating LINE-side idempotency.

Change (ponytail — no migration): generate the retry key **once** and reuse it across the initial send + all retries. Prefer deriving it from the already-stable persisted message row id (or a single value stamped on the row at PENDING-create) rather than a new column. Thread it through `pushTextMessage(...)` as `X-Line-Retry-Key`. Additive column only if a dedicated key is semantically required (announce migration if so).
Secondary (same phase, minor): parse `Retry-After` on 429 in `line-messaging.adapter.ts:70-94` and let the backoff honor it (fall back to exponential when absent). Add the missing `line-messaging.adapter.spec.ts`.

Codex verify: spec — same message failing then retried twice pushes the **identical** `X-Line-Retry-Key`; 429 with `Retry-After` yields a `nextAttemptAt` honoring the header; 401 stays terminal. Register specs.

Claude gate: browser rig with dummy LINE creds (sends land FAILED) → confirm the sweep re-pushes with a stable key across attempts; no second customer-visible message.

## H3 — New-conversation notification PII scrub (P1, PDPA)

> STATUS: implemented + reviewed **PASS** 2026-07-10 (body now a constant PDPA-safe string; spec inverts the old leak-expecting assertion into a real guard; typecheck 0, spec 5/5). Awaiting owner commit.

Business intent: staff alert says "who + that they messaged," never the message content.

Root cause (`scan-crm-new-conversations.use-case.ts:51`): `body = ... `ข้อความ: ${conv.lastMessagePreview}`` leaks the inbound message text; also audit `sourceRefs.label` (`:54`).

Change: body = the generic name/count form only (`'มีลูกค้าทักเข้ามาใหม่ ยังไม่มีผู้รับผิดชอบ'` branch always); drop the `lastMessagePreview` branch. Title keeping the customer *name* is allowed (rule 6 permits name/count).

Codex verify: spec — produced event body never contains `lastMessagePreview`/message text. Register.

Claude gate: diff shows no message-content field reaches any notification/push body across the producer.

## H4 — Production S3 evidence storage adapter (P1, loop-B evidence broken on prod)

> STATUS: implemented + reviewed **PASS** 2026-07-10 (`S3StorageAdapter` presigned PUT/GET + real HeadObject; `ATTACHMENT_STORAGE` token + env factory; SDK-mocked spec; typecheck 0, suite 1318/0). Deps `@aws-sdk/client-s3`+`s3-request-presigner` (^3) installed. Web already absolute-URL-safe — no consumer change. Awaiting owner commit.

Business intent: on prod, expense/receipt evidence bytes upload, preview, download, and the accountant manifest links actually resolve. Today only a dev/local stub exists.

Root cause: `data-model-core/infrastructure/storage/local-storage.adapter.ts` is the ONLY `AttachmentStoragePort` impl (bound `data-model-core.module.ts:37`); `getObjectMetadata` is stubbed (`byteSize:0`). Config already defines `S3_BUCKET/REGION/ENDPOINT/FORCE_PATH_STYLE` (`packages/config/src/index.ts:38-41`) and `validateProductionConfig` (`:176-177,227-234`) **requires** `S3_BUCKET` in prod — but nothing consumes it.

Change: add an `S3StorageAdapter implements AttachmentStoragePort` (presigned PUT for upload, presigned GET for download/preview, real `getObjectMetadata` via `HeadObject`), DI-bound by env — local adapter in dev, S3 in prod (select on `S3_BUCKET` presence, mirroring `validateProductionConfig`). Dependency: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — **announced, justified** (S3 presign is impossible without it; `@aws-sdk` already ships in this monorepo via ai-gateway/Bedrock).

Codex verify: unit spec — adapter builds presigned PUT/GET URLs for a bucket/key and `getObjectMetadata` returns real size (mock the S3 client; no live AWS in tests). Config-selection spec: prod config → S3 adapter, dev → local. api typecheck.

Claude gate: the expenses evidence path (`expenses.api.ts` upload→preview→accountant-package manifest links) resolves against the S3 adapter shape; local dev still works unchanged.

---

## S1 — REMOVED (owner 2026-07-10)

The document-renderer / send-doc-as-LINE-image / PDF-export slice is **cut**. Owner decision: financial documents come from **outside, handled manually** — staff attaches the actual file in LINE themselves. The customer-reply need is only a **text reply with an AI-suggested, formatted draft**, and that is **ALREADY shipped + mounted** (verified 2026-07-10 against committed code — NOT a gap):
- **Gateway**: `crm-customer-reply.agent.ts` + `crm-reply-draft.use-case.ts` + `POST crm-reply-draft` — real `IModelProvider`, grounded in the conversation window + brand + active templates + optional tone.
- **API**: `CrmAiReplyDraftUseCase` + `POST :conversationId/ai/reply-draft` (`crm-ai-assist.controller.ts:40`), permission `crm.ai.assist`.
- **Web**: `InboxAiPanel` is mounted in `InboxPrototypePage.tsx:899` (gated `crm.ai.assist`; the `<AiPlaceholder/>` at :906 is only the no-permission fallback). The **"ใช้ร่าง"** button (`InboxAiPanel.tsx:357`) does `setComposeText(draft.draftText)` → inserts the draft into the composer; staff edits, attaches the doc manually, and sends via the H2-hardened reply path.

Action: **nothing to build.** Optional polish (not launch-blocking): tune the reply agent's output format (`crm-prompts.ts`) if the draft styling needs to match a house format; a browser-rig pass to confirm panel → draft → "ใช้ร่าง" → composer → send on a real session. No renderer, no PNG/PDF, no S3 image hosting, no `pushImageMessage`, no doc-view route.

## B7+B10 — CRM AI autonomy stack (auto-reply + auto-booking) — IN LAUNCH (owner 2026-07-10: "ลุยเต็ม")

Owner's spec (2026-07-10) = §27 **Level 0 (autonomous auto-reply)** + **Level 2 (AI auto-booking)**. Behaviors: (a) when the AI auto-toggle is ON **and** a customer's requested slot is **free** → **AI books it** (a sanctioned final mutation, gated); (b) when no slot matches → **AI replies proposing nearby free slots** for the customer to pick, looping until a slot is chosen. Both unstarted (Dev-B lane B7/B10); mostly greenfield.

**CROSS-LANE + BOUNDARY (read first):**
- Touches **Dev-B-owned** files (`apps/ai-gateway/src/modules/crm-customer-ai/*`, `packages/contracts/src/crm-ai.ts`, `crm-ai-*` in crm-inbox, `*AiPanel*`) **and SHARED** (`schema.prisma`+migration, `crm-inbox.module.ts`, `contracts/index.ts`, permission registry). Announce shared edits; coordinate migration ordering with the parallel session (shared-worktree hazard).
- **AI-final-mutation sanction (owner 2026-07-10)** — the code ban is otherwise absolute. The AI may create a booking ONLY when ALL hold, checked DETERMINISTICALLY (never LLM-decided): auto-toggle **ON** + customer **trust>80** (§27 Level-2 gate) + the requested slot is **actually free** + within **caps**. Audited. NEVER pay/approve/post/void/issue. This is the ONLY sanctioned AI write — keep it narrow.
- Handshakes: **H3 (send path) = SATISFIED** by H2 (reply-send idempotency/retry). **H4 (availability read) = built by P1** below.

**Reuse (do NOT rebuild):** trust score + tier + §27 clamp (`crm-ai-trust.logic.ts:29-69`); reply agent incl. the dormant `AUTONOMOUS` branch (`crm-customer-reply.agent.ts:47-53`); `BOOKING_REQUEST` intake classifier (`crm-prompts.ts:14`, gateway `POST crm-intake` + `CrmIntakeUseCase`); `findOverlappingBooking` + `createBooking` (`crm-booking.use-case.ts`); frozen contract seams (`AUTONOMOUS` mode, `AI` role, `refused` status — `crm-ai.ts:33,38,63`); the H2-hardened send path.

### Stage P1 — Appointment-availability API (Dev A, clean, NO migration) ← START HERE
The H4 foundation. Build "free slots for a staff/branch on a day" over existing non-cancelled bookings + the existing 09:00–20:00 / 30-min / 1–3h window (`crm-booking.logic.ts`) — pure logic (enumerate the window, subtract booked) + one day-range repo query; **no new working-hours config/migration** (per-staff hours = later refinement, `ponytail:` comment it). Expose `GET .../crm/bookings/availability?branchId&staffUserId&date` gated `crm.booking.read` + an `isSlotFree(staffUserId,start,end)` helper (reuse `findOverlappingBooking`). Contracts additive. Specs (pure logic): free windows = window minus booked; `isSlotFree` true/false at boundaries. Also improves MANUAL booking UX; it is the input to P4.

### Stage P2 — Autonomy migration (SHARED schema — ANNOUNCE, additive only)
Per-channel `autoReplyEnabled Boolean @default(false)` + `autoReplyDailyCap Int @default(50)`; per-conversation daily cap (5/day — counter + `autoReplyCheckedAt DateTime?`); add **`AI`** to `CrmMessageAuthorType` enum; fold in the CrmBooking `source` (`STAFF|LINE`) + a system-actor path for `createdByUserId` (P4 needs it). Mirror in `contracts`. Timestamp strictly increasing; coordinate with the parallel session. Specs: defaults (OFF, cap 50); `AI` enum present.

### Stage P3 — Autonomous auto-reply send = §27 Level 0 (Dev B lane)
Webhook/outbox-driven consumer: on inbound customer message, IF `autoReplyEnabled` + within caps + Level-0 QUESTION-grounded turn → call the reply agent (mode `AUTONOMOUS`) → send via the LINE adapter (H2 path) as `authorType='AI'` → increment caps + stamp `autoReplyCheckedAt`. **No trust gate** (Level 0). Holding message + kill-switch env + per-conversation 5/day. Audited. Add `requestCrmReply({mode:'AUTONOMOUS'})` to `crm-ai-gateway.client.ts`. Specs: enabled→sends AI msg (author=AI); disabled/cap-hit→no send.

### Stage P4 — Gated AI auto-booking = §27 Level 2 (Dev B lane)
Wire `requestCrmIntake` (dead-ended today) so `BOOKING_REQUEST` is detected off the inbound seam. Then:
- **Match path**: auto-toggle ON + trust>80 + requested slot free (P1 `isSlotFree`) → **AI creates the booking** via a NEW system-actor gated path (audited, `source=LINE`, `sourceConversationId`; NOT `CreateCrmBookingUseCase`, which requires staff `ctx.userId`) → AI confirms to the customer (P3 send) → the existing A7 reminder arms.
- **No-match path**: (no free slot / trust≤80 / toggle off) → AI proposes nearby free slots (P1 + P3 auto-reply); loop until the customer picks one, then re-run the match path.
Every gate deterministic (toggle, trust>80, slot-free, cap, audit). Specs: match+toggle+trust→booking created+confirmed; no-match→propose-slots reply + NO booking; toggle-off or trust≤80→never auto-books.

Codex verify (per stage): api/gateway typecheck + test (registered, explicit `DATABASE_URL`); workers typecheck; prisma validate/generate for P2. Claude gate (per stage): the specific business behavior + the deterministic gates hold + boundary/audit intact + the migration is additive + no Dev-B-file regression.

## B9 (Phase 7) — Customer LIFF registration/self-service — IN LAUNCH, greenfield

Business intent: a customer opens the OA's LIFF link and registers themselves — creating/linking a CRM customer bound to their LINE identity, with PDPA consent — so they're attributable in inbox/360 and reachable for CRM.

Reuse: the **employee** LIFF pattern in `auth.controller.ts` (server-rendered page, CDN `liff.init`, POST to a link endpoint, **server-side LINE-token verification**) — mirror it for a **customer** flow. The inbound pipeline already creates LINE identities (`enrichIdentityProfile`); registration adds a customer-initiated profile + consent.

Change:
- **W1 LIFF page**: a new server-rendered customer-register LIFF page (mirror the employee-link page; `liff.init` with `lineLiffId`; form = name/phone + PDPA consent checkbox). XSS-inert.
- **W2 register endpoint**: `POST /auth/line/customer-register` (or a CRM self-register use-case) — **verify the LINE idToken/access-token server-side** (never trust a client-supplied userId), then create/link `CrmCustomer` + identity binding to the LINE userId + persist **PDPA consent** (additive consent field/model — **announce migration**; align with MVP1-0 PDPA notice). Audited. Scope the created customer to the OA's company via the channel binding. Rate-limited.
- **W3 surfacing**: the registered customer appears in `/customers` + is attributed in the inbox 360; if already known via inbound messages, **link (don't duplicate)** the identity.
- **W4 specs**: token-verified register creates/links exactly one customer + consent; forged/absent token rejected (no customer created); duplicate LINE identity links not duplicates; PDPA consent persisted. Register api specs.

Boundary note: customer-facing but LIFF/LINE-token-authenticated — the only trust is the server-verified LINE token (no ambient tenant permission; it's self-service).

Codex verify: api typecheck + test (registered, explicit `DATABASE_URL`); prisma validate/generate for the consent migration.
Claude gate: a LIFF register round-trip creates a consented, identity-bound customer visible in `/customers`; a request without a valid LINE token is rejected; no duplicate customer when the identity already exists.

---

## Per-phase Claude review gate (the "did Codex do it business-complete" contract)

After Codex finishes each phase, Claude runs and returns **PASS** or **FIX (specifics)** — Codex iterates until PASS; only then does the owner commit:
1. **Diff vs intent + ponytail**: shortest correct diff, reused existing patterns/helpers/contracts, no speculative abstraction, no unrequested dep. Touched files scoped.
2. **Business question (not just green tests)**: does the phase close the stated customer/company *outcome*? (H1: a real event actually reaches web+LINE. H2: no duplicate customer message on retry. H4: evidence resolves on a prod-shaped adapter. S1: the customer receives the actual document; the voucher/PDF carries the right fields.)
3. **Boundary audit**: tenant + `@RequirePermissions` on every route; audit + outbox on mutations; `X-Worker-Token` on internal endpoints; PII name/count-only; LINE/AI final-mutation ban intact; XSS-inert.
4. **Verification real**: listed typecheck/test green with new specs **registered** in the api test list; migrations additive + announced; and — where observable — the **browser rig** (`api-verify-3011` + `web-verify-3002`, seeded docker DB) demonstrates the behavior, not just unit green.
5. **No-regression**: the uncommitted inbox 360 work + already-DONE surfaces untouched.

## Owner / ops (NOT Codex code — do in parallel)

- **Deploy**: prod still serves the PR#6 mock for `/inbox` + `/expenses` (fix committed `008e12c0`, undeployed). Owner-gated canary — bill-review + inbox are broken on prod until it ships.
- **Commit the uncommitted inbox work** (360 sidebar + create-actions + payment-proof) before the parallel session sweeps it.
- **`TYPHOON_OCR_API_KEY`** set in prod (else image-receipt OCR degrades to `NOT_CONFIGURED` → manual web review only).
- **Coordinate migration ordering** with the parallel Dev-A session for any H2/S1/S2 additive migration.

## Done criteria (launch)

- H2–H4 green + browser-verified: no duplicate customer messages on retry, PII-clean alerts, prod S3 evidence resolves. (H1 casing = verified non-issue on review; notifications already reach web+LINE.)
- ~~S1 renderer~~ **REMOVED** (owner 2026-07-10): documents are external/manual; the customer reply is a text message with an AI-suggested formatted draft — already shipped (`InboxAiPanel` + `reply-draft` chain); verify the panel→draft→composer→send flow on a real session.
- B7+B10 (autonomy stack): with auto-toggle ON, a customer's booking request auto-books a FREE slot (gated: trust>80 + slot-free + cap + audit) or the AI proposes nearby slots; Level-0 auto-reply sends AI-authored messages within caps. B9: customer LIFF register creates a consented, identity-bound customer, no duplicates.
- Every phase's specs registered; migrations additive; evidence + file lists appended to [[agent-memory/mvp1-a3-a5-revenue-loop-durable-flow]]; deploy + ops items handed to owner.
