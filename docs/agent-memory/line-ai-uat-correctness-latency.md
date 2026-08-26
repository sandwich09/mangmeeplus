# Agent Memory: LINE AI UAT Correctness and Latency

Status: Implementation EXISTS on this branch behind three default-off flags, and is MERGE-SAFE but NOT
ACTIVATION-READY. No deploy, no config/flag change in any environment. Phase 0 eval freeze is closed for
§14.1 (structural), §14.2 (now bound to the real assessor) and §14.3 (19 implemented_fixture / 2
required_gap). Every behaviour phase stays gated, and DRAFT-only (Phase 3B) still waits for owner GO.

WP-B (2026-08-26): the §8.3 DB-backed neutral intake state landed behind a FOURTH default-off flag,
`LINE_AI_INTAKE_STATE_MODE` (`off` | `shadow` | `on`). New `LineIntakeState` model + migration
`20260826120000_line_intake_state` (partial unique index on the OPEN row per company+user+chatKeyHash) and
`LineIntakeStateRepository`, which fails **closed** — the exact opposite of the fail-open Redis ledger it
backstops. That moved four §14.3 rows from `required_gap` to `implemented_fixture`
(state outage / stale-expired / cross-user / cross-chat-or-company). Read that as "code path and specs
exist", NOT as "the lane is proven": the flag is off in every environment, and no provider replay or UAT
evidence exists for those four rows. Each row's `note` says `DEFAULT OFF` and the integrity spec asserts it.

WP-A (2026-08-26): durable terminal-outcome replay and the Flex→text fallback landed behind a FIFTH and
SIXTH default-off flag, `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED` and `LINE_AI_FLEX_TEXT_FALLBACK_ENABLED`.
New `LineTurnOutcome` model + migration `20260826140000_line_turn_outcome` (`webhookEventId` unique, FK to
`LineWebhookEventLog` with `ON DELETE CASCADE`, so the existing retention purge covers it). The delivery
seam persists the EXACT rendered LINE message array before the first send and fails **closed** — an
outcome it cannot record is parked `delivery_pending` / `LINE_OUTCOME_NOT_RECORDED` instead of being sent
unrecorded — and the orphan sweep's new arm pushes those stored bytes on a retry with no buffer enqueue and
no intake route, which is the §8.3 "replay without re-routing" requirement. `deliveredAt` is the separate
delivery status. The adapter's new `failed_flex` is a strict REFINEMENT of `failed_token` (reply + 400 +
`/messages/` in the error body + a Flex message in the payload), so with the fallback flag off the push
path, its log line and the resulting error code are byte-identical to before. That moved the last two §14.3
delivery rows from `required_gap` to `implemented_fixture`. Read it the same way as WP-B: code path and
fixtures exist, both flags are off in every environment, and no provider replay or UAT evidence exists.
KNOWN CEILING, recorded rather than hidden: the fallback text is each card's `altText`, which the builders
produce as `preview(text, 400)`, so a card body over 400 characters falls back to a visibly marked ("…")
preview — short of §10.2's lossless bar. The fix, if a real fallback is seen losing content, is a
canonical-text field on the card builders; nothing in this WP invents copy or adds a model call.

Owner: thawatchai.phuchana

Scope: Employee LINE OA semantic expense-vs-reimbursement routing, completeness handoff, typed
clarification, terminal Flex presentation, and latency lanes.

## What actually ships (all default-off)

- `LINE_AI_REIMBURSEMENT_SEMANTIC_MODE` (`off`): `clarify_only`/`handoff` are the only modes that grant the
  router the `reimbursementSemantic` capability and turn on the `businessPurpose` completeness expansion.
  `shadow` is an inert NO-GO scaffold, byte-identical to `off`.
- `LINE_AI_EXACT_GREETING_ENABLED` (`false`): whole-message greeting allowlist → 3 model calls become 0 on
  that lane only. Mixed greeting + business text (including a newline-split bubble) keeps the full route.
