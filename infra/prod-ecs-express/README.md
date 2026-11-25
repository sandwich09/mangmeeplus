# WatchDog-BMS ECS Express Production Deploy

App Runner is legacy rollback only. Use this path for the current no-real-user migration to ECS Express Mode/Fargate.

`DEPLOY_ENV` defaults to `production`. UAT reuses this deploy engine only through the isolated contract in `infra/uat/README.md`; unsupported environment names fail before any AWS call.

Service rollouts are dispatched only by the environment-owned GitHub workflow. Direct workstation
invocation is reserved for the non-service `s3-cors` helper and audited
`operation-reconcile` break-glass; it cannot create a normal release/F2/retirement controller.

Targets:

- `api-web` deploys the combined API + Next.js service.
- `ai-gateway` deploys AI Gateway.
- `all` deploys API/Web, deploys AI Gateway, then redeploys API/Web with the new AI Gateway URL.

Live services (2026-07-03): `watchdog-bms-api-web-pub` and `watchdog-bms-ai-gateway-v2`. Two dead predecessors were deleted on 2026-07-03 via a temporary scoped `ecs:DeleteExpressGatewayService` grant: `watchdog-bms-api-web` (immutable-subnet first attempt) and `watchdog-bms-ai-gateway` (control-plane state broke — every deployment ended `ROLLBACK_FAILED: No rollback candidate` and later updates never launched target-revision tasks; replaced by `-v2`). The deploy script follows the service ARNs stored in SSM, so it updates the live services automatically. `AI_SERVICE_NAME` in `deploy.sh` must be kept equal to the service that ARN points at: the name is not only used to locate the service, it also validates the service-revision ARN that ECS returns. It was left on the deleted `watchdog-bms-ai-gateway` until 2026-08-09, and the first production ai-gateway deploy failed with "incomplete active configuration" because the returned revision named `-v2`.

Before running:

- Docker Desktop must be running.
- The deploy principal needs the permissions in `deploy-principal-policy.template.json` with `<ACCOUNT_ID>` replaced.
- Existing production RDS, Redis, S3, Secrets Manager, SSM, ECR, private subnets, and `watchdog-bms-prod-app-egress-sg` are reused from the current production bootstrap.
- The GitHub deploy workflow runs the approved clean release task for the exact commit and exports its durable `RELEASE_PARENT_OPERATION_ID`, the exact `RELEASE_TASK_IMAGE`, and a fresh `DEPLOYMENT_EVIDENCE_DIR`. Every service target fails before any AWS call when one is missing; `s3-cors` is the only deploy target exempt from this parent/evidence contract.
- For a CI release, the workflow downloads `production-release-<full-git-sha>`, validates its `sourceCommit`, and sets `PRODUCTION_IMAGE_MANIFEST` plus the release-task identity above. The deploy script rejects a wrong account/region, repository mapping, digest, service set, commit binding, or unbound rollout and skips all local Docker builds.

## One-click GitHub production deploy

`Actions` → `Production Deploy` → `Run workflow` accepts:

- `release_ref`: exact `release-*` tag, or lowercase 40-character commit SHA reachable from `origin/main`. Tags outside `main` are rejected too.
- `target`: `all`, `api-web`, `ai-gateway`, or `workers`.

Choose `main` in **Use workflow from**. The GitHub `production` environment allows `main` and `release-*`; `develop` remains temporarily allowed for compatibility, but it can deploy only a release already reachable from `main`.

The workflow resolves the immutable commit, reuses every CI/test/security/image publisher gate, validates the three-image manifest and SPDX SBOMs, builds a clean exact-commit release-task image, runs migrations/permission/address sync, deploys only the selected target by digest, then verifies the active digest, `GIT_SHA`, and health response. Production deploys are globally serialized and use the GitHub `production` environment.

One-time setup uses a dedicated OIDC role rather than expanding the image-publisher role:

```sh
sed 's/<ACCOUNT_ID>/311414082667/g' \
  infra/prod-ecs-express/github-deploy-role-trust.template.json \
  > /tmp/watchdog-bms-github-deploy-trust.json
sed 's/<ACCOUNT_ID>/311414082667/g' \
  infra/prod-ecs-express/github-deploy-role-policy.template.json \
  > /tmp/watchdog-bms-github-deploy-policy.json

aws iam create-role \
  --role-name watchdog-bms-deploy-production \
  --assume-role-policy-document file:///tmp/watchdog-bms-github-deploy-trust.json
aws iam put-role-policy \
  --role-name watchdog-bms-deploy-production \
  --policy-name watchdog-bms-production-deploy \
  --policy-document file:///tmp/watchdog-bms-github-deploy-policy.json

gh variable set AWS_DEPLOY_ROLE_ARN \
  --env production \
  --body arn:aws:iam::311414082667:role/watchdog-bms-deploy-production
```

