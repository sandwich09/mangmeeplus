# Agent Memory: LINE receipt zero-price failure, 2026-09-07

Status: Diagnosis confirmed; no remediation requested or performed.
Owner: Codex, following the owner's request to investigate without fixing.
Scope: Production logs for 2026-09-07 12:00–13:00 Asia/Bangkok; receipt intake, OCR apply, and LINE error delivery. The screenshot uses Korea time, so 14:48–14:49 KST is 12:48–12:49 Bangkok / 05:48–05:49 UTC.

Decisions:
- The current request is diagnosis only. No application/configuration edits, deployments, LINE messages, receipt retries, or database writes were performed during this investigation.
- Preserve the earlier release acceptance state and existing uncommitted deployment-runbook correction; do not resume release mutations under this request.
- This file records sanitized diagnostic findings only; customer identity and receipt text are omitted.

Findings:
- CloudWatch group `/ecs/watchdog-bms-prod-api-web`, event `01M1X6K0BG2RTWHH16RK7H0RBW`: accepted at `2026-09-07T05:48:50.249Z`, then `LINE receipt upload error` at `2026-09-07T05:49:30.726Z`.
- The failure is `prisma.expenseLine.create()` for line 3, quantity `1.0000`, unitPrice `NaN`: `Invalid value for argument unitPrice: invalid digit found in string. Expected decimal String.` The generic receipt-processing-failed message in the screenshot is the corresponding catch-path reply.
- In `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts`, `usableItemLines` at line 564 accepts zero amounts through `nonNegativeMoney`. The item mapper at line 678 instead calls `positiveMoney(item.amount)!`, which returns undefined for `0.00`. Dividing undefined by quantity produces NaN; line 688 formats it as the literal string `NaN`. The final insert at line 1054 passes that invalid value to Prisma.
- Totals calculation can normalize the invalid unit price to zero, letting a reconciled item split reach persistence. The failure therefore depends on the extracted rows and selected item-split path; it does not affect every receipt.
- API Production and UAT readback both used application SHA `604ac785479ced5b9858d0b46d89f8d11cf2b9f6`, with `AI_GATEWAY_ENABLED=true` and `LINE_AI_DRAFT_EDIT_ENABLED=true`. This incident is an OCR-apply code defect; a disabled Production AI switch does not explain the observed exception.
- Zero-row validation was introduced by `9efcebf2990b189d6ab7d9af04dc38ef8b3e3c91` on 2026-08-28 (#332), while the positive-only amount mapper remained. Both conflicting behaviors already exist in the prior Production source `a768e3a27aa0ffe5aaf848c23fea720b381a76b0`; today's feature-flag parity changes did not introduce this mismatch.
- The same apply service is used by the web extraction use case, so equivalent extracted input can affect both LINE and web.
- Existing zero-row tests check `usableItemLines` acceptance/rejection, rather than the entire apply-to-insert path.
- A second, separate event `01M1X72AR0C0RK3P4GSPRHFBAY` logged `LINE reply network error` / `fetch failed` at `2026-09-07T05:57:55.970Z` and `LINE_DELIVERY_FAILED_OTHER` at `.977Z`. This is not the 12:49 screenshot event. The adapter logs only the fetch error message for this path, so the deeper network cause is not established.

Verification:
- Read the cloud-operations runbook before read-only AWS inspection; queried the requested Bangkok time window.
- Followed the receipt failure catch path, zero-value validation, unit-price calculation, and Prisma insert using the unchanged operational checkout `../mangmeeplus-prod-email-fix-20260907`.
- Ran `pnpm exec tsx --eval` from that checkout's `apps/api` with the actual `ReceiptOcrApplyService` and `usableItemLines`, and in-memory Prisma stubs only. The fixture had paid rows 100.00 and 200.00 plus a zero-priced third row, quantity 1, NO_VAT, total 300.00. The third insert payload contained `unitPrice=NaN`, `lineTotal=0.0000`. A positive control using 0.01 and total 300.01 produced `unitPrice=0.0100`, `lineTotal=0.0100`. Assertions passed, exit 0. No database client or network writes were used.
- Verified the older Production source also contains zero-accepting validation and positive-only amount conversion.

Open questions:
- Exact persisted draft/attachment state for this receipt was not queried. Code initializes the expense and completes its attachment before OCR apply; therefore the error does not prove that nothing was saved. The apply transaction's line changes fail, but earlier intake writes are separate.
- No deeper cause is claimed for the separate 12:57 fetch failure.

Artifacts: This diagnostic record; existing application source and read-only CloudWatch evidence. No raw customer log dump was added to the repository.
Next: Report the confirmed cause and limits to the owner. Any fix, regression coverage change, or rollout remains outside the current diagnosis-only request.

## Follow-up: same receipt succeeds on the third submission; settings question

The owner reports that the same bill succeeded on submission three and asks whether entering more information in settings caused that success. Read-only log inspection was extended through 13:04 Bangkok to include the successful turn, without replaying a receipt or changing settings.

- Same-company media sequence: `01M1X6K0BG2RTWHH16RK7H0RBW` failed at 12:49:30 with NaN; `01M1X72AR0C0RK3P4GSPRHFBAY` reached a committed OCR apply (`expense_category_suggested` at 12:57:55.840), then reply rendering and a delivery failure at 12:57:55.975; `01M1X7CF58W1TEXM4ZB3ZWVCDA` was accepted at 13:02:44.696 and finished `completed` / `delivered` at 13:03:28.317. All three relevant gateway reads correlate to the same company. The log alone does not prove identical attachment bytes; that is the owner's report.
- Another company's media event at 13:00–13:01 ended `clarification_required` and must not be confused with the above sequence.
- API access logs show successful `PATCH /v1/companies/:companyId/identity` at 13:02:16.436 and `PUT /v1/companies/:companyId/vat-registration` at 13:02:16.645. Access logs contain route templates, not the target company or old/new values; no claim is made that those particular mutations belong to the receipt's company without audit readback.
- The second receipt had already passed OCR persistence BEFORE those settings requests. Therefore the later settings requests cannot explain why the second receipt avoided the first receipt's NaN failure. Both failed submissions receive the same generic message because the receipt catch covers persistence and reply delivery.
- Gateway `ocr.receipt.extract` calls succeeded on all three turns using the same Sonnet 4.6 model. Input/output token counts were 1351/883, 1306/1085, and 1183/1071 respectively. The separate model calls and differing outputs support variable extraction results; they do not identify which specific row changed.
- Code `tryExtractReceiptFields` requests extraction for each new LINE message, forwarding that turn's intake reading. Existing-expense reuse is keyed by LINE message ID, not identical image content. Actual OCR fields are not present in these CloudWatch records. It remains unverified whether the successful reads omitted the zero modifier, represented it differently, or took the summary fallback. Do not state one of these as observed fact.
- `GetExpenseCapturePolicyUseCase` uses company VAT status for FULL/SIMPLE capture policy and initial claimability. `ReceiptOcrApplyService.apply` prepares OCR item prices from extracted fields before loading the expense; it does not use company identity/VAT registration to change the zero parser. The settings therefore do not directly repair this code defect.

Verification: read cloud-operations runbook; read-only API/gateway log queries; source inspection of receipt intake, extraction, capture policy, mapping, persistence, and delivery. No code/config/deployment changes, database queries, or outbound LINE messages. The prior zero-price reproduction remains valid but is conditional on the extracted data and selected item-split path, not on the image alone.
