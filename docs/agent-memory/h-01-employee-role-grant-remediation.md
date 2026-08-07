# Agent Memory: H-01 employee role-grant remediation

Status: Implemented and locally verified; deployment/live verification remains a release step.
Owner: API/Auth
Scope: Employee create/update role assignment, permission registry, audit evidence, specs, and H-01 checklist evidence.
Decisions: Enforce permission-set subset at the shared domain policy; deny actual self-role changes while accepting unchanged role IDs from profile-edit forms; reserve `FINANCE`/`ACCOUNTANT` assignment to OWNER through `access.role.financial.assign`; fail closed if denied-attempt audit persistence fails.
Open questions: None for local implementation. Clean CI artifact deployment and sanitized live telemetry verification are outside this local change.
Artifacts: `employee-access.logic.ts`, create/update employee use cases and tests, permission registry, employee access spec/plan, permission matrix, merged security checklist.
Verification: Focused Node tests 54/54 passed; full API regression tests 2010/2010 passed; `corepack pnpm --filter @watchdog-bms/api typecheck` passed; `git diff --check` passed. Review traced every non-test `membershipRole` mutation; employee assignment paths converge on create/update, while system onboarding creates only the protected first OWNER. Frontend review confirmed profile forms surface API failures and submit unchanged role IDs, covered by the no-op test.
Next: Deploy from clean CI, sync permission registry, verify denied role-grant audit telemetry, and retest AC-01 with authorized runbook before production release.
