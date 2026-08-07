# MVP1 A3–A5 + push + `/expenses`: CRM Revenue Loop + Durable Flow — Codex Harness Plan

Status: Implement-ready 2026-07-09 (backend surface code-verified via 3-agent map — see [[agent-memory/mvp1-a3-a5-revenue-loop-durable-flow]] "Verified Baseline"). Follows the proven [[plans/mvp1-a1-web-wireup-plan|A1 harness]] format.
Executor: **Codex CLI under harness** — Codex codes + adds/updates tests + runs the listed verify commands per phase; **Claude reviews each phase (diff vs this plan + ponytail), drives fixes, runs the browser rig; owner/harness controls ALL commits — Codex never commits, never `git add`.**
Scope (owner-confirmed 2026-07-09): the **full revenue loop + durable flow** the sequence doc leaves open, plus the loop-B `/expenses` re-point. Maps to two-dev lanes **A3** (Phase 3 revenue-loop remainder), **A4** (new-conversation notification + item-06 LINE push), **A5** (durable inbound media + reply-send retry/DLQ, resolves **H3**), and the loop-B `/expenses`/`/sales-documents` web wire-up. `/inbox`, `/customers`, `/crm-reports`, AI panel = **already DONE (A1/B5, committed `eacd8984`/`274c5028`/`a580f324`/`d67d24c5`), awaiting owner-gated canary deploy — NOT re-done here.**
Authority: [[plans/crm-line-oa-customer-os-plan]] Phase 3 (line 212–229, "Remaining Phase 3") + Production Hardening Baseline; [[plans/mvp-1-crm-line-bill-capture-sequence]] MVP1-1; [[agent-memory/notification-line-push-wiring]] (Phase 7 design); [[plans/mvp-1-two-dev-parallel-plan]] lanes A3/A4/A5 + H3 + migration-lane rule.

## Verified backend baseline (what EXISTS — do NOT rebuild)

Grounded in the 3-agent code map (2026-07-09). Full detail in the task memory.

