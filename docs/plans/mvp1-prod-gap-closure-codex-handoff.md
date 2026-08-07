# MVP1 Prod Gap Closure — Codex CLI Handoff Harness

Status: Implement-ready 2026-07-10. Closes the launch gap audit (2026-07-10) so MVP1 (loop A CRM + loop B bill/receipt) is production-ready. Spec authority: `docs/specs/crm-line-oa-customer-os-spec.md` **§28** (owner decisions for every phase below). Task memory: `docs/agent-memory/mvp1-prod-gap-closure.md`. Predecessor harness (all phases shipped): `docs/plans/mvp1-launch-codex-handoff.md`.

Executor model: **Codex CLI** — `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s workspace-write` (CLI ≥ 0.144.1 — verified working 2026-07-10; the old gpt-5.5 pin is obsolete). Codex codes + adds/updates tests + runs the listed verify commands per phase and self-reviews. **Claude reviews each phase for business completeness (diff-vs-intent + ponytail + boundary audit), drives fixes, runs the real `pnpm test` gate, and commits per-phase after PASS (owner authorization 2026-07-10 — explicit paths only, never `git add -A`). Codex never commits, never `git add`.**

Owner decisions 2026-07-10 driving this harness: ALL four P1 items in scope (reply-token-first, appointment lifecycle UI, auto-book fallback for unassigned chats, Daily Brief + LIFF branding). Rate limit = in-process. **Deploy is DEFERRED — this harness ends at code + tests + docs complete**; deploy runbook updated but not executed.

---

## Ground-truth baseline — what EXISTS, do NOT rebuild

- Autonomous pipeline (P3/P4, shipped): `CrmLineWebhookController` (`crm-line-webhook.controller.ts:29`, signature-verified at :53) → `ProcessInboundLineMessageUseCase.processEvent` (:91) → `tryAutonomousAutoReply` (:167) → `CrmAiAutoReplyUseCase.evaluate` (`crm-ai-auto-reply.use-case.ts:40`, DI token `CRM_AUTO_REPLY_AGENT`) → `sendAutonomousAutoReply` (:243) via `LineMessagingAdapter.pushTextMessage` (:70) with stable retry key `lineReplyRetryKeyForMessage`. Gates already in order: global env → per-channel toggle → text non-empty → per-conversation 5/day (`PER_CONVERSATION_AUTO_REPLY_DAILY_CAP`, `crm-auto-reply.logic.ts:8`) → per-channel cap → consent lookup → intake → QUESTION-only → reply draft → send. Holding-message logic exists in the same use-case.
- Auto-booking (P4b, shipped): `CreateAutonomousCrmBookingUseCase` (`crm-booking.use-case.ts:132`), `resolveRequestedBookingWindow`, `isSlotFree`/`computeFreeStartSlots` (P1 availability), propose-on-conflict fallback, `source:'LINE'`, sentinel `createdByUserId='system'`.
- B9 LIFF register (shipped): `CustomerLineRegisterUseCase` + `@Public` routes + `AuthRateLimitService.assertCustomerRegisterAllowed` (`customer-line-register.controller.ts:46`).
- Schema already has: `CompanyMessagingChannel.autoReplyEnabled @default(false)` + `autoReplyDailyCap @default(50)` (`schema.prisma:5011-5012`), `CrmConsentStatus { UNKNOWN GRANTED REVOKED NOT_REQUIRED }` (:3812), `CrmMessage @@unique([companyId, providerMessageId])` (:5127), `CrmBooking` indexes (no overlap constraint), `LineWebhookEventLog` (line-ai module ONLY — not CRM).
- S3 adapter (H4, shipped): `s3-storage.adapter.ts` + `ATTACHMENT_STORAGE` factory. MinIO exists in `infra/docker/compose.local.yml:30`.
- E2E: Playwright `e2e/` — `crm.spec.ts` (inbox), `bookings.spec.ts` (BOOK-01..03), `expenses.spec.ts` (EXP-06 fixme :71). Seeded via `e2e/run-local.sh` against native postgres **:5432** (NOT the docker :15432).
- Daily brief: `buildDailyBriefWidgets` (`crm-daily-brief.logic.ts:37`) — 5 widgets today.