- `LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED` (`false`): terminal part of a completed multi-part reply becomes
  the trusted Flex card; a terminal past the Flex body limit ships intact as text with a concise card after
  it, and a part past LINE's 5,000-character cap is refused rather than sliced.

There is NO reimbursement writer anywhere in this branch: the payer question, the clarify-only card and the
web handoff are canonical server copy with zero domain writes.

## Activation blockers (all four must close first)

1. Durable replay of the canonical terminal outcome. CODE CLOSED by WP-A, EVIDENCE OPEN. `LineTurnOutcome`
   now stores the exact rendered message array before the first send (fail-closed), and the orphan sweep
   pushes it back without re-routing. `persistIntakeTurn` is unchanged and still best-effort — it remains an
   AUDIT record, not the deliverable. `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED` is off everywhere and no
   replay has been observed against a real LINE channel.
2. DB-backed neutral intake state. CODE CLOSED by WP-B, EVIDENCE OPEN (`LINE_AI_INTAKE_STATE_MODE=off`).
   Financial continuation still rides the Redis ledger in every environment, which is why the assessor
   treats resolved clarifications as VETO evidence only.
3. Text fallback when Flex delivery fails. CODE CLOSED by WP-A, EVIDENCE OPEN. The adapter now discriminates
   `failed_flex` and the seam retries once with the card's own `altText`;
   `LINE_AI_FLEX_TEXT_FALLBACK_ENABLED` is off everywhere, no real LINE 400 has exercised it, and the
   400-character `altText` ceiling above is unproven against real card bodies.
4. Configured-provider replay of the frozen corpus plus a UAT canary. Neither has run. STILL FULLY OPEN, and
   it is the blocker the other three now depend on: three of the four are code-complete and evidence-poor.

1,000 ms debounce remains the primary experiment candidate of the existing latency implementation. This
branch neither activates nor deploys it.

Decisions:
- Phase 1B completeness is a single shared gate: `isLineTextExpenseCaptureEligible` became
  `assessLineTextExpenseCapture`, which returns bounded enum `acceptedFields`/`missingFields`/`conflictingFields`
  instead of a boolean. No call site was patched individually.
- Amount authority is now "exactly ONE distinct deterministic candidate equal to the model-selected amount".
  Candidates prefer currency-marked numbers, so an incidental quantity (`2 แก้ว 65 บาท`) is not a second amount.
- Two distinct amounts are `conflictingFields: ['amount']` and are zero-write on BOTH lanes, including the
  draft-conversation lane, because opening a draft would be the silent pick §8.3 rule 3 forbids.
- `แก้ยอดเป็น <n> บาท` (short versioned list, whitespace-stripped, NFC) is the only grammar that lets the
  current message's sole amount replace the grounded one. It clears the CONFLICT; it does not license a
  write, because the item the money would be recorded under lives in the earlier turn, not this message.
- In semantic mode a resolved clarification is VETO evidence only, never positive authority. So a follow-up
  carrying only the purpose still has to ask for the amount again, and the correction above still asks.
- An active category name can no longer stand in for a purpose. Purpose = grounded `description`, or grounded
  `businessPurpose` ONLY when the dispatcher passes `semanticBusinessExpenseConfirmed`.
- `semanticBusinessExpenseConfirmed` is set only when `LINE_AI_REIMBURSEMENT_SEMANTIC_MODE` is
  `clarify_only`/`handoff` AND the plan says `BUSINESS_EXPENSE` + `COMPANY_PAID`; `off`/`shadow` can never
  activate the expansion, so the completeness lane cannot ship ahead of the semantic guard.
- DEFAULT-OFF is the LEGACY gate verbatim: it returns the old boolean and reports NO typed field at all, so
  the dispatcher falls back to the exact previous generic clarification. The two exact UAT texts are
  `เบิก…` claims, hence route-veto rows — their re-ask defect is NOT fixed in the default-off path.
