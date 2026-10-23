# Agent Memory: line-ai-workflow-first

Status: DRAFT — blocked on: R4-F2 (ordered dispatch of new controls) review before Phase A2; owner Q1–Q3, MC1
(Rounds 1–4 + the focused check applied 2026-10-24. Focused check: R4-F1 CLOSED; R4-F2 redesigned (ordered dispatch) and needs review before Phase A2. Can start without A2: A9 (no charge for unusable output), A10 (substitute writes only on signed apply), A6c (greeting), A7 (telemetry), Phase M (M1a–M3; M4 needs the Q3 budget), B1 probe. Blocked behind A2: A3a/A3c/A3b, A4a/A4b, A5, A6a, A6b, B4. The round-2 claim "no HIGH finding open" was wrong (corrected in round 3). MC1–MC11 must close per step, spec §17.1.)
Owner: LINE AI lane — controller = main thread; implementation = Codex lanes per plan; held-out author = a separate lane.
Scope: Owner idea 2026-10-23 "อันไหนที่ทำซ้ำอันนั้นควรมี workflow แล้ว ai classifier แม่นและเรียกแค่ tools เดียวแล้ว workflow วิ่งต่อ เช่นใบเบิก ใบทดแทน หรืออื่นๆ" — backlog ค 16–24 (`docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`). Goal: lower AI cost per COMPLETED task, higher accuracy, wrong action 0. Docs only; no code changed; not committed.
Baseline: main 6c54ba208 (worktree `mangmee-worktrees/expense-specs-20261023`, same tree).

