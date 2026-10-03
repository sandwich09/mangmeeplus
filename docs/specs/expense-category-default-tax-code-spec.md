# Expense Category Default Tax Code Spec

## 1. Status

v1.1, 2026-08-05. **Implemented.**

Owner: thawtchai. Replaces the removed `ExpenseCategory.inputVatDefault` (see [[specs/vat-registration-aware-expense-capture-spec|VAT-Registration-Aware Expense Capture Spec]] §12 G7). That field tried to make a category carry a *claimability*, which is the wrong half of the answer and a second source of truth against the Tax Code. This spec makes a category carry a **suggested Tax Code** instead, which brings claimability, account determination and report mapping with it.

Linked plan: [[plans/expense-category-default-tax-code-plan|Expense Category Default Tax Code Plan]]

Related: [[specs/sap-compatible-transaction-tax-account-determination-spec|SAP-Compatible Transaction Tax and Account Determination Spec]] (owns Tax Code semantics — this spec only points at one), [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]] (capture surfaces).

## 2. Goal

Let a company say "purchases in this category are normally taxed like *this*", so a reviewer picking ค่าโฆษณา is offered the right input Tax Code instead of choosing from a list every time.

The suggestion is a **default in a picker**, never a decision. The reviewer's explicit choice always wins, nothing is auto-saved, and a suggestion that does not fit the document simply does not appear.

## 3. Source Facts (verified in code on 2026-08-05)

| Fact | Evidence | Consequence for this design |
| --- | --- | --- |
| A Tax Code definition is versioned and dated: unique on `(profileId, direction, externalCode, effectiveFrom, version)` | `schema.prisma:2959` | A category must **not** hold a `TaxCodeDefinition.id` — that pins one version and breaks when the profile is re-versioned or retired |
| `externalCode` (e.g. `O7`) is the stable business identity across versions | same | The pointer is the external code |
| The selector already resolves code → definition: ACTIVE, matching direction and context, effective on the document date | `transaction-tax.model.ts:66` | No new server-side resolution is needed; reuse `availableTaxDefinitions` |
| The category picker is **header-level**, in `DocumentReviewSection` | `ExpensesPages.tsx:657` | The suggestion crosses from a header field to line fields |
| The Tax Code picker is **per line**, in `ExpenseReviewEditSection` | `ExpensesPages.tsx:1113` | Two different components; coupling them at save time would be a seam. Solved by §5 |
| Manual capture has **no** category picker at all | `ExpensesPages.tsx:1428-1520` | Manual capture is out of scope until it gains one |
| Expense detail already joins the category in one query | `prisma-expense.repository.ts:1915` | The hint can ride on the existing detail response — no extra fetch |
| Capture mode already decides whether tax questions are asked | `expense-capture-policy.logic.ts` | The category tax control follows it; a non-VAT company never sees it |

## 4. Non-goals

- Changing Tax Code semantics, account determination, report mapping, or claimability. This spec points at a Tax Code; it does not define one.
- Auto-applying the suggestion to a saved expense, or backfilling existing expenses.
- Suggesting an **output** Tax Code. An expense is a purchase; direction is `INPUT`.
- Adding a category picker to manual capture. Worth doing, but it is a separate change with its own UX question.
- Reviving any category-level claimability. That was G7 and is deliberately gone.

## 5. Key Design Decision — a code, not a foreign key; a default, not a write

**The pointer is `externalCode`, stored as a plain nullable string, with no FK.** A `TaxCodeDefinition` row is one dated version of a code. An FK to it would pin the category to that version, make retirement of an old profile fail, and quietly suggest a definition that is no longer effective. Storing `O7` and resolving it per document date is both simpler and more correct.

A code that no longer resolves is not an error. If the company retires `O7`, or the document's date falls outside every `O7` window, or the line's context is not `DOMESTIC_PURCHASE`, the suggestion silently does not apply. A stale suggestion must never become a wrong pre-fill.

**The suggestion reaches the line picker as its default value, not as a save.** The category lives on the expense header and the Tax Code on each line, in two different components. Rather than couple them at save time, the resolved hint rides on the expense detail response as `categoryDefaultInputTaxCode`, and the line selector uses it as the initial value **only when the line has no Tax Code of its own**. Nothing is written until the reviewer saves the line as they normally would.

## 6. Business Journey

1. An accountant opens หมวดหมู่ค่าใช้จ่าย and sets ค่าโฆษณาและการตลาด → `O7 · ภาษีซื้อขอคืนได้ 7%`.
2. A reviewer opens an expense, sets its category to ค่าโฆษณาและการตลาด, saves.
3. In the line editor below, each line with no Tax Code now shows `O7` pre-selected. The reviewer confirms or changes it.
4. Six months later the company retires that Tax Code profile. Old expenses are untouched; new ones simply get no suggestion until the category is pointed at a code that still resolves.

## 7. Business Rules

