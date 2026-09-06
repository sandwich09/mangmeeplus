# Agent Memory: line-capability-question-scoped

Status: Implemented and verified locally 2026-09-06 on branch `codex/line-capability-question-scoped`
(cut from `origin/develop` 740fa36d, with `origin/codex/line-ai-persona-teaching` 52325370 — PR #453,
not yet merged — merged in as 53c9ab15 so the fix sits on the code it depends on). Code + tests
`bfce270b`. No PR, not merged, not deployed; no live UAT turn re-run yet.
Owner: thawatchai
Scope: Review finding F1 of `line-ai-persona-teaching.md` (adversarial review 2026-09-06), Owner
decision "เห็นด้วย" the same day. ONE defect: the API's deterministic capability lane
(`isCapabilityQuestion` → `buildCapabilityCard`, Owner 2026-08-27 rich-menu-v2 lane) ran BEFORE
`resolveLineIdentity` in `process-line-webhook.use-case.ts` and answered every message ≤ 40 chars
containing `ทำอะไรได้`/`ช่วยอะไรได้`/`มีฟีเจอร์อะไร`, or `ใช้ยังไง`/`ใช้งานยังไง` plus a system
subject, with the fixed six-function Flex card. That card is unscoped: an expenses-only staff member
typing `มั่งมีใช้ยังไง` was shown "ยอดขายวันนี้" and "สรุปบัญชี" they cannot use, and no linked
caller ever reached the permission/entitlement-scoped `capability_help` the gateway already composes.
Owner rule: "ควรสอนการใช้งาน user ได้ตามฟีเจอร์ที่เปิดอยู่ และตามขอบเขตของผู้ถาม".

Decisions:
- **Owner-approved shape.** Unlinked / no ACTIVE account → the fixed card, byte-identical to today
  (public marketing copy, no tenant data, deterministic, zero model calls). Linked ACTIVE caller →
  never the card; the SAME scoped `capability_help` the gateway already produces
  (`composeCapabilityHelp` → `buildCapabilityHelp` for "ทำอะไรได้บ้าง" phrasings,
  `buildCapabilityTeaching` for "ใช้ยังไง / สอน" phrasings via `isTeachingRequest`), derived from
  `usableCapabilityGroupIds(permissions, entitled)` + `canAdvertiseReceiptCapture`.
- **Path 2 chosen (fall through), because path 1 does not exist.** Traced the whole API→gateway
  seam: there is NO forced-intent / plan-override / dedicated route that would let the API ask for
  the capability-help composition without a model call.
  - The gateway exposes exactly two LINE routes, `POST internal/ai/line-turn` and
    `POST internal/ai/line-intake-route` (`line-ai-internal.controller.ts`); both always invoke a
    model (`router.routeIntake` / `router.route`).
  - `OrchestratorAgent.run` reaches `composeCapabilityHelp` only via
    `zeroToolIntent = plan.intents[0].intent`, and `plan` comes from `router.route(...)` — a model
    call — on every path. The one pre-router lane, `executePreparedSimpleRead`, is reads-only and
    flag-gated (`LINE_AI_PREPARED_SIMPLE_READ_ENABLED`, default off).
  - `LineAiTurnRequest.intakeIntent` is trusted provenance but gates lanes, it does not force an
    intent; `preparedPlan` is explicitly untrusted model advice, re-parsed by every receiver.
  - The copy itself (`CAPABILITY_COPY`, `TEACHING_COPY`) lives in `apps/ai-gateway` by spec §6, and
    `apps/api` ships as a separate app that never imports gateway source. Only the derivation
    (`usableCapabilityGroupIds`, `canAdvertiseReceiptCapture`) is shared, via
    `packages/contracts/src/ai-tools.ts`. So a zero-model API answer would have meant a second
    capability composer + a third copy of the wording — explicitly out of scope.
- **Smallest correct diff: move the intercept, change nothing else.** It now sits INSIDE the
  `!identity || identity.user.status !== 'ACTIVE'` branch, first, before the entry-door card and its
  audit row — so an unlinked caller's outcome, card, audit shape and `staff_menu_capability` status
  are unchanged (they now pay two extra indexed identity lookups and nothing else). Nine lines moved
  and re-commented; no new function, no new outcome, no new copy, no flag, no schema, no dependency,
  no `package.json` edit.
- **Pause semantics restored, not preserved.** A linked caller's capability question is free text,
  not a `staffMenuCommand`, so under a support pause it must behave like any other sentence
  (`line-support-request-spec-th` §2.2 delta รอบ 6: the pause silences the assistant, and only
  deterministic commands the customer was handed as buttons run through it). The old intercept sat
  ABOVE the pause gate and answered anyway — the assistant talking over the human. Falling through
  fixes that for free; a spec pins it.
- **`staff_menu_capability` keeps one meaning** — "an unlinked caller was sent the public card". The
  scoped path ends on the ordinary turn outcomes (`completed`, `support_paused`, `forbidden`, …), so
  no new outcome value was added; the two lanes are already distinguishable.
- **Accepted, Owner-approved cost.** The linked lane is no longer zero-model: a capability question
  now costs the ordinary two model calls (intake route + gateway turn) and the ordinary latency
  (prod business-turn p50 ≈ 11.7 s, chat turn p50 ≈ 78 satang). Only the COPY is deterministic;
  *reaching* `capability_help` is a model decision. See Open questions for the evidence and the
  residual risk.
