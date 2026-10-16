# OCR round C — benchmark corrections

Owner direction: 2026-10-16. Scope: existing LINE/web receipt capture; always on, no new dependency,
flag, database shape or final-mutation authority. Original benchmark evidence in `.ocr-bench/` stays local.

1. LINE PDF files use the same guarded upload completion and EXPENSE capture job as web PDFs,
   with one-page reading/windows and the existing access-checked result card. Pending-media receipt
   resolution must also queue this reader after attachment completion; redelivery reuses the job.
   Never send a whole PDF to `receipt-ocr`, which intentionally returns `PDF_CAPTURE_REQUIRED`.
2. Reconciliation counts printed VAT once. Rows/charges already matching the printed total are
   inclusive; add the printed tax for explicit additional VAT, or when that addition alone proves
   the exclusive breakdown against the printed total. Never invent VAT or hide another difference.
   Benchmark subtotal + VAT = total: 560,360.75 + 39,225.25 = 599,586.00;
   796,262.25 + 55,738.36 = 852,000.61; 1,050,447.00 + 73,531.29 = 1,123,978.29;
   1,670,195.75 + 116,913.70 = 1,787,109.45. Missing-page evidence remains independent.
3. Keep the earliest non-empty valid issuer name/tax ID/branch/address and its source evidence.
   A 13-digit ID selected from the same printed dash/space-separated ID is valid (for example
   `0105473325385` from `0-1054-73325-38-5`); never accept an unprinted digit sequence.
   Later omissions/empty/invalid fields cannot erase it. A different valid issuer tax ID on a
   continuation keeps the original identity, adds a contradiction and requires human review;
   do not fill identity fields from that conflicting issuer.
4. Stage-2 receipt extraction, including extraction after a reread/structural repair, gets exactly
   one timeout-only retry through normal provider admission/usage. Capture window extraction gets
   the same one API-managed timeout retry as capture reads, with a distinct attempt and existing
   job call/time/lease ceilings. No retry for credit refusals or other errors. Receipt chain bound
   becomes eight calls (read/extract/reread/extract, at most two attempts each); caller waits longer.
   Failed attempts remain company-absorbed; successful retries alone consume customer AI money.
5. Before applying unreviewed OCR vendor identity, a valid extracted seller tax ID matching exactly
   one ACTIVE counterparty in that company supplies its legal name (falling back to display name), regardless of OCR
   misspellings (`ซัพพลาย` → `ชัพพลาย`, doubled syllables). Reuse the vendor autosave registry seam.
   No ID, zero matches, duplicate matches (including branches), unavailable registry or reviewed
   identity means retain the OCR/reviewer name. Keep original OCR fields/evidence unchanged.

Acceptance: registered specs prove all five paths and the benchmark values, inclusive/exclusive
VAT, invalid/contradicting identity, retry bounds/accounting, exact-one company-scoped lookup and
review protection. Build contracts; package typecheck API/gateway; run full gateway/contracts
scripts and every registered API spec importing changed implementations. No commits/package edits.
