# Expense Review Page Redesign — Codex CLI Handoff Harness

Design authority: `docs/plans/expense-review-page-redesign-plan.md` (read it first — every §
reference below points there). Task memory: `docs/agent-memory/expense-review-page-redesign.md`.
Working rules: `AGENTS.md` + `.agents/skills/ponytail/SKILL.md` (full mode).

Executor: **Codex CLI**. Codex writes code + specs and runs the per-phase verify commands.
**Claude reviews each phase against intent, drives fixes, and runs the gate.
Codex never commits and never runs `git add`.**

## Environment

- Node 24 and pnpm 9 are already on PATH here (`node -v` → v24.14.0, `corepack pnpm -v` → 9.15.0).
- Web tests are auto-globbed: `apps/web` `"test": "tsx --test \"src/**/*.spec.ts\""`. A new
  `*.spec.ts` under `apps/web/src` runs automatically — no manifest to update (unlike `apps/api`).
- `corepack pnpm --filter @watchdog-bms/contracts build` first if typecheck reports errors in
  unrelated `crm`/`employee-access` files — that means the contracts `dist` is stale.
- No dev servers. No `prisma migrate`/`db push`. This change needs **zero** schema/contract changes.

## Hard rules — violating any is a wrong implementation

1. **`apps/web` + `e2e` + `docs` only.** No `apps/api`, no `packages/contracts`, no new dependency.
2. **Behaviour freeze on settled logic.** `DocumentReviewSection` internals, `goToStep`'s
   save-on-leave, the `hidden`-not-unmounted step panels, `deriveExpenseAuditChecks`,
   `expenseSubstituteReceiptReady`, `expenseNeedsReceiptOrSubstitute`,
   `deriveExpenseClassificationReviewState`, and **every terminal-action button's condition,
   handler, `disabled` expression and `title` string** must survive byte-equivalent. This round
   changes layout, routing, validation and help — not the workflow.
3. **The non-editable layout is a straight port.** Statuses outside
   `{DRAFT, NEEDS_REVIEW, READY_FOR_CONFIRMATION}` (and users without mutate rights) keep the
   current continuous-scroll section order: notices → posting → audit → money → vendor →
   documents(+mismatch+aiData+duplicates) → payment.
4. **Permission gates unchanged.** `expenseCapabilities`, `canMutateDraft`, `canExtract`,
   `canConfirmExpense`, `approverOnlyActions`, `canRestartReview` keep their current expressions.
5. **XSS-inert.** OCR-derived strings (vendor name, line description, AI labels) render as text
   nodes only. No `dangerouslySetInnerHTML`.
6. **No new i18n mechanism.** New copy goes into `workspace-dictionary.ts` under both `th` and `en`
   with the existing `expenses.*` prefix, and is read with `t(key, locale)`.
7. **Validation is pure and tested.** Rules live in a pure module with a `node:test` spec, not in JSX.
8. Report deviations. If a rule below contradicts the code you find, **stop and report** — do not
   improvise across the boundary.

---

# Phase 1 — Pure logic: 3-step model + validation module

Business intent: the step model stops gating on "AI succeeded", and every data-entry rule the
screen needs exists as a tested pure function before any UI depends on it.

Files:

- `apps/web/src/features/expenses/expenses.model.ts`
- `apps/web/src/features/expenses/expense-review-steps.logic.spec.ts`
- `apps/web/src/features/expenses/expense-review-validation.ts` (new)
- `apps/web/src/features/expenses/expense-review-validation.spec.ts` (new)

## 1a. Step model (§6)

Change `ExpenseReviewStepKey` to `'data' | 'evidence' | 'review'`. `deriveExpenseReviewSteps`
returns three entries:

```ts
{ key: 'data', state: (detail.vendorNameSnapshot ?? '').trim() !== '' && Boolean(detail.expenseDate) && detail.lines.length > 0 ? 'done' : 'pending' },
// 'evidence' and 'review' entries: copy the current expressions verbatim
```

