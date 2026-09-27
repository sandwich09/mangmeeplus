# NAT-only synthetic document assets

Status: draft / UNREVIEWED by a human. No customer data, tax entitlement, payment or native LINE acceptance is certified.

These files are independent of `../mangmee-ai-reliability-assets-2026-09-27/`. The old 225-case corpus, its assets, labels and hashes remain unchanged. Its receipt image has no readable fields and its PDFs each have one physical page, so their original draft labels must not be used as visual truth for NAT.

- `receipt-clear.png`: visible Green Bowl Synthetic Cafe, 2026-09-21, subtotal 1,196.63 THB, VAT component 83.87 THB, total 1,280.50 THB. Values sum exactly; this is authored test data, not a claim about a current tax rate.
- `receipt-partial.pdf`: two actual pages. Page 1 shows Sample Catering Test Kitchen, 2026-09-20 and total 1,580.00 THB, with no separate VAT amount. Page 2 has readable lunch-catering note, Prepared lunch boxes, quantity 10 and delivery date 2026-09-20. Only customer tax ID is obscured; there is no value hidden below the black field.
- `document-unreadable.pdf`: two actual pages. Page 1 identifies replacement NAT-REPLACEMENT-002 dated 2026-09-22; no merchant or monetary fields. Page 2 has a readable synthetic test marker plus a deliberately degraded raster business body. Do not report readable business content, or call the whole page blank.

`*.label.json` records only visible fields and explicit unknowns. Reviewer fields stay null. `manifest.json` hashes exact file/label bytes and records physical page counts. `*.source.html` and `generate.cjs` preserve authored content. Run `node docs/research/mangmee-ai-natural-assets-2026-09-27/generate.cjs` only when intentionally versioning/regenerating these NAT assets; PDF creation metadata may change byte hashes. Existing Playwright and Poppler are used, with no external resources or new dependency.

AI visual inspection is supporting evidence only. Independent human review and actual-model extraction remain separate pending checks.
