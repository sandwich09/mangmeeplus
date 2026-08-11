# Agent Memory: production fast promotion

Status: Implemented locally; live timing not yet measured
Owner: Codex / release owner
Scope: UAT selective release plus UAT-backed Production fast/no-migration promotion.
Decisions:
- Reuse the existing UAT classifier and exact signed resolved-all acceptance.
- Mint that acceptance from the resolved target, so explicit `all` and
  `auto -> all` carry identical authority only after identical three-service
  deploy, health and finalization evidence.
- `target=auto` is coordinated UAT promotion, never incident authority.
- Keep Production canary/bakes and every legal/security/maintenance gate.
- Prove the exact migration catalog inside the fenced release task before any
  idempotent sync or application rollout; mismatch returns to explicit full U5.
- Do not add dependencies or modify package manifests.
Open questions: None.
Artifacts:
- `docs/specs/production-fast-promotion-spec.md`
- `docs/plans/production-fast-promotion-plan.md`
Verification:
- Resolved-all acceptance regression proves all three signing/upload conditions
  use `steps.target.outputs.target`, and rejects the stale requested-target gate.
- `production-release-intent.spec.sh`: pass.
- `production-fast-promotion.spec.sh`: pass, including rendered release-task
  command and malformed authority rejection.
- `verify-applied-migration-catalog.spec.ts`: 5/5 pass.
- `production-serving-mode.spec.sh`: pass, including rejection of selective
  maintenance invocation outside the workflow.
- `validate-production-maintenance-release.spec.sh`: pass with exact byte pins.
- `production-image-security.spec.sh`, `release-safety.spec.sh`,
  `maintenance-preflight.spec.sh`, UAT selector and UAT workflow suites: pass.
- Production workflow YAML parse, shell syntax and `git diff --check`: pass.
Next: Commit/push when requested, then measure one real selective UAT run and
one no-migration Production promotion. GitHub/AWS execution was not performed
as part of this implementation verification.
