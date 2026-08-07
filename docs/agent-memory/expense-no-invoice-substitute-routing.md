# Agent Memory: Expense No-Invoice → Substitute Receipt Routing

Status: Complete (implemented + live-verified 2026-07-30)
Owner: Claude
Scope: Web-only journey routing from the no-invoice state into the existing substitute-receipt flow; docs + web model/UI + dictionary + QA cases. No API/contract/migration changes.
Decisions:
- User-journey feedback (tennis-shop round): กรณีไม่มี invoice ต้องพาไป Flow ออกใบทดแทน — treated as routing/UX gap, not a new flow; the generate → certify → approve flow already exists.
- No-invoice state = no ACTIVE `expense.receipt.primary` attachment AND no substitute path started (reason / generated timestamp / evidence / `SUBSTITUTE_RECEIPT` type). Mirrors server `validateConfirm` receipt-or-reason rule; repo resolves primary by that purpose as fallback, so purpose-based client detection is faithful.
- Guided one-click entry presets `EXPENSE_NOTE_TEXT` + `SUPPORTING_ONLY` only where values are still `NEEDS_REVIEW` (both server-eligible; server rejects generation on `NEEDS_REVIEW` values), persists via existing `saveDocumentReview` (which already clears tax-code lines for supporting-only), then opens the substitute form.
- Evidence step turns ⚠ for the no-invoice state so the popup lands there; confirm button mirrors the rule with an explanatory tooltip instead of a late server 400.
- Nonce prop (`substituteIntentNonce`) from modal → `DocumentReviewSection` triggers the guided entry from the empty-viewer CTA without effect-dependency churn.
Open questions: None. Mobile-width primary-receipt attach slot gap closed 2026-07-30: the detail modal's right pane shows a `lg:hidden` zero-attachment strip reusing the desktop attach control (shared `attachReceiptControl`, same `attachPrimaryReceipt` → `expense.receipt.primary`, `canMutateDraft` gate); see plan follow-up section.
Artifacts:
- `docs/plans/expense-no-invoice-substitute-routing-plan.md`
- Spec updates: `docs/specs/expense-receipt-upload-spec.md` §7 UI bullet + UI rule + acceptance checkbox
- QA: `docs/qa/tennis-shop-e2e-test-cases-2026-07-29.md` EXP-SR-12..15
- Code: `apps/web/src/features/expenses/expenses.model.ts` (`expenseHasPrimaryReceipt`, `expenseNeedsReceiptOrSubstitute`, evidence-step state), `ExpensesPages.tsx` (banner + guided CTA + empty-viewer CTA + upload-tab link + confirm mirror), `workspace-dictionary.ts` (4 new keys TH/EN + reworded `manual_receipt_helper`), `expense-review-steps.logic.spec.ts`
Verification:
- `tsx --test` expense-review-steps + expenses.model specs: 32/32 pass; full `pnpm --filter web test`: 565/565 pass; `pnpm --filter web typecheck` pass.
- Live (local stack: docker postgres/redis/minio + `api` + `web` launch configs, dev sign-in OWNER): manual no-file draft → popup step 3 ⚠ + both CTAs + banner; guided CTA saved โน้ตค่าใช้จ่าย/หลักฐานประกอบเท่านั้น and opened the substitute form with company policy loaded (payment evidence "จำเป็นตามนโยบาย"); upload-tab link navigates to manual. Test draft deleted afterwards (DELETE 204).
Next: Nothing blocking. Optional follow-up: LINE-side nudge when a text-note expense lands with no receipt (LINE cannot generate substitute per spec). (Mobile attach-primary-receipt affordance shipped 2026-07-30.)
