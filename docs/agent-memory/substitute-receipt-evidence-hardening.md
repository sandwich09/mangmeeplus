# Agent Memory: substitute-receipt-evidence-hardening

Status: COMPLETE — implemented and locally verified 2026-07-13

Owner: WatchDog primary agent

Scope: Item 09B internal substitute-receipt evidence generation, Revenue Department-aligned artifact fields, tax/ledger safety, branch/channel/permission boundaries, immutable versioning, payer certification and separate approval, manual web journey, accountant export, download authorization, and retention.

Decisions:
- Canonical product/document title is `ใบรับรองแทนใบเสร็จรับเงิน`. The Revenue Department accounting-evidence guide is the primary business baseline. The Court of Justice บก.111 page is a secondary layout reference only; WatchDog does not claim that a private-company artifact is an official government form.
- The form follows the Revenue Department baseline: company, expense/payment date, item/detail, quantity where applicable, amount, note, numeric and Thai-word total, actual payer name/position and personal company-business certification, payer signature/date, and separate authorized approver signature/date.
- Internal evidence is not an issuer-created receipt, tax invoice, or replacement tax invoice. It remains `SUPPORTING_ONLY` and `NON_CLAIMABLE` by itself. Lost/damaged VAT tax invoices route to the supplier-issued replacement flow.
- The employee who actually paid must personally certify. Finance/reviewer or a reusable company signature cannot certify on that person's behalf; the approver is distinct and recorded separately.
- Original source classification and attachments remain unchanged. Each certificate is a separate immutable version with a snapshot hash, artifact checksum, supersede history, and retained evidence references.
- Quotations, order/check bills without settlement, appointments, bookings/reservations, non-business/unreadable/multi-document images, quantity-only bills, and otherwise valid available receipts are not eligible through a finance override alone.
- Manual web upload uses the selected/default branch resolver and the same classification guard as LINE/API intake. An unresolved non-expense classification keeps the draft/file but cannot mark ready or confirm without a reasoned `expense.review` override.
- Primary WatchDog/Codex agent implemented. Claude CLI remained restricted to read-only dev review/test and was not allowed to edit, implement, stage, commit, or deploy.

Open questions:
- None in code. Item 09C added company settings and runtime policy; the later owner-approved mode makes
  no policy row default `OWNER_SELF`, while `DESIGNATED_APPROVERS`, current eligibility/scope and
  evidence requirements still fail closed. Each production tenant still owns its actual approval mode
  and accountant-approved cash-evidence wording.

Artifacts:
- `apps/api/prisma/migrations/20260713150000_substitute_receipt_evidence_hardening/migration.sql`
- `apps/api/prisma/schema.prisma`
- `packages/contracts/src/expenses.ts`
- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`
- `apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.ts`
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`
- `apps/api/src/modules/expenses/presentation/http/expense.controller.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts`
- `apps/api/src/modules/data-model-core/application/use-cases/create-download-url.use-case.ts`
- `apps/api/src/modules/data-model-core/application/use-cases/delete-attachment.use-case.ts`
- `apps/api/src/modules/ledger/application/use-cases/journal.use-case.ts`
- `apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts`
- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `apps/web/src/features/expenses/expenses.api.ts`
- `docs/specs/expense-receipt-upload-spec.md`
- `docs/plans/substitute-receipt-evidence-hardening-plan.md`
- `docs/plans/substitute-receipt-company-policy-plan.md`

Verification:
- Substitute lifecycle, artifact renderer, branch/download/delete/retention, manual-upload branch, document guard, and export focused suite: 57/57 passed.
- AI Gateway intake/classification focused suite: 44/44 passed.
- API extraction/document/status plus VAT ledger/tax/source invariants: 62/62 passed.
- Web expense classification/model suite: 5/5 passed.
- Contracts, AI Gateway, API, and web typechecks passed; Prisma client generation passed; API production build passed.
- Fresh database `watchdog_substitute_verify_0713b`: 58/58 migrations applied and seed completed.
- Clean production web build using the repo's actual `pnpm build` Turbopack path passed. The diagnostic webpack fallback is not the supported SVG production path and was not used as final evidence.
- Authenticated browser smoke on the production build passed: login, Expenses manual-upload screen, Head Office branch selection, expense detail, and the `ใบรับรองแทนใบเสร็จรับเงิน` pre-sign form with tax disclaimer, payer, business purpose, source/supporting evidence requirement, and disabled prepare action when evidence is incomplete.
- Exact payer certification and distinct-approver issuance are covered by focused API lifecycle tests.
  The later `OWNER_SELF` shared-role exemption is covered by the approval-mode follow-up; the original
  local seed contained only one payer candidate, so this browser smoke did not fabricate another user.
- Claude CLI 2.1.207 was invoked only for read-only review/test; it returned no review output and was interrupted after hanging. No workaround or code write was attempted. Independent read-only agent reviews found race, ABAC, signature binding, export, retention, and immutable-snapshot gaps; those findings were closed before verification.
- No deploy, stage, commit, or push was performed.

Next:
- Before production enablement, use the item 09C settings page to select real tenant approvers and cash-evidence wording, then run the same non-sensitive two-user smoke with those tenant users.