Decisions:
- Three tiers: Tier 0 = buttons/postbacks + answers to the workflow's own question (incl. deterministic new-line details) + exact commands/greeting (0 model calls); Tier 1 = one provider-schema-enforced classifier call, then coded workflow; Tier 2 = existing intake + semantic turn.
- Workflow names = `LINE_CHAT_ACTIONS` ids (`packages/contracts/src/ai-tools.ts:258–279`) + `substitute_receipt`. No reimbursement-edit workflow; the existing edit route (UPDATE options incl. TARGET, rda:812–820) stays byte-identical.
- Authorization per record = existing code (`line-expense-action.service.ts:997–1012`, `approvalDecisionActions`, frozen assignments). Picker reads use the list use case's scope (`expense-list-read-scope.ts:4–9`); creators without read scope see only their own records (MC1, owner).
- Pickers: `ListReimbursementsUseCase`, `ListExpensesUseCase`, `ListCounterpartiesUseCase` (paged, not the 10-row tool), and two new LINE read admissions: `DisbursementVoucherUseCase.listForLine` and `ListSubstituteReceiptCandidatesUseCase` with `channel: 'line'` (MC2, controller security review). "ไม่พบ" only when exhaustive.
- Deterministic claim start `startFromWorkflow` (`LineReimbursementDraftUseCase.open` + `buildOptions`) and `parseManualClaimLine` (amount/date from candidates, description = exact span) with existing proof format.
- Classifier: own authority kind `webhook_classify`, own attempt key `line-classify-v2`, own profile `line-classify/2` (24,576 / 1,024 / 1); turn grant/slot/repair/QA/narrow math unchanged; slots include `description_text`; low-confidence table (spec §7.2.1).
- Charging boundary: callers' `acceptOutput` runs BEFORE settle; `output_limit`/invalid/timeout → usage `ok:false` → company-absorbed. Applies to EVERY call under a v2 envelope: router, planner, public lookup, compose, document QA, classifier (fixes the B6 class).
- `wf_open` signs `act, id, pm, pd, pa` (covers VOUCHER_SUBMIT/APPROVE/PAY, WHT issue, RECORD_PAYMENT incl. partial amount). It never expires; a failed signature shows the existing lea:178 text, and "หมดเวลา" is said only when a stored/signed `expiresAt` has passed.
- Substitute receipts: EVERY expense write — the category answered while collecting, the review, the numbered document — happens only on a signed-card press (`confirmedDecision` from the token); while collecting, answers live only in the continuation's `acceptedValues`; typed "1"/"2"/yes only sends the matching signed card (new FORM card; the signature guard applies to ISSUE only) — plan A10, fixes B7 + B8.
- New controls (`workflowControl`, `workflowStart`, `fixedReadControl`) travel through the message buffer: item type, command detection, frozen payload, sweep replay, `toTextEvent` (today only existing controls are copied from the last message — `line-message-buffer.service.ts:1061, 1090`). They always go through the ordered worker, never the stateless-menu fast path (:510–511), so they cannot overtake a queued `/company` switch (company resolved at pwu:6648).
- Postback proofs: HMAC (`wf_open`); owner-bound stored proofs (`wf_choice` token + stored options; `reimbursement_choice` actionId + revision digest rda:155); targetless navigation (`chat-action`, `fixed-read` with a closed id list, permission rechecked).
- `fixed-read` = `action=fixed-read&id=<id>` only for ids with a prepared family; the existing `PREPARED_READ_UNAVAILABLE` guard (`orchestrator.agent.ts:1210–1222`) stays, with neutral copy + a web button; no fallback model call.
- Expired cards: `recover:<previewId>` record (7 days, deleted on confirm/cancel) lets a card whose Redis preview expired (600 s) offer `เตรียมการ์ดใหม่`; no record → the existing lea:178 text.
- Expense pickers: `pageSize: 100`, ≤ 3 pages, no date window, exhaustive = Σ total ≤ 300 (P11).
- Classifier model: own `LINE_CLASSIFY_MODEL_ID` constant via capability `modelPolicy` (partner model policy wins); Haiku 5.5 needs a `REVIEWED_LINE_MODEL_CAPACITY` row (100K ceiling, MC10).
- `startFromWorkflow` key: `taskId = stableUuid(['reimbursement-draft-task', owner, 'workflow', eventIdHash])`, `actionId = stableUuid(['reimbursement-draft-action', taskId, 'CREATE', 1])`, `actionOrdinal: 1` (rda:390–393 pattern; `open` rejects non-UUID / ordinal < 1 at `line-reimbursement-draft.use-case.ts:143`).
- Shared pending-field guard = question/command checks only (rda:194–197); the amount-free rule (rda:198) stays on claim reasons.
- "อย่างอื่น" = fresh admission of the stored text on the new event (new deadline, original provenance kept; Bangkok date changed → ask to retype).
- Latency promise: Tier 0/1 ≤ 15 s; a Tier 2 fallback follows A7 inside the existing turn deadline (admittedAt + 40 s).
- Eval: run cap enforced before every dispatch by a harness-only trigger `BEFORE INSERT ON "AiBudgetReservation"` in the eval DB (schema `eval_guard` survives `truncateAllTables`), counting ledger + open bounds + finished cost incl. company-absorbed; NOT by seeded customer credit (failed calls refund credit). Cap rejections are visible to the harness through sequence `eval_guard.cap_rejections` (nextval survives the rollback; `reserveAiBudgetStep` swallows the error into `reserve_failed`, cbr:453–457). Child rows (approval steps, voucher lines, WHT handoff/history) linked to a gold parent at `confirmTurn` are derived effects, not writes outside gold. The trigger's PG tests get their own entry in `LINE_AI_RELIABILITY_POSTGRES_SUITES`. `captureSpend` runs at harness start/resume, before preflight/oracle/runtime resets and after the last conversation; ledger keyed by `invocationKey`; event ids carry `attemptId`. Collection state (draft actions COLLECTING, substitute continuation metadata) is not a "write". Provider cost = every pinned tariff component, unrounded. Phase C measured on Bedrock only. PG assertions in `company-ai-usage-meter.spec.ts` (package-listed) via `realpg.sh`.
- Greeting flag removed (always on, ahead of the v2 route). Order: Phase M → A (incl. A9 money fix) → B → C → D.