- **Deal engine** = `CrmOpportunity`. Full CRUD/pipeline: `crm-opportunity.use-case.ts` `CreateCrmOpportunityUseCase`, routes `POST /companies/:companyId/crm/opportunities` (`crm.opportunity.create`); web client `createCrmOpportunity` (`crm.api.ts`). Missing only: no `conversationId` link (bridge via the conversation's `customerId`).
- **Task engine** = `CrmFollowUp`. Full lifecycle: `crm-follow-up.use-case.ts` `CreateCrmFollowUpUseCase`, `POST /crm/follow-ups` (`crm.follow_up.create`); web `createCrmFollowUp`. Same customer-mediated bridge.
- **Quotation-from-deal** EXISTS: `crm-quotation.use-case.ts` `CreateCrmQuotationDraftUseCase`, `POST /crm/opportunities/:opportunityId/quotation-drafts` (`crm.quotation.link` + `accounting.quotation.create`) — ensures counterparty, calls `CreateDocumentUseCase`, persists `CrmQuotationLink`. Needs an `opportunityId` (no direct conversation→quotation).
- **Customer 360 read** EXISTS and already aggregates the sidebar's data: `GET /crm/customers/:id/summary360` (`crm-customer-360.use-case.ts` `GetCrmCustomer360SummaryUseCase`, `crm.customer.read`) → `CrmCustomer360Summary` with `customer` + `conversations` + `deals{openCount,openAmountTotal,latest}` + `tasks{openCount,next}` + `quotations[]` + `finance{documents}`, **per-source redaction** (`redactedSources`, never a whole-page 403). Web client `getCrmCustomer360` (`crm.api.ts`).
- **Expense review UI** EXISTS + verified (item 09): `apps/web/src/features/expenses/ExpensesPages.tsx` (upload/list/detail/doc-review/tax/category/signature/substitute/duplicate/ready/confirm/reject/void/record-payment) wired to `expenses.api.ts`. **Mounted at NO route** — `/expenses` renders `MangmeeModulePrototypePage moduleKey="expenses"` (generic placeholder).
- **Durable-flow substrate**: `apps/api` has **zero** BullMQ producers. Pattern = worker self-schedules a repeatable job → HTTP `POST` to an `X-Worker-Token` `/internal/*` endpoint → API use-case. New sweeps copy `apps/workers/src/common/scan-worker.ts` (`upsertJobScheduler`). Template end-to-end = `crm-sla-worker.ts` (`sla.scan` 60s) → `CrmInternalController.slaBreachScan` → `ScanCrmSlaBreachesUseCase` → `CreateOrUpdateNotificationEventUseCase`.
- **Notification/delivery substrate**: `CreateOrUpdateNotificationEventUseCase` (dedup/cooldown + web/line `NotificationDelivery` rows), `ProcessQueuedDeliveryUseCase` (LINE branch: preference/quiet-hours/binding/identity/token/push), internal `POST notification-deliveries/:id/process`, worker `handleDeliveryProcess`. Retry scaffold = `NotificationDelivery` model (`attemptCount/nextAttemptAt/errorCode` + sweep index `@@index([companyId, channel, status, nextAttemptAt])`) + `computeNextAttemptAt` (`notification-jobs.ts`) + `isRetryable`.

### The genuine gaps this harness closes

| # | Gap | Verdict | Where |
|---|-----|---------|-------|
| G1 | `/expenses` (+`/sales-documents`) mock placeholder; real `ExpensesPages` mounted nowhere | web wire | route pages |
| G2 | Inbox rail renders NO deals/tasks/finance; no create-deal/task/quotation from conversation | web glue over ready `summary360` + create clients | `InboxPrototypePage.tsx` |
| G3 | `crm.conversation.message_received`/`created` have NO notification consumer (staff get no new-chat alert) | backend producer | inbound use-case + notification |
| G4 | Inbound media/profile enrichment runs as in-process `void` (lost on deploy, no retry) | durable worker | `process-inbound-line-message.use-case.ts` L135/L197 |
| G5 | Reply send inline, no retry/backoff/DLQ; LINE 429 → generic, `Retry-After` never read | durable worker + adapter | `crm-conversation.use-case.ts` `SendCrmInboxMessageUseCase`; `line-messaging.adapter.ts` |
| G6 | item-06 LINE push: no due-delivery sweep/producer; default channels exclude `line`; no failure backoff | worker + use-case | `ProcessQueuedDeliveryUseCase`, `notification-worker.ts` |
| G7 | Send document to customer LINE (outbound is TEXT-only; adapter has no doc push; no doc view link) | **greenfield (Phase 8 — owner chose B: rich Flex/image push + doc-view route)** | crm-inbox send + accounting |
| G8 | Payment-proof queue (inbound image → finance review) | **greenfield** | crm-inbox message + finance |

## Hard rules (violating any = wrong implementation)

1. **Mangmee design stays** on already-wired CRM surfaces; the inbox sidebar additions reuse the existing `MangmeeCard`/rail classes and Thai copy tone — no visual redesign. `/expenses` re-point mounts the real `ExpensesPages` **as-is** (owner decision: functional-now, Mangmee restyle is a later slice — do NOT restyle it here).
2. **Kill mock, never fake**: wired surfaces import nothing from `mangmee-crm-data.ts`; `/expenses` imports nothing from `mangmee-prototype`. NEVER render mock rows as an API-failure fallback — render the error state.
3. **Contracts + existing clients only**: all web data via `crm-inbox.api.ts` / `crm.api.ts` / `expenses.api.ts`, typed with `@watchdog-bms/contracts`; new client fns go INTO those files using `authedApiFetch` — no direct `fetch`, no react-query/SWR (repo uses `useState`/`useEffect`). All new API contracts are **additive** to `packages/contracts/src/*`.
4. **Real-page conventions**: mirror the A1 wire-up for loading / error / `ForbiddenState` (403) / empty states with Thai copy, permission gating, 350ms debounced search, 10s polling paused on `document.hidden`, stale-response abort.
5. **AI Gateway boundary untouched**: this is all ERP-core (Dev A lane). Do NOT touch `apps/ai-gateway`, the `crm-customer-ai` module, or any `crm-ai-*` files (Dev B owns them). The send path you harden here is what B7 auto-reply will later call (H3) — keep `SendCrmInboxMessageUseCase`'s signature stable; extend, don't rename.
6. **No-backend ⇒ hide, don't fake** (carried from A1): any UI whose backend is not yet in this harness stays hidden with a `{/* MVP1-x: <what> arrives with <phase/item> */}` comment.
7. **Derive, never invent**: presentational fields the API doesn't return are derived from real fields; no fabricated scores/tiers/LTV/amounts.
8. **XSS-inert**: customer-supplied text/media renders as text nodes / same-origin authed `<img>` only; no `dangerouslySetInnerHTML`. Phase 8 doc-view link and Phase 9 proof view inherit this.
9. **Security/tenant/permission/audit boundaries explicit** on every new route: server-side tenant + `@RequirePermissions` (deny-by-default guard is AND-only — every route needs a permission gate) + ABAC scope + audit + outbox on mutations. New internal endpoints are `X-Worker-Token`-guarded (mirror `CrmInternalController`). Payment-proof/marking respects the boundary: **LINE/AI cannot confirm/pay/post** — proof marking routes to a human review queue only.
10. **Migration lane** (two-dev rule): announce before creating any migration; **additive only**, timestamps strictly increasing, and coordinate ordering with Dev B's in-flight migrations (B has toggle/cap/`AuthorType.AI`/`autoReplyCheckedAt`/`turnClass` sets pending). This harness introduces additive migrations in Phases 5, 6, 9 only — see each phase.
11. **No commits, no `git add -A`, explicit paths only** (shared-worktree rule — the dirty tree ships on deploy). No new dependencies. Do not start dev servers (Claude runs the browser rig). Verification commands only.

## Environment quirks (read before running anything)

- **Node**: shell defaults to v14 → breaks pnpm/tsx. Prefix EVERY command session: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- **Web**: typecheck runs `next typegen` first — `pnpm --filter @watchdog-bms/web typecheck`. Web unit tests: `pnpm --filter @watchdog-bms/web test` (tsx `--test` glob `src/**/*.spec.ts` — new web specs are auto-discovered).
- **API tests are a HAND-MAINTAINED explicit list** in `apps/api/package.json` `"test"` (tsx `--test` file list) — **an unregistered new `*.spec.ts` silently never runs.** Every new API spec in Phases 4–9 MUST be added to that list in the same phase.
- **Prisma/DB**: the real DB is docker `:15432/watchdog_bms` (repo-root `.env`); `apps/api/.env` is stale (`:5432/mydb`). Pass `DATABASE_URL` explicitly from repo-root `.env` for any api test/prisma command. After editing `packages/contracts`: `pnpm --filter @watchdog-bms/contracts build` before dependent typechecks. After `schema.prisma`: `prisma validate` + `prisma generate` (explicit `DATABASE_URL`).
- **Sandbox fallback**: if raw `pnpm --filter … test` hits `tsx` IPC `listen EPERM`, the allowed fallback is `node --import tsx --test <files>` with `DATABASE_URL` set (precedent: A1 Phase 3/4 evidence).
- Do not commit — the harness owner controls commits.

---

## Phase 1 — `/expenses` re-point (loop B web wire-up) — web-only, trivial

Closes G1. The real `ExpensesPages` is complete + verified; this only mounts it.

Files: `apps/web/app/(workspace)/companies/[companyId]/expenses/page.tsx`, `apps/web/app/(workspace)/companies/[companyId]/sales-documents/page.tsx`, `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts` (nav only if repointing `/sales-documents`).

- **W1** `/expenses` route: replace `MangmeeModulePrototypePage moduleKey="expenses"` with the A1 session pattern — `fetchServerSession(companyId)`, `redirect('/login?next=…')` when null, render the real expenses page (mirror `/accounting`'s `AccountingPage` shape: `import { <ExpensesHub export> } from '@/features/expenses/ExpensesPages'`; confirm the exact export name in `ExpensesPages.tsx` and pass `companyId`). Server enforces `expense.*` permissions; keep the page's own states.
- **W2** `/sales-documents`: the real item-08 feature already serves at `/accounting` (real `AccountingHubPage`). Re-point the `/sales-documents` **nav entry** (`web-core-workspace.constants.ts`) to `/accounting` and delete the `/sales-documents` mock route page (or, if the nav must keep a distinct slot, mount the same real `AccountingHubPage` there). Do NOT leave a mock placeholder on a launch surface. (`/sales` `moduleKey=sales` stays a placeholder — out of launch scope, leave as-is.)
- **W3** Confirm no `mangmee-prototype` import remains under the `/expenses` (and repointed `/sales-documents`) route.

Verify (Codex): `pnpm --filter @watchdog-bms/web typecheck` + `test`; `grep -rn "mangmee-prototype" apps/web/app/\(workspace\)/companies/\[companyId\]/expenses` returns nothing; `git diff --check`.

## Phase 2 — Customer 360 sidebar + create deal/task from conversation (A3.1) — web-only over ready reads

Closes G2 (read side + deal/task). No backend — `summary360` + `createCrmOpportunity`/`createCrmFollowUp` all exist.

Files: `apps/web/src/features/crm-inbox/InboxPrototypePage.tsx` (the right-rail `CustomerPanel`), `apps/web/src/features/crm/crm.api.ts` (reuse; add typing only if needed), possibly a small `apps/web/src/features/crm-inbox/inbox-sidebar.model.ts` (+spec) for pure mapping helpers.

- **W1** On conversation open, fetch `getCrmCustomer360(companyId, detail.customerId)` (already imported path exists for the deep-link) alongside the existing `getCrmCustomer`. Gate each section by the summary's `redactedSources` — a redacted source renders a small "ไม่มีสิทธิ์ดู" note, never blanks the panel.
- **W2** Render in the rail below the customer card: **ดีล** (latest deal name/stage/amount + open count from `deals`), **งานติดตาม** (next task + open count from `tasks`), **การเงิน** (finance `documents` count + latest doc status), **ใบเสนอราคา** (from `quotations`). Reuse `MangmeeCard` styling.
- **W3** Quick actions (gated): **"สร้างดีล"** (`crm.opportunity.create`) → `createCrmOpportunity({ customerId: detail.customerId, … minimal fields })`; **"สร้างงานติดตาม"** (`crm.follow_up.create`) → `createCrmFollowUp({ customerId, dueAt, note })`. Small inline forms/modals in the Mangmee style; on success refresh the 360 summary + append an optimistic rail update. No new endpoints.
- **W4** Keep the hidden-block comments (rule 6) for purchases/LTV/appointment/slip-verify until their phases; the "ดูโปรไฟล์เต็ม" deep-link stays.

Verify: web typecheck + test + build; sidebar renders real `summary360`; create-deal/task round-trip refreshes the panel.

## Phase 3 — Quotation draft from conversation (A3.2) — thin glue

Closes G2 (quotation). `CreateCrmQuotationDraftUseCase` needs an `opportunityId`.

- **Decision (ponytail, confirm if you disagree)**: **deal-first, zero new backend.** The sidebar "สร้างใบเสนอราคา" action: if the customer has an open deal use it, else create one (Phase 2 bridge), then call the existing `POST /crm/opportunities/:opportunityId/quotation-drafts`. Deep-link the created accounting doc (`/accounting`). This avoids a new conversation→quotation use-case. (Alternative — a direct `customerId`→quotation convenience endpoint — only if the owner wants quoting without a deal; not built by default.)

Files: `apps/web/src/features/crm-inbox/InboxPrototypePage.tsx`, `apps/web/src/features/crm/crm.api.ts` (reuse `createCrmQuotationDraft` client if present; add if missing, additive). No API/contract change under the default decision.

- **W1** Sidebar "สร้างใบเสนอราคา" (gated `crm.quotation.link` + `accounting.quotation.create`): resolve-or-create opportunity → create quotation draft → toast + deep-link. Loading/error/permission states.
- **W2** Show the resulting `CrmQuotationLink` in the ใบเสนอราคา section (refresh summary).

Verify: web typecheck + test + build; quotation draft appears in `/accounting` and in the sidebar after creation.

> **Phase 3 exit = CRM plan Phase 3 demo criterion (read/create half):** "chat → view 360 → create deal → quotation draft → follow-up task" runs live on real data. The "send to LINE" half lands in Phase 8.

## Phase 4 — New-conversation notification (A4.1) — backend producer

Closes G3. Copy the SLA notification path exactly.

Files: `apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts` (trigger key), `apps/api/src/modules/crm-inbox/application/use-cases/process-inbound-line-message.use-case.ts` OR a new `scan-crm-new-conversations.use-case.ts` (+ register in `crm-inbox.module.ts`), `apps/api/src/modules/crm-inbox/presentation/http/crm-internal.controller.ts` (if scan-based), `apps/workers/src/modules/crm-inbox/*` (if scan-based), the new `*.spec.ts` + **`apps/api/package.json` test list**.

- **W1** Add `crm_new_conversation` to `IMPLEMENTED_TRIGGER_KEYS`.
- **W2** Produce the notification: on first inbound message that opens a NEW conversation (not every message), call `CreateOrUpdateNotificationEventUseCase.execute({ triggerKey:'crm_new_conversation', severity:'action', title/body = customer display name + "ส่งข้อความใหม่" (NAME/COUNT ONLY — no message text, PII rule), deepLinkHref:'/companies/:id/inbox?conversation=:id', sourceRefs:[{permissionKey:'crm.inbox.read'}], recipientUserIds = inbox managers (+ assignee if any) })`. Prefer producing inline in the inbound use-case at conversation-created (L303 site) for latency; if that risks the fast-200 path, use a 60s scan copying `ScanCrmSlaBreachesUseCase`. **Dedup** on conversationId so repeated inbounds don't re-alert.
- **W3** Spec: new conversation → one event + recipients = managers; repeat inbound → no duplicate; PII-free body.

Verify: api typecheck + test (new spec registered) with explicit `DATABASE_URL`. (Web notification center already reads these; LINE delivery waits Phase 7.)

## Phase 5 — Durable inbound media/profile enrichment (A5.1) — backend + workers + additive migration

Closes G4. Replace the two in-process `void` tasks with the DB-row-as-queue + sweep pattern.

Files: `apps/api/prisma/schema.prisma` (**additive** pending markers), migration dir, `process-inbound-line-message.use-case.ts` (enqueue markers instead of `void`), a new drain use-case + `crm-internal.controller.ts` endpoint, `apps/workers/src/modules/crm-inbox/*` new sweep (copy `common/scan-worker.ts`) + register in `apps/workers/src/main.ts` (append-only), contracts if any, new specs + api test-list.

- **Announce migration** (rule 10). **W1** Add additive markers: e.g. `CrmMessage.mediaPending Boolean @default(false)` (+ `mediaError` already exists) and an identity `profilePending`/`profileFetchedAt` marker — minimal columns to select due rows. Indexes for the sweep selection.
- **W2** In the inbound use-case, replace `void this.storeInboundMedia(...)`/`void this.enrichIdentityProfile(...)` with: set the pending marker (keep the fast 200). Do NOT delete `storeInboundMedia`/`enrichIdentityProfile` — the drain reuses their bodies.
- **W3** New sweep worker (`crm-inbox` queue is SLA-owned — use a **new queue name** to avoid collision, mirror how B added `crm-trust`; announce the cross-lane `main.ts` append) → `POST /internal/crm/enrichment-sweep` (worker-token) → drain use-case selects due pending rows (batch ≤50), calls the existing enrichment bodies, clears the marker on success / records error + leaves for retry with a bounded attempt cap.
- **W4** Specs: due-selection excludes cleared/maxed rows; success clears marker; failure retries then dead-letters (marker stays with error after cap).

Verify: prisma validate + generate + api typecheck + test (new specs registered, explicit `DATABASE_URL`); workers typecheck.

## Phase 6 — Reply-send retry/backoff/DLQ + LINE 429 (A5.2, resolves H3) — schema + backend + workers + adapter

Closes G5. Unblocks Dev B's B7 auto-reply (H3).

Files: `apps/api/prisma/schema.prisma` (**additive** on the outbound message row: `attemptCount Int @default(0)`, `nextAttemptAt DateTime?`, keep a stable `retryKey`), migration, `crm-conversation.use-case.ts` (`SendCrmInboxMessageUseCase` — signature STABLE, extend), `line-messaging.adapter.ts` (`Retry-After` parse on 429), a send-sweep drain use-case + `crm-internal.controller.ts` endpoint, `apps/workers/src/modules/crm-inbox/*` sweep + `main.ts`, specs + api test-list.

- **Announce migration. W1** On a FAILED push, instead of terminal FAILED: set `attemptCount+1`, `nextAttemptAt = computeNextAttemptAt(attemptCount)` (port/reuse the notification helper into a CRM logic module), keep the row PENDING/RETRYING with a **stable `retryKey`** (generate once, reuse across attempts as `X-Line-Retry-Key` — today `randomUUID()` per call defeats idempotency). Terminal DLQ = FAILED after `MAX_SEND_ATTEMPTS` + audit + `deliveryError`.
- **W2** Adapter: on 429 read `res.headers.get('retry-after')` and surface it so the backoff can honor it; distinguish `line_api_429` (retryable) from `invalid_access_token` (401, terminal — do not retry, audit).
- **W3** Send-sweep worker (reuse the Phase 5 queue or a sibling) → `POST /internal/crm/send-sweep` → drain selects due PENDING/RETRYING (`nextAttemptAt <= now`, `attemptCount < MAX`), re-pushes with the stable key, advances SENT / re-backoffs / dead-letters.
- **W4** Specs: transient 429 → retry with future `nextAttemptAt` + honored Retry-After; 401 → terminal, no retry; success after N; DLQ after MAX; stable retryKey across attempts.

Verify: prisma validate + generate + api typecheck + test (registered, explicit `DATABASE_URL`); workers typecheck. **H3 handshake note appended to the two-dev plan when merged.**

## Phase 7 — LINE push delivery wiring (A4.2 / item-06) — backend + workers

Closes G6. Implements [[agent-memory/notification-line-push-wiring]] verbatim; makes Phase 4 new-conversation + SLA + daily-brief alerts reach staff LINE.

Files: `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts` (`ProcessQueuedDeliveryUseCase` default channels + failure backoff; `GetPreferenceUseCase` default), a new delivery-sweep internal endpoint (new `@Controller('internal/notifications')` beside the existing internal controller), `notification.logic.ts` (port `computeNextAttemptAt`), `apps/workers/src/modules/notifications/notification-worker.ts` (add `scheduleRepeatableJobs` for `delivery.sweep` 60s), specs + api test-list.

- **W1 Sweep**: `POST /v1/internal/notifications/delivery-sweep` (worker-token), select `status IN (QUEUED,FAILED) AND attemptCount < MAX AND nextAttemptAt <= now` oldest-first (batch 100), per-row `ProcessQueuedDeliveryUseCase` with per-row error isolation, return counts. **Reconcile the status-case caveat** (schema enum is UPPERCASE `QUEUED/FAILED`; parts of the logic use lowercase — normalize in the sweep filter).
- **W2 Default channels** `['web','line']` in both fallbacks (unlinked users resolve to harmless `skipped NO_LINE_DELIVERY_TARGET`; opt-out via existing prefs UI).
- **W3 Failure backoff**: on `failed` set `nextAttemptAt = computeNextAttemptAt(attemptCount)` (cap 1h); `suppressed`/`skipped` stay terminal.
- **W4 Worker**: repeatable `delivery.sweep` (`jobId:'notification-delivery-sweep'`, 60s) via `scheduleRepeatableJobs`; keep the existing `delivery.process`/`delivery.retry` handlers.
- **PII**: LINE push body is name/count-only (no customer message text) — matches Phase 4.

Verify: api typecheck + test (default-channel gate, backoff, sweep due-selection incl. status-case; registered, explicit `DATABASE_URL`); workers typecheck.

## Phase 8 — Send document to customer LINE (A3.3) — greenfield, HIGHEST RISK

Closes G7. Outbound is TEXT-only today; adapter has no doc push; there is no customer-facing doc view.

> **OWNER DECISION — RESOLVED 2026-07-09: option (B) chosen** (rich push, not the tokenized-text-link default).
> **LINE constraint (must respect):** the Messaging API has NO generic PDF/file push. "Rich document push" = either a **Flex bubble** (a doc-summary card with a "ดูเอกสาร" button) or an **image message** (the doc rendered to a hosted HTTPS image). Both still need the document reachable by the customer, so option B is a SUPERSET of the text-link option: it keeps a scoped read-only doc-view/asset route AND adds a Flex/image push path. Higher build + a media-hosting decision (image render + HTTPS host) vs Flex-with-button (reuses the doc-view route only). Prefer **Flex-with-button** first (no image-hosting), image message as a follow-up if a visual preview is wanted.

Files: `apps/api/src/modules/accounting-documents/**` (scoped, expiring, revocable read-only doc-view route OUTSIDE `/v1` — mirror the item-09 `local-storage` public-route precedent; plus, only if image push is used, a rendered-doc asset + HTTPS URL), `apps/api/src/modules/crm-inbox/infrastructure/line-messaging.adapter.ts` (NEW push method(s): `pushFlexMessage` and/or `pushImageMessage` — today only `pushTextMessage` exists), `crm-conversation.use-case.ts` (`SendCrmInboxMessageUseCase` — a `DOCUMENT`-typed outbound branch composing the Flex/image payload; `CrmMessageType` already has `DOCUMENT`; keep the text branch + method signature stable), `packages/contracts` additive, `InboxPrototypePage.tsx` + accounting UI "ส่งให้ลูกค้า" action, specs + api test-list.

- **W1 doc-view route**: issue a scoped, expiring, revocable doc-view token for a specific accounting document (permission `accounting.document.read` to issue; audit). Public read route OUTSIDE `/v1`: token → read-only doc view (no PII beyond the doc; rate-limited; XSS-inert). (Image push only: also render the doc to a PNG at a stable HTTPS asset URL under the same token scope.)
- **W2 adapter**: add `pushFlexMessage(token, to, flex, retryKey)` (and/or `pushImageMessage(token, to, originalContentUrl, previewImageUrl, retryKey)`) to `LineMessagingAdapter` — HTTPS-only URLs, SAME error mapping as `pushTextMessage` (429/401 → feeds the Phase 6 retry path). Do NOT alter `pushTextMessage`.
- **W3 compose + send**: build the Flex doc-summary bubble (doc type/number/amount/status + "ดูเอกสาร" button → doc-view URL) — or the image message; "ส่งให้ลูกค้า" from the conversation/quotation sends it via `SendCrmInboxMessageUseCase` as `messageType:'DOCUMENT'` (audited, appears in-thread, rides the Phase 6 retry/DLQ path).
- **W4 specs**: token scope/expiry/revocation; unauthorized token → 403/404; Flex/image payload shape (HTTPS URLs, bounded); adapter 429/401 mapping; send appends an audited `DOCUMENT` outbound row; PII bounds (no extra customer data in the card/body).

Verify: api typecheck + test (registered, explicit `DATABASE_URL`); web typecheck + test.

## Phase 9 — Payment-proof queue (A3.4 / A3-marking) — greenfield

Closes G8. Boundary: **marking routes to a HUMAN finance review queue only — no auto-post/confirm/pay** (LINE/AI final-mutation ban).

Files: `apps/api/prisma/schema.prisma` (**additive** `CrmMessage` payment-proof flag, e.g. `isPaymentProof Boolean @default(false)` + `paymentProofMarkedBy/At`), migration, `crm-conversation.use-case.ts` or a new mark use-case + `crm.inbox` route, a finance review-queue read (filtered list of flagged-unreconciled proofs) + endpoint, `permission-registry.ts` (new `crm.inbox.payment_proof` or reuse `crm.inbox.resolve` — decide, additive), a `crm_payment_proof` notification (reuse Phase 4 producer shape), `InboxPrototypePage.tsx` "ทำเครื่องหมายเป็นหลักฐานการชำระ" action + a finance queue view, specs + api test-list.

- **Announce migration. W1** Mark action (gated) on an inbound IMAGE message → set the flag + audit + emit `crm_payment_proof` notification to finance/`accounting.payment` recipients (name/count-only body).
- **W2** Finance review queue: list flagged proofs (open/reconciled) with deep-link to the conversation + the image (same-origin authed). Reconciliation itself stays MANUAL in accounting/expenses (link out — no auto-post).
- **W3** Specs: mark sets flag + audit + notification; queue lists open proofs; non-image reject; permission-gated; no accounting mutation triggered.

Verify: prisma validate + generate + api typecheck + test (registered, explicit `DATABASE_URL`); web typecheck + test.

## Harness verification per phase (Claude, not Codex)

Per A1 precedent: diff-review vs this plan + ponytail; then the browser rig — servers `api-verify-3011` + `web-verify-3002` (`.claude/launch.json`; the api-verify CORS-origin fix for :3002 stays), seeded docker DB (harness seeds CRM channel/customers/conversations/messages; local LINE sends land FAILED+deliveryError with dummy creds — which now exercises the Phase 6 retry/DLQ path). Per-phase browser pass:
- P1 `/expenses`: real upload/list/detail/confirm/pay renders on a real session; no placeholder.
- P2/P3 inbox: open thread → sidebar shows real deals/tasks/finance → create deal/task → quotation draft → deep-link to `/accounting`.
- P4/P7: trigger a new conversation → staff notification in web center → (P7) real LINE push to a linked identity (name/count-only, no PII).
- P5/P6: kill the API mid-enrichment/mid-send → confirm the sweep recovers (media stored, send retried) — durability proof, not just green tests.
- P8/P9 (after owner decision on P8): send a doc link to a test LINE → customer view opens; mark an image as payment proof → appears in the finance queue.

Playwright smoke may be added by the harness where stable.

## Done criteria

- `/expenses` (+`/sales-documents`) serve the real feature on a real session — bill/receipt review works on prod-shaped services; zero mock placeholder on launch surfaces.
- Inbox Customer 360 sidebar shows real deals/tasks/finance/quotations; "chat → 360 → deal → quotation draft → **send to LINE** → follow-up task" passes live (CRM plan Phase 3 exit).
- New conversations alert staff in web AND reach linked staff LINE (Phase 4 + 7); inbound media/profile enrichment and reply sends survive a deploy/restart (durable sweeps — Phase 5 + 6); H3 resolved for B7.
- Payment-proof marking routes a customer slip into a finance review queue (no auto-post).
- Every phase's listed verify commands green; new API specs registered in the test list; evidence + file lists appended to [[agent-memory/mvp1-a3-a5-revenue-loop-durable-flow]]; two-dev plan A3/A4/A5 + H3 status updated; sequence-doc reconciliation cross-linked.

## Out of scope (do NOT build here)

MVP1-0 tenant/entitlement/PDPA-notice (A2, ops), PDPA purge sweep (A6), appointments (A7) + `/bookings` wire-up, daily brief (A8), auto-reply toggle/pipeline (B7 — you only keep the send path stable for it), LIFF registration (B9), auto-booking (B10), campaigns/broadcast, `/sales` `moduleKey=sales` placeholder, the already-done A1/B5 surfaces, and the canary DEPLOY of any of this (owner-gated, separate).