Open questions:
- **Routing now depends on the router model.** Evidence it holds, all from PR #453, none of it a
  runtime guarantee: (a) `INTENT_ROUTER_SYSTEM_PROMPT` (`intent-router.agent.ts:59`) describes
  `capability_help` with exactly these phrasings — "ทำอะไรได้บ้าง", "ช่วยอะไรได้บ้าง",
  "สอนใช้งานหน่อย", "วิธีใช้", "ใช้งานยังไง", "เริ่มยังไง", "มือใหม่", "how can you help",
  "teach me", "how do I start"; (b) the intake router's advisor section (`:234`) says a request to
  be taught how to use the system — naming `สอน`, `วิธีใช้`, `ใช้งานยังไง`, `เริ่มยังไง`,
  `ทำอะไรได้บ้าง`, `มือใหม่` — is NEVER `ADVISOR_CONVERSATION` and must return `UNSUPPORTED` with no
  `advisorAnswer`, which matters because `LINE_AI_ADVISOR_MODE` defaults to `social` in production;
  (c) `orchestrator.agent.spec.ts` + `response-composer.agent.spec.ts` pin the zero-tool
  `capability_help` branch and both renderings, and `line-intake-dispatch.use-case.spec.ts` pins the
  API's advisor-draft veto. What is NOT pinned anywhere is that the model actually returns
  `capability_help` for these five phrasings — no fixture asserts a router OUTPUT, because that
  needs a provider. A misroute now answers something ELSE (small talk, or "ยังไม่รองรับ") rather
  than something wrongly scoped; the previous lane could not misroute but could not be right either.
  Worth one live UAT turn per phrasing before production promotion.
- Linked callers whom a gate refuses now get that gate's reply instead of the card: AI feature off
  (`lineAssistantDisabledFor`) → `feature_disabled`; none of `line.ai.query` / receipt-capture /
  signature → `FORBIDDEN_REPLY`; launch route closed → its refusal. Each is the same answer every
  other message from that caller already gets, so this is consistency rather than a regression — but
  it is a visible change for an AI-off shop that used to see a card listing ถ่ายใบเสร็จ /
  บริษัทของฉัน / โปรโมชั่น / ติดต่อเรา, all of which still work. Owner call if that shop should keep
  a card; not implemented, and it would need its own lane rather than this one.
- F2 of the persona review (an approvals-only caller taught `ค่าใช้จ่ายเดือนนี้เท่าไหร่`) is
  untouched and still open; it is a property of the group derivation, not of this lane.
Artifacts:
- Code: `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
  (the intercept, now inside the unlinked branch). `isCapabilityQuestion` and `buildCapabilityCard`
  in `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts` are UNCHANGED.
- Specs (docs): `docs/specs/line-ai-capability-help-entitlement-spec.md` §8.2 + AC-16,
  `docs/specs/line-rich-menu-v2-spec.md` (the 2026-08-27 card-lane paragraph now says
  "unlinked callers only").
- Tests: `process-line-webhook.use-case.spec.ts` (4 new cases: unlinked card unchanged; linked
  `มั่งมีใช้ยังไง` and `ทำอะไรได้บ้าง` dispatched to the scoped turn; linked + support pause →
  pause reply), `response-composer.agent.spec.ts` (one pin: every phrasing `isCapabilityQuestion`
  accepts renders scoped on an expenses-only company).
Verification (2026-09-06, worktree `scratchpad/wt-cap`, after `pnpm install --frozen-lockfile
--offline`, `pnpm --filter @watchdog-bms/contracts build`, `prisma generate`):
- Red first: `process-line-webhook.use-case.spec.ts` 212 tests, 209 pass / 3 fail — the two
  linked-caller cases and the paused one; the unlinked case passed from the start, which is what
  makes it the regression guard. After the move: **212 / 212**.
- `response-composer.agent.spec.ts` **102 / 102** (the new F1 pin passes without a gateway change —
  it pins the promise this move relies on, it does not fix anything).
- `line-intake-dispatch.use-case.spec.ts` + `spec-suite-coverage.spec.ts` +
  `line-staff-menu.logic.spec.ts` + `line-first-signup-webhook.spec.ts`: **295 tests / 34 suites,
  295 pass, 0 fail**.
- `pnpm --filter @watchdog-bms/api typecheck` — pass. `pnpm --filter @watchdog-bms/ai-gateway
  typecheck` — pass. `node apps/api/scripts/check-di-metadata.mjs` — 795 files, 870 decorated
  classes, 820 with constructor dependencies, all carry `design:paramtypes`.
- Full `pnpm --filter @watchdog-bms/api test` and `pnpm --filter @watchdog-bms/ai-gateway test`
  under the heavy-job mutex `/tmp/mangmee-heavy.lock`: see the run recorded below.
- Mutation: intercept put back above `resolveLineIdentity` → the three linked-caller specs go red
  (212 pass → 209 / 3 fail), restored → 212 / 212.
- Not run: any live LINE/UAT turn; web typecheck (no web change).
Next:
- Owner review → PR (stacked on #453; the diff collapses to this change once #453 lands) → UAT
  deploy with the same candidate → run `ทำอะไรได้บ้าง` and `มั่งมีใช้ยังไง` as (1) an unlinked LINE
  account — expect the six-function card — and (2) a linked expenses-only employee — expect the
  scoped card / walkthrough with no ยอดขาย and no สรุปบัญชี → production promotion.