Verified bugs (code-read only, not executed):
- B1 next-step buttons depend on a 120 s "UI courtesy" applied store, one slot per chat (`line-draft-preview.store.ts:33, 209–225`; lea:243, 845–880).
- B2 pending reason/payee-address capture questions; a question in the payee-name field deletes the pending action (lea:977–993, delete at :988).
- B3 exact-greeting lane unreachable in private chats (pwu:7007, 7032–7034 before :7613).
- B4 expired card refusal has no way out (lea:178, 877, 880).
- B5 support pause swallows claim choice postbacks and `chat-action` presses (pwu:6612–6628).
- B6 complete-but-unusable provider output (router/planner/compose and document QA) is charged to the customer: settle in `finally` (`ai-budget-provider.ts:429, 459`) before the router parses (`intent-router.agent.ts:741`) and before document QA parses (`document-qa.use-case.ts:92–93` → `QA_RESULT_INVALID` :97, :106); absorbed only when `ok === false` (`company-ai-budget-reservation.ts:872`); second settle is `'duplicate'` (:859–860).
- B8 (High) the substitute continuation writes `ExpenseRecord.expenseCategoryId` as soon as the category is answered, in the same CAS as the continuation state, before any confirmation card (`line-substitute-receipt-continuation.use-case.ts:2000` → `prisma-expense.repository.ts:4312`; reply says the category was saved, :1266–1268).
- B7 (High) a complete substitute receipt waiting on `ISSUE_CONFIRM` accepts typed "1"/"2"/yes and reviews the expense + prepares the numbered document without a signed card (`line-substitute-receipt-continuation.use-case.ts:774–778, 1917, 2189, 2289, 2394`); the signed card itself feeds `messageText: '1'` into the same path (`line-substitute-receipt-action.service.ts:203`). Reachability per state to be proven by a failing test first (MC9).
- MB1 eval evidence hardcodes provider `bedrock` (`run-real.ts:220` vs `launch-gateway.mjs:93`); MB2 rescore needs env vars (`run-rescore.ts:87–88`); MB3 runtime event ids have no attempt (`line-ai-reliability-runtime.ts:436`), so a resumed attempt reuses invocation keys.

Key verified facts:
- Claim choice postbacks pay the intake (pwu:7716–7718); claim answers need the grant and amount-free text (pwu:5352–5353; rda:198); first claim line otherwise comes from intake hints (rda:536–545).
- Turn slots/ordinals: `ai-budget-bounds.ts:348–351`, `ai-usage.interceptor.ts:96`, budget-authority:344; turn deadline = admittedAt (pwu:4426) + lane `public` 40 s (pwu:4427, budget-authority:45).
- `DisbursementVoucherUseCase` rejects LINE sessions unless `lineConfirmed` (`disbursement-voucher.use-case.ts:69–72, 74–78, 228–229`); the voucher read tool relabels `authProvider: 'watchdog'` (`erp-advisor-document-tools.use-case.ts:15–19`).
- Substitute candidates use case is web-only (`substitute-receipt.use-case.ts:471–496`, `assertWeb` :474); the signature queue lists prepared documents without expense ids (`prisma-expense.repository.ts:1817–1833`).
- Counterparty tool caps at 10 and needs `accounting.counterparty.read` (`line-counterparty.service.ts:75–77`; use case `counterparty.use-case.ts:266–272`).
- Pricing rounds each invocation to whole satang (`ai-model-pricing.ts:223`); absorbed rows: `usageBasis 'COMPANY_ABSORBED'` (cbr:893) with real basis in `evidenceJson.providerUsageBasis` (cbr:956).
- Eval runtime truncates every table before each conversation (`line-ai-reliability-runtime.ts:92, 372`); the oracle pass (`gold-oracle-pass.ts:128`, called from `run-real.ts:216`) and preflight (`run-preflight.ts:79`) truncate too; `truncateAllTables` touches schema public only (`seed.ts:433`).
- Failed calls restore customer credit while recording provider cost (`ai-credit-funding.pg.spec.ts:151, 157`). Three reserve callers: budget-authority:323, `internal-ai-budget.controller.ts:123`, `company-ai-usage-meter.ts:205` → all via `reserveAiBudgetStep` (cbr:318).
- Pinned cost includes external-tool fees and search-content tokens (`ai-model-pricing.ts:219–222`); whole-call ROUND_HALF_UP (:223): Haiku warm ~0.35 satang → 0, cold 1.29525 → 1.
- Cross-message task ids already exist in the task projection (`process-line-webhook.use-case.ts:4834, 4843`); what is missing is a durable id tied to reservations for cost reporting.
- `line-substitute-receipt-continuation.use-case.spec.ts` is NOT in `apps/api/package.json` (the whole-chain catalog runs some of its test names); new B7 assertions go to `substitute-receipt.use-case.spec.ts` + `process-line-webhook.use-case.spec.ts`. Gateway `document-qa.integration.spec.ts` is not package-listed either.
- Bedrock structured outputs: `outputConfig.textFormat` + `strict` tools; no numeric/length constraints; grammar cached 24 h from first access. Sonnet 4.6 on Converse unverified (MC3).
- Haiku 5.5 (coordinator-verified from the AWS model card): Converse/Messages/Invoke on `bedrock-runtime`; `global.anthropic.claude-haiku-5-5` from ap-southeast-1; structured outputs; adaptive thinking on by default (thinking tokens count toward max_tokens). No new transport. Messages API: `thinking: { type: 'disabled' }` allowed at effort ≤ high, effort via `output_config.effort` (default medium); Converse field names = MC5 probe. `provider.factory.ts:52–54` picks `AnthropicApiProvider` when a local key is set.

