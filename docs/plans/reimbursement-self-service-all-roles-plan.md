# Plan: Reimbursement self-service for every company role

Status: In progress (2026-08-27)

## Product and architecture

- User reports ADMIN missing สร้างคำขอเบิก and requires all company-member roles to request
  their own reimbursement. This extends the existing internal-role baseline, not approver or
  payer authority. See auth-authorization-rbac-spec §8 and reimbursement-approval-spec §4/8.1.
- Reuse materialized role permissions, the automatic capability-pack compiler and additive
  company-role backfills; no schema, package dependency, runtime bypass, or live data changes.
- Standard company roles, custom/read-only roles, and new role templates receive own request
  read/create/edit/submit/cancel plus branch selection and receipt upload/read prerequisites.
- Universal self-service is not discretionary granter authority. Preserve it during role edits
  even when feature OFF removes it from the editor's effective permissions. Other grants still
  obey owner-delegated scope. Runtime feature OFF and source/ownership checks remain unchanged.

## Implementation

- [x] Add one canonical baseline reused by system grants, automatic self pack and old-role backfill.
- [x] Keep baseline during compilation; keep role catalog consistent with the mandatory pack.
- [x] Correct unavailable-create/empty-state guidance and verify responsive CTA visibility.
- [x] Test persisted-role sync, templates/compiler, effective permissions and own create/submit
  including receipt evidence; test feature OFF, tenant/branch/ownership denial and unchanged
  approve/pay boundaries.
- [ ] Reconcile latest develop, rerun focused verification, commit and push normally to develop.

## Integration evidence

Initial checks: 193 focused API + 139 boundary API + 82 web tests passed; web and API full
typechecks passed after generating this worktree's Prisma client and resolving installed
dependencies. One additional role-catalog regression will be included in the integration rerun.
Local browser: ADMIN CTA at 390px, custom-readonly CTA at 1280px (no horizontal overflow),
auditor own create form posts synthetic 25 THB draft/branch, feature-OFF hub and direct-create
show accurate guidance and no create action. The synthetic API did not exercise live login,
storage or post-save protected-route navigation; actual use-case tests cover draft submission.
Safe local tests only; no UAT/Production deploy or permission sync against a live DB.
Permission data takes effect through the existing normal startup/seed sync when released.