## Environment quirks (read before running anything)

- **Node**: shell defaults to v14. Prefix EVERY session: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- **API tests are a HAND-MAINTAINED explicit list** in `apps/api/package.json` `"test"` — an unregistered new `*.spec.ts` silently never runs. Every new API spec MUST be added to that list in the same phase.
- **Prisma/DB**: repo-root `.env` points at docker `:15432/watchdog_bms` — that DB is PARTIAL (6 migrations unapplied, `CrmBooking` table absent). **NEVER run `prisma migrate dev/deploy/reset` or `db push` locally.** After `schema.prisma` edits: `prisma validate` + `prisma generate` only (explicit `DATABASE_URL`). Specs stay pure-logic/mocked (repo convention). After editing `packages/contracts`: `pnpm --filter @watchdog-bms/contracts build` before dependent typechecks.
- **Sandbox fallback**: if `pnpm --filter … test` hits `tsx` IPC `listen EPERM`, use `node --import tsx --test <files>` with `DATABASE_URL` set.
- Prod migrations auto-apply at container boot (`apps/api/start-combined-production.sh:5`) — no local DB work needed for deploy.

## Hard rules (violating any = wrong implementation)

1. **No commits, no `git add`** — Claude commits after PASS, explicit paths only (shared worktree: the dirty tree ships on deploy). No dev servers.
2. **Contracts + existing clients only**: web data via existing `*.api.ts` clients, typed with `@watchdog-bms/contracts`, `authedApiFetch`. New contracts additive.
3. **Security/tenant/permission/audit explicit** on every new/changed route: server-side tenant scope + `@RequirePermissions` (deny-by-default) + ABAC + audit + outbox on mutations.
4. **LINE/AI final-mutation ban** unchanged except the single sanctioned auto-booking path (§28 availability-first envelope). NEVER pay/approve/post/void/issue.
5. **PII**: notification/LINE-push bodies are name/count only; consent REVOKED blocks every automated customer send (§28).
6. **Migrations: additive only, announce in the task memory, timestamps strictly increasing** (> `20260710120000`); never applied locally (see quirks).
7. **XSS-inert**: customer-supplied text as text nodes; no `dangerouslySetInnerHTML`.
8. **No new dependency.** Everything below is stdlib + existing deps.
9. Deterministic gates only — an LLM output never gates an autonomy decision; thresholds/toggles/locks are code.

---

# Phases (sequenced — each gated by Claude review, committed individually)

## GC0 — Test-registry hygiene (tiny)

3 spec files exist but are NOT in `apps/api/package.json` `"test"` (silently never run): `src/modules/ledger/domain/logic/journal-balance.logic.spec.ts`, `src/modules/procurement/domain/logic/procurement.logic.spec.ts`, `src/modules/system-partner-management/application/use-cases/partner-member-console.use-cases.spec.ts`. Register all 3. If one fails for stale reasons, fix trivially or REPORT (do not force-fit or delete assertions).
Codex verify: full `pnpm --filter @watchdog-bms/api test` green.

## GC1 — Consent enum gate + confidence threshold (P0 — autonomy safety)

Business intent: never auto-message a customer who revoked consent; never auto-act on a low-confidence classification. Spec: §28 bullets 2–3.
Root cause: `crm-ai-auto-reply.use-case.ts:68-71` checks `!consent` — `'REVOKED'`/`'UNKNOWN'` are truthy and pass; `.confidence` from intake/reply/booking-extract results (`crm-ai.ts:55,70-80,111-114`) is never read.
Change (one phase, same file cluster):
- Consent: explicit check — `consent === 'REVOKED'` → skip EVERY automated send incl. holding message, audit reason `consent_revoked`. `null` keeps failing closed (`context_unavailable`). `UNKNOWN|GRANTED|NOT_REQUIRED` pass.
- Confidence: new config `CRM_AI_MIN_CONFIDENCE` (`packages/config` schema, `envNumber` default 0.7 + `AppConfigService` getter). Gate: `intake.confidence < t` → staff path (+holding message rules unchanged), audit `low_confidence`; `reply.confidence < t` → no send, staff path; booking `extract.confidence < t` → treat as `unclear` (clarify reply, never book).
Codex verify: specs (extend existing P3/P4 spec files, they wire the REAL use-case): REVOKED → no push + audit `consent_revoked`; REVOKED also blocks holding message; UNKNOWN still sends (Level-0 regression guard); each confidence gate below/above threshold; register any new spec file. `pnpm --filter @watchdog-bms/api test` + typecheck.
Claude gate: no path from inbound event to any LINE send survives with consent REVOKED; thresholds deterministic; audit trail complete.

