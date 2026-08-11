# Agent Memory: UAT reused-CI release manifest

Status: Release-manifest fix verified; rollout-latency follow-up moved to `ecs-express-rollout-latency.md`
Owner: Codex
Scope: Reusable CI release-manifest assembly after UAT reuses exact successful pull-request validation
Decisions:
- Keep trusted validation reuse and immutable image publication unchanged.
- Run `publish-production-manifest` through skipped validation ancestors with `always()`, but only when source resolution and all three image publishers succeeded.
- Reuse the existing production image security script for the regression guard.
- Avoid redundant stabilization rollouts and make ECS polling fail fast on AWS API errors. The temporary phase-specific credential refresh was superseded by the shortened single-session path recorded in `ecs-express-rollout-latency.md`.
Open questions:
- None.
Artifacts:
- `.github/workflows/ci.yml`
- `infra/docker/production-image-security.spec.sh`
- `docs/plans/github-actions-budget-optimization-plan.md`
- `.github/workflows/deploy-uat.yml`
- `infra/prod-ecs-express/deploy.sh`
- `docs/plans/uat-environment-plan.md`
Verification:
- `bash infra/docker/production-image-security.spec.sh`: passed.
- `bash -n infra/prod-ecs-express/deploy.sh infra/uat/setup-control-plane.sh`: passed.
- Ruby YAML parse of `.github/workflows/deploy-uat.yml`: passed.
- `git diff --check`: passed.
- `actionlint` was unavailable locally; the repository's static workflow contract passed.
- UAT run `30520656494` proved exact-CI reuse and manifest publication, then was cancelled after live logs showed repeated `ExpiredTokenException` once the one-hour deploy-role session expired.
Next:
- See `docs/agent-memory/ecs-express-rollout-latency.md`.