Review 2026-10-24 (round 1, Codex, F1–F34) — where each is addressed:
- F1 grant reuse → spec §6.4; plan B2/B4. F2 slots → spec §6.4, §3; plan B2. F3 get_summary no ids → spec §6.1; plan A4a.
- F4 oracle values/confirm → measurement §6.1, M-R5/M-R6. F5 effect tables/snapshots → measurement §6.2, §11. F6 checkpoints → measurement §6.6.
- F7 message-action press → measurement §6.1.1–6.1.2. F8 cost split → measurement §6.5; spec §6.2. F9 Haiku Converse → spec R19; plan C2.
- F10 authorization vs navigation → spec R21, §8; plan A6a. F11 pagination → spec §6.1, §7.5, §10. F12 task boundary → spec §6.2, §9.3, AC1.
- F13 failed spend + mix → measurement W5, W13. F14 second score → spec §7.2. F15 sizing → spec §6.4, R7. F16 schema in proofs → spec §7.3.
- F17 runtime whitelist → measurement §11. F18 fixture ops → measurement §6.1. F19 no UPDATE → spec §3. F20 pause allowlist → spec §7.1, B5.
- F21 payee interruption → spec B2, R6. F22 provenance → measurement M-R11, MB1. F23 test placement → spec §14 (now package-listed only, see P23).
- F24 Haiku thinking → spec §7.2. F25 schema prerequisite → spec §2.3, §16. F26 grammar expiry → spec R10, §7.2. F27 cold/warm → M-R12.
- F28 PDPA source → M-R8. F29 cancel terminal → measurement §6.1. F30 illustration → spec §1.1. F31 route → spec §7.2. F32 help buttons → spec §1.2. F33 cold cost → spec §7.2. F34 rescore → measurement §7.2.

Round 2 (2026-10-24) — partial items and new findings:
- P4 confirmation mandatory + payment records + expected preview → measurement M-R6, §6.1 (`expect.preview`, payment GoldRecords, validator).
- P6 reserve next call's bound before dispatch → measurement M-R9, §6.6 (seeded credit = cap − ledger; product reserve enforces; `CAP_REACHED`) — superseded in round 3 F3 by the eval-DB trigger.
- P8 absorbed-call provenance → measurement §6.5 (`evidenceJson.providerUsageBasis`, cbr:956).
- P10 creator read paths → spec R21, §6.1, AC11; §17.1 MC1 (owner).
- P18 cross-company/restricted-branch actors → measurement §6.1 `Actor`, §6.4, §15.1; plan M1a/M2.
- P19 edit route must not break → spec §3, §7.1 (CREATE-only postbacks), AC18; plan A3a.
- P23 PG assertions in package-listed files → spec §14 and plan rules (`company-ai-usage-meter.spec.ts` "real PostgreSQL:" via `realpg.sh`).
- F1 (HIGH) truncate erases spend → measurement §6.6 `onBeforeReset` + `*.spend.jsonl`; plan M1a/M1c — extended in round 3 F4 to every reset + final flush.
- F2 (HIGH) unusable output charged → spec §1.4, R12, §7.3, B6, AC16; measurement W15; plan A9.
- F3 (HIGH) voucher list rejects LINE → spec §6.1 `listForLine`, G15, AC17; plan A4b; MC2.
- F4 (HIGH) substitute source → spec §6.1 candidates `channel: 'line'`, G17; plan A4b; MC2.
- F5 (HIGH) deterministic CREATE init → spec §7.5 `startFromWorkflow` + `parseManualClaimLine`, slot `description_text`, G16, AC1/AC2; plan A3c — key corrected in round 3 F2.
- F6 "อย่างอื่น" deadline → spec §9.1, E4; plan B4. F7 voucher/payment mappings → spec §7.1 `wf_open act/pm/pd`, AC9; plan A2/A5.
- F8 vendor resolution → spec §6.1 search rules, §10 copy; plan A4b. F9 rounding → spec §6.2, §7.2; measurement M-R3, §6.5, MA4; plan C1.
- F10 attempts → measurement M-R13, §6.6. F11 low-confidence with non-workflow second label → spec §7.2.1, AC4. F12 end-to-end deadline → spec §6.4, AC14; plan B5.

