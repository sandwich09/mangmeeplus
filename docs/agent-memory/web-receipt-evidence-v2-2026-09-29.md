# Agent Memory: web receipt reads and strict evidence v2 (2026-09-29)

Status: option A implemented (web reads like LINE). The Owner then decided to delete strict receipt evidence
entirely ("ลบทิ้งเลย"); that removal is a separate follow-up PR. Option B (make strict mode pass real receipts)
is closed.
Owner: Claude (diagnosis and fix) for the 2026-09-29 coordinator session.
Scope: web receipt photo read (`ReceiptOcrClient`) and the PDF/file read job (`ExpenseCaptureReadRunnerService`).

Decisions:
- Since dd086233 (2026-09-27) `LINE_AI_RELIABILITY_V2_MODE` defaults to `on` and an empty company list admits
  every company, so every web read asked the gateway for strict evidence. UAT and Production leave both unset.
- Option A (Owner, 2026-09-29, "ก. ให้เว็บอ่านแบบ LINE"): strict evidence only on an explicit request
  (`ReceiptOcrRequest.requireEvidenceV2`, `runClaimed(job, { fieldEvidenceV2 })`), never from the reliability
  default. No production caller asks, so the web reads like LINE's `requestReceiptOcr`.
- The PDF read job is shared by web PDF uploads and the LINE `file` lane (`ExpenseCaptureLineUseCase`), so both
  return to the pre-27-Sep read. LINE photos are unchanged.

Diagnosis (evidence):
- UAT 2026-09-29 had no web receipt reads (8 LINE reads, all OK). The "6/6" came from a local probe that forced
  strict mode on the LINE path. The model returned `fieldEvidence` in 11 of 12 outputs; the gateway's citation
  checks rejected them with `OCR_SCHEMA_INVALID`, so the API check (`OCR_EVIDENCE_INVALID`) was never reached.
- Real web-path probe, Sonnet 4.6, develop 3d7b4d6c: strict mode failed both owner photos with
  `OCR_SCHEMA_INVALID` after 3 paid calls (55-63 s). The same photos without strict mode read in 2 calls.
- Failing rules, from 16 strict outputs replayed through develop's parser:
  - Branch: the printed "00013" is compared with `String(Number(value))` ("13"), a colon ("Branch: 00013") is not
    allowed, and the label is required before a quote that already contains it. "สาขาที่ 00013", "สาขาที่ 13",
    "Branch: 00013" and "สำนักงานใหญ่" are all rejected. The API verifier has the same comparison.
  - Label lists are too narrow: VAT amount lacks "VAT 7%" / "VAT(7%):"; taxable base lacks "Before VAT" /
    "ก่อนภาษี"; document number lacks "Tax Invoice (ABB):".
  - Fields that cannot be quoted have no citation: summary description, currency when THB is not printed,
    VAT mode, and a service charge's VAT rate.
  - A number twice in one row, wrapped addresses, and model key drift (`lines[0].amount`, citations outside
    `fields`, extra citations for `vendorEntityKind` / `categorySuggestion`).
  - One failed field discards the whole read, and the repair retry fails the same way.

Open questions: none for option A.

Artifacts: session scratchpad `webrcpt-*` (UAT read-only queries, replay scripts, probe JSON). Owner photos
stay out of the repo.

Verification (option A, branch claude/web-receipt-evidence-fix-20260929):
- Red first: 3 new or changed specs failed on develop, then passed.
- expense-extraction + capture-read-runner specs 90/90; onboarding PG spec 1/1 on fresh Postgres 18.3
  (migrate deploy + sync-permissions); API and web typecheck rc=0; W00 manifest 4/4 (no hashed file changed);
  whole-chain acceptance exit 0 (3,421 pass, 0 fail).
- Real web-path probe through the fixed `ReceiptOcrClient` (UAT defaults): Tamphun ok, 21 fields, total
  1712.54, VAT 112.04; IBERRY ok, 21 fields, total 1,529.00, VAT 100.03; 2 model calls each, about 30 s.

Next: follow-up PR removes the strict receipt evidence path end to end.
