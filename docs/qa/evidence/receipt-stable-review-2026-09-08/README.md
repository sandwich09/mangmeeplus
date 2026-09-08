# Stable receipt form evidence — 2026-09-08

Corrective implementation: all owner/reviewer LINE receipts use the ordinary PANDA MALA three-step form. The missing-data overview is removed; existing themed inputs and inline guidance remain. Business purpose is optional across web/API/source rules.

All images are captures of the real modified local web application using synthetic receipts, seeded company and a one-pixel generated attachment. They are not live customer screenshots or proof of live LINE delivery. The synthetic Drtb case deliberately uses tax-exclusive line price 51.40 plus VAT 3.60 = total 55 to prove an unbound OCR gross 55 cannot overwrite accepted finance; this is not a claim about the live Drtb record’s VAT mode. PANDA retains four financial lines and total 300. Both use the seeded meals category.

- `drtb-stable-form-*` / `drtb-stable-line-*`: same ordinary form with unknown date blank, preserved category and accepted amounts.
- `receipt-one-form-*` / `receipt-purpose-*`: PANDA form, original input layout, voluntary purpose.
- `receipt-review-dropdown-*`: shared theme, active option, popup bounds at 390px/1280px.
- `receipt-saved-toast-*`: actual success toast after a real API write.

Browser acceptance: **11/11 passed**, real local API/PostgreSQL/MinIO/session permissions. Initially incomplete no-money receipts save/reload blank facts, then fill visible mandatory fields while purpose stays blank, progress through all three steps, POST reviewer-mark-ready and read READY_FOR_CONFIRMATION from the database. Original image and row identities remain; Drtb/PANDA amounts/category remain; blank quantity can be explicitly confirmed as the old placeholder value 1; stale save returns 409; originating upload-only access remains restricted; legacy READY reopens safely.

PANDA mobile also proves WHT 0 has no payee-class requirement, WHT 3 reveals the invalid visible selector and disables Next, and returning to 0 removes that requirement. Injected local API/network failures prove one human-readable toast, preserved input, and truthful saved-but-readback-failed feedback. No Production mutation or customer message was performed.

Web full suite **1,678/1,678**; focused receipt/source **46/46**; web typecheck passed. API/PG and release results are recorded in `docs/agent-memory/receipt-stable-review-release-2026-09-08.md`. Earlier preview evidence is historical and superseded for form selection by this directory.
