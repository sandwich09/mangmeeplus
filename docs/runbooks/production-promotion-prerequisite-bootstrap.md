# Production promotion prerequisite bootstrap

Use this one-time boundary only when the exact Production promotion IAM contracts change. The
normal GitHub deploy/readiness roles cannot mutate IAM. The configured local `thawatchai` profile is
AWS root and **must not be used for this ceremony or for the target-role bootstrap**.

A non-root platform administrator must first provide a short-lived profile named below. No such
administrator profile or assumable platform role existed in the 2026-08-12 live inventory, so this
is an owner/provider prerequisite rather than an agent action. If the provider cannot supply one,
the owner may record a release-specific exception allowing AWS root to execute **only** the three
temporary create/bridge commands below and the three retirement commands later in this runbook.
Root must never run the prerequisite helper or mutate any durable target role/S3 policy; those
operations remain inside the temporary non-root role. Verify the selected administrator boundary,
then create one temporary role plus a minimal assume-role bridge for the existing non-root
`watchdog-bedrock-dev` user:

```sh
PROMOTION_ADMIN_PROFILE=replace-with-non-root-platform-admin
test "$(AWS_PROFILE="$PROMOTION_ADMIN_PROFILE" aws sts get-caller-identity --query Arn --output text)" \
  != arn:aws:iam::311414082667:root
AWS_PROFILE="$PROMOTION_ADMIN_PROFILE" aws iam create-role \
  --role-name watchdog-bms-production-promotion-bootstrap \
  --max-session-duration 3600 \
  --assume-role-policy-document file://infra/security/production-promotion-bootstrap-trust.template.json
AWS_PROFILE="$PROMOTION_ADMIN_PROFILE" aws iam put-role-policy \
  --role-name watchdog-bms-production-promotion-bootstrap \
  --policy-name watchdog-bms-production-promotion-bootstrap \
  --policy-document file://infra/security/production-promotion-bootstrap-principal-policy.template.json
AWS_PROFILE="$PROMOTION_ADMIN_PROFILE" aws iam put-user-policy \
  --user-name watchdog-bedrock-dev \
  --policy-name watchdog-bms-production-promotion-bootstrap-assume \
  --policy-document file://infra/security/production-promotion-bootstrap-user-policy.template.json
```

The operator then applies and exact-reads back all prerequisites under the non-root session. The
helper assumes the temporary role internally and rejects root or every other principal:

```sh
AWS_PROFILE=watchdog-bedrock AWS_ACCOUNT_ID=311414082667 \
  bash infra/security/bootstrap-production-promotion-prerequisites.sh --apply
```

The helper exact-applies the deploy/security/workers roles, durable A5 reader and clone controllers,
the one-time reader-bootstrap controller, all four A5 execution roles, and the existing Production
ECS execution/release/infrastructure/API/AI runtime roles. It also exact-read-checks the three AWS
service-linked roles. It also restores `infra/object-storage-lifecycle.json`: this does not replace
current objects, but it makes stale noncurrent `pending/` versions expire after the reviewed
retention period. Record the owner's approval for that data-retention effect before `--apply`.
After the helper reports success, the non-root administrator retires all temporary
promotion-bootstrap authority:

```sh
AWS_PROFILE="$PROMOTION_ADMIN_PROFILE" aws iam delete-user-policy \
  --user-name watchdog-bedrock-dev \
  --policy-name watchdog-bms-production-promotion-bootstrap-assume
AWS_PROFILE="$PROMOTION_ADMIN_PROFILE" aws iam delete-role-policy \
  --role-name watchdog-bms-production-promotion-bootstrap \
  --policy-name watchdog-bms-production-promotion-bootstrap
AWS_PROFILE="$PROMOTION_ADMIN_PROFILE" aws iam delete-role \
  --role-name watchdog-bms-production-promotion-bootstrap
```

Finally, read back that both temporary policies and the role are absent. `NoSuchEntity` is the only
successful result; `AccessDenied` or an empty response is not absence:

```sh
for command in \
  "aws iam get-user-policy --user-name watchdog-bedrock-dev --policy-name watchdog-bms-production-promotion-bootstrap-assume" \
  "aws iam get-role-policy --role-name watchdog-bms-production-promotion-bootstrap --policy-name watchdog-bms-production-promotion-bootstrap" \
  "aws iam get-role --role-name watchdog-bms-production-promotion-bootstrap"; do
  if AWS_PROFILE="$PROMOTION_ADMIN_PROFILE" sh -c "$command" >retire.out 2>retire.err; then
    echo 'ERROR: temporary promotion authority still exists' >&2; exit 1
  fi
  grep -Fq NoSuchEntity retire.err || { cat retire.err >&2; exit 1; }
done
rm -f retire.out retire.err
```

Next run the one-time A5 reader-bootstrap workflow. On every outcome it deletes
`watchdog-bms-production-a5-bootstrap-execution` and replaces the reader-bootstrap controller policy
with the exact deny-all revoked policy. Do not dispatch Production Readiness until that cleanup has
completed and the temporary promotion-bootstrap role is gone.

Readiness independently re-proves the exact deploy policy and two-hour session duration, every ECS
runtime/task/service-linked role, workers cleanup policy, durable reader/clone controller roles,
reader/apply/clone execution roles, deny-all reader-bootstrap controller, absence of its temporary
execution role, required GitHub environment values, metadata-only runtime secret inventory, exact
SSM service pointers, cluster/network/S3/log/KMS/SNS prerequisites, and RDS/Redis state before it can
sign READY.

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
