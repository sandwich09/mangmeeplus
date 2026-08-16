# Agent Memory: substitute-receipt-company-policy

Status: COMPLETE — implemented and locally verified 2026-07-13

Owner: WatchDog primary agent

Scope: Company settings page, configured substitute-receipt approvers, cash-evidence minimum, transparent payer/approver signatures, runtime enforcement, audit, and two-user smoke.

Decisions:
- Reuse company setup and expense permissions; no new permission keys.
- Superseded by the owner-approved 2026-08-06 approval-mode decision: no policy row now means default
  `OWNER_SELF`, while `configured` remains false and runtime readiness still requires an eligible
  current `expense.confirm` approver in branch scope. `DESIGNATED_APPROVERS` remains configured/fail-closed.
- Default cash mode requires a separate payment-evidence image/PDF plus supporting evidence.
- Settings may describe accepted evidence, but semantic/legal sufficiency remains a finance/accountant review decision.
- Approvers must be active members with `expense.confirm`; `DESIGNATED_APPROVERS` rejects the actual
  payer, while `OWNER_SELF` permits same-user approval only for the shared owner/admin/manager exemption.
- The exact payer/approver file applied to the certificate is a reviewed, cropped transparent PNG derived in-browser from that signer's PNG/JPEG upload.
- Payee acknowledgement/signature remains separate payment evidence; it is not substituted for the payer or approver signature required by the Revenue Department example certificate.

Open questions:
- None for the first implementation pass.

Artifacts:
- `apps/api/prisma/migrations/20260713170000_substitute_receipt_company_policy/migration.sql`
- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt-policy.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`
- `apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.ts`
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`
- `apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx`
- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `docs/plans/substitute-receipt-company-policy-plan.md`
- `docs/specs/expense-receipt-upload-spec.md`

Verification:
- `pnpm --filter @watchdog-bms/contracts build`: passed.
- API and web typechecks: passed; API build: passed; webpack production web build: passed.
- Focused API policy/substitute/storage/retention suite: 31/31 passed.
- Focused web policy/signature/image suite: 8/8 passed.
- Fresh isolated database `watchdog_substitute_smoke_20260713`: 59/59 migrations applied; seed completed.
- Authenticated browser smoke: owner login, settings route, configured approver/strict cash policy rendering, same-value save, success state, and zero console errors passed.
- Two persisted users completed the strict-cash lifecycle: payer `seed-room45-user-mind`; approver `seed-local-owner`; final `ISSUED`; supporting evidence 1; payment evidence 1; embedded PNG signatures 2.
- Real PostgreSQL `jsonb` smoke first exposed order-dependent certified snapshot hashing; canonical recursive key sorting and a key-reordering regression test fixed it before the passing rerun.
- Claude CLI 2.1.207 was invoked in read-only plan mode for dev/test review, made no file changes, returned no review output within two minutes, and was interrupted. Primary review found and closed the stale-approver form trap and locale-dependent hash-ordering risk.
- No deploy, stage, commit, or push was performed.

Next:
- Each production company owner/accountant must choose its actual approvers and accepted cash-evidence wording before enabling the flow for real expenses.