- The typed clarify question is enum-derived and does NOT echo the conflicting amounts (60/200): §8.2 keeps
  the error and its log bounded to field names. It instead asks for the explicit correction grammar.
- Clarification consumption is id-driven only. A provider that returns the reimbursement route but omits
  `resolvedClarificationIds` consumes nothing: the payer question stays open and the next turn inherits it.
  A stale re-ask is the accepted cost; no regex recovery guesses the id.
- New route is `REIMBURSEMENT_REQUEST_START`; it must never fall through to expense capture.
- Semantic outcome separates business expense, reimbursement claim and ambiguous; ambiguous means zero write.
- Release one is permission-checked handoff-only. Optional LINE-created `ReimbursementRequest(DRAFT)` waits
  for owner GO.
- Safe rollback is `clarify_only`, not the legacy ambiguous auto-capture path.
- §14.1 semantic dataset lives in the EXISTING `scripts/line-ai-substitute-routing.corpus.ts` (now 92 rows;
  `LINE_AI_SEMANTIC_COVERAGE_CASES` = 61) and replays through the EXISTING
  `run-line-ai-operator-language-eval` runner. No second corpus, no second runner.
- §14.2 and §14.3 live in the EXISTING `scripts/line-ai-latency-autonomy.corpus.ts` as
  `LINE_AI_COMPLETENESS_MERGE_MANIFEST` (22 rows) and `LINE_AI_PRESENTATION_PERMISSION_MANIFEST` (21 rows),
  proven by the EXISTING `scripts/line-ai-latency-autonomy.corpus.spec.ts`. No new file, no new runner.
- §14.2 is no longer self-referential: the integrity spec now REPLAYS all 20 `lane: 'expense'` rows through
  the real `assessLineTextExpenseCapture` with the frozen `LINE_AI_COMPLETENESS_ACTIVE_CATEGORIES` map (no
  DB, no network) and compares eligible/accepted/missing/conflicting. The 2 `lane: 'reimbursement'` rows are
  excluded BY `lane`, not by omission — that lane has no deterministic assessor, so only zero-write is
  asserted for them. §14.1 route accuracy and any mutation/UAT evidence are still missing.
- Both manifests stay OUT of `LINE_AI_PROTECTED_EVAL_CASE_IDS` (still 164 + 92): they are not provider
  route rows, and the integrity spec asserts their ids never collide with a scored one.
- §14.3 rows carry `evidenceStatus`. `implemented_fixture` (19) = terminal Flex for single AND multipart
  replies, payer clarification card, clarify-only card with no CTA, handoff card whose only button is
  `/companies/:id/reimbursements/new` (no query/hash), permission / entitlement / empty-branch denials as
  deterministic text with no CTA, legal-pending text, duplicate webhook suppressed by the durable event-log
  claim, the in-turn push fallback for an expired reply token, and the two long-reply rows (>1,200 and
  >4,800 lossless text closed by a concise card), plus the four DB-backed state rows added by WP-B
  (outage / stale-expired / cross-user / cross-chat-or-company) and the two durable-delivery rows added by
  WP-A (persisted terminal-outcome replay, Flex-failure text fallback) — all six are code implemented,
  flag default-off, with no provider or UAT evidence yet. `required_gap` (2) = the dedicated
  `ร่างค่าใช้จ่าย`/`ร่างคำขอเบิก` cards.
- Gold-label rule frozen in the corpus: a claim that does not state a payer pins
  `REIMBURSEMENT_REQUEST_START` + `AMBIGUOUS`/`UNKNOWN`; only text containing a literal self-payment span
  (`EXPLICIT_EMPLOYEE_PAID_PHRASES`) may pin `REIMBURSEMENT_CLAIM`/`EMPLOYEE_PAID`, proven mechanically by
  the integrity spec. There is deliberately NO mirror list on the expense side: `BUSINESS_EXPENSE` +
  `COMPANY_PAID` is the expense-ROOM route contract the server enforces on every capture row, not a claim
  about who physically handed over the cash.
