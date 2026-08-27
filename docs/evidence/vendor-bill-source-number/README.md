# Vendor bill capture — local acceptance

2026-08-27; actual Chrome, local web3000/API3001. Capture only: no approval,
payment, posting, subscription, bank integration or reconciliation was performed.

## Findings and corrected UI

- [Before: supplier options have no visible names](before-empty-supplier-options.jpg).
  The actual API supplies `displayNameSnapshot`; the form had cast it to `displayName`.
- [After: named supplier and labeled source/date/amount fields](desktop-labeled-source-form.jpg).
- [Before: duplicate error is above the mobile viewport](mobile-duplicate-before-focus-fix.jpg).
  Measured alert top −553 / bottom −467 at390×844; the screenshot is a failure example.
- [After: mobile duplicate error and preserved source number](mobile-duplicate-focused.jpg).
- [Second identical duplicate still focuses the error](mobile-repeat-duplicate-focused.jpg).
- [Desktop duplicate error](desktop-duplicate-focused.jpg).

Actual DOM measurements after each mobile retry: alert top84/bottom170, header bottom68,
computed scroll margin84px, focused=true, no horizontal page overflow. Desktop1280×900:
top84/bottom130, focused=true, no overflow. Chrome warning/error log returned an empty list.
These are viewport tests, not physical-device or actual-user40+ certification.

## Persisted capture proof

Entered through Chrome: supplier `seed-supplier-beauty-supply` (บริษัท บิวตี้ ซัพพลาย จำกัด),
source `CHROME-CAPTURE-20260827-01`, one line125.50, draft only. A read-only PostgreSQL check
after all duplicate attempts found **one** bill `cmtay6ucu0066tak1roc4ke68`, status`DRAFT`,
netPayable125.5000 and no taxInvoiceNumber. This specifically preserves source identity
without asserting a tax-invoice identity. The labeled local draft is retained, not deleted.

```sql
SELECT id, "supplierId", "supplierDocumentNumber", status,
       "netPayableAmount", "taxInvoiceNumber"
FROM "VendorBill"
WHERE "companyId" = 'seed-local-company'
  AND "supplierId" = 'seed-supplier-beauty-supply'
  AND "supplierDocumentNumber" = 'CHROME-CAPTURE-20260827-01';
```

## Reproducible checks

`pnpm exec playwright test e2e/accounts-payable.spec.ts --project=chromium --workers=1`
passed **6/6** on the final submit-scoped implementation. AP-03 selects a different real
supplier, verifies POST/API source identity and twice-repeated mobile duplicate focus;
AP-04 proves blank/whitespace numbers remain optional and create distinct drafts.
AP-05 mocks only a background supplier GET403 and verifies no focus/scroll theft;
it is UI error-path evidence, not a real authorization regression test.

Full web tests1126/1126, procurement DTO tests32/32, web typecheck and diff check passed.
After rebasing onto develop78057e38: AP6/6, web1129/1129 (including three merged
partner-copy tests), typecheck and diff check passed again; screenshots retain their
pre-rebase capture provenance.
E2E retains its normal labeled draft fixtures; none are approved or paid by the new cases.
The original default-first supplier behavior and100-row cap remain unchanged.
Visible labels and ARIA names are verified; native label-tap behavior for the existing
summary-based ThemedSelect and complete P24 UX remain outside this bounded correction.
See [task memory](../../agent-memory/vendor-bill-source-number.md) for initial failures,
Opus findings/dispositions and integration status.
