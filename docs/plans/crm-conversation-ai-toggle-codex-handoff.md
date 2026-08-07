# CRM Per-Conversation AI Toggle — Codex CLI Handoff

Status: Implement-ready 2026-07-10. Spec authority: `docs/specs/crm-line-oa-customer-os-spec.md` **§29**. Task memory: `docs/agent-memory/crm-conversation-ai-toggle.md`. Harness conventions inherited from `docs/plans/mvp1-prod-gap-closure-codex-handoff.md` (all GC phases shipped 2026-07-10 — this plan builds on that baseline).

Executor model: **Codex CLI** — `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s workspace-write`. Codex codes + adds/updates tests + runs the listed verify commands per phase and self-reviews. **Claude reviews for business E2E completeness (diff-vs-intent + ponytail + boundary audit), runs the real full test gate, and commits after PASS (explicit paths only, never `git add -A`). Codex never commits, never `git add`.**

Business goal (one sentence): a staff member handling one customer chat can silence/re-enable autonomous AI for THAT chat — safely (no stale queued reply slips through), visibly (state obvious in the inbox), reversibly (toggle back), and audited — without touching the channel-level toggle.

---

## Dispute protocol (Codex is REQUIRED to exercise judgment)

You (Codex) are not a typist. Before and during each phase, independently judge whether spec §29 + this plan actually achieve the business goal against the real code. If you find a conflict with code reality, a safety hole, or a materially simpler correct design:

1. **STOP the affected phase** (finish unaffected phases if any).
2. Append to `docs/agent-memory/crm-conversation-ai-toggle.md` under `## Objections`: (a) the claim, (b) evidence `file:line`, (c) impact on the business goal, (d) your proposed alternative as the smallest correct diff.
3. Do NOT silently deviate from the plan — an undocumented deviation is a defect; a well-evidenced objection is a **success outcome** and will be adjudicated by Claude (business conflicts go to the owner).

## Ground-truth baseline — what EXISTS, do NOT rebuild

- Autonomy gate chain: `apps/api/src/modules/crm-inbox/application/use-cases/crm-ai-auto-reply.use-case.ts` `evaluate()` — global env (`:44`) → channel status+toggle (`:45-47`) → `not_text` (`:48-50`) → consent (`:52-54`) → per-conversation daily cap 5 (`:56-65`) → channel cap (`:67-71`) → intake/confidence → QUESTION/BOOKING only. Every skip audited via `skip()` (`:205`).
- Holding message: `process-inbound-line-message.use-case.ts` — `HOLDING_MESSAGE_TEXT` (`:46`), **`HOLDING_MESSAGE_BLOCKED_REASONS` (`:47-54`)** = reasons that suppress the holding message (`global_disabled`, `channel_disabled`, `not_text`, `context_unavailable`, `consent_revoked`, `exception`); send site `:336-343`.
- Durable retry: `retryAutonomyJob` (`process-inbound-line-message.use-case.ts:223`) re-runs autonomy for stale `CrmAutonomyJob` rows; swept by `apps/workers/src/modules/crm-inbox/crm-sla-worker.ts` via `POST /internal/crm/autonomy-retry-scan`.
- Evaluate input port: `crm-auto-reply.logic.ts:31-56` (`CrmAutoReplyAgentPort`) — `conversation` currently carries `id, companyId, channelId, customerId, assignedToUserId, autoReplyCount, autoReplyCheckedAt`.
- Schema: `CrmConversation` at `apps/api/prisma/schema.prisma:5066-5106` (already has `autoReplyCount`/`autoReplyCheckedAt`). Latest migration: `20260710150000_crm_booking_no_show` — new timestamp must be strictly greater.
- Conversation routes: `crm-conversation.controller.ts` (`@Controller('companies/:companyId/crm/conversations')`) — existing `PUT :conversationId/status|priority|tags|assign` show the DTO/permission/audit pattern to mirror.
- Contracts: `packages/contracts/src/crm-inbox.ts` — `CrmConversationSummary` (`:134`), `CrmConversationDetail` (`:186`).
- Web: `apps/web/src/features/crm-inbox/InboxPrototypePage.tsx` (capability flags `:153-160`, e.g. `canReply`); api client `apps/web/src/features/crm-inbox/crm-inbox.api.ts`; toggle-UI pattern to imitate: `LineOaSettingsPage.tsx:63-108`.
- Staff-assist endpoints (`crm-ai-assist.controller.ts`) are OUT of scope — the override must NOT gate them.

