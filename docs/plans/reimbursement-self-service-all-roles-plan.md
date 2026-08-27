# Plan: Reimbursement self-service for every company role

Status: Complete and pushed to develop (2026-08-27); not deployed to UAT/Production.

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
- [x] Reconcile latest develop, rerun focused verification, commit and push normally to develop.

## Integration evidence

Implementation `065e917c`; merged WHT/VAT develop `8c472324` at `2bb26f16` without conflicts.
Final integration rerun: 333 API + 184 web tests passed, including role catalog and updated VAT
web regressions. Full API and web typechecks passed with this worktree's generated client.
Atomic non-force push delivered `2bb26f163b10e2596fb01c905d49d9d22b6104ce` to develop and
codex/reimbursement-self-service-all-roles; both remote heads were confirmed with ls-remote.
This final documentation follow-up records that successful delivery without application changes.
Local browser: ADMIN CTA at 390px, custom-readonly CTA at 1280px (no horizontal overflow),
auditor own create form posts synthetic 25 THB draft/branch, feature-OFF hub and direct-create
show accurate guidance and no create action. The synthetic API did not exercise live login,
storage or post-save protected-route navigation; actual use-case tests cover draft submission.
Safe local tests only; no UAT/Production deploy or permission sync against a live DB.
Permission data takes effect through the existing normal startup/seed sync when released.
