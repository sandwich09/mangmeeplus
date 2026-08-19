# Agent Memory: ocr-outcome-observability

Status: code change done, verified locally; needs UAT deploy + ~1 week of data before the
Typhoon-vs-vision decision can be made on evidence.

Owner: thawatchai

Scope: `expense.ocr.request` audit completeness on both intake channels.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts`

## Why this exists

Production feedback: receipts often "อ่านไม่ออก", handwriting especially. The proposed fix was
swapping Typhoon OCR for Bedrock vision at stage 1. Before committing to a vendor swap we queried
UAT (129 `expense.ocr.request` rows, 2026-07-21 → 2026-08-18) and found the evidence could not
support the decision.

## Findings from UAT

- `HANDWRITTEN_CASH_BILL`: 8 rows, **all `status: ok`**, avg 7.9 recognized fields (vs
  TAX_INVOICE 12.6). When Typhoon completes a handwritten bill it does extract.
- `UNREADABLE_OR_CROPPED`: **0 occurrences in 129 rows.**
- Top reason codes: `MISSING_VENDOR_TAX_ID` 26, `MISSING_DOCUMENT_NUMBER` 12 — i.e. the dominant
  measurable defect is stage-2 omission, matching §8 "Collision traps observed on UAT" in
  `docs/research/thai-receipt-field-format-conventions.md`. A stage-1 reader swap does not fix it.
- 15 `failed` rows carried `{documentKind: null, reasonCodes: [], modelLineage: []}` — no cause.
- 35 rows (27%) had **no `status` key at all**, and that shape was *growing* (7 of 7 rows on
  2026-08-18). Traced to the LINE path, not a stale deploy.

## Root cause found

`decideLineBusinessDocument` returns `clarify` when `ocr.status !== 'OCR_EXTRACTED_NEEDS_REVIEW'`,
which early-returns before any expense is created. The LINE `expense.ocr.request` audit sat *after*
that return **and** was guarded on `OCR_EXTRACTED_NEEDS_REVIEW`, so:

- LINE success → 1 row with only `{documentKind, recognizedFieldCount}`
- **LINE failure → zero rows**

Every unreadable image on the channel where users actually report the problem was absent from the
audit log. `tryExtractReceiptFields` also discarded the gateway's `errorCode` on the failure branch.

## Decisions

- Do **not** swap Typhoon for vision AI yet — UAT evidence points at stage 2, not the reader.
- `documentKind` on a failed read is not recoverable: the gateway returns no classification because
  nothing was read. `errorCode` is the usable discriminator instead —
  `OCR_EMPTY_OUTPUT` = image genuinely unreadable (the handwriting signal),
  `PROVIDER_TIMEOUT`/`PROVIDER_*` = never got a response, `OCR_JSON_PARSE_FAILED` = stage 2 broke.
- A null `errorCode` on `OCR_FAILED` means the gateway call threw; the gateway always sets a code on
  a `failed` response, so no synthetic constant was invented for it.
- Both channels now write `channel: 'line' | 'web'` so one query can group them.

## Changes

- `ReceiptOcrPreflight` carries `errorCode?: string`; `tryExtractReceiptFields` propagates
  `result.errorCode`.
- LINE audit moved to immediately after `decideLineBusinessDocument`, unconditional, keyed to
  `targetType: 'line_webhook_event'` / `targetId: webhookEventId` (no expense exists yet — the
  expense-linked `expense.line_upload.receive` row shares the same `requestId`). Emits
  `channel`, `status`, `errorCode`, `documentKind`, `recognizedFieldCount`, `mimeType`, `byteSize`.
- Web `auditOutcome` gained `errorCode` + `channel: 'web'`.

## Verification

- `npx tsc --noEmit -p apps/api/tsconfig.json` → exit 0
- `process-line-webhook.use-case.spec.ts` → 72/72 pass, incl. new
  "audits a failed LINE receipt read with its gateway errorCode"
- `expense-extraction.use-case.spec.ts` → 15/15 pass (deep-equal expectation updated for `channel`)

## Open questions

- Production was never queried: only `infra/uat/db-port-forward.sh` exists, there is no prod
  equivalent. UAT traffic is likely internal testing, so the real feedback population is unmeasured.
- 129 rows is a small sample.

## Rebase (2026-08-19)

The LINE-side audit was re-applied on top of `origin/main` (the file had moved under PR #167/#169).
The web-side `channel`/`errorCode` fields were untouched by upstream. Re-verified: `apps/api`
typecheck clean, `process-line-webhook.use-case.spec.ts` + `expense-extraction.use-case.spec.ts`
pass inside the 114-test focused run.

## Next

1. Deploy to UAT, collect ~1 week.
2. Re-run the grouping query (now `GROUP BY channel, status, errorCode, documentKind`).
3. If `OCR_EMPTY_OUTPUT` dominates → stage-1 reader swap is justified; must also move off
   Sonnet 4.6, which caps images at 1568px (high-res 2576px starts at Sonnet 5 / Opus 4.7+).
4. If `MISSING_VENDOR_TAX_ID` keeps dominating → fix stage 2 / the §13 verbatim cross-check for
   handwritten documents instead.
5. Decide whether a prod port-forward script is worth adding.
