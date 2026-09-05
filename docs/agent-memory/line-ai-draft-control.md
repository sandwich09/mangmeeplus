# Agent Memory: line-ai-draft-control

Status: docs approved (Owner 2026-09-05, 5 decisions) → building slices A/B in parallel, then C, then D
Owner: Owner (product) · Fable (control) · Opus (implementation)
Scope: spec `docs/specs/line-ai-draft-control-spec-th.md`, plan `docs/plans/line-ai-draft-control-plan-th.md`
Decisions: service charge first-class (chargeKind), no silent today-date, receipt-mode BE dates with recorded assumptions, `unsupported_yet` refusal split from `unsupported_module`, LINE draft edits behind preview+confirm postback and `LINE_AI_DRAFT_EDIT_ENABLED` (default off), one UAT deploy after everything.
Open questions: Q1 (no-VAT-evidence charge → NEEDS_REVIEW), Q2 (edit allowed up to READY_FOR_CONFIRMATION) — spec defaults stand unless the Owner objects.
Artifacts: branches `codex/line-ai-truth-and-dates` (A), `codex/expense-charge-kind` (B), `codex/line-ai-explain-record` (C), `codex/line-ai-draft-edit` (D)
Verification: per slice — api fixed-list, typecheck, prisma validate, pins --check, web test/build when web touched, mutation table, security eval (D), local LINE-fake drive (J2–J4)
Next: A + B implementation → review → PR develop; C after B; D after C; single develop→main PR; UAT deploy on Owner order.

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

Status: implemented on top of B (`5200ba5d`, B rebased onto develop `91704151`), review round 1
fixed, gates green, pushed; no PR.

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
