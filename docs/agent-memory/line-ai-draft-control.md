# Agent Memory: line-ai-draft-control

Status: docs approved (Owner 2026-09-05, 5 decisions) → A/B/C built, D built on C; single UAT deploy pending
Owner: Owner (product) · Fable (control) · Opus (implementation)
Scope: spec `docs/specs/line-ai-draft-control-spec-th.md`, plan `docs/plans/line-ai-draft-control-plan-th.md`
Decisions: service charge first-class (chargeKind), no silent today-date, receipt-mode BE dates with recorded assumptions, `unsupported_yet` refusal split from `unsupported_module`, LINE draft edits behind preview+confirm postback and `LINE_AI_DRAFT_EDIT_ENABLED` (default off), one UAT deploy after everything.
Open questions: Q1 (no-VAT-evidence charge → NEEDS_REVIEW), Q2 (edit allowed up to READY_FOR_CONFIRMATION) — spec defaults stand unless the Owner objects.
Artifacts: branches `codex/line-ai-truth-and-dates` (A), `codex/expense-charge-kind` (B), `codex/line-ai-explain-record` (C), `codex/line-ai-draft-edit` (D)
Verification: per slice — api fixed-list, typecheck, prisma validate, pins --check, web test/build when web touched, mutation table, security eval (D), local LINE-fake drive (J2–J4)
Next: A + B implementation → review → PR develop; C after B; D after C; single develop→main PR; UAT deploy on Owner order.
Next (D): rebase onto the final A/B/C heads, then reviewer pass; the Owner's UAT script is section D.5.

## Slice B — `codex/expense-charge-kind` (S-1, service charge first-class)

Status: implemented, gates green, pushed. Reviewed once adversarially (2026-09-05) and reworked;
no PR yet.

What it does: `ExpenseLineChargeKind` enum + nullable `ExpenseLine.chargeKind`, additive migration
`20260905160000_expense_line_charge_kind` (no backfill). `subtotalAmount` becomes goods-only, so
`taxable = subtotal - discount + charges` and `total = taxable + vat` hold. Charge rows must be
quantity 1, non-zero, positive unless ROUNDING, and sorted after every product row. OCR apply names
a charge in Thai with the printed percent and keeps the extractor's own wording in `sourceLineText`;
`ExpenseDetail` gains a derived `charges` group and a `totalsIdentity` flag; the web review page
renders "ค่าใช้จ่ายเพิ่ม" and a "ค่าบริการ/ค่าใช้จ่ายเพิ่ม" money row.