## Environment quirks (read before running anything)

- **Node**: shell defaults to v14. Prefix EVERY session: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- **API tests are a HAND-MAINTAINED explicit list** in `apps/api/package.json` `"test"` — an unregistered new `*.spec.ts` silently never runs. Every new API spec MUST be added in the same phase.
- **Prisma/DB**: repo-root `.env` points at docker `:15432/watchdog_bms` — PARTIAL DB. **NEVER run `prisma migrate dev/deploy/reset` or `db push` locally.** After `schema.prisma` edits: `prisma validate` + `prisma generate` only (explicit `DATABASE_URL`). Specs stay pure-logic/mocked (repo convention).
- After editing `packages/contracts`: `pnpm --filter @watchdog-bms/contracts build` before dependent typechecks.
- **Sandbox fallback**: if `pnpm --filter … test` hits `tsx` IPC `listen EPERM`, use `node --import tsx --test <files>` with `DATABASE_URL` set.

## Hard rules (violating any = wrong implementation)

1. **No commits, no `git add`** (shared worktree — the dirty tree ships on deploy). No dev servers.
2. **Contracts + existing clients only**: web data via `crm-inbox.api.ts` + `@watchdog-bms/contracts` + `authedApiFetch`. New contracts additive.
3. **Security/tenant/permission/audit explicit** on the new route: server-side tenant scope (fetch-or-404 within `companyId`) + `@RequirePermissions` + audit + (mutation ⇒ follow the outbox convention only if sibling toggle-like routes do).
4. **Deterministic gates only** — an LLM output never gates the override; the flag is a plain column check.
5. **Migrations: additive only, announce in task memory, timestamp strictly > `20260710150000`; never applied locally.**
6. **XSS-inert**; **no new dependency**; ponytail full mode (shortest correct diff, reuse existing patterns, no speculative abstraction).
7. Read `/Users/spare058/WatchDog-BMS/.agents/skills/ponytail/SKILL.md` before code edits.

---

# Phases (T1 → T3, sequenced; Claude review-gates after your run)

## T1 — Schema + autonomy gate (API core)

> **Adjudication 2026-07-10 (Claude, after Codex objection — ACCEPTED):** the original single early gate loses the race against a multi-second `evaluate()` and the enqueue-time snapshot (`process-inbound-line-message.use-case.ts:209-218`). T1 below is AMENDED per the objection's smallest-correct alternative; spec §29 now carries the final-mutation-boundary bullet. Scope guard: do NOT add locks/transactions around the send path (ms-scale race is the accepted bound); do NOT change channel-snapshot semantics — conversation flag only.

Business intent: a disabled conversation never receives ANY autonomous send — auto-reply, auto-booking, or holding message — even from a stale queued job or a toggle flipped while the AI evaluation is in flight.

- Migration `20260710160000_crm_conversation_auto_reply_override` (or later timestamp): `CrmConversation.autoReplyEnabled Boolean @default(true)` NOT NULL. Announce in task memory. `prisma validate` + `prisma generate` only.
- Thread the field through the repo record/mappers that feed `AutonomyContext.conversation` (`CrmConversationRecord`) and the evaluate port (`crm-auto-reply.logic.ts:43-51`).
- Early gate (cheap denial, unchanged from original plan): in `evaluate()` immediately after the channel check (`crm-ai-auto-reply.use-case.ts:47`): `!input.conversation.autoReplyEnabled` → `skip(..., 'DENIED', { sent:false, reason:'conversation_disabled' })`.
- Add `conversation_disabled` to `HOLDING_MESSAGE_BLOCKED_REASONS` (`process-inbound-line-message.use-case.ts:47-54`).
- **Fresh read at job start (immediate path)**: the immediate `runAutonomyJob` closure (`:209-218`) must stop passing the enqueue-time conversation snapshot as gate authority — re-read the tenant-scoped conversation (mirror `retryAutonomyJob:225-226`, including the missing-row throw) so BOTH entry paths evaluate against the current row.
- **Final-mutation-boundary re-check (shared path)**: in `tryAutonomousAutoReply`, after `evaluate()` returns and before the `send` / `book` / holding branches (`:314-350`), re-read the conversation once; row missing → throw (job FAILED, consistent with `autonomy_conversation_not_found`); `autoReplyEnabled === false` → audit `conversation_disabled` (DENIED), return with ZERO outbound row, ZERO LINE call, ZERO booking (job completes DONE). This single re-check must cover all three branches — send, `createAutonomousBooking.execute` (`:318`), and holding message (`:336-350`).
- Specs (extend the existing auto-reply spec files that wire the REAL use-case; register any new file): disabled at enqueue → no send + no booking + audit `conversation_disabled`; disabled → NO holding message; **flag flipped mid-evaluate (deferred evaluate resolves after an in-memory flip) → post-evaluate re-check blocks send AND book AND holding**; **toggle flipped after enqueue → immediate-path job re-read skips**; **retry-path flip → retried job skips**; enabled default → behavior unchanged incl. caps/consent gates (regression guard).

