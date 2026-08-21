# Agent Memory: Employee Job Title and HR Role Delegation

Status: Ready for review on `codex/employee-job-title-hr-delegation`; not deployed
Owner: Codex
Scope: Separate employee job title from system RBAC role; add constrained HR employee-administration delegation; align wizard validation and labels.
Decisions:
- `jobTitle` is nullable in persistence and additive in the API for backward compatibility, but required by the new wizard.
- Job titles are free text (120 characters) and do not grant permissions.
- HR may assign only MANAGER, SALES, INVENTORY, MARKETING, and STAFF.
- HR cannot assign itself, privileged/financial/audit/platform/custom roles; owner remains the HR assigner.
- No payroll, leave, salary, tax, or statutory HR scope is added.
Open questions: None.
Artifacts:
- `docs/specs/employee-job-title-and-hr-role-delegation-spec.md`
- `docs/plans/employee-job-title-and-hr-role-delegation-plan.md`
Verification:
- `pnpm --filter api exec prisma validate --schema prisma/schema.prisma` passed.
- `pnpm --filter api typecheck` passed on the branch rebased onto `origin/develop`.
- Final focused API security/use-case run passed 152/152, including HR operational allowlist, forbidden current-role changes, custom-role key spoofing, and the latest entitlement-filtered grant rules from `develop`.
- `pnpm --filter web exec tsx --test src/features/employee-access/employee-email.logic.spec.ts src/features/employee-access/role-picker.logic.spec.ts` passed 16/16.
- Contracts build and web typecheck passed on the clean branch worktree.
- Prisma migration adds nullable `jobTitle`; `git diff --check` passed.
Next: Review and merge the PR into `develop`. Deployment remains a separate authorized action under the UAT/Production runbook.