Keep existing `production` variables `AWS_ROLE_ARN`, `AWS_ACCOUNT_ID`, and `AWS_REGION`. Optional non-secret LINE/AI variables override live configuration; absent values are copied from the active ECS configurations so an application-only deploy does not silently reset them. The GitHub deploy role deliberately cannot create or rewrite IAM roles: all ECS/service-linked/task roles must already exist, and IAM-policy changes remain an explicit infrastructure operation.

The ordinary `CI` workflow's `production` entries represent image publication. A completed `Production Deploy` run is the deployment record for an ECS rollout.

### Deployed but not launched maintenance ceremony

`maintenance_only=true` is an all-target, exact-UAT release mode; it is not available to a partial
incident deploy. The first closure also sets `maintenance_bootstrap=true`. That bootstrap runs only
the read-only migration-catalog preflight, deploys the three immutable UAT images, forces the outer
web/API and AI gates on, sets `QUEUE_ENABLED=false`, and refuses to create a missing service. It does
not apply a migration or create launch-build authority.

After bootstrap evidence proves one active revision per service plus the custom/raw-origin probe
matrix, a distinct all-target UAT release may use that source as the closed bridge and run the normal
reviewed migration/promotion path with `maintenance_only=true`. The bridge is re-proved immediately
before database mutation. Maintenance promotions never unquiesce writes or run the POST-live chain.
After singleton closure the workflow waits 900 seconds so every direct S3 URL issued by the old live
API has expired, and uploads a separate drain proof. Opening later uses a distinct all-target UAT
source with the closed release as its bridge, a separate `maintenance_only=false` production
approval, and the complete legal evidence bundle.

This state is `DEPLOYED_NOT_LAUNCHED`, not network-private and not zero PDPA processing: public health,
traffic logs, named operators, and data already stored still exist. Do not send LINE messages or
documents during maintenance; the gate acknowledges and discards new business payloads before any
application parser, database, queue, or AI provider receives them.

Rollout behavior (learned 2026-07-03):

- Express services deploy CANARY (5%, 3-minute bake) guarded by an auto-created CloudWatch alarm `watchdog-bms-prod/<service>/RollbackAlarm`: `(4xx when >=5/min + 5xx) / total > 1%` per target group. Any sustained 4xx during the bake (including your own smoke/poll curls returning 401/404 on a low-traffic service) triggers a silent rollback to the previous configuration.
- `all` is a coordinated release and waits for each affected service in sequence. For an incident, select only `api-web`, `ai-gateway`, or `workers` so recovery pays one canary window; stable endpoints skip the otherwise redundant stabilization rollouts.
- Do NOT poll application routes while a deploy bakes; watch with `aws ecs list-service-deployments --cluster watchdog-bms-prod --service <name>` (status `SUCCESSFUL` vs `ROLLBACK_*`) and `GET /v1/health` only.
- The script's ACTIVE+URL wait does not detect rollback; after deploy, confirm the new image is the only entry in `service.activeConfigurations` before smoke-testing routes.

MVP1 launch additions (2026-07-10, gap-closure harness — see docs/agent-memory/mvp1-prod-gap-closure.md):

- `CRM_AUTO_REPLY_ENABLED` is passed to api-web (default `false`). Enable customer-facing autonomy only when piloting: export `CRM_AUTO_REPLY_ENABLED=true` before running deploy.sh, then turn ON the per-channel toggle in ตั้งค่า LINE OA (requires `crm.channel.manage`). `CRM_AI_OUTBOUND_ALLOWED_DOMAINS` is a comma-separated exact-host/explicit-`*.` allowlist; an empty value blocks every autonomous URL. Optional tuning: `CRM_AI_MIN_CONFIDENCE` (default 0.7).
- Rate limiting is real now (in-process per task, keyed on the ALB-appended last X-Forwarded-For entry). The existing `RATE_LIMIT_*` values apply per client IP. Note: app 429s count toward the canary 4xx RollbackAlarm — do not load-test during a bake.
- Pre-pilot checklist (ops, not code): align the LIFF Login channel and the OA messaging channel under the same LINE provider (B9 identity join depends on it); keep the release-task migration/sync evidence and its exact `RELEASE_TASKS_APPLIED_SHA` binding with the deployment record.
