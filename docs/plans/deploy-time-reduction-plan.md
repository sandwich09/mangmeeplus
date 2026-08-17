# Deploy Time Reduction Plan

Status: Ready to execute after the in-flight 2026-08-17 release reaches
customer `OPEN` (stage E) — no controller change may land before that
Owner: Platform / release owner
Spec: `docs/specs/deploy-time-reduction-spec.md`
Protocol: `docs/runbooks/uat-production-v2-deployment.md` governs every
dispatch in this plan; run IDs are recorded in
`docs/agent-memory/deploy-time-reduction.md`.

## 0. Hard sequencing constraints

1. `main` is frozen until the in-flight release (UAT `32038712267`, READY
   `32041268834`) completes stage E. Phase 1 lands only after that.
2. Workflow-file edits invalidate CI reuse and blob-match for in-flight
   candidates (`deploy-uat.yml` requires candidate and controller to hold
   identical `ci.yml`/`deploy-uat.yml` blobs for `all`). Therefore every phase
   that edits workflows must land on `main` **and** be merged back to
   `develop` in the same maintenance window, and the first UAT run after each
   phase uses a candidate cut after that sync.
3. One phase at a time. Each phase ends with a real-run verification gate
   (§per-phase below) recorded in the ledger before the next phase starts.
4. Any release-file change re-runs the pin cascade before merge:
   `node infra/security/sync-production-maintenance-release-pins.mjs` (apply),
   `--check` to prove, then `bash infra/docker/production-image-security.spec.sh`.

## 1. Phase 1 — bake policy + poll cadence

Files:
- `infra/prod-ecs-express/lib-prod-rollout-config.sh` (new; mirrors
  `lib-uat-fast-rollout.sh` structure: snapshot → fail-closed shape
  validation → desired configuration by `REQUESTED_SERVING_MODE` → ensure →
  post-deploy verify)
- `infra/prod-ecs-express/deploy.sh` (source + call sites next to the existing
  `ensure_uat_fast_rollout_configuration` calls; production guard
  `DEPLOY_ENV = production`)
- `infra/prod-ecs-express/lib-wait-for-service-url.sh` (tiered poll interval)
- `.github/workflows/deploy-production-v2.yml` (pass
  `REQUESTED_SERVING_MODE` through to deploy env if not already;
  recompute `DEPLOYMENT_POLL_ATTEMPTS` for the new interval so the ceiling
  stays ≥ 25m)
- `infra/prod-ecs-express/uat-fast-rollout.spec.sh` (+ prod fixtures) or new
  `prod-rollout-config.spec.sh`

Step order:
1. Read-back evidence (blocking): live `deploymentConfiguration` of the three
   production services and `RollbackAlarm` metric/period; record prior values
   in the ledger as the rollback reference. Runner: read-only AWS via the
   existing A5/readiness read path or `AWS_PROFILE=watchdog-bedrock` if
   available locally.
2. Implement + local gates:
   `bash -n` all touched scripts,
   `bash infra/prod-ecs-express/uat-fast-rollout.spec.sh`,
   `bash infra/prod-ecs-express/release-safety.spec.sh`,
   pin cascade (§0.4), `git diff --check`, workflow YAML parse.
3. PR → review → admin merge to `main`; merge `main → develop` sync PR.
4. Verification gate (real runs):
   - maintenance-mode promote (routine nightly path) — expect rollout step
     ≤ ~14m (2 waves × mechanics only) and total promote ≤ ~26m;
   - next live promote — expect rollout ≤ ~20m (2 waves × (mechanics + 3m
     post-shift)).
   - Confirm post-deploy `verify_*` proves the bake values persisted, and
     alarms/circuit breaker still validate in the snapshot shape.
Rollback: revert commit; re-run ensure with recorded prior minutes.

## 2. Phase 2 — publish reuse, publish-on-merge, fence/retire latency

Files:
- `.github/workflows/deploy-uat.yml` (publish-reuse gate alongside the
  existing CI-validation-reuse step; fail-open to full publish)
- `.github/workflows/ci.yml` (no publish-logic change; expose existing
  publish path to the new trigger)
- `.github/workflows/publish-on-develop.yml` (new thin trigger)
- `infra/prod-ecs-express/run-release-task.sh` + task-definition template
  (image selection per §5.3 of the spec — only after the measurement step)
- specs: extend `infra/docker/production-image-security.spec.sh` fixtures for
  the reuse gate; pin cascade.

Step order:
1. Measure (blocking): from two recent runs' `run-release-task.sh` logs,
   record Fargate provision/pull/execute split for fence and retire tasks;
   record `migration-tool` vs `watchdog-bms-api` image sizes. Decide slim-image
   option 1 vs 2 (spec §5.3) from data.
2. Implement publish-reuse + publish-on-merge; then fence/retire image change
   as a separate commit (independent rollback).
3. Local gates as §0.4 + workflow parse + a dry validation that the reuse gate
   rejects: missing digest, unsigned digest, manifest mismatch (fixtures).
4. Merge choreography as §0.2/0.3.
5. Verification gate: one UAT `all` with a pre-published candidate — expect
   dispatch→Passport ≤ 10m (build leg absent, fence+retire ≤ ~3m total,
   rollout ~7m); one promote — fence+retire ≤ ~3m.
Rollback: revert commits; reuse gate fails open to full publish by design.

## 3. Phase 3 — READY folded into promote

Files:
- `.github/workflows/deploy-production-v2.yml` (leading readiness job emitting
  the signed READY artifact; promote consumes same-run artifact; drop the two
  duplicated read-only recheck steps; keep mutation-boundary checks)
- `.github/workflows/production-readiness.yml` (retained for standalone
  dispatch; shared logic factored via reusable workflow if the diff stays
  smaller than duplication)
- `infra/security/` validator scripts + pins for the changed contract
- runbook `docs/runbooks/uat-production-v2-deployment.md` §§4–5 updated in the
  same PR (single-dispatch path documented)

Step order:
1. Contract design note in the PR description: exact fields of READY that the
   promote consumes same-run vs re-proves at mutation boundary.
2. Implement; full local cascade §0.4 + all release contract specs.
3. Rehearsal gate (blocking): one `maintenance_closed` promote end-to-end on a
   real candidate before any `live` use of the combined path.
4. Verification gate: live promote ≤ ~11m dispatch→signed `PROMOTED_LIVE`;
   stage E unchanged.
Rollback: revert to two-workflow dispatch (production-readiness.yml retained
functional throughout).

## 4. Ledger

`docs/agent-memory/deploy-time-reduction.md` records per phase: read-back
evidence, PR/merge SHAs, local gate outputs, run IDs with step timings vs
target, decision notes. Template per `AGENTS.md`.