Drop the `document` entry. `aiVerificationSummaryJson` stays in the input type — the `evidence`
entry still uses it via `deriveExpenseClassificationReviewState`.

`initialExpenseReviewStep` keeps its current body unchanged (`READY_FOR_CONFIRMATION` → `'review'`,
else first not-done, else `'review'`). Verify by test that a no-attachment draft still opens on
`'evidence'` — with `document` gone this now falls out of `data` being done or not; if a
no-attachment draft with complete details would open on `review` instead of `evidence`, add an
explicit guard so the attach-or-substitute banner is still seen first, and say so in your report.

Update `expense-review-steps.logic.spec.ts`: delete the two `document` cases, retarget
`'details'` → `'data'`, keep every `evidence`/`review`/`initialExpenseReviewStep` case. Add one
case proving a draft with no AI summary but complete vendor/date/lines has `data: 'done'` — the
regression the old `document` gate caused.

## 1b. Validation module (§4)

New `expense-review-validation.ts`, exactly the §4 table, no more:

```ts
export type ExpenseFieldIssue = {
  field: string;                 // 'vendorNameSnapshot' | 'expenseDate' | `lines.${number}.quantity` | 'total'
  severity: 'error' | 'warn';
  messageKey: DictionaryKey;
  params?: Record<string, string>;
};
export function validateExpenseReview(
  values: ExpenseDraftReviewValues,
  opts: { today: string; aiGrandTotal?: string | null },
): ExpenseFieldIssue[];
```

Notes:

- `today` is injected (`todayIso()` at the call site) — the module must not read the clock, so the
  spec is deterministic.
- Tax id check: strip `-` and spaces, then require exactly 13 digits. Empty → no issue (optional).
- Money comparison: compare with a 0.01 epsilon. Reuse `hasAiGrandTotalMismatch` if it fits;
  otherwise state why it does not and keep the arithmetic in one helper.
- Rate domain is the **fraction** `0..1` for both `vatRate` and `whtRate` (§ D8).
- Non-numeric input (`''`, `'abc'`) for a required numeric field is an `error`, not a crash.
- `messageKey` values are the dictionary keys added in Phase 2; declare them here as the string
  literals listed in Phase 2 §2b so the two phases agree.

Spec: one case per row of the §4 table plus a clean-values case returning `[]`, and a case proving
`lines.3.quantity` style indexing is stable.

