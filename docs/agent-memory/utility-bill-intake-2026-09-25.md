# Agent Memory: Utility bill intake (2026-09-25)

Status: Locally implemented and verified; integration into develop and main in progress. No UAT or Production deployment.
Owner: Platform / AI / Finance Operations
Scope: LINE photo intake for Thai water and electricity bills, including a current invoice printed with a prior-period receipt.

Decisions:
- A single photo can contain independently titled documents for different periods. OCR must return each role, period and total without summing them or treating the current invoice as paid.
- For one current utility invoice and one verified receipt from the immediately preceding month, create one reviewable expense draft from the prior receipt. Show the current amount due separately. An uncertain pair remains in review without an expense draft.
- On an explicit, same-chat follow-up such as `บันทึกใบแจ้งหนี้ด้วย`, create a separate, unpaid `SUPPLIER_BILL` draft for the current period from the verified photo. Scope the source to the same user, company, branch and active attachment; make retries idempotent. This command does not issue a customer sales invoice.
- The supplier-bill draft requires web review of vendor, date, expense line and VAT. A later receipt can be attached while the bill remains a draft or ready for confirmation. Automatic matching after confirmation is outside this change.

Open questions:
- Post-confirmation attachment of a later receipt requires a separate product design if early payable confirmation is needed.
- The broader public use-case inventory is a research corpus, not a claim of full OCR coverage.

Artifacts:
- `docs/specs/business-document-image-intake-spec.md` §5.8
- `docs/plans/business-document-image-intake-plan.md`
- `docs/research/thai-water-electricity-bill-use-cases-2026-09-25-th.md`

Verification:
- The exact incident image was replayed locally through the configured OCR model. It returned separate current-invoice and prior-receipt amounts; no customer image or raw OCR text is committed.
- On the clean integration worktree: AI Gateway controller suite 102/102 and LINE dispatch suite 337/337 passed; Contracts, AI Gateway and API typechecks passed after generating the Prisma client; `git diff --check` passed. The original dirty worktree's counterparty-file errors were unrelated to this change.

Next:
- Merge the scoped change into develop and main after clean-branch verification.
- Use the mandatory UAT/Production deployment protocol for any later release. A merged branch is not a live release.
