# Agent Memory: PDF expense documents get the AI category (2026-09-29)

Status: PR to develop from `claude/pdf-capture-category-20260929` (not merged by this agent). Sibling of #911 (LINE text/photo categories), same release.
Owner: controller session 2026-09-29; owner words "หมวดหมู่ AI ควรจับได้เลย".
Scope: the durable capture read (web PDF upload and LINE `file` lane, both `ownerType EXPENSE`).

Root cause (traced in code):
- `expense-capture-read-runner.service.ts` called `client.extractWindow` without `activeCategories`, although the client and the gateway request already accepted them.
- The gateway `capture-extract` route put the catalogue in the user message, but `CAPTURE_EXTRACT_PROMPT` never asked for a category and `parseCaptureObservationsJson` had nowhere to keep one; `ExpenseCaptureDocumentObservation` had no category field.
- So `captureFieldsFromObservations` never set `fields.categorySuggestion`, and `receipt-ocr-apply` (the photo path's auto-fill) had nothing to apply.

Decisions:
- Reuse the photo rule end to end: the document gets the photo reader's `categorySuggestion` shape; `parseCategorySuggestion` (gateway, shared with `parseReceiptOcrJson`, pure refactor there) checks key, confidence and exact evidence; `receipt-ocr-apply` alone decides (ACTIVE company category, ≥ `RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE`, record has no category yet) and writes header plus every line.
- The catalogue is `aiSelectableExpenseCategories` (catch-all excluded, #911 helper).
- The model picks by a short key `c1…cN`; the gateway maps it back. Before this, a real Sonnet read of the courier fixture returned the NEXT row's cuid (ค่าธรรมเนียมธนาคาร, 0.92) with the delivery rows as evidence — bootstrap ids differ by a few characters.
- A continued document keeps the first window's pick (`mergeDocument` `??=`); the auto-split drafts each get their own document's pick.
- No switch, no env flag; budget and lease logic untouched.

Open questions / follow-ups:
- The photo reader (`receipt-ocr`) and the LINE intake router still show the model raw cuids; the same neighbour-id slip can happen there. Same keyed catalogue would fix it (not in this scope).
- The web image path (`expense-extraction.use-case.ts`) still offers the catch-all to the model; #911 excluded it only on LINE.
- The PDF lane writes no review summary, so a below-bar suggestion is not shown as a "ตัวเลือกแนะนำ" (photo path shows one). Auto-fill only.

Verification: see the PR body (unit specs, API/gateway/web typecheck, API suite, gateway suite, real-model runs: 2 consecutive web runs 4/4 and 4/4 plus one LINE-lane run 4/4 on a 12-category starter shop).

Next: controller merges #911 sibling release; consider the keyed catalogue for the photo reader and router.