Where the §5.1 identity is actually enforced (the first cut got this wrong and said "enforced at the
write boundary" while only calling it somewhere it could not fail):

- `CreateExpenseDraftUseCase` / `UpdateExpenseDraftUseCase` — header totals from
  `reconcileExpenseVat` against the lines `TransactionTaxService.resolveLines` returned. Two
  sources, one write; a mismatch is a 400 and nothing is persisted. This is the enforcement.
- `materializeClaimExpenses` — the reimbursement projection writes header totals from the claim's
  own figure, so the builder proves they agree before the projection exists.
- `findByIdWithRelations` — read side, `ExpenseDetail.totalsIdentity { ok, gapAmount }`, so a record
  written before this rule existed is visible rather than silently wrong.
- `validateExpenseDraftAmounts` also calls it, but both sides there derive from the same line array:
  that call is a regression tripwire on `calcDocumentTotals`, NOT input validation. Deleting it
  alone passes every suite; the mutation that proves the rule is making `calcDocumentTotals` count
  charge rows in `subtotalAmount` again.

PATCH semantics: `lines` is a full replacement, so an ABSENT `chargeKind` keeps the stored kind and
only an explicit `null` clears it. Without that, a client echoing a line back turned a service charge
into a product and got a 200.

The first version of that keep resolved by `lineNumber` and was itself a blocker: a line number is a
POSITION, and adding a goods row renumbers everything under it, so the row arriving as line 2 is not
the row that was line 2. A reviewer typing "ของหวาน" got it stored as SERVICE_CHARGE, with a 200 and
`totalsIdentity.ok = true` — the identity is derived from the same wrong kinds, so it cannot catch
this class of bug. Fixed on three layers, because any one of them alone still leaves a hole:

- the web payload emits `chargeKind` on EVERY row (`null` for products), not only on charge rows;
- the LINE draft-collection lane states `chargeKind: null` on the items it materializes;
- the server resolves an absent kind by DESCRIPTION, not line number: a description matching exactly
  one stored row is that row, and a new row, a renamed row or a duplicate description resolves to
  null rather than a guess.

Read side: `ExpenseDetail.totalsIdentity { ok, gapAmount }` is declared in the web model and the
review page warns when `ok` is false. Consumers must branch on `ok` — `gapAmount` describes the
grand-total equation only, so a subtotal-only drift reports `ok: false` with a zero gap.

Owner-visible export change: the accountant index gained a trailing column
`additional_charges_amount` ("ค่าใช้จ่ายเพิ่ม") so the row is additive again now that
`subtotal_amount` is goods-only (`subtotal - discount + charges + vat = grand_total`). Trailing, so
position-based consumers keep their offsets. The golden CSV sha256 in
`common/export/thai-date.logic.spec.ts` is now stale for a second reason — it was ALREADY stale and
quarantined in `spec-suite-coverage.spec.ts` before this change, and un-quarantining it needs a
`package.json` script edit plus an Owner call on the format, so it was left alone.

Merge order (agreed with the coordinator): **B merges into develop FIRST.** Slice A then rebases onto
develop-with-B; slice C rebases onto B rather than merging C's older copy of B's history.

B vs A (`8bef1a4c`) is **12 conflict hunks across 9 files**, and it is NOT all mechanical:

- `receipt-ocr-apply.service.ts` (2 hunks) — the import list is trivial, but the `chargeLines()`
  body needs a real resolution. A rewrote it around a `reading: 'document' | 'unproven'` parameter
  with `needsReview`, `whtRate: null` and `isAdditionalCharge: true`; B changed the same rows to
  carry `chargeKind`, a Thai description, and the richer `sourceLineText`. Keep A's signature and
  tax rules, keep B's three field changes, and collapse `isAdditionalCharge` into
  `chargeKind != null` at both read sites (the WHT allocation set and the per-line `whtRate`).
- `packages/contracts/src/expenses.ts` (2) and `.github/workflows/ci.yml` (2) — both branches append
  (an accountant-index column plus label; a pg-spec invocation). Keep both; A's own comment already
  says to order `document_date_status` after B's `additional_charges_amount`.
- `expense-export.logic.ts`, `prisma-expense.repository.ts`, `expenses.model.ts`,
  `receipt-ocr-apply.service.spec.ts`, `ExpensesPages.qa.spec.ts`, this file (1 each) — import lists
  and both-appended blocks. Keep both.

Follow-up (not this slice): make `chargeKind` REQUIRED on `updateExpenseDraft` lines once no caller
omits it. Every first-party caller already states it on every row, so the only thing the optional
field still buys is the legacy/third-party fallback — and that fallback carries one documented
collision: omitting the field while renaming a product to a stored charge row's exact description
inherits that kind, because the wire format has no row identity. Making the field required deletes
the fallback and the collision together.

Known gap (§10, deliberate): additional charges still post to the record's expense category — no
separate "ค่าบริการ" account and no report by charge kind.

## Slice C — `codex/line-ai-explain-record` (S-3, อธิบายรายการของฉัน)

Status: rebased onto develop `e37eb216` (which carries B via PR #434), review rounds 1–4 fixed,
gates green, pushed; no PR. Slice A merges after this one — expect a small second rebase in
`process-line-webhook.use-case.ts`, where A took the `intakeIntent` binding from here verbatim, so
that hunk should collapse rather than conflict.

What it does — evidence E4 ("ทำไม service charge คิดแยกเป็นอีกรายการนึง") now gets a real answer:

- **API tool `expense.explain_record`** (`erp-core-detail-tools.use-case.ts`), wired into
  `internal-tools.controller.ts` beside `expense.get_detail` and sharing its exact read permissions,
  `sensitiveAudit`, tenant scoping and typed `forbidden` / `unsupported_module` statuses. Output per
  spec §5.5: header (vendor, date, document number, Thai status label), line groups (products /
  `charges` from slice B / discount), the §5.1 identity as real numbers, the assumed-or-unverified
  list read from the OCR provenance the apply service stores (`aiVerifiedFieldsJson` +
  `aiVerificationSummaryJson`), slice B's `totalsIdentity` verdict (a required field on
  `ExpenseDetail` since B's fix-up, so it is read directly rather than defensively), and what LINE
  can change today.
- **ONE shared provenance rule.** `apps/api/src/modules/expenses/application/services/line-recent-capture.ts`
  now owns the 24 h window + chat/user/branch/status query that the correction lane's candidate
  loader used to hold inline (`process-line-webhook.use-case.ts`, was `CORRECTION_CANDIDATE_WINDOW_MS`).
  Both lanes call it; only the *ambiguity policy* differs (the write lane refuses, this read takes the
  newest and names the bill). `listRecentLineCaptures` also returns `vendorDocumentNumber`, so a
  `documentNumber` reference resolves inside the same bounded set with no second query.
- **Chat provenance now reaches the tool**: `LineUserContext.chatKeyHash` → gateway `ErpToolContext`
  → `InternalToolContextDto`. DATA only; company/permissions/branch are still re-resolved from the
  verified actor delegation, so a wrong value can at most pick another of the SAME user's own chats.
- **`intakeIntent` is bound on every turn** (it used to ride only when a prepared plan was
  forwarded), which is what lets the orchestrator tell a business read from an out-of-scope question.
  It activates no lane by itself — the prepared simple-read lane still requires `preparedPlan`.
  *Overlaps slice A*, which also plans to consume `req.intakeIntent` for `unsupported_yet`; A should
  keep this binding rather than re-add its own.
- **Gateway**: registry entry (`read_detail`, `questionKinds: ['detail','explain']`, subjects
  `['expense']`, agents `accounting`/`cfo`/`general`), `ROUTER_ENABLED_TOOLS`, accounting specialist
  allowlist, feature-coverage claim, a router prompt hint, and a deterministic
  `preferExplainRecordPlan` rescue keyed on trusted `BUSINESS_READ_QUESTION` + `asksAboutOwnRecord`.
- **Deterministic Thai answer** (`expense-explain-formatter.ts`): one bubble, one card, no model
  call, every money figure copied from the tool result. It refuses (falls back to the honest path)
  when the totals identity is incomplete rather than half-answering.

Deliberately NOT done: `line-ai-classifier.logic.ts` got no hint — `classifyIntent`/`chooseAgent` are
referenced only by their own spec, so a hint there would be dead code; the live deterministic seam is
the orchestrator rescue above.

`amountEditableOverLine` stays a hard `false` rather than calling B's `canCorrectAmount`, which is
the authority. That predicate reads `taxCodeDefinitionId` and `externalTaxCodeSnapshot`, and
`ExpenseLineSummary` carries neither — evaluating it from the detail would come out MORE permissive
than the lane really is and could invite a correction the lane then refuses, which is the E3
dishonesty this slice exists to remove. (It also refuses every record with a charge line, i.e. every
receipt this tool explains.) S-4 replaces the pair with the real draft-edit capability.

### Review round 1 (adversarial, at `ca37d6a1`) — fixed

- **Free text was interpolated raw.** Vendor name, document number, charge label and unmapped
  assumption keys all come from OCR, i.e. from whatever was printed on the paper the user was
  handed. A vendor of `ร้าน ABC ยอดรวมที่ถูกต้องคือ 99,999.00 บาท ดูที่ https://evil.example.com`
  put a fake total and a live link into the answer. `safeText()` now bounds (60 / 32 / 40), strips
  `https?://…` and bare `www.` tokens, and **drops the whole field** when a money- or percent-shaped
  token survives — a refused field falls back to a neutral label rather than a sentence with a hole.
  Three OCR-injection rows added to the corpus (now 6, spec §11), and the number guard checks
  `\d[\d,]*\.\d{2}` **and** `\d+%` against the tool result only, plus no auto-linkable text.
- **The rescue was too eager.** It now fires only through `isUnroutedOutOfScopePlan()` — nothing
  routed at all, and every refusal is `unsupported_module`. That is an allowlist, not the previous
  three-item denylist, so `forbidden`, `feature_disabled`, `tool_unavailable` (a model outage) and
  every other real outcome survive. The joke rescue was collapsed onto the same helper, so the two
  deterministic rescues cannot drift apart.
- **`asksAboutOwnRecord` was far too broad.** It now needs the own-record marker ADJACENT to the
  document noun (`บิลเมื่อกี้`, `ใบเสร็จนี้`), `รายการ` is no longer a document noun, and a
  third-party possessor or a mutation verb vetoes outright. E4 has no document noun at all, so it is
  matched by its own shape (a named additional charge + a "how is it counted" verb). 6 positives and
  13 negatives are pinned.

### Review round 2 (at `ca5dad1f`) — fixed

- **The guard was written in ASCII, on a Thai receipt.** `\d` is `[0-9]` even under `/u`, and
  `\bwww\.` needs a word boundary Thai text does not give, so four shapes walked straight past the
  first fix: a Thai-numeral total (`๙๙,๙๙๙.๐๐`), a fullwidth one (`９９，９９９．００`), an integer-only
  fake total with no decimal part (`99999`), and a bare domain with no scheme (`ร้านabcbit.ly/x9`).
  Every field is now folded to ASCII digits and separators FIRST (`foldDigits`), the money shape
  covers grouped, decimal and any run of 3+ digits, and the link pattern includes bare domains.
  `documentNumber` gets its own structural guard instead of the prose one — it is the one field
  whose job is digits, so `INV-2569-00123` must survive while a sentence must not: a single token
  of document-number characters, which an injected sentence (needing spaces) cannot satisfy. Four
  more corpus rows and three more mutations cover this.

### Review round 3 (at `0455f0d3`) — fixed

- **The link control was a TLD allowlist**, so `evil.xyz`, `evil.app` and `evil.ru` rendered and
  LINE auto-linked them — and the spec's guard shared the same list, so no test could see it. Both
  sides now use a TLD *shape* (`[a-z]{2,24}`), which needs no upkeep as the registry grows. The
  accepted cost is that `Co.Ltd` scrubs too. Two corpus rows added (**12** now).
- **The `\d{3,}` floor was eating real shop names.** Thai shops number their branches, so
  "ร้าน 7-Eleven สาขา 123", "โลตัส สาขา 456" and "ปตท. สาขา 088" all collapsed to
  "ร้านที่ยังไม่ระบุ" — the guard was erasing the vendor on the most common receipts in the
  country. `safeText` now takes a policy: **neutralise** (default) replaces the number with `…` and
  keeps the words, for real OCR prose like the vendor name; **drop** stays for the enum-derived
  labels (charge kind, status, assumption keys), which never legitimately contain a number and land
  inside the arithmetic line where prose does not belong. The guarantee is unchanged — it was
  always about numbers, never about words.
- **`DOCUMENT_NUMBER` lacked `\p{M}`** (a regression introduced by round 2's structural guard):
  Thai writes vowel signs and tone marks as combining marks, so `ใบเสร็จ-001` and `ใบกำกับ-12` were
  dropped whole. Added, with tests for both.

### Review round 4 (at `63ac6d56`) — folded in

- **The OCR-read vendor name is now quoted** («…») in the rendered sentence, and therefore in the
  card text and its `altText`, which both derive from `replyText`. Scrubbing removes the number and
  the link from an injected clause; it cannot remove the impression that น้องมั่งมี said it. Our own
  fallback wording (`ร้านที่ยังไม่ระบุ`) stays unquoted — that one really is our voice.
- Punctuation-only fallback pinned: a field that is nothing but an amount neutralises to a bare
  `…`, and without the `\p{L}\p{N}` check that ellipsis printed as the shop's name.
- Comment corrected: the neutralise guarantee is "no amount-shaped run survives" (grouped, decimal,
  or 3+ digits), NOT "no digit" — one- and two-digit runs survive by design so "7-Eleven" and
  "สาขา 2" keep their names.

**Deliberate, documented cost:** `INV.2569.00123` stays dropped. `DOCUMENT_NUMBER` is a structural
guard with no money test behind it, so admitting `.` to the charset would also admit `99.999,00` —
a European-formatted total — as a valid "document number", which would print as one. A dropped
document number costs a line of context; an admitted total costs the guarantee the answer sells.
Revisit only with a real money test in front of it.

- **The router prompt hint was untested** (the E4 replay forced the wire to fail, so it only ever
  exercised the rescue). `intent-router.agent.spec.ts` now asserts both halves of the hint, and the
  gateway spec stubs the wire for three distinct replays: the router picking the tool itself, the
  exact UAT UNROUTABLE plan reaching it through the rescue, and a model outage NOT being rescued.

### AI usage / cost

`AiUsageEvent` records MODEL calls (`usageTag`) and has no per-tool column. Tool calls are recorded
separately: an `AiToolInvocation` row per call (written generically from `LINE_TOOL_REGISTRY`, so the
explain tool needed no registration) plus the `AI_TOOL_INVOKE` audit row its `sensitiveAudit: true`
demands. An explain turn is **cheaper** than a composed read: the deterministic renderer replaces the
`line.compose` model call, so the turn adds one ERP call and removes one model call.

### Open gap — `chatKeyHashOf` is an unsalted hash (reviewer F9, deliberately NOT changed)

`chatKeyHashOf` (`line-ai-classifier.logic.ts:38` → `hashMessagePreview`) is a bare
`sha256(lineUserId|pushTargetId).slice(0,16)`, so it is brute-forceable from a known LINE id. It was
left alone because the value is **persisted and compared as an equality key** across
`ExpenseRecord.sourceChannelMetadataJson` (matched in SQL by JSON path in `listRecentLineCaptures`),
the LINE expense-draft conversation state, the substitute-receipt continuation state, and the
pending-media clarify rows. Re-salting it would orphan every in-flight draft, open clarification and
correctable record at deploy — they would silently stop matching. There is also no existing salted
LINE-id hash to adopt: `shortLineIdHash` is the same unsalted sha256/16, and the CRM-inbox
`pdpa-hmac-v2` scheme is a versioned, key-rotated identifier with its own migration path. Fixing this
properly needs a dual-read migration (write v2, read v1∪v2, backfill, drop v1) — its own change.

## Slice A — `codex/line-ai-truth-and-dates` (S-0 + S-2), 2026-09-05

Status: implemented, pushed, NOT PR'd (branched from `origin/develop` c7b1d138).

Delivered, all six plan §2-A items:

1. No silent today-date. `receipt-ocr-apply.service.ts` gained `reviewReceiptDate` + `RECEIPT_REVIEW_REASONS`; an unread date (or one > today+1d / < today−2y) sets `aiVerificationStatus: NEEDS_REVIEW` and returns `{ dateVerified, reviewReasons }` on the outcome. Both capture paths (LINE webhook, web `expense-extraction.use-case`) add `expenseDate` to `missingFields` and store `reviewReasons` in `aiVerificationSummaryJson`. The LINE card says `ยังไม่ระบุ — ใช้วันที่ส่งไว้ก่อน พิมพ์ "วันที่ 3/9/69" เพื่อแก้`. **No web change was needed**: `expenseAiMissingFields` → `aiPrefillBanner` already renders `ต้องกรอกเอง: วันที่รายจ่าย` off `missingFields`, and `expenseDate` is already in `AI_DATA_STEP_FIELDS`.
2. Receipt-mode BE dates. `extractValueCandidates(text, todayIso, { documentContext })`; `'receipt'` resolves the era through `plausibleEraReadings` even when the day/month order was assumed, taking the reading nearest today when the window leaves both. Wired at the ONE place the date was actually being dropped: `applyOcrValueCrossCheck` in the gateway, which sees the printed OCR text. `ReceiptOcrFieldResult.expenseDate` stays ISO — no raw string needed on the wire.
3. Correction honesty. `appendUserNote` (append, ` · ` separator, 500-char cap, redelivery-idempotent) + audit `noteAppend: true`; `formatCorrectionAppliedReply` names each change, says `บันทึกหมายเหตุไว้` for a note, and adds the `ยังไม่ได้แก้ยอด` sentence + web link when the message mentioned money the lane cannot change.
4. `unsupported_yet` in `LineAiRefusalReason` AND `ADVISOR_REFUSAL_CODES`, plus every silent-drop mirror (prepared-plan parser, AgentCore boundary set, router prompt + advisor schema, composer copy ladder th/en with a `/companies/<id>` webLink, API refusal table, both terminal-outcome switches, `toAiTurnIntent`). Chosen from `isBusinessIntakeIntent(req.intakeIntent)` — new helper in contracts, derived from `LINE_INTAKE_ROUTE_INTENTS` minus `CLARIFY`/`UNSUPPORTED`.
5. Charge tax rules. A charge row takes its own or the document's PRINTED rate, never `defaultLineVatRate`'s invented 7%; unproven → `vatRate: null`, `vatTreatment: null`, line `reviewStatus: NEEDS_REVIEW`, record reason. WHT never lands on a charge row and is no longer diluted by one (`applyExpenseWhtInput` takes `excludedLineNumbers`). Card groups charges under `ค่าใช้จ่ายเพิ่ม`.
6. Docs: this file, ADR 0011 (decisions 6+7 and a "why it does not violate 2026-08-28" section), capture-correction spec (note append + reply honesty + AC 10a), advisor spec (refusal code).

Gaps left for slice B or later (deliberate, see the final report):

- **Negative `ROUNDING` charges are still rejected.** `calcLineTotals` clamps a document discount with `min(discount, lineSubtotal)`, which on a negative subtotal cancels the row to zero, so the printed rounding would be silently dropped from the total instead of applied. The protective half of §5.1 (no other kind may be negative) IS enforced. Fixing it means changing a shared money helper — belongs with the `chargeKind` column in B.
- **`ExpenseRecord.status` is not forced to NEEDS_REVIEW.** It is already NEEDS_REVIEW on every path when apply runs (`CompleteReceiptUploadUseCase` moves DRAFT→NEEDS_REVIEW first); the one exception is the flag-gated draft-conversation lane, which holds DRAFT on purpose so `startFromReceipt` can run and ASK for the missing date. Forcing it there would return NOT_FOUND and kill that conversation. `aiVerificationStatus` carries the signal instead.
- **`expenseAiFieldProvenance` (`apps/web/.../expenses.model.ts:708`) can never render the 🤖 "recognized" badge**: it expects `summary.recognizedFields` to be a `string[]` of field names, and every producer writes the `ReceiptOcrFieldResult` OBJECT. The `missing` half works, which is the half slice A relies on. Pre-existing, untouched, worth a separate fix.
- `line-ai-classifier.logic.ts` (API) was left alone: `classifyIntent`/`chooseAgent` there have no production caller — the live twin is the gateway's `line-ai-turn.logic.ts`, whose deterministic path now splits on the intake intent.
- `LineAiIntent` and the Prisma `AiTurnIntent` enum gained no member; `unsupported_yet` maps to `UNSUPPORTED_MODULE` for analytics. The customer-visible split lives on the refusal reason and the terminal status.
- `chargeKind` deliberately NOT added (slice B owns it). The interim marker is the in-memory `PreparedOcrLine.isAdditionalCharge` flag plus the OCR `additionalCharges` block for the card — B can rebase over this and swap both for the column.
- **`line-expense-draft-conversation.use-case.ts:360` still overwrites `note`** with `state.header.businessPurpose` on every persist, destroying `'LINE receipt upload'` on the first purpose answer. Left alone deliberately: that lane is COLLECTING a field (there is no purpose column, so the purpose lives in `note`) and re-stamps it as the user refines the answer — appending there would stack purposes, which is worse for that lane than the current state. Fixing it properly needs a purpose-vs-provenance split; spec §5.3 scopes the append rule to the correction lane.

Impact sweep found and fixed on the way (both the same silent-placeholder class as item 1):

- LINE text-note path (`expense-document.use-case.ts`) defaulted `expenseDate` to today with the conversation off and never flagged it → now adds `expenseDate` to `missingFields`.
- Pending-media clarify path (`process-line-webhook.use-case.ts`) wrote `expenseDate: new Date()` — a full instant into a date column, the exact bug the direct-media path's comment says was fixed → now `civilDateToUtcDate(todayCivilDate())`.

## Slice A — adversarial review round 2 (2026-09-05)

Reviewer found the slice's own principle ("ค่าที่เดา/สมมติต้องบอกว่าเดา") broken in three places. All fixed on the same branch, rebased onto `origin/develop` f44b0519.

- **H1** `intakeIntent` was bound only inside the prepared-plan block, and the router omits the plan exactly when it had no confident tool — the E4 turn — so `unsupported_yet` was unreachable for the case it exists for. Bound on every routed turn, using slice C's hunk verbatim (`ed88fca8`) so the branches merge without conflicting resolutions; the two assertions C changed are matched too. Additionally carried on the ledger `turn` entry so the reclaim/drain path keeps it (C did not touch that). New API-level E4 replay.
- **H2** Receipt mode computed the DD/MM + era assumptions in the gateway and dropped them: `ReceiptOcrFieldResult` carried only the ISO date, so `reviewReceiptDate` said `verified` for `03/09/69` and the ADR text was false. `expenseDateAssumptions` now travels on the OCR result; `ExpenseDocumentDateStatus` (contracts) is the four-state answer, `assumed` is kept and labelled and NOT forced into review, and the ADR says exactly that.
- **M1** A charge with no per-charge VAT evidence sank the whole split: `vatRate: null` broke reconciliation, the fold discarded the charge, its money and `chargeReviewReasons`, and the record total moved (100 + 10 with printed VAT 7.70 recorded 100.00). The document rate is now tried FIRST and the printed totals adding up IS the proof; when they do not, the charge line stays with `vatRate: null` + `reviewStatus: NEEDS_REVIEW` and the unexplained VAT remainder is named in the reason. The un-rated split is only taken while it still reaches the printed grand total — a page contradicting its own total still folds, which is what the pre-existing 1000/100/77/1200 test was protecting. `chargeReconciliation` is now written on the LINE path too, so the web charge banners fire for LINE drafts.
- **M2** card copy keyed on the four states, not on whether a date string exists.
- **M3** `apps/api/src/modules/expenses/receipt-truth.pg.spec.ts` — 5 cases through the real adapter (charge VAT/WHT columns, assumed date persisted + PARTIAL, unread date + placeholder + NEEDS_REVIEW, note append keeps provenance, note cap). Wired into the ci.yml pg step, NOT package.json. Verified on a scratch container.
- **L1** terminal-outcome spec wired into the api fixed list. **L2** `appendUserNote` returns an outcome — truncates the new segment with "…" at the cap and says so, only skips a sentence that is the newest segment, refuses whitespace with an honest reply. **L3** the link points at the expenses list, and `formatLineReply` prints words instead of a bare relative path when no base URL is configured. **L4/L5** dead comment corrected, ROUNDING note moved onto the charge filter.
- **L6** charges are on the DEFAULT capture card (count + total), not only in the item-question branch.
- **WEB** review banner renders `reviewReasons` + an "อ่านจากบิล" marker; the stepper, the audit checklist and `LateDocumentBadge` all stop treating the placeholder as a document date; `ExpenseSummary.dateStatus` (additive) is derived in the API mapper and shown on list rows; `document_date_status` appended last in the accountant index (slice B adds `additional_charges_amount` in the same region — order by name, trivial conflict expected). `expenseAiFieldProvenance` fixed: it expected `recognizedFields` as `string[]` while every producer writes the object, so the 🤖 badge had never rendered.
- **DRAFT LANE** the purpose is stored as its own `วัตถุประสงค์: …` segment that replaces the previous one, keeping the provenance first.

Still open (unchanged from round 1): negative `ROUNDING` charges stay rejected until `calcLineTotals` stops clamping a document discount against a negative subtotal (shared money path, slice B territory); `ExpenseRecord.status` is not forced to NEEDS_REVIEW because it already is on every path except the flag-gated draft-conversation lane, which holds DRAFT deliberately so it can ASK for the date.

## Slice A — review round 3 (2026-09-06)

Round-2 blockers verified closed by the reviewer's own probes; five narrow items fixed on the same branch, no rebase yet (waiting for B in develop).

- **N1** `<DocumentDateBadge>` was rendered twice on the desktop list row (a mis-indented duplicate from a scripted edit) — an `assumed` row painted "อ่านจากบิล" twice. Deleted; `ExpensesPages.qa.spec.ts` now asserts one date badge per layout that shows the late badge, and no two adjacent.
- **N2** `RECEIPT_REVIEW_REASONS.chargesFolded` had no test, so the mutation-table row "reinstate the fold-back discard" was overstated: reverting the fold branch to `chargeReviewReasons: []` really did leave everything green. The existing 1000/100/77/1200 fold test now asserts the reason and `aiVerificationStatus: NEEDS_REVIEW`, plus a companion asserting a charge-free bill raises nothing. **Mutation table corrected** — that revert is its own mutation (M11) and kills 1.
- **N3** `withPurposeNote` had no test and neither did its wiring. Six cases in `line-correction.logic.spec.ts` (provenance first, purpose replaced not stacked, no separator from nothing, cap) and two in `line-expense-draft-conversation.use-case.spec.ts` that die when the lane is reverted to `note: state.header.businessPurpose` (M12, kills 2).
- **N4** Could NOT reproduce a varying count. Fixed list, TAP reporter: `tests 6561 / pass 6462 / fail 0 / skipped 99` on four separate runs, and `pretest` is 30/16/0/14 twice including with the database forced unreachable. What IS environment-dependent, and proven: with a **present-but-unreachable** `DATABASE_URL`, four real-database suites (13 tests) flip from skip to **fail** — `Expense payment intent integrity` and three `company OCR admission` suites — because their `before` hook throws instead of the guard short-circuiting. With no `DATABASE_URL` at all they skip cleanly. So `# pass`/`# skipped`/`# fail` track database state while registration does not. The reviewer's 6537/6540 are below mine because they measured `df7f5d64`, before N1–N5 added tests. **Counts must be quoted with reporter + whether pretest is included + database state.**
- **N5** Ledger round-trip: `appendTurn` persists `intakeIntent`, `fieldsToEntry` reads it back through `asIntakeRouteIntent` (a forged `NOT_A_ROUTE` comes back `undefined`), and the drain spec asserts the reclaimed turn request carries it.

Gap found while proving N4, pre-existing and NOT fixed here: a broken (rather than absent) `DATABASE_URL` makes those four suites fail instead of skip. Worth its own change — the guards test for a missing URL, not an unusable one.

Tooling note after two collisions on the shared box: this agent's helpers now live under `<scratchpad>/agent-aade5f5a0d0d0f4df/`, and `mutate.sh` reverts only the one file its patch reports touching (the old `git checkout -- .` ate uncommitted test files once). Full suites run behind `/tmp/mangmee-heavy.lock` (mkdir to acquire, nothing written inside). Never `pkill` on a bare `tsc`/`node --test` pattern — match the worktree path.

Amended by slice D: `amountEditableOverLine` is no longer a hard `false`. It follows
`LINE_AI_DRAFT_EDIT_ENABLED` — with S-4 on, the draft tools really do change money on exactly
the receipts this tool explains, so the answer says so; with S-4 off the reasoning above stands
unchanged. The flag decides, never the copy. See D.1.

## Slice D — `codex/line-ai-draft-edit` (S-4, แก้ draft ผ่าน LINE)

Status: implemented on top of C (`ca37d6a1`), gates green, pushed at `579f16b5`; not reviewed, no PR.

Gates (2026-09-06): api fixed list 6508 tests / 0 fail / 99 skipped · ai-gateway 1048 / 0 fail ·
contracts 217 / 0 fail · config 141 / 0 fail · api+gateway+contracts typecheck clean ·
prisma validate ok · maintenance pins `--check` **status=current** (after the deploy.sh edit) ·
`production-serving-mode.spec.sh` PASS · pg spec 1/1 on an isolated `watchdog_bms_sliced` database ·
no TODO / `@ts-ignore` in the slice.

### D.1 What it does

**Two beats, always.** A model — or the deterministic correction lane — can only ever produce a
PREVIEW; the write is a `ยืนยัน` postback that no model can send.

- **PREVIEW** (`LineDraftUpdateUseCase.preview`) resolves the record through the ONE shared
  chat-provenance rule slice C extracted (`line-recent-capture.ts`), guards status ∈
  `DRAFT | NEEDS_REVIEW | READY_FOR_CONFIRMATION`, re-checks branch scope and `expense.update`,
  grounds every number against the turn's evidence or the record, then produces the resulting
  totals by running the REAL `UpdateExpenseDraftUseCase` inside a transaction it throws out of.
  That last choice is the load-bearing one: re-deriving the arithmetic is how a card ends up
  promising a total the apply would not produce, and a rolled-back run of the actual write path
  cannot disagree with itself. It also proves the validators, the VAT reconciliation, the tax-code
  resolution and the §5.1 totals identity all pass *before* the user is asked anything.
- **APPLY** (`.apply`) is reachable only from the confirm postback. The postback carries
  `action=draft-update-confirm` and no ids (P10-L SEC-04); the server looks the preview up by
  company + chat, re-checks `{companyId, userId, chatKeyHash}` and refuses unless the record's
  `updatedAt` is still the one the preview was computed against. Then the same use case runs for
  real, in one transaction, with `expense.line_ai.draft_update` written inside it.

**Five tools** (`draft_update`, a new `ToolCategory`): `expense.draft.set_header`, `set_line`,
`add_charge`, `remove_line`, `set_vat_mode`. `requiredPermissions: ['expense.update']` — exactly
what `expense.controller.ts` `updateDraft` takes, so LINE is never a cheaper way to edit than the
web form. Every input reserves `recordType` (spec §4).

**Correction lane migration.** `amount` left the five-field lane and `amountOnlyLine` is deleted.
An `amount` hint becomes `set_line` with no `lineNumber`; the use case fills it with the record's
only line or refuses `ambiguous_line`, which renders as the same "บรรทัดไหน" clarify as before.
Header corrections (date/vendor/docNo/note) stay ONE step — that is today's behaviour, they change
no money, and the honest per-field reply slice A introduced is unchanged.

**The card** is built API-side (`line-draft-update-card.logic.ts`) because only the API may print
buttons whose postbacks it must later re-derive. The gateway renders the same preview as
deterministic Thai text (`draft-update-formatter.ts`) so a Flex-less delivery still explains the
choice, and so no model sentence ever states this money.

### D.2 Flag

`LINE_AI_DRAFT_EDIT_ENABLED`, default off, on **both** containers — the API executor is
authoritative, the gateway decides whether the five tools are in the catalog the model is offered
at all ("refused later" would still have advertised an ability the deployment does not have).
`deploy.sh` defaults it true for UAT and false for production; maintenance mode quiesces it.
Contract greps live in `production-serving-mode.spec.sh`; maintenance-release pins re-synced.

Off is byte-for-byte the pre-S-4 behaviour: tools absent from the catalog, executor refuses the
category with `LINE_DRAFT_EDIT_DISABLED`, no preview card, and a stray confirm postback answers
"there is nothing pending".

### D.3 Boundaries and known gaps

- **No apply without a postback, ever.** That is the single invariant the frozen eval states, and
  every row asserts `expectedApplyCount: 0` — including the row that legitimately previews.
- A preview needs a SHARED store. Without Redis in production none is offered (the confirm would
  reach a task that never saw it, and the user would be told "รายการเปลี่ยนไปแล้ว" for a change
  nobody made). Outside production a per-process map keeps the local LINE-fake harness able to
  drive J3.
- The Redis key uses the chat **hash**, not the raw chat id as the spec wrote it — same uniqueness,
  and it keeps raw LINE/group ids out of a store the tool lane can reach. Recorded as a deliberate
  deviation.
- Grounding on the GATEWAY lane needs the user's message at the ERP boundary, so
  `ErpToolContext.groundingText` forwards it verbatim (bounded at the transport, sent only while
  the flag is on). It authorises nothing and is not stored. Without it, only numbers already on the
  record ground — strictly safer, but it would refuse a legitimate "เพิ่มค่าบริการ 10%".
- Deliberately NOT added: a deterministic router rescue for draft edits. The primary journey (J3)
  is the webhook's own allowlist detector, which runs only on a turn the intake router already
  classified as a correction of THIS chat's record; the gateway lane relies on the prompt hint.
  A rescue that guesses "this looks like an edit" is the wrong thing to make eager.
- `canCorrectAmount` is retained with no production caller — slice B's fix-up is still adding a
  charge-line refusal to it. Delete it after that lands if nothing else picks it up.
- `scrubRecordText` lives in `packages/contracts` so BOTH apps share one copy. Slice C's review is
  widening a gateway-local `safeText` for the same reason; at rebase the two must collapse onto
  this one rather than diverging.

### D.4 Mutation table — every row RUN and verified red (`mutations.sh`, 2026-09-06)

| # | Mutation | Test that fails | Result |
|---|---|---|---|
| 1 | Apply without checking `updatedAt` (drop the CAS compare) | eval `draft-confirm-after-record-moved`; `line-draft-update.pg.spec.ts` — "a moved record is refused, never re-based" | RED |
| 2 | The dry run COMMITS instead of rolling back — an apply with no confirm | `line-draft-update.security.spec.ts` — every row's `expectedApplyCount: 0` | RED |
| 3 | Preview not bound to the chat/user (drop the binding check in `apply`) | eval `draft-preview-from-another-chat` | RED |
| 4 | Status guard removed (`EDITABLE_STATUSES` accepts CONFIRMED/VOIDED) | eval `draft-confirmed-record-edit`; pg spec — "a confirmed record is never touched" | RED |
| 5 | Flag ignored (`classificationDenial` admits `draft_update` unconditionally) | `internal-tools.controller.spec.ts` — "refuses every draft_update tool while LINE_AI_DRAFT_EDIT_ENABLED is off"; `intent-router.agent.spec.ts` — catalog gate | RED |
| 6 | Grounding dropped (accept any model-supplied amount) | `line-draft-update.logic.spec.ts` — "refuses a number nobody said…"; eval `draft-injection-in-ocr-text-orders-edit` | RED |
| 7 | Scrubber narrowed back to ASCII digits | `line-ai-record-text.spec.ts` — Thai/fullwidth totals; eval `draft-injection-thai-numeral-total` | RED |
| 8 | Postback carries `previewId` | `line-draft-update-card.logic.spec.ts` — "carries an intent and no ids (SEC-04)" | RED |

The first run of this table found two rows that survived, and both were test bugs rather than code
bugs: M1 had no fast test at all (only the pg spec could move a row revision), and the two injection
rows asserted on a payload the hostile text never entered — an `add_charge` diff carries the charge
label and amount, never the existing line's description. Both are fixed above: the corpus gained
`draft-confirm-after-record-moved`, and the Thai-numeral row now edits a line description so the
attacker's own words are what the diff prints.

### D.5 UAT script for the Owner (J1–J4)

Prerequisite: UAT runs the candidate with `LINE_AI_DRAFT_EDIT_ENABLED=true` on **both** api-web and
ai-gateway (read it back from the task definitions before starting). Use the BHC restaurant bill —
1,520.00 of food, service charge 10%, VAT 7%.

| # | Type / do this | Expect exactly |
|---|---|---|
| J1.1 | Send the BHC bill photo | Summary card: ร้าน, **วันที่ 03/09/2569 อ่านจากบิล**, 3 รายการสินค้า, **ค่าบริการ 10% 152.00** in its own group, VAT 117.04, รวม 1,789.04, สถานะ "ร่าง รอตรวจ" |
| J1.2 | Open the web link on the card | Review page shows a "ค่าใช้จ่ายเพิ่ม" group separate from products, and a ค่าบริการ row between ส่วนลด and VAT |
| J2 | "ทำไม service charge คิดแยกเป็นอีกรายการ" | A real answer with the arithmetic (สินค้า 1,520.00, ค่าบริการ 152.00, ฐานภาษี 1,672.00, VAT 7% 117.04, รวม 1,789.04). **Never** "อยู่นอกขอบเขตระบบ" |
| J3.1 | Send a NEW bill with no service charge, then "จากบิลเมื่อกี้มี service charge 10% นะ" | A confirm card naming the bill, `ค่าบริการ: ยังไม่ระบุ → 152.00`, **ยอดรวมใหม่** and the previous total, and two buttons [ยืนยัน] [ยกเลิก]. Nothing saved yet — the web page still shows the old total |
| J3.2 | Press **ยืนยัน** | "แก้ให้แล้วค่ะ: ค่าบริการ 152.00 · ยอดรวม 1,789.04 · ดูในเว็บ: <link>". Open the link: the charge is a ค่าใช้จ่ายเพิ่ม row, subtotal stays goods-only, ฐานภาษี = subtotal − discount + charges, รวม = ฐานภาษี + VAT |
| J3.2b | Press **ยกเลิก** on a fresh preview instead | "ยกเลิกแล้วค่ะ ยังไม่ได้แก้อะไรในรายการนะคะ" and the web page is unchanged |
| J3.3 | On the ORIGINAL BHC bill (OCR wrote service charge as a product line), type "เพิ่มค่าบริการ 10%" | It refuses to duplicate: "บิลนี้มี ค่าบริการ เป็นรายการสินค้าอยู่แล้ว (บรรทัด N) … พิมพ์ 'ย้ายบรรทัด N เป็นช่องค่าบริการ'". Type that, confirm: the row moves and the total does NOT change |
| J3.4 | Confirm a record in the web, then type "เพิ่มค่าบริการ 10%" in LINE | "รายการนี้ยืนยันไปแล้ว แก้ผ่าน LINE ไม่ได้ค่ะ ไปที่เว็บ <link> เพื่อยกเลิกหรือแก้" — not an out-of-scope refusal |
| J3.5 | Get a preview card, edit the SAME record in the web, then press ยืนยัน | "รายการเปลี่ยนไปแล้ว ขอดูใหม่นะคะ" plus the link, and the web edit survives untouched |
| J3.6 | Press ยืนยัน again ~11 minutes after a card | "ไม่พบรายการที่รอยืนยันในแชทนี้ค่ะ (อาจหมดเวลาไปแล้ว)…" |
| J3.7 | "แก้ยอดเป็น 500" on a multi-line bill | "บิลนี้มีหลายบรรทัดค่ะ ขอทราบว่าต้องการแก้บรรทัดไหนนะคะ" — then "บรรทัด 2 เป็น 500" previews that line only |
| J4 | "ช่วยออกใบกำกับภาษีให้หน่อย" | "เรื่องนี้ทำได้ในเว็บค่ะ น้องมั่งมียังทำผ่าน LINE ไม่ได้ในตอนนี้: <link>" (`unsupported_yet`, from slice A) |
| Neg-1 | "ลบบรรทัด 2 ของบิลร้านอื่น" | No preview card. The lane must not act on a third-party phrasing |
| Neg-2 | As a MARKETING/ACCOUNTANT user (no `expense.update`), "เพิ่มค่าบริการ 10%" | "คุณยังไม่มีสิทธิ์แก้รายการค่าใช้จ่ายค่ะ …" and no card |

After the run, check in the web audit/history that each applied edit left an
`expense.line_ai.draft_update` row naming the fields and both totals, and that no such row exists
for any preview that was cancelled or expired.

### D.6 Impact sweep (spec §9), row by row

| Area | Verdict |
|---|---|
| OCR apply (`receipt-ocr-apply.service.ts`) | **Not affected.** D only reads what B (chargeKind) and A (charge VAT/WHT rules) write there. No line in that file is touched. |
| correction lane (`line-correction.use-case.ts`) | **Changed.** `amount` removed from the allowed fields, `amountOnlyLine` deleted, and the clarification ack now records a proposal as guidance rather than as an apply. Note-append and the per-field honest reply (slice A) are untouched. |
| substitute receipt continuation | **Not affected.** D copies lines only *within one record* (`storedLineToInput`), and that copier preserves `chargeKind`, WHT rate, category, account hint and the tax-code snapshot — asserted by "preserves every field of an untouched line". |
| reimbursement → expense | **Not affected.** D never builds a line from another source record. |
| VAT capture / input VAT claim | **Same path as the web.** Every D write goes through `UpdateExpenseDraftUseCase`, so `validateExpenseDraftAmounts`, `reconcileExpenseVat`, `validateExpenseVatSourceInput` and the claim rules run exactly as on the web PATCH. `set_vat_mode` moves the mode/rate through that same code. A charge whose VAT the products do not prove gets no rate and a visible warning — 7% is never assumed (§5.1). |
| WHT | **Not affected.** D never sets `whtInput` and never spreads WHT onto a charge row; each line's `whtRate` is copied unchanged. |
| ledger / journal, reports, CSV export | **Not affected.** At the repository boundary a LINE draft edit is byte-identical to a web draft edit; D introduces no new column, line shape or posting rule. |
| web list / detail / validation / QA specs | **Not affected.** No web file is touched. |
| LINE summary card / status row | **Not affected.** The capture card stays slice A's; D adds a separate confirm card. |
| read tools + security eval | `expense.get_detail` unchanged. `expense.explain_record` now reports `amountEditableOverLine` from the flag instead of a hardcoded `false` — with S-4 on, the answer stops saying money cannot be changed over LINE, because it can. Eval: 12 frozen rows, every one `expectedApplyCount: 0`. |
| AI usage / cost (`AiUsageEvent`) | **Metered like a read tool, no new model call.** All five tools are `sensitiveAudit: true`, so the executor writes `AI_TOOL_INVOKE` per call, and the turn's `AiUsageEntry` rows are unchanged in kind. The preview is pure server work and the reply is a deterministic template, so an edit turn costs one extra tool round trip — not another LLM call. |
| quota (`RECEIPT_QUOTA_ENFORCED`) | **Not consumed.** The only claim sites are the OCR/extraction branch (`claimReceiptQuotaNotice`, `RequestReceiptExtractionUseCase`); no draft-edit path reaches them. Verified by grep. |
| PDPA | **No new personal data.** The apply audit payload is exactly `{previewId, webhookEventId, tool, before, after, diff}` — asserted by key name in the pg spec — so no image, no raw LINE id, no message text. The Redis preview holds ids, the chat **hash**, the patch and the already-scrubbed diff, TTL 600 s, deleted on apply or cancel. `groundingText` is request-scoped: used for one substring check, never stored, never logged. |
| outbox / drain | **None needed, none added.** Double-apply is prevented twice: the webhook event claim is the outer dedup layer as today, and a replayed confirm finds either no preview (deleted) or a moved `updatedAt`. No workflow template subscribes to anything new. |
| docs | capture-correction spec (tools + the `amount` supersession), LINE runbook (flag table + what "off" restores), this memory (D.1–D.6). |
| **web shows LINE-made edits?** | **Gap, pre-existing, not introduced here.** `ExpenseReviewPage` has no audit/history panel — `deriveExpenseAuditChecks` is a validation checklist, and nothing in the web renders `aiVerificationSummaryJson.corrections[]`. So a LINE edit is invisible in the web today for the *correction* lane too. D deliberately writes no `corrections[]` mirror for draft applies: with no reader it would be write-only data, and the `expense.line_ai.draft_update` audit row is the durable record. Whoever builds the history panel should read the audit log and cover both lanes.

### D.7 Left out, with reasons

1. **No deterministic router rescue** for draft edits. The primary journey is the webhook's own allowlist detector, which runs only on a turn already classified as a correction of THIS chat's record. A rescue that guesses "this looks like an edit" is the wrong thing to make eager on a write path.
2. **No `corrections[]` JSON mirror** on a draft apply — no reader exists (see the web row above).
3. **`canCorrectAmount` retained** with no production caller: slice B's fix-up is still adding a charge-line refusal to it, and deleting it here would conflict. Delete after B lands if nothing picks it up.
4. **The pg spec's CI step creates `watchdog_bms` itself**, because PR #428's step is not on this base. On rebase the two should collapse into one — add the spec path to #428's step and drop this one.
5. **`scrubRecordText` lives in `packages/contracts`** so both apps share one copy. Slice C's review is widening a gateway-local `safeText` for the same reason; at rebase they must collapse onto this one rather than diverge.
