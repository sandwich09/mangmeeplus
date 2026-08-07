# Agent Memory: receipt-ocr-total-recovery

Status: Done (local verified, not deployed)
Owner: thawatchai
Scope: `apps/ai-gateway` receipt OCR stage 1/2, `apps/api` expense extraction gate, `apps/web` expense review, `infra/docker/compose.local.yml`

## Trigger

Web upload of a real Starbucks receipt (`141567.jpg`, 492x1451) produced an expense draft with every
field blank and the banner "เอกสารนี้อาจไม่ใช่หลักฐานค่าใช้จ่าย".

## Diagnosis

Not a gate bug. Stage 1 (Typhoon OCR) mangled the totals block of the warped photo:

```
printed:  Sub Total 195.00 / Total Discount -15.00 / Total Amount 180.00 / Payment 180.00
Typhoon:  | Sub Total | 160.00 | / | Total Discount | -15.00 | / | MobileRedeem Payment | 180.00 |
```

The printed `Total Amount` line was dropped and `195.00` was read as `160.00`. Stage 2 then reported
`grandTotalAmount: 160.00` with `grandTotalAmount_ambiguous` + `MISSING_TRANSACTION_TOTAL`, which set
`requiresClarification: true`, which is the one condition `isExpenseExtractionEligible`
(`apps/api/src/modules/expenses/domain/logic/expense-document.logic.ts`) failed on. The gate correctly
refused to write 160.00 into a draft whose real total was 180.00.

Stage 2 is also non-deterministic on this image: repeated runs over the same (bad) stage-1 text
returned 160.00 twice and 180.00 once.

## Decisions

- Recover the reading rather than loosen the gate. One Bedrock vision re-read of the same image runs
  only when the first pass leaves no usable total, and replaces it only if it clears the same bar
  (`hasUsableTotal`: a `grandTotalAmount` plus `requiresClarification === false`). Bounded to one
  extra read; a still-unusable re-read is discarded so the honest weaker result and its lineage stand.
- Keep "apply no money fields" intact for `NOT_EXPENSE_DOCUMENT`, but stop discarding what was read:
  store it under `aiVerificationSummaryJson.suggestedFields` and let the reviewer copy it into empty
  fields. Server-side auto-application is unchanged.

## Artifacts

- `apps/ai-gateway/.../line-ai-internal.controller.ts` — `understandReceiptText`, `hasUsableTotal`,
  the re-read branch, `bedrockOcrPrompt('PDF'|'image')` (replaces `PDF_OCR_PROMPT`)
- `apps/api/.../expense-extraction.use-case.ts` — `suggestedFields` in the non-expense branch
- `apps/web/.../expenses.model.ts` — `expenseAiSuggestion`, `applyExpenseAiSuggestion`
- `apps/web/.../ExpensesPages.tsx` — suggestion card in `ExpenseReviewEditSection`
- `docs/specs/business-document-image-intake-spec.md`, `docs/specs/ai-prompt-caching-usage-logging-spec.md`

## Verification

- `apps/ai-gateway` controller spec 30/30 — new cases cover re-read recovery (asserting exactly one
  re-read: `['extract','read','extract']`) and no re-read on a non-Bedrock provider.
- `apps/api` expense-extraction spec 13/13 — non-expense case now asserts `suggestedFields` is stored
  while the draft update carries no vendor/total field.
- `apps/web` expenses.model spec 26/26 — suggestion parsing, fill, and never-overwrite.
- Live, same receipt, 3 runs post-change: all returned `180.00` with `requiresClarification: false`;
  gateway usage logs show `ocr.receipt.image-reread` fired on 2 of the 3 (the runs whose first pass
  would previously have blocked the draft).
- `pnpm typecheck` was missed here and UAT deploy run 30917354554 failed on it: the new
  `emptyValues` fixture inferred `vendorEntityKindSnapshot: string`, which the
  `BuyerEntityKind | ''` field rejects. Fixture is now annotated `ExpenseDraftReviewValues`.
  `tsx --test` strips types, so passing specs prove nothing about typecheck — run both before
  dispatching a deploy.

## Local env note

`MODEL_PROVIDER`/`TYPHOON_OCR_API_KEY`/`DOCUMENT_AI_MODEL_ID` only reach the containers when compose
runs with `--env-file .env` (see `pnpm docker:local`). Bedrock in the gateway uses the host `~/.aws`
mounted read-only at `/aws` with `AWS_PROFILE`.

## Next

- Deploy path untouched; prod already passes `S3_BUCKET`/`S3_REGION` and a Bedrock task role.
- If re-read frequency turns out high in UAT, the cheaper lever is image preprocessing before stage 1
  rather than a second model call.
