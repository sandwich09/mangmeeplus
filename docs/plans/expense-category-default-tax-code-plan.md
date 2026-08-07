# Expense Category Default Tax Code Plan

## Status

v1.1, 2026-08-05. **Steps 1–6 done.** Q1 and Q2 of the spec are deferrals, not decisions this needed.

Verification: `apps/api` 0 failures, `apps/web` 681/681, `pnpm test:boot` resolves every provider, `npx prisma validate` clean, both packages typecheck.

One implementation note worth carrying: the selector's preview effect had to follow the *effective* value (stored ?? suggested), not the stored one, or a suggested code would render with no tax preview beneath it and read as broken.

## Linked Specs

- [[specs/expense-category-default-tax-code-spec|Expense Category Default Tax Code Spec]] — authority for this plan.
- [[specs/vat-registration-aware-expense-capture-spec|VAT-Registration-Aware Expense Capture Spec]] — supplies the capture policy this control follows, and records why the field it replaces was removed (G7).

## Purpose

Let a category suggest an input Tax Code, so a reviewer is offered the right one instead of choosing from a list every time. A suggestion, never a decision.

## Non-Goals

- Tax Code semantics, account determination, report mapping, claimability — a Tax Code owns all of these; this only points at one.
- Auto-applying to saved expenses, or backfilling.
- A category picker in manual capture (spec §4, Q1).
- Any category-level claimability. That was G7.

## Steps

### 1. Schema + contract

`ExpenseCategory.defaultInputTaxCode String?` — plain nullable string, **no FK**. A `TaxCodeDefinition` row is one dated version of a code, so an FK would pin the category to that version and block retiring the profile (spec §5).

Additive migration, forward and backward safe: an older build ignores a column it does not select.

Contract: add to `ExpenseCategorySummary`, `Create/UpdateExpenseCategoryInput`, plus `ExpenseDetail.categoryDefaultInputTaxCode`.

### 2. Domain — the resolution, as a pure function

New `apps/api/src/modules/expenses/domain/logic/expense-category-tax-suggestion.logic.ts`:

```ts
export function suggestedLineTaxCode(input: {
  categoryDefaultInputTaxCode: string | null;
  lineHasTaxCode: boolean;
  available: Array<{ externalCode: string }>;   // already filtered by the picker
}): string | null
```

Returns the code only when the category has one, the line has none, and the code appears in what the picker is already offering. Everything date/context/status-related is *already* decided by `availableTaxDefinitions` — do not re-implement that filter here, or the two will disagree.

Spec file alongside, covering every §12 edge case. Register in the api test list.

### 3. API — carry the hint on the detail

`prisma-expense.repository.ts` already joins the category for the detail read (`:1915` selects `name`); add `defaultInputTaxCode` to that select and expose it as `categoryDefaultInputTaxCode`. No new query.

Repository create/update: pass the field through, same shape as `sortOrder`.

### 4. Web — the category control

`ExpensesWorkspacePanels.tsx` — a "Tax Code เริ่มต้น" column and a picker in the create/edit modal, both wrapped in the existing `showsTax` boolean so a SIMPLE company never sees them.

The picker's options come from `listTaxCodeDefinitions` filtered to ACTIVE `INPUT` codes. Reuse `availableTaxDefinitions` with `context: 'DOMESTIC_PURCHASE'`, `direction: 'INPUT'`, `documentDate: today` — the category is a standing setting, so today is the right lens for *offering* codes even though resolution at use time is per document date.

### 5. Web — the suggestion in the line picker

`ExpenseReviewEditSection` passes `suggestedTaxCode` into `TransactionTaxLineSelector`; the selector pre-selects the matching choice when its own `value` is empty, and shows a short note saying the code came from the category.

Do not write it into form state on mount — that would make an untouched expense dirty and could persist a suggestion nobody chose (spec AC5). The selector shows it; only an explicit change writes it.

### 6. Tests

- The domain spec from step 2 (the real coverage).
- One web test that the suggestion fills an empty line and leaves a filled one alone (AC2/AC3).
- Round-trip through create/update in the existing category use-case spec.

### 7. Verification

```bash
pnpm --filter @watchdog-bms/api test
```

```bash
pnpm --filter @watchdog-bms/web test
```

Plus `pnpm test:boot` if any provider wiring changes, and `npx prisma validate` after the schema edit.

## Rollout

Steps 1–3 are inert without 4–5: the column exists and the detail carries a null. Safe to land separately.

The migration is additive, so there is no deploy-order constraint — unlike the G7 drop, which was forward-only.

## Risks

- **R1 — the suggestion reads as a stored value.** Mitigated by the note in the picker and by never writing on mount.
- **R2 — re-implementing the date/context filter.** Step 2 must consume the picker's already-filtered list. Two filters would eventually disagree and suggest a code the picker refuses to show.
- **R3 — reintroducing a second source of truth.** The category suggests a **Tax Code**, never a claimability. If a future change adds a claimability back onto the category, it recreates G7.
