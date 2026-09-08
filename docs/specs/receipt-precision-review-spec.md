# Receipt precision and live review totals

Status: owner approved implementation, combined merge and UAT deployment on 2026-09-09. Production remains held. Supersedes the earlier hold on rounding and the add-row branch.

## Outcome and boundaries

The entrepreneur checks a familiar receipt form and saves it. A calculated precision adjustment is system-owned, not a service to enter. Preserve the PANDA MALA form, optional purpose, themed controls, draft feedback and add-row scrolling.

- Recognize existing calculated ROUNDING rows by server-held provenance, not amount, description alone or client claims. Retain printed rounding (e.g. Shichi -0.72) as real document evidence.
- Keep calculated rows in the financial/audit representation but omit their editable controls and ordinary service summary. They must not become a hidden required field. Show printed rounding in the money summary.
- Retain the bounded fuel adjustment only while the original fractional quantity, unit price and document arithmetic still justify it. Recompute from receipt evidence; never trust an edited adjustment amount. If merchandise, taxes or charges change beyond that evidence, discard the obsolete calculated adjustment, calculate the edited amounts and retain the existing discrepancy review path. Never balance an arbitrary missing item or tax error to the OCR total.
- Use the same API calculation path for a read-only preview and save (VAT source reconciliation, WHT and Decimal satang rounding). Debounce edits, discard stale responses, show a calculating/error state instead of presenting stale totals as current. Preview never saves, marks reviewed, posts, pays, emits LINE messages or writes audit/outbox records.
- Draft save may retain a monetary discrepancy. Final confirmation preserves existing amount-bound reviewer correction/acknowledgement and independent VAT gates. A corrected OCR reading is allowed through explicit review; no unconditional AI-truth lock and no relaxed tolerance. Show an understandable amount difference/reason.
- Preview and save must enforce tenant, branch, ownership/review permission and expected revision. API normalizes system-owned adjustments independently of the UI. No schema migration, tax-policy change, dependency or feature flag.

## Plan and acceptance

1. Reuse the existing draft calculation with a read-only return before persistence; add bounded adjustment normalization against stored source evidence.
2. Wire latest preview totals into the existing money card. Suppress only provenance-proven calculated adjustment controls, preserve actual charges/printed rounding and source line numbering.
3. Verify fuel 61.488 × 39.19: gross2409.70/VAT157.64; repeated save and edited/forged adjustment; quantity/price/service edits; negative printed rounding; mixed VAT; VAT+WHT and explicit base; invalid/blank fields; draft discrepancy versus confirmation; stale/forbidden/cross-tenant preview; preview has zero writes. Browser: mobile/desktop, add-row scrolling, asynchronous preview races/error handling.
4. Run focused API/web/type checks and exact PR CI, merge the reviewed head into develop/main, deploy one canonical UAT run, verify signed Passport, deployed preview/save/reload and customer OPEN. Record exact UAT/READY IDs; do not deploy Production.

## Impact

Shared draft callers retain mutation behavior and final gates. Old clients cannot change system-owned precision by editing its line; direct saves recompute it. Historical confirmed receipts are not rewritten. Source evidence, money and UI presentation remain distinct, with no new editable tax field or alternate form.
