# Expense No-Invoice → Substitute Receipt Routing Plan

Status: Implemented 2026-07-30
Spec: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]] (§7 Web UI, substitute-receipt rules §6)
Related: [[plans/substitute-receipt-evidence-hardening-plan|Evidence Hardening]], [[plans/substitute-receipt-company-policy-plan|Company Policy]], [[plans/expense-detail-stepper-ux-plan|Detail Stepper UX]]

## Trigger

User-journey feedback (2026-07-30, tennis-shop journey round): กรณีผู้ใช้ไม่มี invoice/ใบเสร็จ ระบบต้องพาไป Flow ออกใบทดแทน (ใบรับรองแทนใบเสร็จรับเงิน). The flow exists end-to-end (generate → payer certify → approve → issue, company policy, signatures) but the journey never routes users into it.

## Current gap

- `/expenses/upload` has no path when the user has no document at all.
- A manual draft saved without a file opens the detail popup with the evidence step showing no warning: `deriveExpenseReviewSteps` treats "no attachment + no missing-receipt reason" as fine, while server `validateConfirm` later rejects with "requires a receipt attachment or a missing receipt reason" — a dead end at the last click.
- The substitute entry is a small ghost button inside the doc-review card; generating also requires `sourceDocumentType` ≠ `NEEDS_REVIEW` and `taxEvidenceStatus` ≠ `NEEDS_REVIEW` to be reviewed and saved first, which users cannot discover (defaults are both `NEEDS_REVIEW`, so a straight attempt 400s).
- Confirm button gives no client-side hint about the receipt-or-substitute rule.

## Change (smallest correct diff, web only)

1. `apps/web/src/features/expenses/expenses.model.ts`
   - `expenseHasPrimaryReceipt(attachments)` — ACTIVE `expense.receipt.primary` present (mirrors repo fallback used by confirm).
   - `expenseNeedsReceiptOrSubstitute(detail)` — no primary receipt and no substitute path started (no reason / legacy timestamp / evidence / `SUBSTITUTE_RECEIPT` type).
   - Evidence step in `deriveExpenseReviewSteps` becomes `attention` in that state, so the popup opens on the evidence step for no-invoice drafts.
2. `apps/web/src/features/expenses/ExpensesPages.tsx`
   - Evidence-step banner (mutable + `expense.review`): two options — attach receipt, or one-click guided CTA that presets `EXPENSE_NOTE_TEXT` + `SUPPORTING_ONLY` when still `NEEDS_REVIEW`, saves the doc review (reusing `saveDocumentReview`, which already clears tax-code lines for supporting-only), and opens the substitute form.
   - Empty document-viewer pane gains "ไม่มีใบเสร็จ — จัดทำใบรับรองแทน" beside "แนบใบเสร็จ"; jumps to the evidence step and triggers the guided CTA (nonce prop into `DocumentReviewSection`).
   - Confirm button mirrors the server rule (`primary receipt || missingReceiptReason`) with an explanatory tooltip.
   - Upload tab gains a link to manual entry for the no-document case; manual receipt-slot helper copy now names the substitute flow.
3. Dictionary TH/EN: `expenses.no_receipt_banner`, `expenses.no_receipt_start_substitute`, `expenses.upload_no_document_link`, `expenses.confirm_needs_receipt`; reworded `expenses.manual_receipt_helper`.
4. Tests: `expense-review-steps.logic.spec.ts` — primary-receipt fixtures + no-invoice attention cases + initial-step landing.
5. Docs: spec §7 UI bullets + acceptance checkbox; QA journey cases `EXP-NR` added to `docs/qa/tennis-shop-e2e-test-cases-2026-07-29.md`.

## Guided preset rationale

`EXPENSE_NOTE_TEXT` + `SUPPORTING_ONLY` is the eligible pair for "no document at all" (spec §6: text notes default to missing-receipt/substitute policy; supporting-only forces `inputVatClaimStatus = NON_CLAIMABLE` on save). Already-classified documents keep their reviewed type — the preset only replaces `NEEDS_REVIEW` values. Category remains a manual pick in the same card (server requires category or account hint before generation and says so).

## Out of scope

- Generating substitute evidence from LINE (spec non-goal), reimbursement journey, issuer-created replacement tax invoice path.
- ~~Mobile-width primary-receipt attach slot~~ — closed same day (see follow-up below).

## Verification (2026-07-30)

- Focused specs 32/32, full apps/web suite 565/565, `pnpm --filter web typecheck` pass.
- Live on local stack (docker postgres/redis/minio + api + web, seed OWNER): no-file manual draft → step 3 ⚠ + attach/substitute banner + empty-viewer CTA; guided CTA auto-saved `โน้ตค่าใช้จ่าย (ข้อความ)` + `หลักฐานประกอบเท่านั้น` and opened the substitute form with company policy loaded; upload-tab link routes to manual entry. Test draft deleted afterwards.
- Details in [[agent-memory/expense-no-invoice-substitute-routing]].

## Follow-up: mobile attach affordance (2026-07-30)

The left document-viewer pane is `lg:`-only, so below `lg` a no-attachment expense had no way into the primary-receipt slot (the evidence-step banner covers only the substitute route). The detail modal's right pane now shows a `lg:hidden` strip ("ยังไม่มีไฟล์เอกสารแนบ" + "แนบไฟล์ใบเสร็จ") when an editable expense has zero attachments; it reuses the exact desktop control (shared `attachReceiptControl`, same `attachPrimaryReceipt` → `expense.receipt.primary`, gated `canMutateDraft`). No new strings, no model changes. Verified: apps/web typecheck + suite 565/565; live at <1024px the strip renders with the file input and the desktop pane is hidden, at ≥1024px the strip is hidden and the desktop empty-state (attach + substitute CTA) is unchanged.