- `scoreSubstituteRow` has three bases: `expected_intent` for the categories whose exact route the contract
  pins (`reimbursement`, `reimbursement_read`, `ordinary_expense`, `unrelated_expense`), `not_command` for
  question/negation/stock/advance rows (§7.2 licenses several safe routes there, so claiming one would
  overstate the contract), and the original `not_substitute` for every other protected negative.
- Phase 6B exact greeting is a whole-message allowlist (`สวัสดี`, `สวัสดีค่ะ`, `สวัสดีครับ`) compared against
  `normalizeLineText` output, never a substring/regex. `normalizeLineText` collapses a newline to a space, so
  `สวัสดี\nเบิกค่าโดยสารหน่อย` can never match — mixed greeting+business text keeps the full semantic route.
- The greeting lane sits at the END of the deterministic gates (after identity/company/access/legal/feature,
  pending-media resolution, the ledger read and the active-draft/substitute context reads) and fires only when
  the turn carries no state: `openWaiting=0`, `activeExpenseDrafts=0`, no media resume capsule,
  `substituteContext.workflowState='none'` and `hasPendingQuestion=false`.

Open questions:
- Owner GO: allow DRAFT-only reimbursement creation from LINE, or retain handoff-only behavior?

Artifacts:
- `docs/specs/line-ai-uat-correctness-latency-spec.md`
- `docs/plans/line-ai-uat-correctness-latency-plan.md`
- UAT event `01M0H6AW395J1D9CJG3P0W6YZJ` (clarification)
- UAT event `01M0H6C9475HA5XJK0KYZKVP33` (expense completed)

Verification:
- Final focused suites PASSED after the consistency pass: API 388/388, corpora/eval 33/33,
  `@watchdog-bms/config` 130/130, AI Gateway 69/69 และ contracts 39/39.
- Typecheck PASSED for `@watchdog-bms/api`, `@watchdog-bms/ai-gateway`, `@watchdog-bms/config` and
  `@watchdog-bms/contracts` after regenerating the local Prisma client; generated output has no tracked diff.
- `git diff --check` passed.
- Read-only UAT CloudWatch trace inspected on 2026-08-21.
- Repository flow traced through contracts, intake prompt, expense gate, reimbursement create use case,
  reimbursement projection ownership, reply renderer and web routes.
- Claude read-only review returned CONDITIONAL, then PASS with no P0/P1 after the gaps were applied.
- Final independent review: PASS for a default-off merge, FAIL for flag activation until the four blockers
  above close.

Next:
- Close Phase 0: UAT source SHA/config + the 4 event ids, the related doc amendments, and the per-journey
  baseline p50/p95/model-call/token/cost.
- Configured-provider replay for §14.1 route accuracy.
- The remaining 2 §14.3 `required_gap` implementations: the dedicated expense-draft and optional-draft
  cards. (WP-B closed the DB-backed neutral state; WP-A closed persisted terminal-outcome replay and the
  Flex-failure text fallback.)
- Evidence for the four WP-B rows: a `shadow`-mode divergence run, then provider/UAT evidence, before
  `LINE_AI_INTAKE_STATE_MODE` may go to `on` anywhere. Wiring the flag into `deploy.sh` is a separate step
  (UAT flags only reach the environment through its jq blocks).
- Evidence for the two WP-A rows, and the same `deploy.sh` wiring step for both new flags. Neither has a
  shadow mode — they are behavior lanes — so UAT is the first place a real LINE 400 or a real replay can be
  observed. Worth watching there: whether any observed Flex fallback loses content to the 400-character
  `altText` ceiling (that is the trigger for a canonical-text field on the card builders), and whether the
  replay arm ever picks up a `delivery_pending` row whose `payloadJson` was already cleared — the push
  target comes from that envelope, so such a row cannot be replayed today.
- Keep Phase 3B blocked until owner GO.
