# Agent Memory: reimbursement multi-role approvers

Status: Implemented locally, unit and type checks pass (2026-09-25). Not deployed.
Owner: Claude (session with the owner, 2026-09-25)
Scope: reimbursement policy "ส่งใบเบิกให้ใครอนุมัติ?" becomes a multi-role checkbox list (e.g. OWNER + CEO + MANAGER).

Decisions:
- Owner picked "one decision from any of several roles". Multi-step and amount-tiered routing stay out of scope (routing spec D1 amendment).
- New column `ReimbursementPolicy.defaultApproverRoles TEXT[]`. The migration backfills it from `defaultApproverRole`. The repository mapper also falls back to `[defaultApproverRole]` for rows saved without the list (for example, seed data).
- `defaultApproverRole` and `approverMode` keep the first role. The policy snapshot shape is unchanged (its parser rejects unknown keys, so adding a field would break a rollback). Queue, authorization, notification, SLA and claim form already read the frozen `assignedApproverUserIdsJson`, so they needed no change.
- Save: every selected role must be selectable. At submit, a role that lost approve capability is skipped, and the route is refused only when none of the roles is usable. The OWNER fallback applies only when no selected role has an actionable holder.
- Web: when the page loads, it drops any stored role that no longer appears in the options, and the next save stores the shorter list.
- API input `defaultApproverRole` was replaced by `defaultApproverRoles` (web is the only client).
- Known limits come from the step recording only the first role. D4 recovery (every frozen assignee gone) and the journey hint "blocked only by the self-approval switch" both look at the first role plus OWNER only.

Open questions: none.

Artifacts:
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260925160000_reimbursement_policy_approver_roles/`
- `packages/contracts/src/reimbursements.ts`, `apps/api/src/modules/reimbursements/**` (policy use-case routing union + save validation, submit passes `roleKeys`, DTO, mapper, record type, constants)
- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx` (checkbox list), `reimbursement-guide.content.ts`
- Spec: `docs/specs/reimbursement-approver-routing-policy-spec.md` (D1 amendment, §9.2)

Verification:
- `prisma validate` and `prisma generate` pass. The migration SQL came from `prisma migrate diff` plus the backfill UPDATE. It was not applied, because no local database was reachable.
- API reimbursement and workflow specs: 540 pass, 0 fail, 16 skipped. All 16 skips are DB-only tests ("no database reachable").
- Web reimbursement and user-guide specs: 147/147 pass. Web typecheck is clean.
- API typecheck: clean for the reimbursement changes. It still has 2 errors from the in-progress counterparty work already on the branch (`counterparty.use-case.ts:257`, `counterparty.controller.ts:128`), which this change does not touch.

Next: run `prisma migrate deploy` on a real database, then in the browser tick OWNER + another role and submit a claim to confirm both see it in the queue.
