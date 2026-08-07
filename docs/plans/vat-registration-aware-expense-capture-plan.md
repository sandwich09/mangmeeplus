# VAT-Registration-Aware Expense Capture Plan

## Status

v1.2, 2026-08-05. **Steps 1–7 done and committed.** Q1–Q3 answered by the owner (spec §16).

Verification: `apps/api` suite 0 failures, `apps/web` 681/681, `pnpm test:boot` resolves every provider, both packages typecheck clean. Re-run after every step, not once at the end.

Two defects were found by the per-step reviews and fixed in place:

1. `thai_tax` is ON by default for every new company (`DEFAULT_ENABLED_FEATURE_KEYS`), so the original entitlement-first derivation would have shown the full tax UI to a company that had already answered `NOT_REGISTERED` — which the claim guard then rejects. An answered fact now outranks the entitlement.
2. Same root cause, product-level: a company reaches SIMPLE only after somebody answers the VAT question, so step 6 is what delivers the value rather than a nicety at the end.

Deliberate simplifications, both recorded in spec §7.7 and §8: the per-document "ใบนี้เป็นใบกำกับภาษี" escape hatch was dropped (the gross total is already what was paid, and the VAT is cost either way), and the inline question offers two answers rather than three (nothing writes `VatRegistrationPrompt` yet, so "ไม่แน่ใจ" would be a button that does nothing).

## Linked Specs

- [[specs/vat-registration-aware-expense-capture-spec|VAT-Registration-Aware Expense Capture Spec]] — authority for this plan.
- [[specs/company-tax-identity-setup-spec|Company Tax Identity Setup Spec]] §5 — owns the VAT fact and the ask-once wizard. Release A4 there is a **soft** dependency: steps 1–5 below ship and are correct without it, but until A4 lands every company is `UNKNOWN` and only the `thai_tax` arm of the derivation is exercised in production.

## Purpose

Stop asking Thai VAT questions of companies that cannot answer them, without changing anything for companies that can. Add the one fact-based guard that stops an input-VAT claim a company is not entitled to.

## Non-Goals

- The VAT registration wizard and its onboarding placement (A4 owns them).
- The sales-side issuance gate — spec §12 G2. Flagged, not fixed here (owner confirmed it stays with Company Tax Identity Setup).
- Entitlement changes to `GET tax/code-definitions` — spec §12 G3.
- **Any change to the accountant export** — CSV, XLSX, or evidence manifest. Spec §12.1 establishes the export is unaffected and must stay that way; AC13 is the regression test.
- Making `ExpenseCategory.inputVatDefault` actually do something — spec §12 G7. This plan only hides its control; wiring the dead field is a separate decision.
- Any schema migration, backfill, or data rewrite.

## Steps

### 1. Domain — the derivation, as a pure function

New `apps/api/src/modules/expenses/domain/logic/expense-capture-policy.logic.ts`:

```ts
export type ExpenseCaptureMode = 'FULL' | 'SIMPLE';

export function expenseCaptureMode(input: {
  vatStatus: VatRegistrationStatus;   // already tri-state
  thaiTaxEnabled: boolean;
}): ExpenseCaptureMode
```

Exactly the §5 table, no I/O, no dates inside — the caller resolves `vatStatus` for the date it cares about with the existing `effectiveVatStatus`. Spec test file alongside it, registered in the api test list.

Smallest-diff note: do **not** add a new accessor for the fact history. `effectiveVatStatus(facts, asOf)` already exists and is already tested.

### 2. API — the read endpoint

`GET /v1/companies/:companyId/expenses/capture-policy?on=YYYY-MM-DD` in the existing expenses controller, gated with `RequireAnyPermission('expense.read', 'expense.read_own', 'expense.create', 'expense.review')` — a reviewer holds none of the others.

Delegates the whole fact read to `CompanyVatRegistrationUseCase.get(companyId, on)`: it already validates `on` with `isCivilDate`, defaults to today in the company timezone, and applies the interval accessor. Re-loading facts here would let the two drift. This needs one line adding `CompanyVatRegistrationUseCase` to `DataModelCoreModule` exports.

`thaiTaxEnabled` comes from `loadEntitledFeatureKeys`; a `null` result is the legacy fail-open sentinel and counts as entitled, matching the permission resolver.

Declare the handler **before** `@Get(':expenseId')` so the literal path wins, following the `shared-evidence` precedent.

Verify wiring with `pnpm test:boot` — unit tests cannot catch a Nest resolution error.

### 3. API — the claim guard

In `expense-status.logic.ts`, extend `validateDomesticInputVatEvidence` with an optional `vatStatus` fact so `NOT_REGISTERED` + `CLAIMABLE` returns the new error. That validator runs at confirmation — the single convergence point, since `finalizeAndConfirmExpenseCas` has exactly one caller and every route (web, LINE, AI, reimbursement) passes through it.

`ConfirmExpenseUseCase` resolves the status on the expense's own date via `utcDateToCivilDate(r.expenseDate)`, and only when the expense is `CLAIMABLE`, so the ordinary path adds no query.

Error code `input_vat_not_available_company_not_vat_registered`, thrown as `BadRequestException` like every sibling rule in the same validator. Add its Thai label to `apps/web/src/common/api/api-error-message.ts` in the same step — shipping the code without its label shows the user a raw snake_case string.

