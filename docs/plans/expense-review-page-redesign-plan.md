# Expense Review: Popup → Full Page Redesign

Status: Design approved for implementation 2026-07-31. Owner: Expenses web UX.
Task memory: `docs/agent-memory/expense-review-page-redesign.md`.
Codex harness: `docs/plans/expense-review-page-redesign-codex-handoff.md`.
Predecessors (behaviour that must survive): `expense-detail-stepper-ux-plan.md`,
`docs/agent-memory/expense-detail-popup.md`, `expense-no-invoice-substitute-routing-plan.md`.

---

## 1. Problem (verified against code 2026-07-31)

The post-OCR review lives in `ExpenseDetailModal` (`ExpensesPages.tsx:939-1642`), a
`Modal size="xl"` (`max-w-[min(1180px,96vw)]`, `max-h-[calc(100dvh-2rem)]`).

Observed failures:

1. **The receipt is unreadable at review size.** The viewer gets ~5/11 of 1180px inside a
   height-capped dialog. A phone photo of a thermal receipt is exactly the artefact the user
   must read digit-by-digit to verify AI output — and it is the smallest thing on screen.
2. **The AI result is a dead end, not a hand-off.** Step 1 (`รูปใบเสร็จ`) renders only
   notice banners + an AI status box (`ExpensesPages.tsx:1562-1569`). It shows *that* AI ran,
   never *what it filled*. The user is never told "these values came from AI — check them".
   The prefilled data lives one step away with no visual link back to the read.
3. **A whole step exists to say nothing.** `document` is marked `done` the instant
   `aiVerificationSummaryJson` exists (`expenses.model.ts:474`) — after a successful upload it is
   always already done. It is a step users click past.
4. **Zero client-side validation.** Every input in `ExpenseReviewEditSection`
   (`ExpensesPages.tsx:815-914`) accepts anything and defers to the server. Only
   `findForbiddenChars` runs client-side (`:790`). A future date, a 9-digit tax id, a discount
   larger than the line, an empty vendor — all round-trip to a server error banner.
5. **Unit ambiguity that will corrupt data.** `expenses.wht` is labelled `หัก ณ ที่จ่าย (%)`
   (`:887`) but the input is `min=0 max=1 step=0.0001` — a fraction. A user entering `3` for 3%
   gets silently clamped by `max=1`, and `0.03` looks wrong against a `%` label. `vatRate`
   (`:884`) has the same fraction domain with no unit stated at all.
6. **No explanation anywhere.** `รูปแบบ VAT`, `รหัสภาษีซื้อ`, `สถานะหลักฐานภาษี`,
   `ประเภทเอกสาร`, `ใบรับรองแทนใบเสร็จ` are accounting-domain terms shown to shop owners with
   no help affordance. The codebase has no tooltip component at all.
7. **The URL already disagrees with the UI.** `/companies/:c/expenses/:e` is the canonical deep
   link emitted by the API (`expense-evidence.use-case.ts:171,190`) and LINE replies
   (`process-line-webhook.use-case.ts:350`) — and it currently *redirects into a query param*
   that reopens a dialog. Review state is not shareable, not linkable, not back-button-able.

## 2. Design decisions

