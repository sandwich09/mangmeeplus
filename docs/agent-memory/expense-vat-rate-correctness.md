# Agent Memory: expense-vat-rate-correctness

Status: DONE 2026-08-04 — implemented, self-reviewed, verified, committed on `develop`. NOT pushed (owner pushes; see [[watchdog-no-push-credentials]]).
Owner: thawtchai (report: Starbucks ABB slip `11.78 VAT TTL` / `Net TTL 168.22` / paid 180.00 shows `VAT รวม (7%)` in the header but `VAT ฿0.00` and taxable ฿180.00 in the money card; owner asked what a non-7% document should look like)

Scope: `packages/contracts` (VAT mode labels), `apps/ai-gateway` (receipt OCR rate sanitizer), `apps/api` expenses (totals default, OCR apply fallback, confirm gate), `apps/web` expenses (rate editor, effective-rate display, audit check, payload builder), spec + plan + tests.

## Triage of the owner report

The reported slip is **not** a non-7% document. `180 × 7/107 = 11.78` and `180 − 11.78 = 168.22 = "Net TTL"`. It is an ordinary VAT-included slip whose printed VAT the model failed to read; the fallback then asserted rate `0`. The non-7% question is real but separate, and both are covered here.

## Decisions

1. **"Unknown rate" is a third state, not zero and not 7%.** Spec §6 already binds AI to "unknown values stay blank or NEEDS_REVIEW"; the arithmetic layers violated it in opposite directions (API blank → `0.07`, web blank → `0`). Blank now means unknown everywhere: totals treat it as 0 so nothing is invented, the review form raises a field issue, and confirmation is blocked while a VAT-mode document still has an unknown line rate. See spec §19g.
2. **Explicit zero survives.** §19f decision 3 (`explicit line VAT rate 0 remains zero`) is unchanged. Only the *unknown* case stops masquerading as zero — `defaultLineVatRate` returns `null` instead of `'0'` when no rate was printed or proven, and reports `vatRate` in `missingFields`.
3. **A printed 0% rate is data.** The gateway sanitizer accepts `0 <= r < 1` for the document rate, matching the prompt it already ships and the `additionalCharges` rule.
4. **The header stops claiming a rate.** `EXPENSE_VAT_MODE_LABELS` drops the hardcoded `(7%)`; the effective rate is derived from the stored lines and displayed next to the mode (`· 7%`, `· 0%`, `· หลายอัตรา`, `· ยังไม่ระบุ`).
5. **The reviewer may enter what the receipt prints.** The line editor takes a preset (7% / 0% / กำหนดเอง), a percent input, or the printed VAT amount in baht, and back-solves the stored fraction. Storage stays the expense-side fraction (§G7: expense lines use `0.07`, tax config uses `7`, bridged by `taxDefinitionRateForSource`) — no third unit is introduced.
6. **No historical migration** — same precedent as §19c decision 5. Existing rows heal on re-extraction or the next review save.

## Out of scope (flagged, not changed)

- ~~`TAX INVOICE (ABB)` / ใบกำกับภาษีอย่างย่อ is classified as a full `TAX_INVOICE` and can reach `USABLE_FOR_TAX`.~~ **Resolved 2026-08-04** — owner confirmed the rule and it is fixed under spec §19h; see [[expense-abbreviated-tax-invoice]].
- Zero-rated vs exempt as distinct first-class modes. PP30 keeps separate boxes (`box2ZeroRatedSales` vs `box3ExemptSales`), so the distinction matters downstream, but today `EXEMPT` is a mode and 0% is a rate. Left as-is.
- ~~`deriveTaxEvidence` accepts a `hasVatAmount` input that the body never reads (dead parameter).~~ Removed 2026-08-04 in the §19h pass.
- `accounting-documents` and `procurement` carry their own VAT paths in percent units; untouched.

## Open questions

None blocking.

## Artifacts

- Spec: `docs/specs/expense-receipt-upload-spec.md` §19g
- Plan: `docs/plans/expense-vat-rate-correctness-plan.md`

## Defects fixed

1. **Blank rate meant two different things.** `expense-totals.logic.taxRate` defaulted blank to `0.07` while the web preview treated it as `0`, and `buildExpenseDraftReviewPayload` dropped a blank rate from the PATCH entirely — so clearing the rate field previewed VAT ฿0.00 and stored 7%. Blank now means unknown on both sides, travels explicitly in the payload, and normalizes to a stored NULL via `storedRate` in `expense-draft.use-case`.
2. **Unknown was written as an explicit zero.** `defaultLineVatRate` returned `'0'` when nothing was printed or provable, asserting a zero-rated supply on every slip whose VAT the model failed to read; it now returns `null` and the extraction reports `vatRate` in `missingFields`.
3. **A printed 0% rate was discarded twice.** The gateway sanitizer required `rate > 0`, and — found only after fix 2 removed the fallback that had been masking it — `completeVatFields.printedUsable` required `printed > 0` as well. Both now accept `>= 0`, so §19f decision 3 holds on its own rather than by accident.
4. **The audit checklist measured every document against a hardcoded 7%**, reporting a draft with the VAT missing as a legitimate non-standard rate. It now compares against the document's own per-line rates and separates missing (`warn`) from non-7% (`info`) from contradicted (`warn`).
5. **No confirmation gate existed.** `validateConfirm`'s OCR total check cannot see this defect (the gross is right, only the split is wrong), so `hasUnknownVatRateLine` was added to the confirm path.

Also fixed during self-review, in code written this session: the VAT preset select could not reach its own "custom" branch from the unset state (both store `''`), so the preset needed sticky per-line component state; and the printed-VAT drafts are index-keyed, so deleting a line cleared them rather than shifting them onto the wrong row.

## Verification

- `apps/api` full suite exit 0 (expense specs 107/107 on the touched files); `apps/web` 671/671; `apps/ai-gateway` 517/517.
- Typecheck clean: contracts, api, web, ai-gateway. `apps/web` lint clean. Contracts `dist` rebuilt (gitignored).
- New coverage: blank-vs-7% in `expense-totals.logic.spec`; unknown/explicit-zero/Starbucks-triple in `receipt-ocr-apply.service.spec`; `hasUnknownVatRateLine` in `expense-status.logic.spec`; `missingFields` wiring in `expense-extraction.use-case.spec`; printed-amount derivation, presets, percent conversion and effective-rate label in `expenses.model.spec`; required-rate validation in `expense-review-validation.spec`; printed `"0"` survival in the gateway controller spec.

## Next

Owner reviews and pushes. After deploy, the reported Starbucks draft heals via "อ่านเอกสารอีกครั้ง" (which should now read `11.78` into `168.22 / 11.78 / 180.00`), or by picking the `7%` preset / typing `11.78` in review. Deploy order is free — additive behavior, no contract or schema change.

Note: while this work was in progress the working tree also carried an unrelated in-flight change from another session (`ThemedSelect`/`PopoverPanel` dropdown width + wrapping, accounting-tax-setup copy). Left untouched; it happens to complement the long preset labels added here.
