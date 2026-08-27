# Expense VAT-included review navigation

Status: implemented, verified and integrated into remote develop, 2026-08-27.

## Product and acceptance

A reviewer selecting VAT_INCLUDED on a 25-baht receipt can see why Next is blocked,
reach the required input, enter an explicit rate or usable printed VAT amount, and
save/advance. The inclusive gross remains 25 baht. Selecting price mode alone does
not imply 7%, zero, exemption, or non-VAT.

- Preserve current SIMPLE/FULL visibility of VAT arithmetic.
- Show the first blocking reason beside Next, with a keyboard-accessible action
  that scrolls/focuses the invalid review control; not only a disabled-button tooltip.
- Unknown line rates remain blocking unless the submitted VAT source supplies them
  through an existing server-supported path: document RATE/BOTH, document AMOUNT
  with all lines unknown, or line-specific RATE/BOTH/AMOUNT.
- Reject absent/invalid amount evidence and do not allocate a document amount across
  known-plus-unknown mixed rates. Explicit zero remains known and is not overwritten.
- Client validation may allow source-only draft save; ERP Core remains authoritative
  for rate derivation, totals, tolerance, ambiguity, and final confirmation.
- Retain expectedUpdatedAt, permissions, pending-save behavior, typed input on
  failure, retry, and existing confirmation restrictions.

This is a navigation/validation repair under expense-receipt-upload-spec §19g and
expense-vat-source-reconciliation-spec §§8–11, not a tax-policy change. No schema,
dependency, WHT UI, tax-treatment, historical data, or deployment change.

## Verification

Cover blank/known/zero rates in both price modes; valid document/line source amount;
invalid evidence; mixed known/unknown ambiguity; included gross and accepted VAT;
Next save/advance, failure/retry, and visible focusable errors using a synthetic local
browser fixture with no customer database. Record exact commands and limitations in
the task memory.
