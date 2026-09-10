# Agent Memory: Substitute receipt number follows payment month

Status: implemented and verified; owner requested inclusion with the receipt fixes in develop and main.
Owner: /root
Scope: new substitute receipt numbers use the year/month of actual payment instead of preparation time.
Decisions:
- Preserve the existing `SRC-{YYYY}{MM}-{SEQ}` Gregorian-year format and canonical company sequence allocator. Example: payment 22 August 2569 BE uses `SRC-202608-…` even when prepared in September.
- Change the shared preparation repository, covering WEB/LINE, DIGITAL/PAPER and COMPANY/PERSONAL_ADVANCE. Use the existing Bangkok civil-date conversion for payment timestamps.
- Document corrections reserve a new number in the original payment month. Existing reservations, retries, signed artifacts and historical numbers stay unchanged; no renumbering/backfill.
- Missing/invalid payment date cannot reserve a new number. Existing idempotent retries return their original number before this new-reservation guard.
- Keep expense dates, signing timestamps, payment amounts, tax/accounting behavior, numbering configuration, permissions and reimbursement outside this change.
Open questions: none required for new-number behavior.
Artifacts: company-payer spec, shared preparation repository and existing number/funding tests.
Verification:
- Shared repository now reserves using `civilPeriodKey(civilDate(input.paymentDate))`; validates the date before new expense/evidence writes. Existing-number retry exits before the new-date guard.
- Regression coverage: August payment / September preparation, unchanged creation timestamp, Bangkok month/year boundaries, company/personal and digital/paper modes, invalid/missing dates, document-only corrections and retention of historical numbers on retry.
- Focused API command: `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/infrastructure/prisma-expense.repository.substitute-number.spec.ts src/modules/expenses/infrastructure/substitute-funding.pg.spec.ts src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts src/modules/data-model-core/domain/logic/document-sequence.logic.spec.ts src/modules/data-model-core/infrastructure/repositories/prisma-document-sequence.repository.spec.ts src/modules/data-model-core/infrastructure/repositories/document-sequence-branch-collision.spec.ts` — 316 passed, 0 failed, 0 skipped. Includes real PostgreSQL funding/correction and shared sequence/collision checks; test-owned companies cleaned up. Log `/tmp/substitute-number-focused.log`.
- API typecheck/build passed: `/tmp/substitute-number-typecheck.log`, `/tmp/substitute-number-build.log`. Scoped `git diff --check` passed.
- Rebuilt the existing `dist/substitute-review` runtime and restarted only the local API on 127.0.0.1:3001 through `/tmp/substitute-local-run.py api`; startup confirmed in `/tmp/substitute-number-local-api.log`. Web remains on 127.0.0.1:3000.
- No migration, renumbering of user documents, package.json changes, new user expense/payment/signature or reimbursement changes. Earlier uncommitted expense-entry/role-layout edits remain intact.
Next: commit/push and merge with receipt removal, yellow AI warning and source-edit/signing synchronization. Owner requested immediate merge without further tests; no deployment requested. Source edits that reset signatures continue using the reserved number, while newly allocated document numbers use the payment month.
