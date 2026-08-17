# Agent Memory: deploy-time-reduction

Status: Spec+plan authored; execution blocked until in-flight 2026-08-17
release reaches customer `OPEN` (see `production-deploy-2026-08-17.md`) and
GitHub Actions/API incident resolves.
Owner: Product owner / Claude (Fable 5 orchestrating, Opus 5 implementing)
Scope: 3-phase deploy-time reduction to ≤10m UAT and ≤10m production promote,
per `docs/specs/deploy-time-reduction-spec.md` and
`docs/plans/deploy-time-reduction-plan.md`.
Decisions:
- Sequencing: complete in-flight promotion (UAT `32038712267`, READY
  `32041268834`, then Production V2 live + stage E OPEN) before any controller
  change lands. Rationale: Passport/READY pin exact workflow blobs; a
  controller change now would strand the signed chain.
- Live post-shift bake (3m) is retained in phase 1; only canary bakes and
  maintenance-mode bakes go to 0. Owner may revisit with traffic growth.
Open questions:
- None blocking phase 1. Phase-2 Fargate fence/retire latency split still to be
  measured from run logs (plan §2 step 1).
Artifacts:
- Evidence run set: UAT `31901904745` (22m, step table), UAT `31816168613`
  (32m full-CI), READY `31903027707` (6m), prod live `31903336753` (38m, step
  table), failed prod `31897008213` (1h30m: close 23m / rollout-fail 25m /
  recovery 27m).
Verification:
- Spec §1 tables derived from GitHub Actions job/step timestamps via `gh api`
  on 2026-08-17.
- Phase-1 read-back evidence (2026-08-17, read-only, `watchdog-bedrock`):
  prod ×3 services `CANARY canaryPct=5 canaryBake=3 bake=3`, alarms+circuit
  breaker enabled, rollout COMPLETED. RollbackAlarm: ELB target-group
  error-rate, Period=60, EvaluationPeriods=3, DatapointsToAlarm=2,
  threshold>1, TreatMissingData=notBreaching. Rollback reference for phase-1
  revert: restore canaryBake=3, bake=3 on all three services.
Implementation review (2026-08-18, Fable 5 reviewing Opus 5):
- Phase 1 APPROVED: commit `7e8e60b` on `feat/deploy-speed-phase-1` (8 files,
  +340/−5). lib-prod-rollout-config.sh reuses the UAT shape validators (one
  contract, no copy-drift); live=0/3, maintenance=0/0, unknown mode fails
  closed; adaptive poll keeps ceiling attempts×20 exactly
  (75→1500s, 90→1800s asserted). All gates green incl. full
  production-image-security suite + pin cascade resync
  (validatorSha256 7486173c…, expected_deploy 278cd4ac…). Decision: ci.yml
  release_controller_only allowlist NOT extended — the one phase-1 PR accepts
  a full-CI run (fails safe) instead of widening the most blob-sensitive file.
  Live alarm names confirmed against 2026-08-17 read-back (exact match).
- Phase 2 APPROVED with scope cut: commit `6a00906` on
  `feat/deploy-speed-phase-2` (deploy-uat.yml only, +90/−3): publish-reuse
  gate, fail-open decision table, all needs.build_and_publish references
  traced, download run-id/github-token pattern precedented by
  deploy-production.yml:325. Full suite RC=0 re-run by reviewer after
  pnpm install + prisma generate. §5.2 publish-on-develop REJECTED on
  evidence: uat environment branch policy = main only; cosign identity
  ci.yml@refs/heads/develop cannot satisfy the @refs/heads/main pin; develop
  merge-commit heads have no exact PR CI. Spec §5.2 rewritten accordingly;
  UAT first-dispatch target revised to ~14–15m, redeploy ~9–10m.
- §5.3 fence/retire measurement: blocked locally (watchdog-bedrock profile
  lacks ecr:DescribeImages on migration-tool; newest ECR entries are OCI
  indexes so imageSizeInBytes is manifest size). Plan: capture ECS task
  provision/pull/execute timing live during the upcoming promote run.
- Phase 3 in progress (stacked on phase 1), carrying the readiness env-map
  hotfix forward.
Next:
- After stage E OPEN: merge order = hotfix (already ahead) → phase 1 → phase 2
  → phase 3, each with its verification run per plan; main→develop sync after
  workflow-file merges; first phase-1 verification candidate = camera-fix PR
  head via full chain.
