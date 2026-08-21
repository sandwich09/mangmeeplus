# Employee Job Title and HR Role Delegation Plan

## Status

Implemented locally on 2026-08-21. Not deployed.

## Linked Spec

- [[specs/employee-job-title-and-hr-role-delegation-spec|Employee Job Title and HR Role Delegation Spec]]
- [[specs/employee-access-role-management-spec|Employee Access and Role Management Spec]]

## Smallest Correct Change

1. Add nullable `EmployeeAccessProfile.jobTitle` plus additive API contracts and mapping.
2. Add `access.role.operational.assign`, an `HR` system role, and an explicit server-side HR operational-role allowlist.
3. Keep the existing owner, self-change, financial, protected-role, feature-entitlement, and audit boundaries.
4. Update the employee wizard and access overview to distinguish job title from system role and use field-level validation.
5. Add focused contract/permission/role-grant/UI-logic tests and run typechecks.

## Verification

- [x] Prisma schema/migration validates.
- [x] Permission registry and HR grant-boundary tests pass.
- [x] Employee create/update mapping tests pass.
- [x] Web focused tests pass (14/14).
- [x] API focused tests and typecheck pass (120/120 in the final security run).
- [x] `git diff --check` passes.
- [ ] Current repo-wide web typecheck: blocked by unrelated concurrent changes in `ReimbursementsPages.tsx` (`MissingSavedSignatureModal`, `removeLightBackground`, `assertAllowedUploadFile`, `uploadClaimSignature`, and `IMAGE_UPLOAD_ACCEPT` are undefined). This task's web typecheck passed before those external edits appeared, and the final compiler output reports no employee-access errors.
