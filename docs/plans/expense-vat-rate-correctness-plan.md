# Expense VAT Rate Correctness Implementation Plan

## Status

Implemented and verified 2026-08-04, not committed. Scoped to the expense VAT-rate path only; no schema change, no data migration. Results and defect list in `docs/agent-memory/expense-vat-rate-correctness.md`.

One defect surfaced during implementation that this plan did not predict: `completeVatFields` also required `printed > 0`, so it deleted a printed zero rate. §19f decision 3 ("explicit line VAT rate 0 remains zero") had only been holding because the `defaultLineVatRate` fallback re-added a `'0'`; removing that fallback in step 3 exposed it. Fixed in the same step.

## Linked Specs

- Spec: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]] §19g (authority for this plan), building on §19c (VAT capture vs claimability), §19d (satang rounding), §19f (additional charges)
- Task memory: `docs/agent-memory/expense-vat-rate-correctness.md`
- Related specs:
  - [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
  - [[specs/receipt-additional-charges-reconciliation-spec|Receipt Additional Charges and Total Reconciliation Spec]]

## Purpose

Stop the expense pipeline from recording a guessed VAT rate. An unread rate currently becomes `0` at capture and `7%` on the next server recompute, so the reviewer's preview and the stored record disagree, and a document whose VAT went missing is presented as a legitimate non-standard rate. Make "unknown" an explicit third state that blocks confirmation, and give the reviewer a way to enter what the document actually prints — a percent, a preset, or the printed VAT amount in baht — so genuinely non-7% documents (zero-rated, exempt, foreign VAT, per-line rounding) are expressible.

## Non-Goals

- Whether ใบกำกับภาษีอย่างย่อ (ABB) may support an input-VAT claim. Tax-policy decision with existing-data impact; flagged in §19g and task memory.
- Promoting zero-rated supply to a first-class `vatMode` alongside `EXEMPT`.
- `accounting-documents` and `procurement` VAT paths (percent units, separate totals logic).
- Any migration of stored rows. §19c decision 5 precedent: heal on re-extraction or next review save.

## Steps

### 1. Contracts — honest VAT mode labels

`packages/contracts/src/expenses.ts`

- `EXPENSE_VAT_MODE_LABELS`: drop the hardcoded `(7%)` from `VAT_INCLUDED`/`VAT_EXCLUDED` (§19g decision 3).
- Add `effectiveVatRateLabel(lines)` returning `'7%'` | `'0%'` | `'หลายอัตรา'` | `'ยังไม่ระบุ'` from the distinct known rates on the stored lines, so the rate is displayed where the mode is displayed.

### 2. AI Gateway — keep a printed zero rate

`apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts`

- Document `vatRate` sanitizer: accept `0 <= r < 1` instead of `0 < r < 1` (§19g decision 2). `r >= 1` still drops as a misread percentage.

### 3. API — unknown stays unknown

- `apps/api/.../domain/logic/expense-totals.logic.ts`: `taxRate` no longer defaults blank/absent to `0.07`; unknown contributes zero VAT rather than a guess.
- `apps/api/.../application/services/receipt-ocr-apply.service.ts`: `defaultLineVatRate` returns `null` instead of `'0'` when the document neither printed nor proved a rate. An extracted `vatRate` (including `'0'`) and the `vatAmount`-implies-7% path are unchanged.
- `apps/api/.../application/use-cases/expense-extraction.use-case.ts`: report `vatRate` in `missingFields` when the applied line has no rate and the mode is `VAT_INCLUDED`/`VAT_EXCLUDED`.
- `apps/api/.../domain/logic/expense-status.logic.ts`: `validateConfirm` rejects a `VAT_INCLUDED`/`VAT_EXCLUDED` expense holding a line with no rate (§19g decision 1). Other modes unaffected.

### 4. Web — enter what the document prints

- `apps/web/.../expenses.model.ts`
  - `calculateManualExpenseTotals`: unchanged semantics (blank → 0), now matching the API.
  - `buildExpenseDraftReviewPayload`: send `vatRate` explicitly instead of dropping a blank one, so preview equals stored.
  - `vatRateFromPrintedAmount(...)`: derive the stored fraction from a printed baht amount per mode (§19g decision 4).
  - `deriveExpenseAuditChecks`: compare against the document's own effective rate; `warn` when a VAT mode records no VAT and no rate, `info` when a known rate is simply not 7%, `pass` when VAT matches its own rate (§19g decision 5).
- `apps/web/.../expense-review-validation.ts`: blank line rate under a VAT mode is an error (`expenses.v_vat_rate_required`).
- `apps/web/.../ExpensesPages.tsx`: line VAT editor becomes preset (`7%` / `0%` / กำหนดเอง) + percent input + printed-VAT-amount input, all writing the existing fraction field. Mode select shows the effective rate beside it.
- `apps/web/.../ExpenseReviewPage.tsx`: money card VAT row shows the effective rate.
- `apps/web/src/common/i18n/workspace-dictionary.ts`: th/en keys for the presets, the printed-amount field, and the new validation message.

### 5. Tests

- `expense-totals.logic.spec.ts`: blank rate under each VAT mode yields zero VAT, not 7%.
- `receipt-ocr-apply.service.spec.ts`: unread VAT yields a null line rate (not `'0'`); an explicitly printed `0` still yields `0`; the Starbucks triple `168.22 / 11.78 / 180.00` resolves to rate `0.0700`.
- `expense-status.logic.spec.ts`: confirm blocked for a VAT-mode expense with an unknown line rate; allowed for `NO_VAT`/`EXEMPT` and for an explicit `0`.
- `expenses.model.spec.ts`: printed-amount → fraction for both VAT modes; effective-rate label for single/mixed/unknown; audit check warn/info/pass split.
- `expense-review-validation.spec.ts`: blank rate under a VAT mode is an error; blank under `NO_VAT` is not.
- Gateway controller spec: printed `"0"` survives sanitization; `"7"` still drops.

### 6. Verification

- `pnpm -C apps/api test`, `pnpm -C apps/web test`, `pnpm -C apps/ai-gateway test`
- `pnpm typecheck`
- Record results in task memory.

## Rollout

Additive behavior change with no contract or schema change; api, web, and ai-gateway can deploy in any order. The confirmation gate (step 3) is the only user-visible block — it fires exactly on the drafts that already carry a wrong tax base, and the review form now offers three ways to resolve it.
