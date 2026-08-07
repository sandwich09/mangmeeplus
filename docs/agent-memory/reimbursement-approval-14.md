# Agent Memory: Reimbursement Approval and Review (Item 14)

Status: Core MVP implemented and verified (2026-07-01). Optional/conditional integrations deferred (see Next).

Owner: develop branch.

Scope:
- Implemented item 14 per [[../specs/reimbursement-approval-spec|Reimbursement and Approval Spec]] and [[../plans/reimbursement-approval-plan|Reimbursement Approval Plan]] (Phases 1–3, 6, 7–8; Phase 4/5 external adapters deferred).

Decisions:
- No direct-manager/team model exists on `User`, so approver mode is `MANAGER_ROLE`: submit assigns a role-based approval step (`currentApproverUserId` stays null); any user with `reimbursement.approve` in company scope can act, self-approval blocked by comparing requester vs actor.
- Modeled 5 tables (Policy, Request, ApprovalStep, Payment, DuplicateCandidate). Skipped optional `ReimbursementLine` (single amount on request; no acceptance criterion needs multi-line) and `ReimbursementStatusEvent` (shared AuditLog + approval steps + payments power the timeline).
- Money is decimal strings in contracts, `Decimal(18,4)` in Prisma, `decimal.js` in logic.
- Document numbers reuse `ReserveDocumentNumberUseCase`/`CommitDocumentNumberUseCase` with sequence keys `reimbursement.request`/`reimbursement.payment` (seeded in `prisma/seed.ts`); a deterministic fallback number is used if the sequence is not seeded for the company/period.
- Approval snapshot: sha256 (first 32 hex) over amount|currency|category|incurredDate|reason|attachmentId, frozen at submit; approve/reject re-check it (stale → `stale_approval_snapshot`). Post-submit edits are blocked entirely (PATCH is draft-only), which is stricter than the spec's invalidate-and-resubmit.
- MVP payment is full-payment only: `paidAmount` must equal outstanding; under/over/partial rejected. Reference required for `BANK_TRANSFER`/`CHEQUE`.

Key files:
- Contracts: `packages/contracts/src/reimbursements.ts` (+ index export).
- API: `apps/api/src/modules/reimbursements/**` (domain logic + models + constants, use-cases policy/request/approval/finance/summary, prisma repo, 2 controllers, module). Registered in `apps/api/src/app.module.ts`.
- Permissions: `apps/api/src/modules/auth/permission-registry.ts` (15 `reimbursement.*` keys + role grants). NOTE: deny-by-default guard requires permission metadata on every route AND is AND-only (no OR), so `reimbursement.read_own` is granted to every reading role (STAFF/SALES/INVENTORY/FINANCE/MANAGER/ADMIN/ACCOUNTANT/AUDITOR) as the base read gate; use cases widen scope with `reimbursement.read`.
- Schema/migration: `apps/api/prisma/schema.prisma` + `apps/api/prisma/migrations/20260701000000_item14_reimbursement_approval/` + seed additions.
- Web: `apps/web/src/features/reimbursements/**`, route `apps/web/app/(workspace)/companies/[companyId]/reimbursements/page.tsx`, nav module in `web-core-workspace.constants.ts` + dictionary labels.

Verification:
- `pnpm -r typecheck` clean; `pnpm -r lint` clean; `pnpm -r test` green (API 517/517, Web 103/103).
- All 14 Prisma migrations applied to a throwaway Postgres via `prisma migrate deploy`; `migrate status` = up to date, no drift; 5 tables + PK/FK/unique constraints verified.

Bugs found and fixed during review:
- Deny-by-default guard denied metadata-less list/get/summary/update/cancel routes → added `@RequirePermissions` gates + `read_own` grants.
- `outstandingAmount` went stale if a draft's amount was edited before submit → frozen to submitted amount at submit.
- Payment `sourcePaymentRef` stored `sourceId: 'pending'` → now written with the real payment id after create (item 13 matching).

Next (deferred, conditional/optional per spec — safe to add when those modules expose extension points):
- Item 10 ledger source-posting adapter and item 11 tax review-candidate adapter (posting status `pending` + source facts already exposed; only adapter wiring deferred). [[double-entry-ledger-closing-10]] [[item-11-thai-tax-mvp]]
- AI Gateway item 07 read-tool registration (read-only summary endpoint exists). [[line-ai-read-only-assistant-07]]
- Notification/LINE delivery wiring (outbox events already emitted). [[dashboard-notification-06]]
- Branch-level ABAC scoping beyond company + ownership; multi-line requests; partial payments (backlog).
