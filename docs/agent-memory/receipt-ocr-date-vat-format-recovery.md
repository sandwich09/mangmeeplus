# Agent Memory: receipt-ocr-date-vat-format-recovery

Status: DONE — implemented and locally verified 2026-08-11; not deployed
Owner: thawatchai
Scope: shared LINE/receipt date normalizer, AI Gateway receipt prompt and OCR cross-check, focused tests, receipt field-format research/spec.

Decisions:
- Fix format families at shared boundaries; do not add a Starbucks/vendor template.
- Named Thai month + 2-digit year anchors BE 25xx; named English month + 2-digit year anchors CE 20xx. Numeric 2-digit dates stay ambiguous.
- Thai month abbreviations survive punctuation loss (`ก.ค.` = `กค`, `ส.ค.` = `สค`); English accepts full/abbr and day/month order variants.
- Recover a missing date only from one unambiguous candidate attached to an explicit receipt/transaction/issue/document-date label; unlabeled or multiple candidates remain review-only.
- VAT amount is printed monetary evidence independent of a printed rate. Recover only one distinct decimal/currency amount adjacent to a strong VAT/tax amount label; never compute or guess.
- OCR output remains draft/review evidence. No schema, tax-claim, confirmation, posting, payment, or historical-data mutation.

Open questions:
- None blocking implementation. The workstation IAM identity cannot read UAT evidence objects (`s3:GetObject` and `s3:GetObjectVersion` denied), and the in-app browser has no signed-in UAT session. Diagnosis therefore used the UAT record's redacted OCR summary plus the cross-vendor format canon; no policy bypass was attempted.

Artifacts:
- `docs/research/thai-receipt-field-format-conventions.md` §§4–5
- `docs/specs/expense-receipt-upload-spec.md` §19k
- UAT observation 2026-08-11: latest LINE Starbucks record classified abbreviated tax invoice / VAT included / total 333.00, with `expenseDate` and VAT amount missing.
- `packages/contracts/src/line-ai-value-normalizer.ts` — English month-first/day-first dates, dotted/undotted Thai and English abbreviations, named-month two-digit calendar anchors.
- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts` — expanded prompt, single explicitly-labelled date recovery, single labelled printed-VAT-amount recovery.

Verification:
- Contracts focused normalizer 27/27; full contracts 121/121.
- AI Gateway focused controller/cross-check 43/43; full AI Gateway 535/535.
- `packages/contracts` and `apps/ai-gateway` typechecks passed; `git diff --check` passed.
- Negative coverage: numeric two-digit date remains ambiguous; unlabeled/multiple dates are not recovered; VAT rate-only, unlabeled, and multiple distinct tax amounts are not recovered.

Next:
- Deploy the AI Gateway/workspace build to UAT, then use “อ่านเอกสารอีกครั้ง” on the reported Starbucks draft and compare the new date/VAT fields with the visible receipt. No database migration or API/web deploy ordering requirement.