**Verify:** `corepack pnpm --filter @watchdog-bms/web test` (all existing tests still pass, new
specs green) and `corepack pnpm --filter @watchdog-bms/web typecheck`. `ExpensesPages.tsx` will not
typecheck against the renamed step keys yet — fix only the mechanical key references
(`STEP_LABEL_KEYS`, `STEP_HELPER_KEYS`, `step === 'details'` → `'data'`, and merge the old
`document` panel's content into the `data` panel) so the tree compiles. Do not restructure the
modal in this phase.

**Claude gate:** step-state expressions for `evidence`/`review` are byte-identical to HEAD;
validation rules match §4 exactly with no extra rules invented; no clock read inside the module.

---

# Phase 2 — Shared `InfoTip` + dictionary keys

Business intent: the screen can explain an accounting term at the point of confusion, in both
locales, without a new dependency.

Files:

- `apps/web/src/common/components/field/InfoTip.tsx` (new)
- `apps/web/src/common/components/field/index.ts`
- `apps/web/src/common/i18n/workspace-dictionary.ts`

## 2a. `InfoTip`

```tsx
export function InfoTip({ label, text }: { label: string; text: string }): JSX.Element
```

- Renders a small circular `ⓘ` button, `type="button"`, `aria-label={label}`,
  `aria-describedby` pointing at the panel id (`useId()`), `aria-expanded`.
- Opens on click (toggle — this is what makes it work on touch) and on
  `onMouseEnter`/`onFocus`; closes on `onMouseLeave`/`onBlur`, `Escape`, and outside click.
- The panel renders through the **existing** `PopoverPanel` (`../field/PopoverPanel`) — do not
  write new positioning code. `height` ≈ 160, no `matchAnchorWidth`; panel class in the repo's
  card idiom (`rounded-xl border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-600
  shadow-lg z-[100000]`).
- `role="tooltip"` on the panel. Text renders as a text node.
- Export from `field/index.ts` alongside the existing exports.

Ponytail check: if `PopoverPanel` genuinely cannot serve this (measure before you decide), say so
in your report and fall back to a `group-hover`/`focus-within` absolutely-positioned span — but
do not add a positioning library.

## 2b. Dictionary keys (add to **both** `th` and `en`)

Step model:

```
expenses.step_data            th 'ตรวจข้อมูล'                en 'Check the data'
expenses.step_data_helper     th 'AI กรอกข้อมูลให้แล้ว — เทียบกับใบเสร็จทางซ้ายทีละช่อง แก้ตรงไหนก็ได้'
                              en 'AI filled these in — check each field against the receipt on the left and edit anything that is wrong.'
```

Keep `expenses.step_evidence`, `expenses.step_review` and their `_helper` keys. Delete
`expenses.step_document`, `expenses.step_document_helper`, `expenses.step_details`,
`expenses.step_details_helper` **only after** confirming no other reference remains
(`grep -rn "step_document\|step_details" apps/web e2e`).

Page shell:

```
expenses.back_to_list         th 'กลับไปรายการค่าใช้จ่าย'        en 'Back to expenses'
```

AI prefill banner:

```
expenses.ai_prefill_title     th 'AI อ่านใบเสร็จให้แล้ว'          en 'AI has read the receipt'
expenses.ai_prefill_desc      th 'ข้อมูลด้านล่างมาจากการอ่านอัตโนมัติ กรุณาตรวจสอบให้ตรงกับใบเสร็จก่อนไปขั้นต่อไป'
                              en 'The fields below came from automatic reading. Check them against the receipt before continuing.'
expenses.ai_field_source      th 'ค่านี้ AI อ่านมาจากใบเสร็จ — กรุณาตรวจสอบ'
                              en 'AI read this value from the receipt — please verify it.'
expenses.ai_field_missing     th 'AI อ่านไม่ได้ — กรุณากรอกเอง'   en 'AI could not read this — please fill it in.'
expenses.ai_must_fill         th 'ต้องกรอกเอง'                  en 'Fill in manually'
```

Validation messages (`messageKey` values used by Phase 1):

```
expenses.v_vendor_required        th 'กรุณากรอกชื่อผู้ขาย'                        en 'Vendor name is required'
expenses.v_too_long               th 'ยาวเกิน {max} ตัวอักษร'                     en 'Longer than {max} characters'
expenses.v_tax_id_13              th 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก'          en 'Tax ID must be 13 digits'
expenses.v_date_required          th 'กรุณาระบุวันที่ในใบเสร็จ'                     en 'Receipt date is required'
expenses.v_date_future            th 'วันที่ในใบเสร็จต้องไม่เกินวันนี้'                en 'The receipt date cannot be in the future'
expenses.v_date_very_old          th 'วันที่เก่ากว่า 5 ปี — ตรวจสอบว่าพิมพ์ถูกต้อง'    en 'More than 5 years old — check for a typo'
expenses.v_lines_required         th 'ต้องมีรายการอย่างน้อย 1 รายการ'              en 'At least one line item is required'
expenses.v_description_required   th 'กรุณากรอกรายละเอียดรายการ'                  en 'Line description is required'
expenses.v_quantity_positive      th 'จำนวนต้องมากกว่า 0'                        en 'Quantity must be greater than 0'
expenses.v_number_invalid         th 'กรุณากรอกเป็นตัวเลข'                        en 'Enter a number'
expenses.v_amount_negative        th 'ต้องไม่ติดลบ'                              en 'Cannot be negative'
expenses.v_discount_exceeds       th 'ส่วนลดมากกว่ายอดของรายการนี้'                en 'Discount exceeds this line total'
expenses.v_rate_range             th 'กรอกเป็นทศนิยม 0 ถึง 1 (0.07 = 7%)'        en 'Enter a decimal from 0 to 1 (0.07 = 7%)'
expenses.v_total_mismatch         th 'ยอดรวมที่คำนวณได้ {computed} ไม่ตรงกับที่ AI อ่านได้ {ai}'
                                  en 'Computed total {computed} does not match the AI total {ai}'
expenses.v_total_zero             th 'ยอดรวมเป็น 0 — ตรวจสอบราคาต่อหน่วย'          en 'Total is 0 — check the unit prices'
expenses.v_blocking_count         th 'ยังมีข้อมูลที่ต้องแก้ {count} รายการ'           en '{count} field(s) still need fixing'
```

Tooltips — one key per §5 row, `expenses.tip_tax_id`, `expenses.tip_vat_mode`, `expenses.tip_vat_rate`,
`expenses.tip_wht_rate`, `expenses.tip_tax_code`, `expenses.tip_doc_type`, `expenses.tip_tax_status`,
`expenses.tip_substitute`. Thai copy is given verbatim in §5; write natural English equivalents.
Also `expenses.tip_open` th `'ดูคำอธิบาย'` en `'Show help'` for the ⓘ `aria-label`.

Rate echo: `expenses.rate_percent_echo` th `'= {percent}%'` en `'= {percent}%'`.

**Verify:** `corepack pnpm --filter @watchdog-bms/web typecheck` + `test`. Confirm the dictionary's
`th` and `en` blocks have identical key sets (the file's own spec, if any, will catch drift — if
none exists, grep-count both blocks and state the numbers in your report).

**Claude gate:** `InfoTip` reuses `PopoverPanel`; keyboard reachable and Esc-closable; every new key
present in both locales; no orphaned `step_document`/`step_details` references.

---

# Phase 3 — The page: route conversion + layout

Business intent: review becomes a linkable full-screen workspace where the receipt is legible,
and the modal stops existing.

Files:

- `apps/web/src/features/expenses/ExpenseReviewPage.tsx` (new)
- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/expenses/[expenseId]/page.tsx`
- `e2e/expenses.spec.ts`

## 3a. Extract, do not rewrite

Move `ExpenseDetailModal`'s body into a new exported `ExpenseReviewPage` component in its own file.
**Move the code — do not retype it.** Every hook, `useEffect`, ref, handler (`load`, `doAction`,
`attachPrimaryReceipt`, `checkDuplicates`, `extractAgain`, `openPreview`, `retryViewerUrl`,
`reloadViewerUrl`, `requestGuidedSubstitute`, `goToStep`), derived flag, and section block
(`noticesBlock`, `postingCard`, `auditCard`, `moneyCard`, `vendorCard`, `documentReviewCard`,
`priceMismatchWarning`, `aiDataBox`, `duplicatesCard`, `paymentCard`, `attachReceiptControl`)
carries over unchanged. Helpers it needs (`DocumentReviewSection`, `ExpenseReviewEditSection`,
`reviewValues`, `MoneyRow`, `STEP_LABEL_KEYS`, `STEP_HELPER_KEYS`, `ActionToast`, `InlineSpinner`,
`nonExpenseNotice`, `extractionNotice`, `expenseNoticeKey`) move with it or get exported from
`ExpensesPages.tsx` — pick whichever yields the smaller diff and say which you chose.

`ExpenseReviewPage` props:

```ts
{ companyId: string; expenseId: string; userId: string; permissions: string[] }
```

It derives `caps = expenseCapabilities(permissions)` itself, reads the stashed extraction notice
from `sessionStorage` via `expenseNoticeKey(expenseId)` (same read+remove the hub does today), and
navigates back with `router.push('/companies/{companyId}/expenses')`.

## 3b. Shell (§3.1)

- Wrap in `MangmeePage` with `eyebrow` = the back link, `title` = the current `modalTitle` block
  (expense number + vendor + date), `meta` = the badge row.
- Back link: `← {t('expenses.back_to_list')}`, an actual link/button to the list.
- Stepper row: keep the current markup and classes exactly (`ExpensesPages.tsx:1516-1551`
  guided branch) — including `disabled={stepSaving}`, `onClick={() => void goToStep(entry.key)}`,
  `aria-current`, the ring, and the connector logic. It is `sticky top-0 z-10 bg-white`.
- Helper strip below it, unchanged copy mechanism (`ขั้นที่ {stepIndex + 1}: {helper}`).
- Two-column grid `lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]`. Left column
  `lg:sticky lg:top-[…] lg:h-[calc(100dvh-13rem)]` with its own `overflow-auto`, containing the
  viewer block moved verbatim (empty state, header with `‹ n/m ›` `↻` `เปิดเต็มจอ`, img/iframe/
  fallback rendering). Below `lg` the viewer is hidden and the existing attachment strip shows,
  exactly as now.
- Action bar: `sticky bottom-0 z-10 border-t bg-white` holding the current `modalFooter` content
  **verbatim** — same conditions, handlers, `disabled`, `title`. Same for the reject/void reason
  sub-panel and the blocker notes.
- Loading / not-found: page-level states (spinner block, `ErrorBanner`), not modals.
- The full-screen file preview stays a `Modal` — it is genuinely transient. Keep it.

## 3c. Steps

Three panels, `hidden`-not-unmounted as today:

| step | content |
|---|---|
| `data` | AI prefill banner (Phase 4 fills it in; for now: `noticesBlock` + `aiDataBox` + the `อ่านอีกครั้ง` button moved off the footer) inside the existing `CoverLoader`, then `vendorCard`, then `moneyCard` |
| `evidence` | `documentReviewCard` + `priceMismatchWarning` |
| `review` | `auditCard` + `duplicatesCard` |

Non-guided (`guided === false`): no stepper, no step panels — render the continuous-scroll order
from hard rule 3, inside the same page shell.

## 3d. Routing

- `[expenseId]/page.tsx`: drop the redirect. `await params`, `fetchServerSession(companyId)`,
  render `<ExpenseReviewPage … userId={session?.userId ?? ''} permissions={session?.permissions ?? []} />`
  — mirror `expenses/page.tsx` exactly.
- `ExpensesHubPage`: `openListExpense` becomes
  `router.push('/companies/{companyId}/expenses/{encodeURIComponent(expenseId)}')`. The
  `?expenseId=` effect branch `router.replace`s to the same path instead of setting state (keeps
  LINE deep links, `TaxReconciliationPage`, `TransactionTaxLineSelector` and
  `safeAccountingReturnTo` working). Delete `selectedExpenseId` state and the
  `<ExpenseDetailModal …>` render in `ExpenseListPage`; the row click calls `onSelect` → navigate.
- Delete `ExpenseDetailModal` entirely. Nothing may import it afterwards.

## 3e. e2e

`e2e/expenses.spec.ts` EXP-03 and EXP-04 navigate to `?expenseId=` — they must still pass through
the redirect. Update EXP-04's step-tab names: `'ผู้ขายและรายการ'` → `'ตรวจข้อมูล'`, keep
`'ตรวจก่อนส่ง'`. Leave the assertions themselves alone.

**Verify:** `corepack pnpm --filter @watchdog-bms/web typecheck`, `test`, and
`corepack pnpm --filter @watchdog-bms/web build`. Then
`grep -rn "ExpenseDetailModal\|selectedExpenseId" apps/web` → no hits.

**Claude gate:** full-file `git diff` of `ExpensesPages.tsx` reviewed — hunks confined to the modal
removal + hub navigation; `ExpensesHubPage`'s tab routing, permission gating and `EXPENSES_TABS`
untouched. All terminal actions present with unchanged handlers/guards/titles. Non-guided section
order matches hard rule 3.

---

# Phase 4 — Prefill verification: validation, provenance, tooltips

Business intent: the user can tell, per field, what AI filled and what they must fix — and cannot
walk forward with data the server will reject.

Files:

- `apps/web/src/features/expenses/ExpensesPages.tsx` (the two section components)
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`

