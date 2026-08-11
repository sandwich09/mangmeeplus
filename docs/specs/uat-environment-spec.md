# UAT Environment Spec

## Goal

Provide a production-like AWS environment where releases from `develop` can be accepted before promotion to `main`, without reading or mutating production data or services.

## Users and journey

- Release owner selects `UAT Deploy` in GitHub Actions, enters an exact commit SHA or `uat-*` tag reachable from `develop`, and normally leaves `target=auto`. The controller compares each active service's full `GIT_SHA` with the requested source and chooses one service only when the impact is unambiguous; missing, shared or unknown impact becomes `all`. The owner may still choose `all`, `api-web`, `ai-gateway`, or `workers` explicitly. Production eligibility always requires a later explicit all-target acceptance.
- CI runs the existing typecheck, tests, security checks, clean image build, digest manifest, and SBOM gates.
- The deploy job uses the GitHub `uat` environment and UAT-only OIDC roles, runs migrations against the UAT database, deploys immutable ECR digests, and verifies digest, commit, and health.
- After UAT acceptance, the same commit is merged to `main` and is eligible for the production workflow.

## Invariants

- UAT uses separate ECS services/cluster, RDS database, Redis, S3 bucket, SSM path, Secrets Manager path, runtime roles, and logs. The release owner approved a temporary copy of the production LINE values into the isolated UAT secret namespace for this acceptance cycle; production LINE credentials must be replaced after acceptance.
- UAT never falls back to a production SSM parameter, secret, database, Redis endpoint, bucket, service ARN, or runtime role.
- ECR repositories are shared because an image digest is immutable; environment state and credentials are not shared.
- Containers run with `NODE_ENV=production` and `APP_ENV=production` so UAT exercises production security checks. The deploy controller selects the environment with `DEPLOY_ENV=uat`; each runtime container receives the authoritative `DEPLOY_ENVIRONMENT=uat` plus full `GIT_SHA`. Security mode and resource identity are deliberately separate.
- Development authentication remains disabled. UAT needs its own LINE Login/Messaging configuration.
- Production release authority remains `main`; UAT release authority is `develop`.
- The manual workflow itself is launched from `main`; its resolver is the independent gate that permits only commits reachable from `develop`.
- A recovery controller launched from `main` may execute a newer reviewed recovery SHA from `develop`, but it decides only the held UAT target SHA and never updates an application service. The executor must descend from the target and the pinned UAT recovery-fix floor, have exact successful push CI, and run from a signed digest whose OCI revision is that executor SHA. The target SHA, executor SHA, CI run, signer and live platform evidence are retained in durable audit.
- The UAT recovery-fix floor is pinned only after the reviewed implementation commit exists. Until then an all-zero floor disables recovery. The production floor remains all zero throughout this UAT task; production recovery or deployment requires a separate reviewed decision.
- Retained stopped tasks remain the default historical recovery evidence. Because ECS retention expired for this incident, an evidence-manifest fallback exists only for parent `bf131086-6055-4143-a77c-579bc7d58b57` and `watchdog-bms-uat-ai-gateway`, and only when all three supplied exact ARNs are `MISSING`; a partial set is rejected. The neutral `main` workflow byte-pins `infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json` and still requires exact live task-definition registration/shape/environment, signed image and OCI revision, exact CloudWatch timestamp/message, chronology, and current two-read platform/network/SSM evidence. CloudTrail IDs are audit metadata because the deploy role lacks `LookupEvents`. There is no production fallback.
- Deployments are serialized per environment and never cancel an in-flight release.
- A coordinated `all` release is not terminal until durable service coverage contains exactly API, AI and workers. Provider health cannot substitute for a missing intent. Only api-web may carry legacy bootstrap provenance.
- A successful legacy api-web `BOUND` intent is still unresolved until launch-build
  retirement succeeds and `legacyCutoverCompletedAt` is durable. Neither automatic
  terminalization nor manual reconciliation may bypass this cleanup; completed
  rollback evidence follows its separate cleanup-marker path.
- If a parent has multiple api-web deployments, exact recovery targets the latest
  successful non-no-op BOUND intent. Successful retirement may then mark matching
  earlier successful legacy BOUND rows for the same environment/build/parent, except
  rollback-observed rows. Unexpected later evidence still rejects recovery of a
  superseded intent.