Round 3 (2026-10-24, Codex: 40/46 resolved, 6 partial, 18 new incl. 5 HIGH) — where each is addressed:
- F1 (HIGH) typed substitute choice prepares without a signed card → recorded as bug B7 (spec §13); fix = spec R4, §6.1, §9.2, §10 (FORM card), AC20; plan A10 (+ A4b depends on it); MC9.
- F2 / P39 (HIGH) claim-start key → spec §7.5 (UUID `actionId`, `actionOrdinal: 1`, idempotent replay); plan A3c; locked decision 13.
- F3 / P6 (HIGH) run-wide provider cap → measurement §1, M-R9 (trigger in eval DB across all companies/callers, absorbed cost counted), MA2, §16; plan M1c; locked decision 12.
- F4 / P35 / P44 (HIGH) spend before every reset → measurement §6.6 `captureSpend` (start/resume, preflight :79, oracle :128, runtime :372, final), ledger by `invocationKey`, M-R13 + MB3 (attempt in event id); plan M1a/M1b/M1c/M2.
- F5 (HIGH) document-QA charging → spec R12, §7.3 (every v2 caller incl. document QA + public lookup), B6, AC16, §14; plan A9.
- P4 / F8 EXPENSE_PAID ↔ ExpensePayment (amount/date/method) → measurement §6.1 validator; plan M1b.
- P41 / F6 sign `pa` → spec §7.1, §8, AC9; plan A2/A5; locked decision 9.
- F7 collection state vs committed writes → measurement M-R6, `phase: 'collect'`, §6.2 `collectionState`; plan M1a.
- F9 preflight adaptation → measurement §7.2, §11; plan M1b. F10 every tariff component → measurement §1, M-R3, §6.5, W13.
- F11 thinking/effort → spec §7.2 (Messages names, Converse via probe, Phase C Bedrock-only); measurement M-R2; plan C2; MC5. F12 rounding → spec §7.2; measurement §1; plan C1.
- F13 duplicate labels → spec §7.2 (normalize to `none`), §7.2.1 row. F14 guard scope → spec R6; plan A3b. F15 durable cost identity → spec G9; measurement §1, MG1.
- F16 amount-only zero-model scope → spec §1.1. F17 invalid vs expired → spec E1, §10, AC21; plan A5. F18 historical guidance → spec R1.

