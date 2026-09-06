# Agent Memory: line-capability-question-scoped

Status: Implemented and verified locally 2026-09-06 on branch `codex/line-capability-question-scoped`
(cut from `origin/develop` 740fa36d with `origin/codex/line-ai-persona-teaching` 52325370 merged in,
because PR #453 was still open; #453 landed as `a4ef867b` mid-task and that develop is merged in too,
so the branch diff is now exactly this change). Code + tests `bfce270b`, docs `7404c528`. No PR, not
merged, not deployed; no live UAT turn re-run yet.
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
- Full suites, heavy-job mutex `/tmp/mangmee-heavy.lock` held for both (mkdir acquired, rmdir
  released): `pnpm --filter @watchdog-bms/ai-gateway test` — **1097 tests / 121 suites, 1097 pass,
  0 fail**; the api `test` file list — **6888 tests / 1373 suites, 6789 pass, 0 fail, 99 skipped,
  exit 0** (the api script pins `--test-reporter=dot`, so it was re-run through `tsx --test
  --test-reporter=tap` over the same file list to get countable numbers).
- Mutation: intercept put back above `resolveLineIdentity` → the three linked-caller specs go red
  (212 pass → 209 / 3 fail), restored → 212 / 212.
- Not run: any live LINE/UAT turn; web typecheck (no web change).
Review (2026-09-06, adversarial, branch head de1ad5d6 → two fixes on top):
- Verdict READY after the fixes. The move itself is exactly what it claims: `git diff` on the use
  case is ONE hunk, the check order is byte-identical to develop apart from the intercept crossing
  `resolveLineIdentity`, `resolveLineIdentity` is read-only (two `findFirst`s + a warn log), and no
  `staffMenuCommand` string is also an `isCapabilityQuestion` (whole-string match vs substring
  stems — probed all 23 commands incl. the emoji-prefixed tiles: zero overlap), so no command lane
  changed hands.
- **R1 (MEDIUM, FIXED `b7057009`).** Forwarding the question opened the ADVISOR shortcut. Proven:
  a linked expenses-only caller asking `มั่งมีทำอะไรได้บ้าง`, router returns ADVISOR_CONVERSATION +
  a valid SOCIAL_CHAT draft, and the API delivered `น้องมั่งมีดูยอดขายวันนี้ สรุปบัญชี และภาษีให้ได้ค่ะ`
  itself — `status = completed`, gateway never called, `composeCapabilityHelp` never reached. The
  only guard was `looksLikeTutorial` (≥ 2 newlines or a list marker), which a one-line answer walks
  past. `advisorDirectAnswerText` now declines on `capabilityQuestion`.
- **R2 (LOW, FIXED `c3242d84`).** The `status !== 'ACTIVE'` half of the guard was unpinned:
  relaxing it to `!identity` left the suite at 212/212 (a suspended account would fall through to a
  full AI turn). `makePrisma` hard-coded ACTIVE; one option + one case, and the mutation now fails.
- Gate-by-gate for a linked expenses-only caller, all probed live: support pause → pause/follow-up
  reply, `support_paused`, no router call. AI feature off → `📋 ฟีเจอร์นี้ยังไม่ได้เปิดใช้งาน…`,
  `feature_disabled`, no router call. Launch route closed → its refusal. Legal pending → the legal
  card (and the BUFFER's preflight already answered these before `execute` on develop too, so
  nothing moved). Opt-out → the PDPA line. No membership → `UNLINKED_REPLY`. Holds
  receipt-capture but not `line.ai.query` → `FORBIDDEN_REPLY` **after one paid router call** (the
  floor at §3007 passes, the refusal is at §4091); on develop that message was a free card.
- Residual risk #3 re-read: the AI-off shop's new answer names nothing it cannot use, and the OLD
  card was the dishonest one — it advertised ยอดขายวันนี้, สรุปบัญชี, คุยกับน้องมั่งมี AND
  `พิมพ์ "เมนูหลัก"`, and `เมนูหลัก` itself returns `feature_disabled` for that shop (the menu lane
  sits below the AI gate). No fix recommended; the change is strictly more honest here.
- Not fixed, INFO: the gateway pin's phrasing list is hand-copied (the gateway cannot import the
  API's matcher), so it misses `ทำไรได้`/`ช่วยไรได้`, the `ใช้งานยังไง` variant and the
  `แอป`/`แอพ`/`ที่นี่`/`เมนู` subjects — harmless, because `composeCapabilityHelp` branches only on
  `isTeachingRequest` and both renderings are scoped by the same `usableAccess`.
- Verification: use-case spec 212 → **214 / 214**; `line-advisor-direct-answer.logic.spec.ts`
  **14 / 14**; intake-dispatch + staff-menu + first-signup + spec-suite-coverage **295 / 295, 34
  suites**; `response-composer.agent.spec.ts` **102 / 102**; api + ai-gateway typecheck pass;
  `check-di-metadata.mjs` clean. Mutations, all four red after the fixes (baseline 214/214):
  intercept back above `resolveLineIdentity` → 210 pass / 4 fail; drop `!== 'ACTIVE'` →
  213 / 1; delete the card delivery → 212 / 2; change the unlinked event-log status → 212 / 2.
  Before the fixes the second of those survived at 212/212.

Next:
- Owner review → PR (#453 has landed, so the diff is already just this change) → UAT
  deploy with the same candidate → run `ทำอะไรได้บ้าง` and `มั่งมีใช้ยังไง` as (1) an unlinked LINE
  account — expect the six-function card — and (2) a linked expenses-only employee — expect the
  scoped card / walkthrough with no ยอดขาย and no สรุปบัญชี → production promotion.
