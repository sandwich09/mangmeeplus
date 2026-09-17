# Agent Memory: Employee job titles in list and detail

Status: Complete and verified locally. Owner authorized inclusion in the billing commit and develop/main merges after clean CI on2026-09-17; deployment remains a subsequent step.
Owner: Codex
Scope: Missing job titles in both employee overview locations reported during billing UX review.
Decisions:
- Existing employee-job-title-and-hr-role-delegation spec keeps job titles separate from access roles. API list/detail mapping already returns jobTitle; both UI locations already render it.
- Read-only inspection of the local mangmee_ux database found all 15 seeded QA/Room45 employee profiles had null jobTitle. The seed never populated it. Add explicit descriptive titles to those sample definitions and fill only missing titles on seed reruns; preserve manually edited titles.
- Applied a narrow, localhost-only repair to those 15 known sample IDs in seed-local-company, without reseeding, changing roles, permissions or status, or inventing job titles for real employee records.
- Remove ellipsis from the job-title lines and give the detail identity group enough width before wrapping the controls. Missing real titles still show the honest empty state.
Open questions: None.
Artifacts: apps/api/prisma/seed.ts; IndividualPermissionsPrototypePage.tsx; e2e/employee-job-title.spec.ts.
Verification: Local DB now contains all 15 explicit sample titles. Desktop/mobile API-to-browser checks passed 2/2 (2.8s), /tmp/mangmee-employee-job-title-browser.log: actual API jobTitle, search by title, list row, selected detail, separate role badge, no ellipsis or horizontal overflow. Inspected both screenshots. Existing UI checks passed 7/7; web typecheck passed. Initial test opened the add-employee route by mistake; corrected it to access-overview before the successful run.
Next: Deliver with the billing batch after CI, then verify on UAT. Billing carryover customer E2E completed with scoped evidence and admin-browser limitations recorded in its task memory. No native deployment is included in the merge authorization.
