# Production promotion prerequisite bootstrap

Use this one-time boundary only when the exact Production promotion IAM contracts change. The
normal GitHub deploy/readiness roles cannot mutate IAM. The configured local `thawatchai` profile is
AWS root and must never run the helper or mutate durable targets; it is permitted only by the
explicit temporary-authority fallback below.

A non-root platform administrator must first provide the profile named below. No such administrator
profile or assumable platform role existed in the 2026-08-12 live inventory, so this is an
owner/provider prerequisite rather than an agent action. If the provider cannot supply one, the
owner may record a release-specific exception allowing AWS root to perform only the three temporary
create/bridge mutations and their three matching retirement mutations. Root never runs the
prerequisite helper or mutates a durable target role/S3 policy; the wrapper assumes the exact
temporary role through the existing non-root `watchdog-bedrock-dev` user before invoking that
helper.

Use the single fail-safe wrapper below. It refuses pre-existing temporary authority, exact-reads the
temporary role trust, inline policy, attached-policy emptiness, one-hour duration, and user bridge;
retries bounded IAM propagation; and always retires bridge → role policy → role on success, failure,
or an interrupt. It accepts cleanup only after all three reads converge to `NoSuchEntity`. If a
concurrent ceremony wins the atomic role-create race, an atomic `WatchdogCeremonyId` role tag lets
the losing process stop without deleting authority owned by the winner; the same marker also lets a
CLI retry that received `EntityAlreadyExists` retire its own accepted first request.

Calling either script without `--apply` validates local syntax/templates only; it makes no AWS call
and is not a live permission/resource preflight. Before a future contract-change ceremony, repeat
the permanent proof matrix from `docs/agent-memory/production-a5-v2.md`; never treat the static
dry-run message as evidence that SCPs, boundaries, target resources or provider capacity are ready.

Preferred non-root administrator path:

```sh
PROMOTION_ADMIN_PROFILE=replace-with-non-root-platform-admin \
AWS_ACCOUNT_ID=311414082667 \
  bash infra/security/run-production-promotion-prerequisite-ceremony.sh --apply
```

Approved root fallback path (replace the reference with the current written approval record):

```sh
PROMOTION_ADMIN_PROFILE=thawatchai \
PROMOTION_ROOT_EXCEPTION_APPROVAL_REF=owner-approval-YYYY-MM-DD \
AWS_ACCOUNT_ID=311414082667 \
  bash infra/security/run-production-promotion-prerequisite-ceremony.sh --apply
```

The helper exact-applies both UAT and Production deploy policies, the Production
security/workers roles, durable A5 reader and clone controllers,
the one-time reader-bootstrap controller, all four A5 execution roles, and the existing Production
ECS execution/release/infrastructure/API/AI runtime roles plus the AgentCore execution role. It also
exact-read-checks the AWS service-linked roles used by ECS/ELB/Auto Scaling plus the RDS and
ElastiCache service-linked roles (five total). It derives the exact Production DB
subnet/parameter/option groups, proves they match the reviewed clone Restore policy, and
writes/readbacks the three matching clone SSM pointers. It also restores
`infra/object-storage-lifecycle.json`: this does not replace
current objects, but it makes stale noncurrent `pending/` versions expire after the reviewed
retention period. Record the owner's approval for that data-retention effect before `--apply`.
The wrapper returns the helper's original nonzero status after cleanup, so failure remains visible
without leaving temporary authority behind. `AccessDenied` or an empty response never counts as
absence.

The same ceremony installs `infra/uat/github-deploy-role-policy.template.json` as the only inline
policy `watchdog-bms-uat-deploy` on `watchdog-bms-deploy-uat`, then bounded-retries an exact
readback before UAT is allowed to run. All durable IAM, clone-pointer and lifecycle readbacks retry
for up to 12 attempts at 5-second intervals so normal IAM/provider propagation is not reported as
contract drift.

When the only changed durable contract is
`watchdog-bms-production-a5-clone`'s inline controller policy, do not run the full ceremony: it
would intentionally re-arm the one-time reader-bootstrap controller and execution role. Use the
scoped mode below with the same approved administrator boundary:

