# Agent Memory: item-12-procurement-ap-review

Status: Complete locally; master checklist item 12 ticked on 2026-06-30.
Owner: Codex
Scope: Review and close business logic gaps in Procurement, Supplier, and Accounts Payable implementation.

Decisions:
- Keep direct vendor bill without PO allowed only when caller has `procurement.vendor_bill.direct_entry` in addition to create permission.
- Keep supplier overpayment/unapplied payment blocked by default.
- Keep supplier bank account storage masked/last4 only.

Open questions:
- None for item 12 closeout. Future supplier credit/unapplied overpayment policy remains separate backlog.

Artifacts:
- `apps/api/src/modules/procurement/domain/logic/procurement.logic.ts`
- `apps/api/src/modules/procurement/domain/logic/procurement.logic.spec.ts`
- `apps/api/src/modules/procurement/application/use-cases/purchase-request.use-case.ts`
- `apps/api/src/modules/procurement/application/use-cases/vendor-bill.use-case.ts`
- `apps/api/src/modules/procurement/application/use-cases/supplier-payment.use-case.ts`
- `apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts`
- `apps/web/src/features/accounts-payable/AccountsPayablePages.tsx`
- `docs/plans/master-implementation-checklist.md`
- `docs/plans/implementation-roadmap.md`

Verification:
- Passed: `CI=true pnpm --filter @watchdog-bms/api exec tsx --test src/modules/procurement/domain/logic/procurement.logic.spec.ts` -> 4 tests passed.
- Passed: `CI=true pnpm --filter @watchdog-bms/api prisma:validate` -> schema valid.
- Passed: `CI=true pnpm --filter @watchdog-bms/api typecheck`.
- Passed: `CI=true pnpm --filter @watchdog-bms/web typecheck`.
- Note: sandboxed pnpm/tsx/prisma attempts hit expected local environment blockers (`tsx` IPC EPERM and Prisma engine cache EPERM), then passed with escalation.
- Note: `CI=true pnpm install --no-frozen-lockfile` restored `node_modules` after pnpm attempted a non-TTY reinstall. It still reported ignored dependency build scripts; focused test/typecheck/schema validation passed after that.

Next:
- Item 13 Bank Accounts and Reconciliation can consume supplier payments/vendor bills from item 12.
- Future AP enhancements should treat supplier credits/unapplied payments as a separate approved policy.
