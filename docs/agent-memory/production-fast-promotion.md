# Agent Memory: production fast promotion

Status: Maintenance-bootstrap hardening implemented and locally verified; awaiting live proof
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
- Maintenance-only auto may derive a read-only bootstrap for an exact applied
  prefix with pending append-only migrations. Live auto never receives this
  exception.
- Same-source bridge/final bytes are allowed only after exact all-service and
  global-maintenance runtime proof, so no no-op commit or duplicate UAT deploy
  is needed.
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
- `verify-applied-migration-catalog.spec.ts`: 11/11 pass, including exact,
  append-only pending, unknown, edited, missing-middle, and reordered catalogs.
- `resolve-production-fast-mode.spec.sh`: pass for selective/no-change,
  maintenance bootstrap, live rejection, malformed service state, and
  non-ancestor Production baselines.
- `production-serving-mode.spec.sh`: pass, including rejection of selective
  maintenance invocation outside the workflow.
- `validate-production-maintenance-release.spec.sh`: pass with exact byte pins.
- `production-image-security.spec.sh`, `release-safety.spec.sh`,
  `maintenance-preflight.spec.sh`, UAT selector and UAT workflow suites: pass.
- Production workflow YAML parse, shell syntax and `git diff --check`: pass.
- PR #30 merged as `487d4dc96b4a512ffc50b4326857472a91d82225`.
- UAT run `31488786355` promoted source `8aab86325ada7c65f5819e37c41805cbd68d2998`
  with `auto -> all`; CI reuse, all three signed images, deployment health,
  acceptance signing, and both Production artifacts passed in 18m33s.
- Production run `31490507419` verified that signed UAT acceptance and skipped
  build/test, then stopped before mutation in 50s because active Production
  source `eb515b9e1e92ca970bd14c67fdeebb6f859cf838` is behind ten migrations.
Next: Commit and merge the verified controller, repeat exact UAT acceptance,
then prove Production `auto + maintenance_only` derives `maintenance-bootstrap`
and reaches the closed all-service state without database mutation.