| # | Decision | Why |
|---|---|---|
| D1 | `/companies/:companyId/expenses/:expenseId` becomes the real review **page**. `?expenseId=` on the hub `router.replace`s to it. | The canonical URL already exists and is emitted by API + LINE. Inverting the redirect costs one file and makes review linkable. |
| D2 | **One code path.** The modal is deleted; the page serves every status. Editable drafts get the wizard; every other status gets the continuous-scroll layout (today's `guided === false` branch, unchanged). | Two layouts for one screen is the maintenance debt that produced this round. |
| D3 | **4 steps → 3**: `data` → `evidence` → `review`. The AI read becomes a banner at the top of `data`, not a step. | Removes the always-done click-through (problem 3) and puts the AI result *next to the fields it filled* (problem 2). |
| D4 | After upload, the user lands on **step 1 `data`** with the extraction notice — the prefill-verification screen. | The owner requirement: AI finishes → user verifies prefilled data themselves. |
| D5 | Receipt viewer is a **sticky full-height left column** on the page, not a pane in a capped dialog. | Problem 1. A page has the viewport; a modal rents 96% of it. |
| D6 | New pure `validateExpenseReview()` + inline field errors; `ถัดไป` blocked on `error`, passable on `warn`. | Problem 4. Pure + unit-tested keeps rules out of JSX. |
| D7 | New shared `InfoTip` (ⓘ) built on the **existing** `PopoverPanel`. | Problem 6. No new dependency; reuses the repo's portal/anchor logic. |
| D8 | VAT/WHT rate inputs keep **fraction storage** but gain a tooltip and a live `= 7%` echo under the field; the `(%)` label is corrected. | Problem 5. Converting the stored unit risks float drift across an existing dataset; an echo removes the ambiguity for zero risk. |

### D8 rejected alternative

Displaying percent and dividing by 100 on save was considered and dropped: `vatRate` is also
written by `TransactionTaxLineSelector` from tax-code definitions
(`taxDefinitionRateForSource`), so two writers would need to agree on a unit. Echo instead.

## 3. Screen design

### 3.1 Shell

```
┌─ sticky ────────────────────────────────────────────────────────────────┐
│ ← กลับไปรายการค่าใช้จ่าย                                                  │
│ EXP-0007 · BENLAI            [ฉบับร่าง] [รอตรวจหลักฐานภาษี] [อัปโหลดเว็บ] [🤖 AI] │
│ ใบเสร็จรับเงิน · 27 มิ.ย. 2569                                            │
├─ sticky ────────────────────────────────────────────────────────────────┤
│  ①──────②──────③   ตรวจข้อมูล · ภาษีและหลักฐาน · ตรวจก่อนส่ง               │
│  ขั้นที่ 1: <helper copy for the active step>                              │
├─────────────────────────────┬───────────────────────────────────────────┤
│ receipt viewer              │ step content                              │
│ sticky, own scroll          │ scrolls with the page                     │
│ h-[calc(100dvh-13rem)]      │                                           │
│ ‹ 1/2 › ↻ เปิดเต็มจอ         │                                           │
├─────────────────────────────┴───────────────────────────────────────────┤
│ sticky action bar:  [ปฏิเสธ]              [ย้อนกลับ]  [ถัดไป]              │
└─────────────────────────────────────────────────────────────────────────┘
```

Grid `lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]` — the viewer gains ~1.6× its modal width and
the full viewport height. Below `lg` the viewer collapses to today's attachment strip
(`lg:hidden` rows), unchanged.

### 3.2 Step 1 — `ตรวจข้อมูลที่ AI อ่าน`

Helper: **"AI กรอกข้อมูลให้แล้ว — เทียบกับใบเสร็จทางซ้ายทีละช่อง แก้ตรงไหนก็ได้"**

1. **AI prefill banner** (replaces the old `document` step wholesale):
   - `🤖 AI อ่านใบเสร็จให้แล้ว` + `AI_SUMMARY_STATUS_LABELS[status]`
   - missing-field chips from `aiVerificationSummaryJson.missingFields`, labelled
     `AI_MISSING_FIELD_LABELS` — worded as an instruction: `ต้องกรอกเอง: ยอดรวม`
   - `[อ่านอีกครั้ง]` (the old `extractAgain`, same permission gate `canExtract`)
   - extraction notice / non-expense / override banners (`noticesBlock`, unchanged)
   - `CoverLoader` wraps the whole step-1 body during re-extraction (was step 1 only).
2. **Vendor & document card** — `ชื่อผู้ขาย*`, `เลขประจำตัวผู้เสียภาษี ⓘ`, `เลขที่เอกสาร`,
   `วันที่ในใบเสร็จ*`, `รูปแบบ VAT ⓘ`.
3. **Line items** — unchanged fields, plus per-field validation and rate echoes.
4. **Money summary** (`moneyCard`, moved from step 2 — it belongs beside the numbers that
   produce it) with a new mismatch warning when the computed grand total disagrees with the AI
   total (`hasAiGrandTotalMismatch` already exists; surface both numbers instead of prose).

**AI-provenance marks.** A field whose key appears in `aiVerificationSummaryJson.recognizedFields`
gets a `🤖` chip on its label with tooltip `ค่านี้ AI อ่านมาจากใบเสร็จ — กรุณาตรวจสอบ`. A field in
`missingFields` gets an amber hint `AI อ่านไม่ได้ — กรุณากรอกเอง`. This is the entire point of the
screen: the user must be able to see, per field, what to trust.

### 3.3 Step 2 — `ภาษีและหลักฐาน`

`DocumentReviewSection` **internals unchanged** (substitute-receipt flow, signature capture,
classification override — all settled and tested). Additions are tooltips only:
`ประเภทเอกสาร ⓘ`, `สถานะหลักฐานภาษี ⓘ`, `ใบรับรองแทนใบเสร็จ ⓘ`. Plus `priceMismatchWarning`
as today.

### 3.4 Step 3 — `ตรวจก่อนส่ง`

`auditCard` + `duplicatesCard` as today. Terminal actions stay in the sticky action bar with
**every existing `disabled` expression and `title` verbatim** — those encode the server's
confirm gates and are not up for redesign in this round.

## 4. Validation rules

New pure module `apps/web/src/features/expenses/expense-review-validation.ts`:

```ts
export type ExpenseFieldIssue = {
  field: string;            // 'vendorNameSnapshot' | 'lines.0.quantity' | 'total'
  severity: 'error' | 'warn';
  messageKey: DictionaryKey;
  params?: Record<string, string>;
};
export function validateExpenseReview(
  values: ExpenseDraftReviewValues,
  opts: { today: string; aiGrandTotal?: string | null },
): ExpenseFieldIssue[];
```

| Field | Rule | Severity | Rationale |
|---|---|---|---|
| `vendorNameSnapshot` | trimmed non-empty | error | already the `data`-step done-criterion; make it visible instead of silent |
| `vendorNameSnapshot` | ≤ 200 chars | error | column bound |
| `vendorTaxIdSnapshot` | if set: exactly 13 digits after stripping `-` and space | error | Thai TIN; `deriveExpenseAuditChecks` already checks this post-hoc — move it to entry time |
| `vendorDocumentNumber` | ≤ 50 chars | error | column bound |
| `expenseDate` | present and `YYYY-MM-DD` parseable | error | required by the server |
| `expenseDate` | not after `today` | error | a receipt cannot be dated in the future |
| `expenseDate` | not before `today − 5 years` | warn | typo guard (2569 → 2559), not a prohibition |
| `lines` | ≥ 1 line | error | server rejects a lineless confirm |
| `lines[i].description` | trimmed non-empty, ≤ 200 | error | |
| `lines[i].quantity` | numeric, > 0 | error | 0 silently zeroes the line total |
| `lines[i].unitPrice` | numeric, ≥ 0 | error | |
| `lines[i].discountAmount` | numeric, ≥ 0 | error | |
| `lines[i].discountAmount` | ≤ `quantity × unitPrice` | error | a negative line total is not representable downstream |
| `lines[i].vatRate` | if set: `0 ≤ r ≤ 1` | error | fraction domain (D8) |
| `lines[i].whtRate` | if set: `0 ≤ r ≤ 1` | error | fraction domain (D8) — this is the `(%)` hazard |
| `total` | computed grand total ≠ AI grand total by > 0.01 | warn | `hasAiGrandTotalMismatch` exists; report both numbers |
| `total` | computed grand total = 0 | warn | mirrors the existing `isZeroAmount` confirm warning, surfaced earlier |

Behaviour: recomputed on every change. `error` → red ring + `aria-invalid` + inline message,
and `ถัดไป`/save-on-leave blocked with `title` = `ยังมีข้อมูลที่ต้องแก้ {n} รายการ`. `warn` → amber
inline note, navigation allowed. Existing server-side errors keep their current banner.

## 5. Tooltip inventory

`apps/web/src/common/components/field/InfoTip.tsx` — ⓘ button, toggles on click (touch-safe),
opens on hover for pointer devices, content rendered through the existing `PopoverPanel`,
linked by `aria-describedby`, closes on Esc / outside click.

| Anchor | Copy (th) |
|---|---|
| เลขประจำตัวผู้เสียภาษี | เลข 13 หลักของผู้ขาย ดูได้จากหัวใบกำกับภาษี ถ้าไม่มีให้เว้นว่าง |
| รูปแบบ VAT | เลือก "รวม VAT แล้ว" ถ้าราคาบนใบเสร็จรวมภาษีไว้แล้ว เลือก "ยังไม่รวม VAT" ถ้าต้องบวกเพิ่ม |
| อัตรา VAT | กรอกเป็นทศนิยม เช่น 0.07 = 7% ปกติร้านค้าในไทยใช้ 0.07 |
| หัก ณ ที่จ่าย | กรอกเป็นทศนิยม เช่น 0.03 = 3% ใช้เมื่อต้องหักภาษี ณ ที่จ่ายให้ผู้ขาย ถ้าไม่ต้องหักให้เว้นว่าง |
| รหัสภาษีซื้อ | รหัสที่ใช้แยกประเภทภาษีซื้อในรายงานภาษี เลือกได้เมื่อเอกสารเป็นใบกำกับภาษีเท่านั้น |
| ประเภทเอกสาร | ใบกำกับภาษีใช้ขอคืนภาษีซื้อได้ ใบเสร็จทั่วไปใช้เป็นค่าใช้จ่ายได้แต่ขอคืนภาษีไม่ได้ |
| สถานะหลักฐานภาษี | บอกว่าเอกสารนี้ใช้เป็นหลักฐานทางภาษีได้แค่ไหน มีผลกับการคิดภาษีซื้อ |
| ใบรับรองแทนใบเสร็จ | ใช้เมื่อจ่ายจริงแต่ไม่ได้ใบเสร็จ ต้องมีผู้จ่ายลงนามและผู้อนุมัติออกให้ครบจึงจะยืนยันได้ |

## 6. Model change

```ts
export type ExpenseReviewStepKey = 'data' | 'evidence' | 'review';
```

`deriveExpenseReviewSteps` returns three entries:

- `data` — `done` when trimmed `vendorNameSnapshot` ≠ '' **and** `expenseDate` **and**
  `lines.length > 0`. (Today's `details` criterion verbatim. The old `document` criterion —
  "AI produced a summary" — is dropped: a failed OCR must not gate a user who types the data
  in by hand.)
- `evidence` — unchanged expression.
- `review` — unchanged expression.

`initialExpenseReviewStep` keeps all three tested behaviours: `READY_FOR_CONFIRMATION` → `review`;
a draft with no attachment and no substitute path → `evidence` (the banner must be seen first);
otherwise first not-done, falling back to `review`.

## 7. Out of scope

Server contracts, permissions, the substitute-receipt flow, audit-check rules, terminal-action
gates, the list table, the upload panel. This round is the review screen only.

## 8. Acceptance criteria

- `/companies/:c/expenses/:e` renders the review page directly; no dialog on the route.
- Upload → AI read → the user lands on step 1 with prefilled data, an AI banner, and per-field
  provenance marks.
- Every rule in §4 shows inline on the offending field and blocks/warns as specified.
- Every term in §5 has a reachable, keyboard-accessible tooltip.
- Non-editable statuses render the continuous-scroll layout with no stepper.
- Every terminal action keeps its current condition, handler, `disabled` expression and `title`.