1. `ExpenseCategory.defaultInputTaxCode` is a nullable external code string. No FK, no validation against a specific definition row at write time beyond "a code by this name exists in some profile of this company".
2. The suggestion is resolved **per line, per document date**, through the same filter the picker already applies: ACTIVE, direction `INPUT` (or `SELF_ASSESSED`), matching `transactionContext`, effective on the document date.
3. The suggestion applies **only to a line with no Tax Code selected**. It never replaces, clears, or overrides a stored selection.
4. The suggestion is never auto-saved. It is the picker's default; saving is the reviewer's ordinary action.
5. A code that does not resolve produces no suggestion and no warning. The picker behaves exactly as it does today.
6. Setting the category's default Tax Code is gated on `expense.category.manage` (the permission that already governs the category) **and** shown only when the capture policy is `FULL` — a company that is not asked Thai VAT questions is not asked this one either.
7. Changing a category's default never touches an existing expense.
8. A document type that cannot carry a Tax Code (RECEIPT, SUBSTITUTE_RECEIPT, ABBREVIATED_TAX_INVOICE, or supporting-only evidence) shows no suggestion, because it shows no picker — `allowsDomesticInputTaxCode` already governs that and is not changed.

## 8. Contract Impact

Additive:

```
ExpenseCategorySummary   += defaultInputTaxCode: string | null
CreateExpenseCategoryInput += defaultInputTaxCode?: string
UpdateExpenseCategoryInput += defaultInputTaxCode?: string | null
ExpenseDetail            += categoryDefaultInputTaxCode: string | null   // resolved from the joined category
```

Schema: one nullable column, `ExpenseCategory.defaultInputTaxCode String?`. No new table, no enum, no FK, no index — it is read only via a row already being loaded.

## 9. Permission and Audit

- Setting it: `expense.category.manage`, audited by the existing category-update audit entry, which already records the changed fields.
- Reading it: whatever already reads the category list or the expense detail. It is a configuration hint, not a fact about the company, and carries no new sensitivity.

## 10. UI Behavior

| Surface | Behavior |
| --- | --- |
| หมวดหมู่ค่าใช้จ่าย — list | A “รหัสภาษีเริ่มต้น” column showing the configured Thai display name, or `—`; an unavailable stored definition is labelled “รหัสภาษีเดิม”. The same dictionary key labels the create form. Hidden entirely under SIMPLE capture |
| หมวดหมู่ค่าใช้จ่าย — create/edit | A picker of the company's ACTIVE input Tax Codes, plus "ไม่กำหนด". Hidden under SIMPLE |
| Expense review — line Tax Code picker | Pre-selects the suggestion when the line has none. A short note names where it came from, so the reviewer knows it is a suggestion and not a stored value |
| Manual capture | No change — there is no category picker there |

## 11. Impact Analysis

**Changed:** category master (one column, contract, settings UI), expense detail response (one resolved field), the line Tax Code picker's default value.

**Unchanged, and verified:**

- *Tax sync / tax events* — read `snapshot.claimability` from the resolved component, which comes from the Tax Code the reviewer actually saved. A suggestion that was never saved is invisible to them.
- *Ledger posting* — unchanged; it reads the saved snapshot.
- *Accountant export* — unchanged. The suggestion is not a stored property of any expense.
- *Claim guard* (`validateDomesticInputVatEvidence`) — unchanged, and still the thing that refuses an unsupported claim. A suggestion cannot talk a company past it.
- *Capture policy* — the new control is one more surface that follows `FULL`/`SIMPLE`; it does not change the derivation.

**Risks**

- **R1 — a suggestion read as a decision.** Mitigated by §7.3–7.5: it fills only an empty picker, is labelled, and is never saved on its own.
- **R2 — a stale code silently mis-suggesting.** Mitigated by resolving through the same date/context/status filter as the picker; an unresolvable code yields nothing.
- **R3 — scope creep into manual capture.** Manual capture has no category. Adding one is a separate change (§4).

## 12. Edge Cases

- **E1** Category set, but the line's context is `IMPORT_GOODS` → the code does not match that context → no suggestion.
- **E2** Category set, document dated before the code's `effectiveFrom` → no suggestion.
- **E3** Two profiles both define `O7` → the picker's own list is already filtered to what is offerable; the first match in that list wins, which is the same code the user would have picked.
- **E4** Category changed after lines already have Tax Codes → nothing changes; §7.3 only fills empty pickers.
- **E5** Company has no Tax Code profile at all → the category picker has nothing to offer and shows only "ไม่กำหนด".
- **E6** Capture mode is SIMPLE → the control is hidden, and any previously stored value is left untouched and unused.

## 13. Acceptance Criteria

1. AC1 — A category can be given a default input Tax Code and it round-trips through create, list and update.
2. AC2 — A line with no Tax Code, on an expense whose category has a default that resolves for that date and context, opens with that code pre-selected.
3. AC3 — A line that already has a Tax Code is unaffected by the category default.
4. AC4 — A default that does not resolve (retired, wrong date, wrong context) produces no suggestion and no error.
5. AC5 — Opening an expense and saving nothing writes no Tax Code. The suggestion alone never persists.
6. AC6 — Under SIMPLE capture, the category tax column and control are absent; the stored value is unchanged by viewing or renaming the category.
7. AC7 — Changing a category's default leaves every existing expense's stored Tax Code untouched.

## 14. Test Cases

- Unit, `expense-category-tax-suggestion.logic.spec.ts` — resolution across the §12 edge cases: match, wrong context, out of date window, retired status, no profile, line already has a code.
- API — `defaultInputTaxCode` round-trips on create/update; `categoryDefaultInputTaxCode` appears on the expense detail and is null when the category has none.
- Web — the picker uses the suggestion only for an empty line (AC2/AC3).

## 15. Open Questions

- Q1 — Should manual capture gain a category picker so the suggestion applies there too? Assumed no for now (§4); it is the natural follow-up.
- Q2 — Should a category also suggest a WHT category? Same shape of idea, different tax, deliberately not in this spec.
