# UAT Fast Selective Deployment Plan

Spec: `docs/specs/uat-fast-selective-deployment-spec.md`

- [x] Measure the latest successful UAT build, release task, rollout and
  finalization durations.
- [x] Add a fail-safe per-service Git diff classifier with one focused test.
- [x] Resolve `target=auto` from the three active UAT `GIT_SHA` values and use
  the resolved target through every workflow branch.
- [x] Add the UAT-only zero-bake canary helper and exact IAM permission; preserve
  all rollback controls and leave Production untouched.
- [x] Add focused workflow/runtime checks and run local verification.
- [x] Apply the reviewed UAT deploy-role policy and run the live rollout.
- [x] Run and sign one explicit `target=all` UAT acceptance (`31468653715`,
  attempt 2, source `5f555675271e2fc38024f11b98ed268bbeb87b37`).
- [x] Move exact IAM, stable ECS/rollback-control, required-secret and rollback
  alarm checks before image publication; retain the exact IAM check immediately
  before mutation.