## GC2 — Booking race safety (P0 — double-book)

Business intent: two concurrent booking requests for the same staff/slot can never both succeed.
Root cause: check-then-insert without transaction/lock in all 3 paths (`crm-booking.use-case.ts:107-121, 187-199, 133-166`); `findOverlappingBooking`/`createBooking` (`prisma-crm.repository.ts:784-793, 810`) plain queries; no DB constraint.
Change: one shared repo helper `createBookingIfSlotFree` (and update-variant) wrapping `$transaction` + `pg_advisory_xact_lock(hashtext(companyId || ':' || staffUserId))` → re-run overlap check inside the lock → insert/update or return clash. Route ALL 3 use-cases through it; keep `ConflictException` → existing propose fallback. `ponytail:` note naming the btree_gist exclusion-constraint upgrade path. No schema change.
Codex verify: spec mocks the prisma client capturing `$transaction` + raw lock call ordering (lock → check → create); clash inside lock → ConflictException → autonomous caller proposes (existing spec extended). Suite + typecheck.
Claude gate: no booking write path bypasses the helper; autonomous propose-on-conflict behavior unchanged.

## GC3 — replyToken capture + reply-first send (P1→spec-mandated, §27:777/§28)

Business intent: level-0 replies ride the free reply-token window; push (with quota) is the fallback.
Root cause: `LineInboundEvent` (`crm-inbox.model.ts:130-146`) has no `replyToken`; all sends are `pushTextMessage`.
Change: parse `replyToken` (+ received-at) into `LineInboundEvent`; adapter gains `replyTextMessage(replyToken, text)` mirroring push error handling; autonomous send + holding message try reply-API when token fresh (< ~55s old, single-use — track consumption), fall back to the H2 push path (stable retry key) on expiry/consumed/error. Staff-composed sends stay push (out of scope).
Codex verify: specs — fresh token → reply API called, no push; expired/failed token → push fallback with stable retry key; token never reused twice. Suite + typecheck.
Claude gate: fallback preserves H2 idempotency; no new send path skips caps/consent/audit.

## GC3b — Holding message sender (§27:775 — discovered missing during GC1)

Business intent: on a toggle-ON channel, a customer whose turn falls to the staff path gets one short deterministic Thai acknowledgement, so response behavior is consistent.
Root cause: P3 deliberately skipped it (`crm-ai-auto-reply.use-case.ts:89` `ponytail:` note) but spec §27:775 mandates it. NOT built anywhere (GC1 verified: no holding sender exists).
Change: when `evaluate` returns a staff-path skip on a toggle-ON channel (reasons like `not_actionable`, `low_confidence`, `intake_*`, `reply_*`, cap-exhausted — NOT `consent_revoked`, NOT `global_disabled`/`channel_disabled`), send ONE fixed Thai template (`authorType` SYSTEM, excluded from AI caps, audited). Dedup rule per spec: at most one holding message per conversation between staff/AI outbounds — derive from existing message rows (latest OUTBOUND vs latest holding marker), no new column if avoidable. Rides GC3's reply-token-first send with push fallback. REVOKED consent blocks it (§28, GC1 test already asserts this).
Codex verify: specs — staff-path turn on toggle-ON → exactly one SYSTEM holding message; second staff-path turn before any staff/AI outbound → NO second holding message; staff reply then another staff-path turn → holding message allowed again; toggle OFF → none; REVOKED → none; cap-exhausted turn still gets it. Suite + typecheck.
Claude gate: template is fixed/deterministic (never LLM), excluded from `autoReplyDailyCap` + per-conversation AI cap counting, PII-safe, audited.