Round 4 (2026-10-24, Codex, LAST full review: 63/64 resolved, P11 partly, 12 new incl. 2 HIGH) — where each is addressed:
- F1 (HIGH) substitute category written before confirm → bug B8 (spec §13); fix = spec R4, §10, §11, AC20 (every collection turn), §17.2; plan A10. CLOSED by the focused check 2026-10-24.
- F2 (HIGH) buffer drops new controls → spec §7.1 buffer bullet, §11, AC22, §17.2; plan A2. Focused check: still open (the fast path :510–511 lets a control overtake a queued `/company B` and read company A's data) → redesigned as ordered dispatch; designed, needs review before Phase A2.
- P11 expense picker pagination → spec §6.1 (pageSize 100, ≤ 3 pages, no date window, Σ total ≤ 300), AC23; plan A4b.
- F3 approval-step/WHT child rows → measurement M-R6 (derived effects), GoldRecord tables + `decisionBy`; plan M2.
- F4 cap-rejection signal → measurement M-R9 (`eval_guard.cap_rejections` sequence); plan M1c.
- F5 model readiness → spec §6.4 (classifier model selection), §11, MC10; plan C1.
- F6 `fixed-read` payload → spec §7.1 row, R3; plan A6b. F7 fixed-read fallback → spec §7.4 item 2, §10, AC8; plan A6b; MC11.
- F8 Redis expiry recovery → spec E1 (b), §11, AC21; plan A5. F9 signature guard ISSUE-only → spec §11, AC20; plan A10.
- F10 oracle pass actors → measurement §11; plan M2. F11 PostgreSQL suite → measurement §14; plan M1c. F12 HMAC coverage → spec R3; plan decision 16.

Unreviewed fixes from round 4 — BLOCKERS (spec §17.2; focused check done 2026-10-24):
- R4-F1 (B8) — CLOSED by the focused check; A10 may start. Fails today: while a substitute receipt is still collecting, the bot asks for the category → user answers "หมวด: ค่าเดินทาง" → `saveLineSubstituteContinuation` writes `ExpenseRecord.expenseCategoryId` at once (continuation :2000 → repository :4312) → the user abandons → the expense's category has changed with no confirmation. Designed fix: keep the category only in `acceptedValues.expenseCategoryId`; evaluate blockers and eligibility on the proposed value (the category blocker already does, :552; any other row read uses `{ ...expense, expenseCategoryId: proposed }`); show it on the PREPARE/FORM card; write it with a CAS just before `review.execute` (:2367) inside the signed apply; reply uses the "(ยังไม่แก้รายการ)" text. Review gate: confirm (1) no other collection-time path writes business columns of `ExpenseRecord`, (2) every pre-confirm row read of the category uses the proposed value, (3) AC20 covers every collection turn, (4) the new test in `substitute-receipt.use-case.spec.ts` fails on baseline and passes after.
- R4-F2 — designed, needs review before Phase A2. Fails today: (a) a user sends text and immediately presses a `wf_open`/`fixed-read` button (or the process dies and the sweep replays): the buffer builds the event from the last message and copies only the existing controls (`line-message-buffer.service.ts:1061, 1090`), so the new control is lost; (b) found by the focused check — if the controls are merely classified as commands, the stateless-menu fast path (`void this.dispatchBatch(key, state, [item]` :510–511) sends them at once: during an active turn a queued `/company B` (resolved at pwu:6648) is overtaken by a later fixed-read press, which returns company A's financial data after the user switched to B. Designed fix: add the three controls to the item type (:60–75, logic :25, pwu :236), command detection (:475), frozen payload (:1051–1065), sweep replay (:383–398) and `toTextEvent` (:1086–1091); exclude them from the fast path, so an idle chat uses the idle path (:500–504) and a busy chat uses `state.open` + `flushOpen` (:541) into the ordered worker, isolated as a single-item group (:949–950). Review gate: confirm (1) no other place builds a `LineTextEvent` from the buffer outside this list, (2) items carrying a control are never coalesced and never dispatched ahead of a queued batch, (3) AC22 incl. the regression "/company B then fixed-read during an active turn → company B data" + tests in `line-message-buffer.service.spec.ts` / `line-message-buffer.logic.spec.ts`.

Must close before coding (spec §17.1): MC1 creator-only picker (Owner, recommended yes); MC2 LINE read admissions for vouchers/substitute candidates (controller security review); MC3 Sonnet 4.6 Converse structured outputs (probe B1); MC4 SDK `outputConfig` type (lane B1); MC5 Haiku thinking/effort parameter names (lane C2); MC6 purge job for `LineAiTaskRun` (lane A7); MC7 image/OCR attempt keys (lane M1c); MC8 B6 fix scope incl. AgentCore rebuild (controller, A9); MC9 which typed paths reach the substitute continuation per state — failing test first (lane A10); MC10 Haiku 5.5 capacity row from the AWS model card (lane C1); MC11 which `FIXED_READ` ids have a prepared family (lane A6b).

Open questions (Owner, money only):
- Q1 zero-AI steps free and may finish after credit runs out; new typed messages still meet the credit gate — recommended yes.
- Q2 switch Tier 1 to Haiku 5.5 automatically if MA4 passes — recommended yes.
- Q3 eval budget cap — recommended 2,000 THB (estimate ≈ 1,085 THB + reruns).

Artifacts:
- `docs/specs/line-ai-workflow-first-spec.md`
- `docs/specs/line-ai-measurement-and-eval-spec.md`
- `docs/plans/line-ai-workflow-first-plan.md`
- `docs/agent-memory/line-ai-workflow-first.md`

Verification: docs only. Code citations re-grepped in the worktree on 2026-10-23/24 (the coordinator independently re-opened the round 1–2 citations; round 3 citations re-grepped by this lane — corrected two: amount-only reply check is pwu:3755, expired check is `line-reimbursement-draft.use-case.ts:159`). External facts cite AWS/Anthropic/arXiv/MDES URLs; Haiku 5.5 model-card facts verified by the coordinator. No tests, builds, servers, cloud calls (not run). Line numbers must be re-checked when each lane starts.

Next:
- Review of the R4-F2 redesign (ordered dispatch) before Phase A2; when it passes, drop R4-F2 from the blocked-on status.
- Meanwhile A9, A10, A6c, A7, Phase M (M1a–M3) and the B1 probe can start; M4 waits for the Q3 budget.
- Owner answers Q1–Q3 and MC1 (one message); controller closes MC2.
- Controller lands docs on develop + main (docs-only push).
- Start Phase M (M1a → M4) and A9 before other Phase A code.