`UNKNOWN` must fall through untouched — assert this in the spec file, because it is the arm that protects every existing company.

### 4. Web — one hook, then subtraction

`apps/web/src/features/expenses/expense-capture-policy.ts` — fetch + a `useExpenseCapturePolicy(companyId, on)` hook that fails to `FULL` on error (spec E2).

Then the UI change is deletion guarded by one boolean, at the sites in spec §11:

- `ExpensesPages.tsx:1552` — wrap the tax `MangmeeCard`.
- `ExpensesPages.tsx:1107` — wrap the per-line selector *and* its else-branch note.
- `ExpensesWorkspacePanels.tsx:576` — สถานะหลักฐานภาษี filter.
- `ExpensesWorkspacePanels.tsx:662,712` — หลักฐานภาษี list column (header array and cell must be dropped together, or the header/cell counts drift).
- `ExpensesWorkspacePanels.tsx:135,153,179-183` — category "ภาษีซื้อเริ่มต้น" column *and* create control (Q1: hide both). Drop `inputVatDefault` from the create call so the repository default `NON_CLAIMABLE` applies rather than sending a value the hidden control never showed.
- `ExpenseReviewPage.tsx:464` — VAT summary row, hidden only when the expense itself has no VAT.

Do not touch `ExpensesPages.tsx:1180,1259,1299` (export column-set picker) or `ExpensesWorkspacePanels.tsx:449` (evidence export). The export is deliberately mode-independent — see Non-Goals and AC13.

Rule §7.5 (existing tax data forces FULL) is computed from the loaded expense, not from the policy, so it needs no extra call.

### 5. Web — the empty-state CTA fix (spec G4)

`TransactionTaxLineSelector.tsx:128-133` — render the "ตั้งค่าภาษี" link only when the caller holds `tax.config.manage`; without it, point at who to ask instead. The component does not receive permissions, and neither do its expense callers, so `canConfigureTax` rides on the capture policy those callers already read rather than being threaded as a prop.

This step is independently shippable and fixes a live defect. It can land first.

### 6. Ask the question at company registration

The admin form that creates a company gains an optional VAT answer: จดทะเบียนแล้ว (+ ภ.พ.20 date), ยังไม่ได้จดทะเบียน, or ยังไม่ทราบ. Unknown writes no fact — it is not "not registered".

The fact is written in the onboarding transaction that already creates `companyVatRegistrationState`, with the state starting at version 1 so a later CAS has the right expected version. Direct write instead of the command path is safe only here (spec §8).

**Superseded the original step 6**, which put the question inside manual capture. That placement failed twice — see spec §8.1. Do not reintroduce it on a per-document form.

### 7. Upload default (spec E4)

`expense-upload.use-case.ts:63` — when the policy for the extracted date (or today, if none) is SIMPLE, create the draft `NON_CLAIMABLE` instead of `NEEDS_REVIEW`. One conditional; no change to the extraction contract.

### 8. Tests

Per spec §15. Minimum bar before handoff:

- `expense-capture-policy.logic.spec.ts` — 6-cell derivation table + two-interval date selection.
- `expense-status.logic.spec.ts` — three claim-guard cases, with the `UNKNOWN` pass-through named explicitly.
- web `expenses.model.spec.ts` — §7.5 override.
- `expense-export.logic.spec.ts` — AC13: the same `AccountantIndexSource` fixture produces identical CSV and identical XLSX header rows for both column sets, regardless of capture mode. The point of this test is to fail loudly if someone later "tidies up" the zero VAT column.
- One E2E covering AC1 + AC2 in the same run, so a regression in either direction fails.

### 9. Verification

```bash
pnpm --filter @watchdog-bms/api test
```

```bash
pnpm --filter @watchdog-bms/web test
```

Record results in the task memory. AC2/AC3 (no change for FULL) are the ones to prove first — they are the regression risk of this entire change.

## Rollout

Steps 5 and 7 are independent and safe to land alone. Steps 1–4 land together; without step 4 the endpoint has no reader, and without steps 1–3 the UI has nothing to read.

No migration, no backfill, no feature flag. The `thai_tax` arm of the derivation means the change is a no-op for every company that has the tax module today, and the fact arm is inert until A4 gives companies a way to answer. That is the intended safety property: this ships dark for existing tenants and takes effect for new ones.

## Risks

- **R1 — silent downgrade.** If the `thai_tax` arm is dropped or mis-read, every existing `UNKNOWN` company loses its tax capture. Mitigated by AC3 and by asserting the arm in the derivation spec file.
- **R2 — date drift.** Evaluating the policy on `today` instead of `expenseDate` produces wrong forms for backdated entry. Mitigated by AC5.
- **R3 — hiding as deleting.** A guarded render that also clears state on unmount would destroy captured data. Mitigated by AC9; keep the state in the parent, not in the hidden subtree.
- **R4 — scope creep into G2.** The sales-side gate is a larger, separately-owned correctness fix. Do not open it inside this change.
- **R5 — "tidying" the export.** Hiding tax fields in the UI makes the zero-filled VAT columns in the export look like leftovers. They are not; the CSV is a fixed-order machine contract and the XLSX zero is a true statement. AC13 exists to catch this.
- **R6 — reviving G7 by accident.** Step 4 stops *sending* `inputVatDefault` from a hidden control. It must not start *reading* it anywhere, or a field that has been inert since it shipped would silently begin changing draft claimability.