## 4a. Wire validation into `ExpenseReviewEditSection`

- `const issues = useMemo(() => validateExpenseReview(values, { today: todayIso(), aiGrandTotal }), [values, aiGrandTotal])`
  where `aiGrandTotal` comes from `detail.aiVerifiedFieldsJson` (the value
  `hasAiGrandTotalMismatch` already reads — reuse its accessor, do not duplicate the shape).
- Per input: look up `issues` by `field`; on `error` add `aria-invalid` + a red ring class and
  render the message below the field; on `warn` render an amber note. Use the repo's existing
  error/warn colour tokens (`text-error-500`, `border-error-…`, `text-warning-700`) — no new palette.
- `save` returns `false` without calling the API when any `error` exists, setting the section error
  to `expenses.v_blocking_count` with the count. This is what makes `goToStep`'s save-on-leave
  block navigation — the mechanism already exists; do not add a second one.
- The page's `ถัดไป` button on the `data` step is `disabled` when errors exist, with
  `title` = the same message.

## 4b. AI provenance marks (§3.2)

- Read `aiVerificationSummaryJson.recognizedFields` (array of field-name strings, same vocabulary
  as `missingFields` — `AI_MISSING_FIELD_LABELS` documents the keys) and `missingFields`.
- Map to the form fields: `vendor`/`vendorName` → vendor name, `vendorTaxId`, `expenseDate`,
  `documentNumber`, `grandTotalAmount`/`amount` → money card, `vatAmount` → VAT row,
  `category` → step 2 category select. Put the mapping in **one** exported const, not inline
  conditionals per field.