```sh
PROMOTION_ADMIN_PROFILE=thawatchai \
PROMOTION_ROOT_EXCEPTION_APPROVAL_REF=<current-written-approval-reference> \
AWS_ACCOUNT_ID=311414082667 \
  bash infra/security/run-production-promotion-prerequisite-ceremony.sh \
    --apply-clone-controller
```

This mode installs a different temporary principal policy containing only `iam:GetRole`,
`iam:GetRolePolicy`, `iam:ListRolePolicies`, `iam:ListAttachedRolePolicies` and
`iam:PutRolePolicy` on that one exact role. The non-root helper verifies the unchanged trust,
two-hour duration, absent permission boundary/attachments and sole inline policy before mutation,
then byte-compares the applied policy. It never calls RDS, Secrets Manager, SSM, S3 or any reader
bootstrap role. The wrapper still retires and proves absence of all temporary authority.

When only the four existing Production interface endpoint policies changed, use the scoped mode
below. It can only describe endpoints and replace policies on the exact ECR API, ECR DKR, Logs and
Secrets Manager endpoint ARNs; it cannot create/delete endpoints, change subnets/security groups,
or mutate IAM, SSM, RDS, S3 or services. The helper verifies each endpoint's exact VPC, service,
type, state and private-DNS boundary before mutation and exact-reads every policy afterwards:

```sh
PROMOTION_ADMIN_PROFILE=thawatchai \
PROMOTION_ROOT_EXCEPTION_APPROVAL_REF=<current-written-approval-reference> \
AWS_ACCOUNT_ID=311414082667 \
  bash infra/security/run-production-promotion-prerequisite-ceremony.sh \
    --apply-private-endpoints
```

Next run the one-time A5 reader-bootstrap workflow. On every outcome it deletes
`watchdog-bms-production-a5-bootstrap-execution` and replaces the reader-bootstrap controller policy
with the exact metadata-only recovery policy. Do not dispatch Production Readiness until that cleanup has
completed and the temporary promotion-bootstrap role is gone.

Readiness independently re-proves the exact deploy policy and two-hour session duration, every ECS
runtime/task/service-linked role, workers cleanup policy, durable reader/clone controller roles,
reader/apply/clone execution roles, metadata-only recovery reader-bootstrap controller, absence of its temporary
execution role, required GitHub environment values, metadata-only runtime secret inventory, exact
SSM service pointers, cluster/network/S3/log/KMS/SNS prerequisites, and RDS/Redis state before it can
sign READY. This includes ten clone SSM parameters, PostgreSQL 18.3 `db.t4g.medium` orderability,
one free RDS DB-instance quota slot, the exact source DB group ARNs, and the exact AgentCore runtime
in `READY` state. The source DB must be PostgreSQL 18.3; an available encrypted automated snapshot
must be no older than 129,600 seconds; and `alias/aws/secretsmanager` must resolve to the reviewed,
enabled AWS-managed KMS key. AgentCore is pinned to approved source
`eaa9005a1857b3cd582ceda743977496ed955110`, exact execution role/trust with no permissions boundary
or attached policy, `DEPLOY_ENVIRONMENT=production`, MMDSv2, and a versioned S3 artifact whose key
contains that source plus the 64-hex artifact digest and whose entry point is exactly `runtime.js`.

The 2026-08-12 live GitHub inventory was missing exactly these two required variables. They were
set and read back exactly later that day. If either value drifts or is removed, restore it with the
idempotent owner commands below before Readiness:

```sh
gh variable set WORKFLOW_WEBHOOK_ALLOWED_HOSTS --env production --body none
gh variable set AGENTCORE_RUNTIME_ARN --env production \
  --body arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0
```

Required closed-mode values are: deploy role ARN, canonical public domain, explicit webhook
allowlist, ClamAV host, log KMS key, alert topic, three LINE IDs, and the exact AgentCore
runtime/region/qualifier. `APPROVED_AI_PROVIDERS`, `APPROVED_AI_REGIONS`, and
`TYPHOON_PROCESSING_REGION` become required because the Typhoon secret exists; Readiness proves their
combined value hash without exposing values. The LINE OA/QR display URLs and CRM confidence have
application defaults or are optional display aids. `OPENAI_PROCESSING_REGION` is unused while the
closed-mode model provider is forced to `disabled`. Legal evidence variables are live-mode-only.
