# Agent Memory: Reimbursement Self-Service All Roles

Status: Implemented and locally verified; preparing latest-develop integration (2026-08-27).
Owner: /root/reimbursement_self_service
Scope: User-authorized isolated branch codex/reimbursement-self-service-all-roles from develop
a53bb992fc04713d7cba2f2b19c08286f27c08e5; fix every company role's own reimbursement journey,
test, then commit/push to develop. Do not touch the dirty root plan checkout or live environments.

Decisions:

- Follow ponytail full using this repo's .agents/skills/ponytail/SKILL.md (legacy absolute path
  in AGENTS is not this machine's path). Reuse existing grants/compiler/backfill, no dependency.
- ADMIN's standard grant is already present; old custom roles/presets and read-only company
  roles lack the complete baseline. Actual screenshot UAT session/deployed state was not read.
- Mandatory own-request baseline covers create/edit/submit/cancel/read plus existing branch
  and attachment primitives. No approval/payment/policy permission or feature-gate change.
- Preserve company membership, requester, branch and evidence ownership checks. SYSTEM_ADMIN
  does not acquire customer membership or universal cross-company data access.
- Local source/test changes only; do not run permission sync against any live DB.

Open questions: None blocking for the requested company-member self-service policy.
Artifacts: docs/plans/reimbursement-self-service-all-roles-plan.md; auth and reimbursement specs.
Verification:

- API focused: `tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec` over
  `apps/api/prisma/sync-permissions.spec.ts`, auth `permission-registry.spec.ts`, employee-access
  `capability.logic.spec.ts`, `feature-gate.logic.spec.ts`, `role-template-system-role-parity.spec.ts`,
  `role-management.use-case.spec.ts`, access-control `permission-resolver.spec.ts`, and reimbursement
  `reimbursement-request.use-case.spec.ts` — 193 tests passed before the final catalog regression.
- API boundaries: same command over reimbursement approval/finance/branch-scope/related-access
  use-case specs, evidence service spec, employee-access logic and menu-entitlement-binding specs
  — 139 tests passed. No live PostgreSQL used.
- Web: `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec
  apps/web/src/features/reimbursements/reimbursements*.spec.ts
  apps/web/src/features/web-core-workspace/permission-page-visibility.spec.ts` — 82 tests passed.
- `tsc --noEmit --incremental false -p apps/web/tsconfig.json` and API equivalent — PASS.
  Initial API check exposed stale shared generated Prisma and missing linked SES/config deps;
  resolved using installed dependencies and own generated client, no package.json change.
- Local browser (actual components with synthetic API on ports 4340/4341): ADMIN create CTA
  visible at 390px, 44px tall, no horizontal overflow; custom read-only CTA visible at 1280px,
  correct create href and no approval/payment tabs. Auditor create form selected own test branch
  and posted one synthetic 25 THB draft. Feature OFF hides CTA and gives correct empty-state and
  direct-create guidance. Live login/upload storage and post-save protected-route navigation were
  not part of the fixture (post-save redirects to login without a real session). API tests cover
  actual create/receipt evidence/update/submit, own-only and feature-OFF boundaries.
- Temporary fixture page removed, next-env restored and both local fixture servers stopped.
- Housekeeping incident reported to parent: first Prisma generate followed a still-linked
  ignored root generated directory because the unlink path used the wrong cwd. No tracked root
  source/schema or database was changed. Link removed before generating our own local client.

Next: Commit scoped files, merge latest develop (WHT/VAT delivered at 8c472324), regenerate
local client, rerun focused tests/typechecks, coordinate before normal non-force develop push.
