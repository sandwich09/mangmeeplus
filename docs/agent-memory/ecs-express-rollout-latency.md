# Agent Memory: ECS Express rollout latency

Status: Implemented; live UAT verification passed
Owner: Codex
Scope: UAT and production ECS Express deploy sequencing
Decisions:
- Keep the managed ECS Express canary and rollback completion gate.
- Run the AI Gateway stabilization rollout only when its endpoint changes.
- In `all`, refresh api-web after AI only when the AI endpoint changes.
- Collapse UAT's phase-specific workflow steps back to one freshly assumed deploy session because the steady-state path is now safely below the one-hour credential lifetime.
- Use a service-specific target for production incidents; reserve `all` for coordinated releases.
Open questions:
- None.
Artifacts:
- `infra/prod-ecs-express/deploy.sh`
- `.github/workflows/deploy-uat.yml`
- `infra/docker/production-image-security.spec.sh`
- `docs/specs/uat-environment-spec.md`
- `docs/plans/uat-environment-plan.md`
Verification:
- Run `30526038165` showed initial api-web taking 10m24s and AI Gateway taking 19m because AI performed two full rollouts.
- Steady-state `all` now performs three rollouts instead of five, saving about 20 minutes while retaining each canary gate.
- Push CI run `30529183852` passed in 6 minutes; UAT run `30529628323` reused that exact validation for commit `45c467858856ff426b2f0e5572a9d5ab8bee08bc`.
- UAT run `30529628323` completed successfully. The immutable deploy step took 30m22s and performed exactly three managed rollouts: api-web, AI Gateway, and workers.
- The deploy log confirmed `[deploy-all] AI Gateway endpoint unchanged; skipping redundant api-web rollout`; no second AI Gateway rollout or final api-web rollout ran.
- Post-deploy verification reported `ACTIVE`, commit `45c467858856`, and healthy status for api-web, AI Gateway, and workers.
- Public smoke checks passed: API health returned HTTP 200 and the web root returned the expected HTTP 302 login redirect.
- `bash infra/docker/production-image-security.spec.sh`: passed.
- `bash -n infra/prod-ecs-express/deploy.sh`: passed.
- Ruby YAML parse of `.github/workflows/deploy-uat.yml`: passed.
- `git diff --check`: passed.
- `actionlint` is unavailable locally.
Next:
- Superseded by `docs/agent-memory/deploy-wave-rollout-and-prod-promotion.md`: the
  remaining 30m22s is three *sequential* rollouts, so `all` now runs them as
  concurrent waves and production can promote a UAT-validated release instead of
  rebuilding. The managed canary gate and this task's rollout-count decisions stand.
- Use a service-specific target for production incidents.
