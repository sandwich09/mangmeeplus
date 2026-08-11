# UAT Environment Plan

Status: UAT infrastructure acceptance is complete at `https://uat.mangmeeplus.com`; the held release incident is exactly recovered, while the new fixed-SHA UAT acceptance cycle remains pending. Production credential rotation remains required after sign-off.

Current-state override (2026-08-03): the earlier user-owned task memory saying UAT
compute was cost-paused is historical. Held run `30760853050` left API, AI Gateway
and workers ACTIVE on SHA `605a52e2…`; exact recovery runs `30772897816`,
`30773062124` and `30773209171` subsequently terminalized its parent as
failed-confirmed without deploying an application service. Preserve that memory file,
but use steps 11–18 here as the current operational state.

1. [x] Parameterize the existing ECS Express deploy/release/verification scripts with a fail-closed `DEPLOY_ENV=production|uat`; keep production as the default.
2. [x] Add a manual `UAT Deploy` workflow bound to `develop`, the GitHub `uat` environment, immutable CI artifacts, and UAT-only role variables.
2a. [x] Run automatic full CI only for pull requests; remove duplicate branch-push runs, let UAT reuse exact successful pull-request evidence when safe, and keep reusable/manual CI as the explicit release and recovery paths.
3. [x] Add UAT OIDC/runtime policy templates and a bootstrap path for isolated RDS, Redis, S3, SSM, Secrets Manager, security groups, and ECS roles.
4. [x] Add focused shell/action/IAM checks proving ref and environment isolation.
5. [x] Configure the GitHub environment and AWS roles that current authority permits. Record exact missing values or permissions rather than borrowing production configuration.
6. [x] After explicit cost approval, provision the isolated data plane and copy production LINE values into the UAT namespace under the owner's temporary exception.
7. [x] Merge the reusable-workflow OIDC, rollout-stability, Next standalone bind, and ECS no-op fixes; rerun `all`; retain successful migration, SBOM/digest, public health, redirect, and browser-login evidence for `uat.mangmeeplus.com` in agent memory.
8. After UAT acceptance, replace the production LINE credentials that were copied for the temporary UAT cycle.
9. [x] Skip the second api-web stabilization rollout when its endpoint is unchanged and fail ECS polling immediately when AWS credentials become invalid.
10. [x] Remove duplicate AI and final API rollouts when stable endpoints are unchanged; use one freshly assumed UAT deploy session for the shortened path, while retaining the ECS canary/rollback gate.
11. [x] Diagnose held run `30760853050`: all three services serve full SHA
    `605a52e29f67d1dea5599387dbd22919799ebfe9`, API intent is BOUND,
    workers intent is OPEN, and AI deployed after its intent task failed because
    Bash suppressed the non-zero status. Keep the parent blocking; do not run F2
    or generic reconciliation.
12. [x] Harden recovery and rollout evidence per the Deploy Wave/Feature
    Entitlement specs: optional `currentDeployment`, unique-newest history,
    exact three-service coverage, target/executor separation, CI/fix-floor/image
    trust, bounded ORPHAN, config hash/managed-SG proof, readiness `0`=wave /
    `1`=bootstrap / other=no-writer, exact replay evidence and create-only SSM
    repair. With explicit `DATABASE_URL`, the real-PostgreSQL suite cannot skip.
    After stopped-task retention elapsed, add the incident-only UAT fallback:
    all three exact ARNs must be `MISSING` (never partial), parent/service are
    hard-bound, and the byte-pinned evidence file
    `infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json`
    is only historical input to fresh live task-definition/log/image/chronology
    and two-read platform checks. CloudTrail IDs are audit metadata because the
    deploy role has no `LookupEvents`; production has no fallback. Also compare
    complete canonical serving-deployment evidence/history across both reads and
    test pagination, equal-time ties, and movement. Also block automatic
    terminalization and manual reconcile for a successful legacy api-web BOUND row
    until retirement succeeds and `legacyCutoverCompletedAt` is durable. For a
    multi-api parent, select the latest successful non-no-op BOUND intent and mark
    matching earlier legacy successes only after retirement, excluding rollback rows;
    keep unexpected-later evidence fail-closed for superseded-intent recovery. For
    every non-terminal recovery, complete in-task SSM proof/repair before durable
    intent closure, run cleanup only afterward, and write its marker last; terminal
    replay stays fresh-two-read and read-only.
13. [x] Commit/push the reviewed recovery floor, pin UAT to
    `3b6d83b525d0b6dbb88751b49aa7c146f80e7865`, and require green exact-SHA CI.
    Compatibility fix `60dfc12b6e676c98f4edfe2a755e52d3abf693f9` passed exact-SHA
    CI run `30772074494`; neutral `main` controller `b91fb84bde33e0e073eb899f93dcefa1c6a6d6eb`
    carries the matching task-reference normalization. Production recovery stays disabled.
14. [x] Recover parent `bf131086-6055-4143-a77c-579bc7d58b57` in order without
    an application-service deploy: AI ORPHAN run `30772897816` created exact BOUND
    intent `73bb4f20-1274-4ee0-a22a-edd6ac73b045`; API run `30773062124`
    replay-validated BOUND intent `483aa70a-5a4c-4263-98a3-27ad6635c160` and
    completed the required launch-authority cleanup/cutover path; workers run
    `30773209171` recovered intent `2def7974-c2e1-4c60-b270-a66389af0b8d` last and
    terminalized the parent. All three used target `605a52e2…`, executor `60dfc12b…`
    and controller `b91fb84b…`; all concluded success.
15. [ ] Deploy a new reviewed `develop` full SHA to UAT with `target=all`;
    record the workflow run, three image digests, exact service intents/manifest,
    health/finalization/retirement and optional M-01 evidence. Never normal-retry
    held SHA `605a52e2…`.
16. [ ] Run **`A5-RO`** only with a read-only DB role/session: cohort/baseline SQL,
    migration drift, catalog, launch health/shadow and `WorkflowTask` duplicate scan.
    Record environment/full SHA/timestamp/row counts and keep tenant-identifying output
    in the approved restricted location. This approval authorizes no load or fixture writes.
17. [ ] After steps 15–16 pass, run a fresh F2 PLAN → human artifact review → APPLY →
    independent VERIFY and the user-facing Partner/RPT cycles. Review the full artifact,
    not only its summary: every company needs a valid cohort/evidence pair, every exact
    orphan row must be understood, aggregate counts/hashes must reconcile, and
    `approvalReady` must be true. `UNRESOLVED`, an unknown orphan or any mismatch stops
    before APPLY and requires resolution plus a fresh PLAN. The earlier generic dry-run
    hash `fb1a17f7…` is diagnostic only and must never authorize APPLY.
18. [ ] Before introducing/increasing any bounded batch or promoting/GA, obtain separate
    explicit owner approval and run **`A5-CAPACITY-MUTATING`** against an isolated
    UAT-only non-customer fixture with approved rate/duration/concurrency, abort thresholds,
    before/after counts and cleanup owner/proof. Recovery, deploy, F2 PLAN/APPLY or
    `A5-RO` approval does not authorize it. Its pending state does not block the existing
    per-company state-only F2 APPLY. Production application/runtime remains unchanged.
