# Agent Memory: expense-manual-service-charge

Status: DONE 2026-08-05 — implemented, verified, committed on `develop` in one commit together
with the [[expense-manual-vat-mode-and-discount]] change this builds on (the two rewrote the same
totals block and were no longer separable into compiling commits). NOT pushed (owner pushes; see
[[watchdog-no-push-credentials]]).

Owner: thawtchai (asked whether AI bill reading, manual entry, and every capture channel support a
service charge, then asked for the gap to be closed so all channels run one logic)

Scope: `apps/web` only — `ExpensesPages.tsx` (`ManualExpensePanel`), `expenses.model.ts`,
`workspace-dictionary.ts`, `expenses.model.spec.ts`. No contract, API, schema or AI-Gateway change.

## Triage

Channel audit before the change:

| Channel | Service charge |
|---|---|
| `WEB_UPLOAD` (receipt OCR) | Yes — `ReceiptOcrFieldResult.additionalCharges`, kind `SERVICE_CHARGE` |
| `LINE_UPLOAD` | Yes — same `ReceiptOcrApplyService`, so identical behaviour |
| `WEB_MANUAL` | **No** — the form hard-coded a single `lineNumber: 1` line |
| `API_INTERNAL` | N/A — reimbursement claim materialisation, does not read bills |

So the gap was one channel, and only at capture time: the draft review form could already add a
second line by hand.

## Decisions

1. **Manual emits the OCR path's line shape, not a new field.** `prepareOcrLines`
   (`receipt-ocr-apply.service.ts:301`) writes a reconciled charge as `quantity '1' × printed amount`
   at the charge's VAT rate. `buildManualExpenseLines` writes the same thing. No
   `serviceChargeAmount` column, no migration — the spec's §4 non-goal still holds.
2. **The charge line inherits the document Tax Code, unlike the OCR charge line.** OCR never selects
   a Tax Code at all (§4: no automatic tax-code selection), so its charge line having none is
   consistent. In manual capture the user has explicitly picked one for the document, and the
   claimable-VAT confirm gate (`hasMissingClaimableVatTaxSnapshot`) checks every line with VAT — a
   charge line without a snapshot would block confirmation on a `CLAIMABLE` document.
3. **The charge line carries no discount.** Spec §7.1: charges are additive only, discounts stay in
   `discountAmount`. The printed discount reduces the item.
4. **The summary preview is derived from the exact `lines` array that gets sent**, not recomputed
   from the form fields, so the preview cannot drift from the draft. Same per-line arithmetic the
   review form uses (`expense-review-validation.computedGrandTotal`), now folded over N lines.
5. **One service charge, not the full seven kinds.** `RECEIPT_ADDITIONAL_CHARGE_KINDS` also has
   DELIVERY / PACKAGING / PLATFORM_FEE / TIP / ROUNDING / OTHER. The owner asked about service
   charge; the second line is already generic, so adding an input per kind is a UI change only.

## Out of scope (flagged, not changed)

- Delivery/packaging/tip/rounding inputs — see decision 5. Delivery and tip were built on the owner's
  follow-up and then **dropped the same day** at their call: they do not expect bills printing those
  in this business. Do not re-propose them without a real bill. The shape that worked, if one ever
  turns up: `buildManualExpenseLines` takes a generic `charges: Array<{description, amount,
  outsideVatBase?}>` list instead of the single service-charge pair, the form renders one input per
  entry of a `MANUAL_CHARGE_FIELDS` table, and a tip sets `outsideVatBase` — rate `0` **and no Tax
  Code**, because `resolveLines` rewrites `vatRate` from the code's snapshot
  (`expense-transaction-tax.service.ts:62`) and would put the 7% back. Both commits were rewound
  before pushing, so they are not in history.
- No back-fill of manual drafts already captured with the charge folded into the unit price.
- The manual form still creates at most two lines; multi-item bills stay a review-form job.

## Open questions

None blocking.

## Artifacts

- `apps/web/src/features/expenses/expenses.model.ts` (`buildManualExpenseLines`)
- `apps/web/src/features/expenses/ExpensesPages.tsx` (`ManualExpensePanel`)
- `apps/web/src/common/i18n/workspace-dictionary.ts` (`expenses.manual_service_charge*`, th + en)
- `docs/specs/receipt-additional-charges-reconciliation-spec.md` §12, §15
- Predecessor: [[expense-manual-vat-mode-and-discount]] (this builds directly on its discount field)
- Spec ancestry: [[expense-service-charge-total-preservation]]

## Verification

- `tsx --test apps/web/src/features/expenses/expenses.model.spec.ts` + `expense-review-validation.spec.ts`:
  62/62 pass.
- `tsc --noEmit -p apps/web/tsconfig.json`: clean. `git diff --check`: clean.
- New coverage: the spec §15 acceptance case (`1,000 + service 100 + VAT 77 = 1,177`) typed by hand
  now yields the same two lines and the same total the OCR path produces; blank/`0`/omitted charge
  still yields one line.
- **Not verified in-browser** — same blocker as the predecessor task: no dev-server session and
  entering the owner's credentials is not permitted.

## Next

Owner: open บันทึกค่าใช้จ่ายด้วยมือ, type a bill with a separate service charge, and confirm the
draft opens with two lines and the summary total matches the bill.
