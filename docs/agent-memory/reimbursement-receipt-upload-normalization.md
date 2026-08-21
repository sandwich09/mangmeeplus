# Agent Memory: Reimbursement receipt upload normalization

Status: Implemented and locally verified
Owner: Codex
Scope: Reimbursement create/detail receipt pickers, image preparation before attachment intent, partial draft recovery,
UX wording, focused web tests, and linked reimbursement docs.
Decisions:
- Keep the API attachment boundary unchanged at verified PDF/PNG/JPEG.
- Reuse `prepareReceiptFile` from the expense feature instead of adding a second image converter.
- Accept PDF plus JPG/JPEG, PNG, HEIC/HEIF, and GIF as browser sources; normalize unsupported server image containers
  and mismatched image metadata/bytes to a static JPEG before upload.
- Create the draft once. If a subset of line uploads fails, link every successful attachment, report the failed line
  numbers, and recover through that existing draft.
- Use `บันทึกร่างคำขอเบิก` for the initial action and `เปิดร่างเพื่อแก้ไขไฟล์` only after the draft already exists.
Open questions: None.
Artifacts:
- `docs/specs/reimbursement-approval-spec.md`
- `docs/plans/reimbursement-approval-plan.md`
- `apps/web/src/features/expenses/expense-upload.logic.ts`
- `apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx`
- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx`
- `apps/web/src/features/reimbursements/reimbursements.api.ts`
- `apps/web/src/features/reimbursements/reimbursements.api.spec.ts`
- `apps/web/src/common/files/upload-file.logic.ts`
Verification:
- `pnpm --filter @watchdog-bms/web exec tsx --test src/common/files/upload-file.logic.spec.ts src/features/expenses/expense-upload.logic.spec.ts src/features/reimbursements/reimbursements.api.spec.ts src/features/reimbursements/reimbursements.logic.spec.ts src/features/reimbursements/reimbursements.model.spec.ts` — 89/89 pass on `origin/develop`.
- `pnpm --filter @watchdog-bms/web typecheck` — pass.
- `pnpm --filter @watchdog-bms/api typecheck` and `pnpm --filter @watchdog-bms/contracts typecheck` — pass.
- `git diff --check` — pass.
- The clipboard copies supplied for diagnosis are PNG containers after transfer, so they cannot preserve the original
  mobile file MIME/container mismatch. The focused API test reproduces the relevant `image/jpg` metadata case and
  proves the intent/storage/complete flow uses normalized `image/jpeg` metadata and bytes.
Next: Deploy through the mandatory UAT protocol when requested, then retest the original mobile Dime slip plus one
JPG, JPEG, PNG, HEIC/HEIF, and GIF source in the create and draft-detail receipt pickers.
