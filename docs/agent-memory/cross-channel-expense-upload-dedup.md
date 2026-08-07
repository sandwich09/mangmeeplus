# Agent Memory: cross-channel-expense-upload-dedup

Status: Complete
Owner: Codex
Scope: Expense primary-receipt duplicate detection across web upload, direct LINE upload, deferred LINE media confirmation, web review recheck, tests, and source spec
Decisions:
- Use the server-verified attachment SHA-256, never the client checksum, as the exact-file signal.
- Exact checksum matches search all non-voided expense primary attachments in the same company; metadata similarity keeps the existing 180-day bounded review scan.
- Flag `POSSIBLE_DUPLICATE` and create resolvable candidates instead of rejecting or deleting the upload.
- Compute a server-side 64-bit perceptual hash for verified JPEG/PNG bytes with existing `sharp`; compare only inside the existing bounded recent-candidate scan.
- Run the same candidate creation after primary upload and after OCR applies normalized document number, tax id, date, and amount.
- Visual/OCR matches remain advisory `POSSIBLE_DUPLICATE`; never auto-reject, merge, or confirm.
- Different-angle photos fall back to normalized OCR vendor name + date + amount when the draft has no linked vendor counterparty yet; this closes the common LINE/web intake gap without loosening the perceptual-hash threshold.
- Keep PDF page rendering and OCR-text similarity out of this minimum scope.
Open questions:
- None for this scoped fix.
Artifacts:
- `apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts`
- `apps/api/src/modules/expenses/application/services/expense-duplicate-detection.ts`
- `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts`
- `apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts`
- `apps/api/prisma/migrations/20260729183000_attachment_perceptual_hash/migration.sql`
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- Focused expense and LINE tests
- `docs/specs/expense-receipt-upload-spec.md`
Verification:
- Focused expense/LINE tests on the isolated staged change: 107/107 passed.
- API TypeScript check: passed.
- Exact-checksum repository test covers company scope, primary receipt links, cross-channel ids, current-expense exclusion, and voided-record filtering.
- Compressed-image follow-up focused suite: 140/140 passed, including PNG/JPEG re-encoding, visual candidate scoring, normalized post-OCR matching, web/direct-LINE/deferred-LINE paths.
- Prisma schema validation: passed.
- API TypeScript check after the perceptual-hash migration and direct `sharp` declaration: passed.
- Different-angle focused expense/OCR suite: 25/25 passed, including maximally different visual hashes with normalized OCR vendor/date/amount identity.
- API TypeScript check after the different-angle fallback: passed.
Next:
- Deploy through the UAT release path, then smoke-test one same-bill pair from different camera angles.