- Recognized → a small `🤖` chip beside the label with `title`/tooltip `expenses.ai_field_source`.
- Missing → amber hint `expenses.ai_field_missing` under the field.
- Both are absent when `aiVerificationSummaryJson` is null (manual expense) — the form must look
  exactly as it does today in that case.

## 4c. AI prefill banner

Replace the raw `aiDataBox` on the `data` step with the §3.2 banner: title
`expenses.ai_prefill_title`, description `expenses.ai_prefill_desc`, the existing status label
(`AI_SUMMARY_STATUS_LABELS`), missing-field chips prefixed `expenses.ai_must_fill`, and the
`อ่านอีกครั้ง` button (`extractAgain`, gated on `canExtract`, spinner + `expenses.ai_reading` copy
unchanged). Keep `noticesBlock` above it. Non-guided views keep the plain `aiDataBox` as today.

## 4d. Tooltips + rate echo (§5, D8)

- Add `<InfoTip label={t('expenses.tip_open')} text={t('expenses.tip_*')} />` beside the eight
  labels in §5. Six are in `ExpenseReviewEditSection` / the tax selector; three are in
  `DocumentReviewSection` (doc type, tax status, substitute) — **label markup only**, no logic.
- Fix the WHT label: `หัก ณ ที่จ่าย (%)` → `หัก ณ ที่จ่าย` (the `(%)` is wrong for a 0..1 input).
- Under both `vatRate` and `whtRate`, when the value parses and is > 0, render
  `expenses.rate_percent_echo` with `percent` = value × 100 rounded to 2 decimals, trailing zeros
  trimmed. Display only — never write it back.

**Verify:** `corepack pnpm --filter @watchdog-bms/web typecheck`, `test`, `build`.

**Claude gate:** no validation logic in JSX beyond lookup+render; the manual-expense path (null AI
summary) renders unchanged; rate echo is display-only and cannot round-trip into `values`; every
tooltip is keyboard reachable; the WHT domain is unchanged (0..1) — only the label and help changed.

---

# Report

Write `docs/agent-memory/expense-review-page-redesign.results.md` with, per phase: files touched,
the exact verify commands run and their output tail, every deviation from this harness with the
reason, and anything you found that contradicts the design plan.
