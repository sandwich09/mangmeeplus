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
6. **Document context (amendment 2026-09-05, `line-ai-draft-control-spec-th.md` §5.2).** `extractValueCandidates` takes `documentContext: 'receipt' | 'chat'`, defaulting to `'chat'`. In `'receipt'` mode a `D/M/YY` whose two leading parts are both ≤ 12 is read as day/month (with `orderAssumedDayMonth`, exactly as decision 3 already says) AND its two-digit era is resolved through the existing plausibility window — nearest today when the window leaves both readings, flagged `twoDigitYearResolvedPlausibleEra`. `'chat'` is byte-for-byte unchanged.
7. **A placeholder date is never silent (amendment 2026-09-05, §5.2).** `ExpenseRecord.expenseDate` is NOT NULL, so a receipt whose date could not be read still stores the upload day. That is allowed; presenting it as a reading is not. The apply service drops the draft to `aiVerificationStatus: NEEDS_REVIEW`, adds `expenseDate` to `missingFields` and returns a readable reason; the LINE card says "ยังไม่ระบุ — ใช้วันที่ส่งไว้ก่อน" with the words to correct it. A date that IS read but sits more than one day ahead of today or more than two years behind is reviewed as `วันที่ผิดปกติ`.

## Consequences

### Positive

- The wrong-digit/wrong-calendar hallucination class is blocked structurally, not by prompt hope; input and output guards become symmetric.
- Thai-first UX: clarifies and assumption notes read naturally (พ.ศ., Thai months); every auto-interpretation is auditable via recorded assumptions on drafts.
- Model work shrinks to what it is good at — picking which candidate is the amount/date — aligning with the no-keyword-list, guardrails-only owner rule.

### Why the receipt mode does not violate the 2026-08-28 chat decision

The 2026-08-28 owner decision ("7-6-69 could be 7 June or 6 July — leave it blank and let the user type it") is about **a person who is present and can be asked**. Its whole justification is that asking is cheap and cheaper than being confidently wrong. A printed receipt has nobody to ask: the OCR path deliberately does not clarify (decision 4's discovery step has no addressee there), so refusing to read the date does not produce a question — it produces a record with today's date and no explanation, which is the exact failure the decision was meant to prevent. The receipt mode therefore keeps every guarantee the chat rule provides — the assumption is recorded, the record is `NEEDS_REVIEW`, the reviewer sees the flag — and only removes the outcome that helps nobody. Chat text keeps the 2026-08-28 rule unchanged, and a regression test asserts chat and receipt readings differ on `03/09/69`.

### Trade-offs

- D/M + พ.ศ. defaults can mis-read genuinely MM/DD or CE foreign documents — accepted by owner; assumptions are recorded and the NEEDS_REVIEW/human-review path catches them.
- Receipt mode reads a date a person could not have been asked about. Its answer is always assumption-flagged and NEEDS_REVIEW, and the sanity window above catches a reading that lands in the wrong decade.
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
