# Agent Memory: expense-discount-vs-addon-line

Status: Implemented and verified locally on `develop`; not committed by the agent, not deployed.
Owner: thawtchai (owner report + reading of the slip, 2026-08-04)
Scope: Third owner-reported defect on the same Starbucks ABB slip as §19g/§19h — the review form showed ราคาต่อหน่วย `200` / ส่วนลด `20` for a slip printing `175 + 20 add-on = 195 − 15 discount = 180 paid` — plus the line editor's layout on that screen.

Decisions:
- Root cause confirmed from the stored draft, not inferred: `ExpenseRecord.aiVerifiedFieldsJson` for `cmsev2i3z000j01ogbrvk6jb9` is `{"vatMode":"VAT_INCLUDED","discountAmount":"20.00","grandTotalAmount":"180.00", …}` with `subtotalAmount`/`vatAmount`/`vatRate` in `missingFields`. The model reported the ฿20 extra-shot **item** as the discount; `deriveLineSubtotal` then folded it back as `180 + 20 = 200` unit price (§19f behaviour, correct in itself).
- Two-sided fix, spec §19i: prompt defines what a discount is (label or minus sign; a positive add-on/modifier line is merchandise), and `verifyDiscountAmount` refuses to apply a discount the printed figures cannot prove.
- Drop-or-correct rather than keep-and-warn: the recorded total is identical either way (`unit = base + discount`, `net = unit − discount`), so the only thing at stake is whether a wrong split reaches every review screen and evidence export.
- A dropped discount is deliberately NOT added to `missingFields` — that would mean plumbing a second predicate through `withEffectiveMissingFields` for a field the reviewer can re-enter freely while looking at the receipt.
- Layout: หัก ณ ที่จ่าย moves beside ส่วนลด and the VAT block spans both columns. Pure JSX move + one class; no field, validation, or contract change.

Open questions: none.

Artifacts:
- `docs/specs/expense-receipt-upload-spec.md` §19i (new addendum).
- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts` — `RECEIPT_OCR_PROMPT` discount paragraph.
- `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts` — `verifyDiscountAmount`, wired into `apply` ahead of `completeVatFields`.
- `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts` — 6 unit + 2 apply-level cases.
- `apps/web/src/features/expenses/ExpensesPages.tsx` — line-item grid order.

Verification:
- `apps/api`: focused spec 40/40 PASS; full `corepack pnpm test` PASS (exit 0, no failures); `pnpm typecheck` PASS.
- `apps/web`: `pnpm test` 673/673 PASS; `pnpm typecheck` PASS; `pnpm build` PASS.
- `apps/ai-gateway`: `pnpm test` 518/518 PASS; `pnpm typecheck` PASS.
- Not run: live re-extraction of the reported slip (costs a Typhoon + Bedrock call and needs the local stack rebuilt). The prompt half of the fix is unverified against the real model; the deterministic half is what guarantees the reported symptom cannot recur.

Next:
- Rebuild the local stack (`pnpm docker:local`, no source mounts in `infra/docker/compose.local.yml`) and press "อ่านเอกสารอีกครั้ง" on `cmsev2i3z000j01ogbrvk6jb9` to see whether the model now reads `Sub Total 195.00` / `Total Discount -15.00`.
- Existing rows are not migrated (§19i decision 4) — they heal on re-extraction or the next review save.
