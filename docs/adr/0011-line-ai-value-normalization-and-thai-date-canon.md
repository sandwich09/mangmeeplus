# ADR 0011: LINE AI Value Normalization and Thai Date Canon (วัน/เดือน/ปี พ.ศ.)

## Status

Accepted (owner decision 2026-07-07)

## Context

Users write money and dates in mixed Thai forms: "บันทึกเงินหกสิบบาท", "บิล ๖๐", "bill sixty $B", "9/12/2537" (พ.ศ.), "09/11/1994" (order ambiguous), "วันที่เก้า เดือน11ปี2537". When the model converts these itself, a wrong digit or a wrong calendar lands in an expense draft or a tool date range — a hallucination class with direct money impact.

The repo already solves the mirror problem on the output side: `response-composer.agent.ts` enforces that every number in a composed answer is derivable from tool data or the question. The input side has no such guard: `parseIntakePlan` validates shape only. A standing owner rule (15A decisions, 2026-07-06) also forbids deterministic keyword lists for semantics while allowing deterministic code as execution guardrails — value verification is exactly a guardrail.

## Decision

1. Deterministic value normalizer (pure logic in apps/api) annotates each turn with candidates — amounts (Thai digits ๐-๙, Thai/English number words, currency tokens) and dates (every valid reading) — as data attached to the request. The user's text is never rewritten.
2. The model selects from candidates; it never converts numerals or calendars. Prompts state this; membership guards enforce it on input (capture `amount`/`expenseDate`, explicit loop `fromDate`/`toDate`) and the existing output number guard gains candidate values.
3. Canonical date convention for this channel is day/month/year with Buddhist-era year (วัน/เดือน/ปี พ.ศ.) — the interpretation default and the display form for clarify/assumption text (rendered with Thai month names, e.g. "9 ธ.ค. 2537"). Deterministic disambiguation runs in order: explicit slot labels / month names / day > 12 lock the reading; year ≥ 2400 → พ.ศ., a year implausible as พ.ศ. → ค.ศ. (assumption recorded); remaining positional ambiguity defaults to day/month (assumption recorded).
4. Discovery policy (money and dates alike): unambiguous → auto with recorded assumptions; materially ambiguous (2-digit years, multiple surviving readings, implausible-for-context dates) → ONE bounded clarify naming the concrete choices; unmappable → value dropped to `missingFields` + NEEDS_REVIEW. Never guess.
5. Wire and storage formats do not change: tools and Prisma keep ISO-8601 CE (`YYYY-MM-DD`); exactly one tested BE↔CE/ISO conversion helper crosses the boundary.

## Consequences

### Positive

- The wrong-digit/wrong-calendar hallucination class is blocked structurally, not by prompt hope; input and output guards become symmetric.
- Thai-first UX: clarifies and assumption notes read naturally (พ.ศ., Thai months); every auto-interpretation is auditable via recorded assumptions on drafts.
- Model work shrinks to what it is good at — picking which candidate is the amount/date — aligning with the no-keyword-list, guardrails-only owner rule.

### Trade-offs

- D/M + พ.ศ. defaults can mis-read genuinely MM/DD or CE foreign documents — accepted by owner; assumptions are recorded and the NEEDS_REVIEW/human-review path catches them.
- The normalizer grammar (Thai number words, currency tokens) needs maintenance as new wordings appear — bounded by golden tests; unknown tokens degrade safely to review, never to guesses.
- Image-sourced values cannot be verified against pixels — mitigated by cross-checking capture hints against normalizer output over the OCR text.

## Alternatives Considered

### Prompt-only instruction ("convert Thai numerals carefully")

Rejected: unverifiable, silently fails, and leaves the model as the last authority on digits.

### Full deterministic parsing including meaning (regex the amount/date out of the sentence)

Rejected: violates the owner's no-deterministic-semantics rule and breaks on unseen wordings; choosing which number is "the amount" is a semantic judgment.

### Rewriting the message text to normalized form before the model

Rejected: lossy and audit-hostile; the original wording is evidence and must reach the model and the audit trail intact.

## Implementation Notes

- Normalizer: `apps/api/src/modules/line-ai/domain/logic/thai-value-normalizer.logic.ts` (pure, injected clock); candidates travel via `LineAiValueCandidates` on turn/intake contracts. See [[plans/line-ai-multi-intent-completion-plan|10F plan]] Phase 1.
- Guards live where validation already lives: `parseIntakePlan`, orchestrator `sanitizeToolInput`, composer allowed-number set.

## Test Requirements

- Golden normalizer table covering the six motivating utterances plus 2-digit-year and labeled-slot forms; span-reconstruction property test; guard strip/pass paths; clarify wording names concrete choices; BE↔CE helper round-trip.

## Follow-up Questions

- Whether quickReply buttons should render date clarify choices (10F plan Phase 4, owner UX taste).
