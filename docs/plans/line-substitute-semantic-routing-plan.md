# LINE Substitute-Receipt Semantic Routing — Implementation Plan

Linked spec: [[../specs/line-substitute-semantic-routing-spec]]. Ponytail full: smallest correct reuse of
the existing router, continuation use case, ledger, config, and eval patterns. Default OFF preserves
exact legacy behavior. No commit/push/deploy; no package.json/schema/migration; preserve next-env.d.ts.

## Steps

1. **Contracts (smallest additive).**
   - Add an optional bounded `substituteContext` to `LineIntakeRouteRequest` (workflowState enum,
     hasPendingQuestion, preparedState enum, recentCandidateCount). No ids/free-text/permission material.
   - Confirm `SUBSTITUTE_RECEIPT_CONTINUATION ∈ LINE_INTAKE_ROUTE_INTENTS` (already present); add parity
     test.

2. **Parser / ledger de-dup (remove raw casts + duplicate allowlist).**
   - `parseIntakePlan`: validate the intent via contract `asIntakeRouteIntent`, drop the local
     `INTAKE_ROUTE_INTENTS` array + `as LineIntakeRouteIntent` casts.
   - `line-ai-ledger.service.ts`: read `clarifyForIntent` via `asIntakeRouteIntent`, drop the raw cast.

3. **Prompt.**
   - Add the `SUBSTITUTE_RECEIPT_CONTINUATION` route MEANING and how to use the bounded
     `substituteContext`; low-confidence → `CLARIFY` with `clarifyForIntent`; protected negatives
     (payment voucher / ใบสำคัญรับเงิน / reimbursement, side questions, "ค่ากาแฟ 65 บาท" stays capture).
   - Prompt-contract tests inspect the ACTUAL prompt.

4. **Config mode (default off).**
   - `LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE` enum `off|shadow|primary` (default `off`) in
     `apiConfigSchema`; getter on `AppConfigService`. Config default-off test.

5. **API dispatcher restructure (the root fix).**
   - Build the bounded `substituteContext` from server-derived state and pass it to `tryRouteIntake`.
   - Move the substitute interception to AFTER `routePlan`. New precedence:
     - `off` → exact legacy regex-first path (unchanged).
     - `shadow` → RESERVED, INERT NO-GO: byte-identical to `off`. Because the legacy path short-circuits
       BEFORE the router, a serverless webhook cannot run a real nonblocking semantic-vs-legacy compare
       without adding user latency or firing a background route — so `shadow` MUST NOT fake agreement. It
       carries no capability, sends no `substituteContext`, and logs nothing new; agreement is measured
       OFFLINE by the operator-language provider replay over the protected corpus, never by live shadow
       telemetry.
     - `primary` → typed dispatch when `routePlan.intent === SUBSTITUTE_RECEIPT_CONTINUATION`; regex
       fallback ONLY when `routePlan` status is UNAVAILABLE; never double execute; consume only substitute
       clarification ids; API re-reads authoritative state before dispatch.
   - Reuse the existing continuation use case verbatim; no new save/preflight code.

6. **Telemetry.**
   - One bounded `line.substitute.route` decision log, emitted ONLY on the `primary` dispatch (never in
     `off`/`shadow`): message hash, route/status, confidence bucket, regex-match, open-state bucket,
     agreement, decision source. Here `agreement` is a by-product of the REAL primary decision — whether
     the narrow regex would have matched the semantic route on the same turn — NOT a shadow compare. No raw
     text/PII.

7. **Eval corpus.**
   - Extend the existing latency/operator corpus with ≥40 protected Thai/English cases + gate assertions
     (0 writes for questions/negatives/denied; protected negatives 100%; disagreement/regex telemetry).

8. **Tests + verification.**
   - Router/parser/prompt-contract, config, contracts parity, dispatcher write-behavior, corpus. Run
     router/dispatcher/continuation/config/contracts/corpus/API-LINE/Gateway suites + 4 typechecks +
     diff-check. Truthfully record offline provider-replay agreement / primary rollout as provider-evidence-blocked.

## Evidence-blocked (not code)

Offline provider-replay agreement ≥95% (measured by the operator-language replay, not by live shadow —
`shadow` is an inert off-equivalent NO-GO) and `primary`/canary need configured-provider + full-flow
evidence. This plan ships the CODE + default-off gate + telemetry to gather it; it does not enable `primary`.
