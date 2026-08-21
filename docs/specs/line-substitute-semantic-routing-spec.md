# LINE Substitute-Receipt Semantic Routing Spec

## 1. Status

Focused routing/dispatcher-safety + shadow/eval spec for the UAT dead-end on
`SUBSTITUTE_RECEIPT_CONTINUATION`. Scoped narrowly: it fixes only how a substitute-receipt turn is
ROUTED and DISPATCHED. It does NOT implement assisted-issuance v0.2, signatures, delivery, company
policy, schema/migrations, or any final mutation — those remain governed by
`docs/specs/line-substitute-receipt-assisted-issuance-spec.md`.

## 2. Problem (root cause, already recorded)

`process-line-webhook.use-case.ts` intercepts substitute vocabulary via the narrow regex
`isSubstituteReceiptConversationText` BEFORE the intake router runs. A semantic paraphrase such as the
UAT message "ใบทดแทนของค่าวิน…" ("a substitute receipt for the motorcycle-taxi fare") does not match
the regex, so the turn is never routed to the substitute continuation; and a message that is *both* a
new expense and a substitute request never reaches text capture. The fix is guard ORDERING plus a
semantic route, not a new feature.

## 3. Required flow and precedence (unchanged safety order)

1. Deterministic identity / legal-acceptance / company-selection / explicit slash commands run FIRST
   (unchanged).
2. Load bounded, server-derived substitute context (workflow open/paused/none/multiple, pending
   question, prepared-evidence/state, recent-candidate count). Labels/questions are DATA, never
   authorization.
3. Semantic intake route (`routeIntake`) runs — the substitute context rides in the bounded
   `LineIntakeRouteRequest`.
4. A TYPED dispatcher runs AFTER `routePlan`: when the route is `SUBSTITUTE_RECEIPT_CONTINUATION`, the
   existing continuation use case is invoked, reusing its feature/permission/scope/preflight/ledger/
   audit path. The API re-reads authoritative substitute state before any dispatch.
5. Narrow regex fallback runs ONLY when the semantic route status is UNAVAILABLE or the provider was
   invalid. Regex and semantic dispatch NEVER both execute for one turn.

## 4. Contracts, prompt, parser

- `SUBSTITUTE_RECEIPT_CONTINUATION` (already in `LINE_INTAKE_ROUTE_INTENTS`) appears in the intake
  prompt output schema AND route meanings, and is parsed locally via the contract
  `asIntakeRouteIntent`/`LINE_INTAKE_ROUTE_INTENTS`. Any duplicate local intent allowlist or raw
  `as LineIntakeRouteIntent` cast in the parser and in the ledger clarify-intent read is removed.
- `LineIntakeRouteRequest` gains ONE optional bounded `substituteContext` object carrying only what the
  route decision needs: `workflowState` (`none`|`open`|`paused`|`multiple`), `hasPendingQuestion`,
  `preparedState` (a bounded enum of the current stage), and `recentCandidateCount` (a small integer).
  No free text, no ids, no permission material.
- Low confidence `< INTAKE_MIN_ACTION_CONFIDENCE` on a substitute route → `CLARIFY` with
  `clarifyForIntent: SUBSTITUTE_RECEIPT_CONTINUATION` and one bounded discriminating question.
  Confidence is veto-only; it never grants a start.

## 5. Dispatcher safety

- The substitute interception/dispatch moves to AFTER `routePlan`. The typed branch reuses the existing
  `LineSubstituteReceiptContinuationUseCase` (feature/permission/scope/preflight/ledger/audit unchanged).
- The dispatcher consumes ONLY `routePlan.resolvedClarificationIds` that actually belong to a substitute
  clarification — never all open items (no clarification hijack).
- A side business/VAT/definition/help question, and a new unrelated expense, keep any open substitute
  state OPEN and route normally. In particular, with an open substitute clarification, "ค่ากาแฟ 65 บาท"
  remains `EXPENSE_DOCUMENT_CAPTURE` and does not consume the substitute; `ใบสำคัญรับเงิน` / payment
  voucher / reimbursement are PROTECTED NEGATIVES (never routed to substitute continuation).
- Permission / feature / eligibility rejection happens BEFORE any workflow save. Questions, negation /
  no-op, and denied/ineligible turns cause ZERO substitute workflow writes and ZERO expense-revision
  bump. A high-confidence model "start" alone must clarify/confirm before creating OPEN state unless it
  can prove an explicit stateful command; existing active answers write only when accepted values/status
  actually change.
- Explicit stateful resume/pause/cancel remains deterministic and audited.

## 6. Fallback (narrow, single-path)

When semantic status is UNAVAILABLE / invalid-provider, dispatch falls back to the NARROW deterministic
match: canonical document names only (the existing `isSubstituteReceiptConversationText` set) plus the
exact stateful resume/pause/cancel controls. Negation and questions can never START a workflow via the
fallback. No broad synonym library is added.

## 7. Rollout and telemetry

- A default-OFF isolated mode gates the change: `LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE ∈
  {off, shadow, primary}` (default `off`). `off` preserves EXACT legacy behavior (regex-first).
- `shadow`: a reserved NO-GO scaffold. The legacy path short-circuits BEFORE the router, so a real
  nonblocking semantic-vs-legacy comparison cannot run safely in a serverless webhook lifecycle (a
  non-awaited compare after the handler returns may be frozen/killed). Rather than fake agreement,
  `shadow` behaves EXACTLY like `off` and is intentionally inert; offline provider replay measures
  agreement instead. Do not claim `shadow` implemented.
- `primary`: the semantic route is authoritative; the NARROW canonical fallback runs only on UNAVAILABLE.
  `primary`/canary is DISABLED absent provider/full-flow evidence — the code exists and is tested, but it
  is not enabled by default and must not be turned on without that evidence.
- Telemetry carries only: message hash, route + status, confidence bucket, regex-match boolean,
  open-state bucket, agreement (a by-product of the REAL `primary` decision — whether the narrow regex
  would have matched the semantic route on the same turn — NEVER a shadow compare; the ≥95% agreement
  metric is measured OFFLINE by provider replay), and decision source. No raw text or PII. Rollback gates:
  permission bypass; a workflow write on a question/negative/denied turn; duplicate execution; and
  clarification hijack.

## 8. Eval and tests

Extend the EXISTING latency/operator eval corpus (no second provider runner) with ≥40 protected
Thai/English cases: the UAT paraphrase "ใบทดแทนของค่าวิน…", start/continue/status/pause/cancel, receipt
available/unavailable, ordinary expense notes, payment voucher / ใบสำคัญรับเงิน / reimbursement,
definition/VAT/help questions, negation, open-answer/side-question/unrelated-expense, multiple targets,
low confidence, invalid/UNAVAILABLE, and permission/feature/policy/payer/approver denied. Gates: 0 writes
for questions/negatives/denied; 0 preflight bypass / double execution; 100% protected negatives;
offline provider-replay legacy-positive agreement ≥95% (evidence-blocked here — measured by the operator-
language replay, NOT by live shadow); regex-fallback and disagreement telemetry measured. Dispatcher tests
must prove write/revision behavior, not only classification.

## 9. Non-scope (explicit)

No assisted-issuance v0.2, signatures, delivery link, company policy, schema/migration, or final
mutation. This spec changes routing/dispatch guard order, one bounded route-request field, the prompt
route meaning, a default-off config mode, telemetry, and the eval corpus only.
