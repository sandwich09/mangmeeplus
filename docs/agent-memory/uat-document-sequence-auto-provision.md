# Agent Memory: UAT document sequence auto-provision

Status: IMPLEMENTED AND VERIFIED; UAT data repaired, code not yet deployed
Owner: Codex
Scope: Repair the missing UAT `expense.record` sequence for the affected tenant
and implement the documented lazy provisioning behavior in the shared document
sequence reservation path.
Decisions:
- Keep onboarding free of per-document sequence writes; first document use is
  the provisioning boundary already specified by the onboarding contract.
- System-catalog document types may be created from defaults when a company has
  no prior sequence.
- A missing later period inherits the latest active prefix, padding, and reset
  policy.
- `DISABLED` is an explicit administrator stop and must not be bypassed.
- Unknown document types without prior configuration keep returning 422.
Open questions:
- None for this scope.
Artifacts:
- `docs/specs/data-model-core-spec.md`
- `docs/plans/data-model-core-plan.md`
- `docs/plans/admin-company-onboarding-plan.md`
- `apps/api/src/modules/data-model-core/domain/logic/document-sequence.logic.ts`
- `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-document-sequence.repository.ts`
- `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-document-sequence.repository.spec.ts`
Verification:
- UAT ECS task `c151c0179222429c9b4f0207cc1d200d` completed with exit 0.
- UAT company `New Nail Near Me` now has active global `expense.record` sequence
  for `2026-07`, prefix `EXP-{YYYY}{MM}-{SEQ}`, padding 5, monthly reset, and
  next number 1.
- The target expense remained `READY_FOR_CONFIRMATION`; the repair did not
  confirm or otherwise mutate the document.
- Shared document-sequence focused tests: 19 passed, 0 failed.
- API TypeScript check: `corepack pnpm --filter @watchdog-bms/api typecheck`
  passed.
- `git diff --check` passed.
Next:
- Deploy the code change through the normal UAT release flow when it has an
  approved source commit. The immediate affected tenant does not need to wait
  for deployment because its UAT row is already repaired.