## GC4 — Durable autonomy pipeline (P0 — webhook durability)

Business intent: a crash/deploy right after the webhook 200 must not lose an auto-reply/auto-booking; outbox events must not silently vanish.
Root cause: `process-inbound-line-message.use-case.ts` fire-and-forget `void` at :152 (media), :155/:287/:398/:502 (outbox appends), :164 (whole autonomy pipeline); no raw-event/job persistence on the CRM path.
Change:
- Await the 4 outbox appends (cheap inserts) before returning; keep media/profile enrichment fire-and-forget (existing backstop sweep covers them).
- New additive migration (ANNOUNCE; timestamp > `20260710120000`): `CrmAutonomyJob` — id, companyId, conversationId, messageId (**unique** = idempotency), replyToken?, replyTokenAt?, status `PENDING|DONE|FAILED`, attempts, nextAttemptAt, timestamps. Mirror in contracts only if exposed (it isn't — internal).
- Webhook flow: after `appendInboundMessage`, insert job (awaited) → return 200 → immediate in-process attempt (`void`, marks DONE/FAILED+nextAttemptAt). New sweep use-case (mirror `retry-crm-inbox-deliveries` + its worker registration) claims stale PENDING/FAILED jobs (attempts-capped, backoff) and re-runs the autonomy evaluate — reply token likely expired by then → GC3 push fallback. Dedup: unique messageId + existing `findMessageByProviderId` guard.
Codex verify: specs — job row created before 200 (spy insert order), sweep re-runs a stale PENDING job exactly once (idempotent vs DONE), failed evaluate marks FAILED with backoff, outbox appends awaited (rejection propagates to the per-event catch, not unhandled). `prisma validate` + `generate`. Suite + typecheck.
Claude gate: no autonomy work exists only in process memory after the 200; migration additive; caps/consent still enforced on sweep re-runs (evaluate re-entered from the top).

## GC5 — Channel autonomy controls: contract + API + UI + deploy env (P0 — can't enable)

Business intent: the owner can actually turn autonomy on per channel (and prod can enable the global switch at deploy time).
Root cause: `autoReplyEnabled`/`autoReplyDailyCap` DB-only — `MessagingChannelSummary` (`packages/contracts/src/crm-inbox.ts:78`) omits them; `MessagingChannelController` has no update route; zero web hits; `deploy.sh` passes no `CRM_*` env.
Change:
- Contracts: expose both fields on the channel summary + additive `UpdateMessagingChannelSettingsRequest` (autoReplyEnabled, autoReplyDailyCap, defaultBookingStaffUserId?, defaultBookingBranchId?).
- Additive migration (ANNOUNCE): `CompanyMessagingChannel.defaultBookingStaffUserId String?` + `defaultBookingBranchId String?` (GC6 consumes).
- API: `PATCH` settings route on `MessagingChannelController` — same permission the connect/rotate/disable routes use, tenant-scoped, validated (cap ≥ 0, staff must be an active company member, branch must belong to company), audited.
- Web: channel-settings surface (where channels are listed/managed) — toggle + daily-cap input + default staff/branch pickers, existing api-client + contracts only.
- `infra/prod-ecs-express/deploy.sh`: add `CRM_AUTO_REPLY_ENABLED` (+ value plumbing like the existing env block, default-off unless SSM/param set) to the api-web `environment[]`. Deploy itself deferred.
Codex verify: contract build, API spec (permission denied w/o gate, invalid staff/branch rejected, audit written), web typecheck; suite.
Claude gate: permission/tenant/audit complete; UI states (loading/error/permission) present; deploy.sh diff minimal and consistent with the existing env pattern.

## GC6 — Auto-book fallback for unassigned chats (P1 — owner selected)

Business intent: a brand-new unassigned chat can still auto-book when the channel has defaults configured.
Root cause: P4b resolves staff strictly from `conversation.assignedToUserId` + that staff's membership `defaultBranchId`; unassigned → skip (`no_assigned_staff`).
Change: resolution order per §28 — assigned staff (+their default branch) → channel `defaultBookingStaffUserId`/`defaultBookingBranchId` (GC5) → unresolvable = propose/staff path unchanged (audit reason preserved). Booking still race-safe via GC2 helper.
Codex verify: specs — unassigned + channel defaults → books (source LINE, sentinel actor); unassigned + no defaults → propose/skip with audit; assigned staff still wins over channel default. Suite + typecheck.
Claude gate: no bypass of the §28 envelope (toggle/caps/consent/confidence/slot-free) on the fallback path.

## GC7 — In-process API rate limiter (P0 — validated-but-unused flag)

Business intent: prod flag `RATE_LIMIT_ENABLED=true` actually limits.
Root cause: `main.ts:98` "actual throttler is a future addition"; `RATE_LIMIT_*` consumed by nothing.
Change: global Nest guard/middleware (fixed window per IP, reuse the `AuthRateLimitService` bucket pattern or generalize it) honoring `RATE_LIMIT_ENABLED/WINDOW_SECONDS/MAX_REQUESTS` via new `AppConfigService` getters; exclude health endpoints (`/health`, `/v1/health`); 429 with `Retry-After`. `ponytail:` note — per-task memory (max 2 prod tasks), Redis upgrade path. LIFF register limiter unchanged.
Codex verify: spec — over-limit → 429 + Retry-After, window reset allows again, disabled flag = no-op, health path exempt. Suite + typecheck.
Claude gate: no auth’d hot path broken; limiter fails open (an internal limiter error must never 500 legitimate traffic).

## GC8 — Appointment lifecycle: NO_SHOW + reschedule/done/no-show UI (P1 — exit criteria)

Business intent: staff manage the full booking lifecycle in web (MVP1-6 exit: create/reschedule/cancel/no-show + audit; `docs/plans/mvp-1-crm-line-bill-capture-sequence.md:175`).
Root cause: `CrmBookingStatus` = `BOOKED|CANCELLED|DONE` (no `NO_SHOW`); web bookings page has create/cancel only.
Change: additive migration (ANNOUNCE): enum value `NO_SHOW`. API: `UpdateCrmBookingUseCase` supports status transitions BOOKED→DONE|NO_SHOW|CANCELLED + reschedule (time change via GC2 race-safe helper), each audited. Contracts additive. Web (`BookingsPrototypePage`): reschedule dialog + done/no-show actions, permission-gated, loading/error states. NO_SHOW feeds the existing trust-signal counts if such aggregation exists (check `crm-ai-trust.logic.ts` inputs — wire only if a no-show count input already exists; do NOT build new aggregation).
Codex verify: specs — transitions valid/invalid (DONE→BOOKED rejected), reschedule uses the race-safe path, audit per transition; web typecheck; extend `e2e/bookings.spec.ts` happy-path if the harness rig allows. `prisma validate`+`generate`. Suite.
Claude gate: lifecycle matches exit criteria; A7 reminder sweep unaffected for rescheduled times (verify it reads startAt fresh).

## GC9 — Daily Brief completion (P1 — §9.5 set)

Business intent: owner’s daily brief answers "how is my business today" per spec §9.5 (line 197).
Root cause: `buildDailyBriefWidgets` has 5 widgets (unanswered, SLA, new customers, appointments, payment proof); missing pipeline value, quotations awaiting acceptance, overdue payments, unresolved complaints, avg first-response time.
Change: extend counts query + logic + contracts + dashboard tiles for the 5 missing widgets (deep links filtered like existing ones). Overdue payments reuse the counterparty payment bridge from the CRM-reports/LTV work — reuse its query shape, do not invent a new payment model. Campaign results + cited-AI-insight = post-launch (§28), note in the plan checklist, do not build.
Codex verify: logic spec per new widget (count/value + link), API spec for the enriched response, web typecheck + tile render logic. Suite.
Claude gate: numbers derive from real queries (no placeholders); each tile deep-links to a real filtered view; §9.5 items either shipped or explicitly post-launch.

## GC10 — LIFF tenant branding + real customer name (P1 — owner selected)

Business intent: a customer registering via LINE sees the company (not WatchDog) and gets a real name.
Root cause: register page is generic WatchDog HTML; verifier keeps only the LINE `sub` → customers named "ลูกค้า LINE"; link is channel-parameterized but page shows no tenant identity.
Change: `customer-register-page` renders company display name (+ logo if the company/channel model already stores one — do NOT add a logo upload) resolved server-side from the validated `lineChannelId`; `LineLoginVerifierAdapter` surfaces the ID-token `name` claim; `CustomerLineRegisterUseCase` uses it for `displayName` (fallback unchanged). Keep every B9 security invariant (companyId from channel, never client; spoof test stays green).
Codex verify: specs — name claim used when present, fallback otherwise, spoofed companyId still ignored; page contains company name (controller/unit-level assert). Suite + typecheck.
Claude gate: PDPA text + consent-first unchanged; no client-supplied tenant data trusted; provider-alignment note stays in the deploy checklist.

## GC11 — E2E wave (close the audit's verification gaps)

- **EXP-06**: wire MinIO into the local e2e path — `e2e/run-local.sh` (or playwright localEnv) boots/points at compose MinIO (`infra/docker/compose.local.yml` service, bucket auto-created) and sets the S3 env selecting `S3StorageAdapter`; replace the `test.fixme` at `e2e/expenses.spec.ts:71` with a real upload→preview→download assertion. If the rig genuinely cannot run MinIO, keep fixme + document exact reason (do not fake).
- **CRM autonomy settings**: extend `e2e/crm.spec.ts` (or settings spec) — toggle autonomy on a seeded channel via the GC5 UI, assert persisted.
- **Bookings lifecycle**: extend `e2e/bookings.spec.ts` — reschedule + done + no-show actions on a throwaway booking.
- **LIFF register**: endpoint-level e2e (Playwright `request` against the API with a stubbed/dev verifier if `AUTH_PROVIDER=dev` supports it; otherwise unit-boundary only + document why).
Codex verify: `pnpm e2e` targeted specs green locally (seeded :5432 DB per `run-local.sh`).
Claude gate: new e2e assert real user-visible behavior, not implementation internals; no flaky sleeps.

## GC12 — Docs sync (Claude, not Codex)

§27/§28 done (this doc). Remaining: sequence-plan staleness (`mvp-1-crm-line-bill-capture-sequence.md:5,131,140,164-177` — mark shipped lanes), master checklist Item 15/15A status + Item 09 roll-up note (underlying ~260 unchecked boxes → reconcile or annotate), expense memory staleness (`data-model-core-04.md:18,49`, `crm-line-oa-customer-os-15a.md:53`), runbook `b1-b2-line-external-setup.md:9` ("no code gap" → toggle/rate-limit/reply-token now shipped via this harness), predecessor handoff Status/Next contradiction, deploy runbook (CRM env, TYPHOON_OCR_API_KEY, provider alignment, canary rules).

---

## Per-phase Claude review gate

After Codex finishes each phase, Claude: (1) diff vs business intent + ponytail (smallest correct diff, no speculative abstractions); (2) does the business outcome actually hold end-to-end?; (3) boundary audit — tenant/permission/audit/PII/final-mutation; (4) verification is REAL — tests drive production code paths, not mocks of the thing under test; typecheck 0 + full registered suite green (Claude runs it); (5) no regression to untouched lanes (esp. `InboxPrototypePage.tsx` wiring, P3/P4 behavior). Returns **PASS** (→ Claude commits, explicit paths) or **FIX (specifics)** (→ Codex iterates).

## Owner / ops (NOT code — tracked, deferred with deploy)

- Deploy decision deferred (owner 2026-07-10). When resumed: canary rules per `infra/prod-ecs-express/README.md` (never probe during bake; monitor via ECS API; one 200 verify after), set `CRM_AUTO_REPLY_ENABLED=true` only when piloting, `TYPHOON_OCR_API_KEY`, LIFF Login-channel ↔ OA messaging-channel provider alignment, per-channel toggle via GC5 UI.
- Local docker DB (:15432) still has 6 unapplied migrations — owner/ops applies coordinated; harness never migrates it.

## Done criteria

Every GC phase PASS + committed; full API suite + gateway suite + web/api typechecks green; targeted e2e green on the local rig; §28 + this plan + task memory + stale docs synced; deploy runbook current. NO deploy this round.