- Non-terminal recovery completes exact in-task SSM proof or create-only repair before
  durably closing the recovered intent and before any cleanup child, and persists a
  cleanup/cutover marker only after the child succeeds. A closed recovered intent
  proves SSM validation; a marker additionally proves cleanup. Terminal replay repeats
  fresh two-read validation and performs no repair, intent mutation, cleanup, or marker
  write.
- ECS Express completion remains the release gate. UAT keeps the 5% canary,
  rollback alarms and circuit breaker but uses zero-minute canary/post-shift
  bakes for fast feature feedback; Production retains its ordinary bake values.
  Stable service endpoints do not trigger a second stabilization rollout, and
  `all` refreshes API configuration only when the AI endpoint actually changes.
- ECS Express may clear `currentDeployment` after settlement. A null pointer is acceptable only when two stable service reads and two stable exhaustive unpaginated deployment-history reads prove one ACTIVE target configuration and the bound successful deployment is the unique newest record. A mismatched non-null pointer, multiple active configurations, moving/paginated/malformed history or a newer deployment fails closed for recovery, F2 and retirement.
- The F2 serving-build preflight compares complete canonical deployment evidence/history across both reads. Pagination, an equal-time newest tie, or movement anywhere in that evidence fails closed even if the selected newest row would otherwise remain the same.
- In steady state `all` runs its managed rollouts as concurrent waves (UAT one wave of three services, production `api-web` then `ai-gateway` + `workers`), keeping the canary gate per service. Readiness status `0` selects the wave and status `1` alone selects the sequential bootstrap path; every other status aborts with no deployment mutation before either writer starts. Bootstrap environments, which lack the steady-state service parameters, keep the sequential ordering. See `docs/specs/deploy-wave-rollout-and-prod-promotion-spec.md`.

## Acceptance criteria

- Invalid refs and refs outside `develop` are rejected before image publication.
- The UAT workflow uses only the GitHub `uat` environment for cloud credentials.
- Rendered UAT release tasks reference only `watchdog-bms/uat/database-url` and UAT execution/network resources.
- Static checks prove the UAT workflow cannot reference the production deploy role or production runtime paths.
- A first live deploy is allowed only after isolated data services, UAT secrets, GitHub variables, and UAT runtime roles exist.
- Recovery tests prove that a failed intent/bind cannot continue to ECS/SSM mutation; a held target cannot use itself as the fixed executor; the UAT fix floor, branch ancestry, exact successful CI, signed executor image and OCI revision are all mandatory. With an explicit `DATABASE_URL`, connection/schema/setup failure is fatal and no real-PostgreSQL recovery case may skip.
- A bounded historical ORPHAN repair is accepted only from immutable stopped-task evidence plus exact live deployment/network/SSM state, persists its intent/manifest/audit atomically, is idempotent under fresh readback, and cannot repair another service or incomplete `all` coverage. SSM repair is create-only/no-overwrite and an existing parameter passes only after two exact reads agree; closed-intent and PRE_INTENT replay block unless fresh evidence exactly equals the stored terminal evidence or cleanup marker.
- If and only if this incident's three exact stopped-task ARNs are all `MISSING`, the
  byte-pinned UAT manifest path may replace the expired historical records after all
  exact live validations above; partial expiry, another parent/service, or production
  use fails closed. Serving-build fixtures reject pagination, equal-time newest ties,
  and evidence movement across the two reads.
- The held incident cannot terminalize after AI/workers coverage alone. API intent
  `483aa70a-5a4c-4263-98a3-27ad6635c160` must first complete exact recovery,
  superseded launch-authority retirement, and durable `legacyCutoverCompletedAt`;
  manual reconcile rejects the same incomplete state. This intent remains the target
  because it is this parent's single and latest api-web deployment.
- Recovery acceptance must demonstrate that an SSM mismatch/repair failure neither
  closes the intent nor launches a cleanup child/writes a cleanup marker, while
  terminal replay remains mutation-free after fresh validation.
- Before F2 APPLY, the held release is reconciled terminally, a clean fixed-SHA UAT deploy is verified, the generated PLAN artifact is reviewed, and APPLY ends with an independent VERIFY. The generic deploy's F2 normalizer remains dry-run-only, and customer data never requires bulk re-entry.
- UAT completion keeps every WHT specialist route CLOSED and does not authorize production deployment.

## Out of scope

- Copying production customer data into UAT.
- Automatic promotion from UAT to production.
- Replacing the current production workflow or production resources.