Codex verify: `pnpm --filter @watchdog-bms/api test` green + api typecheck + `prisma validate`/`generate`.

## T2 — Contract + API route

Business intent: staff with reply permission can flip the flag for one conversation; every flip is attributable.

- Contracts additive: `CrmConversationSummary.autoReplyEnabled: boolean` (detail inherits); request type `{ enabled: boolean }` following sibling naming (`Update…Request`). Build contracts.
- API: `PUT companies/:companyId/crm/conversations/:conversationId/auto-reply` on `CrmConversationController`, `@RequirePermissions('crm.inbox.reply')`, mirroring the `status`/`priority` route shape: tenant-scoped fetch-or-404 → update → audit `crm.inbox.auto_reply_override` (metadata `{ enabled, previous }`, actor = caller) → return the updated conversation payload the sibling routes return. List/detail mappers expose the flag.
- Specs: without `crm.inbox.reply` → 403; cross-company id → 404; flip persists + audit row asserted; list/detail responses carry the flag. Register files.

Codex verify: contracts build + `pnpm --filter @watchdog-bms/api test` + api typecheck.

## T3 — Inbox UI

Business intent: the state is obvious and flippable where staff work — the conversation header.

- `crm-inbox.api.ts`: `setConversationAutoReply(companyId, conversationId, enabled)` via `authedApiFetch` + contracts.
- `InboxPrototypePage.tsx` conversation header: toggle/button labeled "AI ตอบแชทนี้" — visible when `canReply`; reflects `conversation.autoReplyEnabled`; disabled/pending state while the request is in flight; error surfaced per existing page conventions; when off, show a clear badge (e.g. "AI ปิดอยู่ (แชทนี้) — พนักงานตอบเอง"). Reuse the existing toggle interaction pattern from `LineOaSettingsPage.tsx` — do not invent a new component system.
- e2e: extend `e2e/crm.spec.ts` with the toggle flow ONLY if the seeded rig supports it cheaply (GC11 pattern, DB `:5432` via `e2e/run-local.sh`); otherwise state exactly why in your summary — do not fake.

Codex verify: `pnpm --filter @watchdog-bms/web typecheck` (+ e2e spec if added).

---

## Final Codex deliverable (end of run)

Append to task memory `Verification:` — per phase: files touched, commands run + results, spec files registered, objections raised (or "none"), and anything you consciously left out with the reason.

## Claude review gate (business E2E — after Codex run)

1. Intent holds end-to-end: webhook turn on a disabled conversation produces zero autonomous LINE traffic (reply/booking/holding); stale queued job cannot bypass; re-enable restores L0 behavior; staff-assist untouched.
2. Boundary audit: tenant scope, permission, audit completeness, no PII leak in audit metadata.
3. Tests are REAL (drive the production use-case, not mocks of the thing under test); new specs registered; full registered suite + typechecks green (Claude runs them).
4. Ponytail: smallest correct diff; no regression to GC3b holding dedup, caps, consent, GC4 sweep.
5. Docs sync after PASS (Claude): spec §29 checkbox state, runbook `partner-onboarding-e2e.md` Phase-5 ข้อ 18, task memory Status/Verification, master checklist if touched.

Returns **PASS** (→ Claude commits, explicit paths) or **FIX (specifics)** (→ Codex iterates).
