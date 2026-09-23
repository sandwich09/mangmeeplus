# Agent Memory: Package purchase required markers

Status: Implemented in an isolated worktree; not merged or deployed.
Owner: Codex
Scope: Red visual asterisks on the current package purchase prerequisite fields in the company profile and account email form.
Decisions: Mark address line 1, subdistrict, district, province, postal code, and account email. Mark registered name only when the existing shop name is blank, because either name satisfies billing. Do not mark tax ID, VAT, business type, or address line 2. The marks are presentation only; existing validation and email policy are unchanged.
Open questions: None.
Artifacts: `apps/web/src/common/components/field/Field.tsx`, `apps/web/src/common/components/field/ThaiAddressFields.tsx`, `apps/web/src/features/company-profile/CompanyProfilePage.tsx`, `apps/web/src/features/auth/AccountEmailOtpPanel.tsx`.
Verification: Contracts build passed; focused CompanyProfilePage QA spec passed 30/30; web typecheck passed; `git diff --check` passed. No browser or production verification was run for this visual change.
Next: Review the isolated worktree diff; merge and deploy only under the relevant release protocol when requested.
