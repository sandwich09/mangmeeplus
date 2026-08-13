#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <watchdog-bms-api@sha256:digest> <full-commit-sha> [release|release-prepare|maintenance-preflight|incident-preflight|release-intent|release-bind|release-intent-recover|release-orphan-intent-recover|release-pre-intent-recover|release-bootstrap-closed-recover|release-finalize|retire|reconcile|m01-live|a5-bootstrap|a5-ro|a5-capacity-preflight|a5-capacity|a5-capacity-cleanup|f2-plan|f2-apply|f2-verify|operation-reconcile]" >&2
  exit 2
fi

image="$1"
commit="$2"
mode="${3:-release}"
case "$mode" in
  release|release-prepare|maintenance-preflight|incident-preflight|release-intent|release-bind|release-intent-recover|release-orphan-intent-recover|release-pre-intent-recover|release-bootstrap-closed-recover|release-finalize|retire|reconcile|m01-live|a5-bootstrap|a5-ro|a5-capacity-preflight|a5-capacity|a5-capacity-cleanup|f2-plan|f2-apply|f2-verify|operation-reconcile) ;;
  *) echo "ERROR: unsupported release-task mode: $mode" >&2; exit 2 ;;
esac
region="${AWS_REGION:-ap-southeast-1}"
deploy_env="${DEPLOY_ENV:-production}"
case "$deploy_env" in
  production)
    resource_stage="prod"
    execution_role="ecsTaskExecutionRole"
    release_task_role="watchdog-bms-release-task-role"
    task_family="watchdog-bms-release-task"
    source_branch="main"
    ;;
  uat)
    resource_stage="uat"
    execution_role="watchdog-bms-uat-ecs-execution-role"
    release_task_role="watchdog-bms-uat-release-task-role"
    task_family="watchdog-bms-uat-release-task"
    source_branch="develop"
    ;;
  *) echo "ERROR: DEPLOY_ENV must be production or uat" >&2; exit 2 ;;
esac
if [ "$mode" = release-prepare ] && [ "$deploy_env" != production ]; then
  echo "ERROR: release-prepare is the production no-migration path" >&2
  exit 2
fi
if [ "$mode" = maintenance-preflight ] && [ "$deploy_env" != production ]; then
  echo "ERROR: maintenance-preflight is production read-only" >&2
  exit 2
fi
resource_prefix="watchdog-bms-${resource_stage}"
secret_prefix="watchdog-bms/${deploy_env}"
log_group="/ecs/${task_family}"
cluster="${ECS_CLUSTER_NAME:-$resource_prefix}"
if [ "$deploy_env" = "uat" ] && [ "$cluster" != "watchdog-bms-uat" ]; then
  echo "ERROR: UAT release task cluster must be watchdog-bms-uat" >&2
  exit 2
fi
if [ "$mode" = "m01-live" ] && [ "$deploy_env" != "uat" ]; then
  echo "ERROR: M-01 adversarial verification is allowed only in isolated UAT" >&2
  exit 2
fi
case "$mode" in
  a5-bootstrap|a5-ro|f2-plan|f2-apply|f2-verify)
    if [ "$deploy_env" != "uat" ]; then
      echo "ERROR: A5/F2 read/write operations are locked to isolated UAT until production has a separately reviewed read-only principal" >&2
      exit 2
    fi
    ;;
  a5-capacity-preflight|a5-capacity|a5-capacity-cleanup)
    if [ "$deploy_env" != "uat" ]; then
      echo "ERROR: A5-CAPACITY-MUTATING is allowed only in isolated UAT" >&2
      exit 2
    fi
    ;;
esac
aws_bin="${AWS_BIN:-aws}"
account_id="${AWS_ACCOUNT_ID:-}"
render_only="${RELEASE_TASK_RENDER_ONLY:-false}"
# `retire` mode only: the builds serving RIGHT NOW, as read from the deployment platform.
retire_active_builds="${RETIRE_ACTIVE_BUILDS:-}"
retire_deployment_arn="${RETIRE_DEPLOYMENT_ARN:-}"
retire_service_arn="${RETIRE_SERVICE_ARN:-}"
retire_target_revision_arn="${RETIRE_TARGET_REVISION_ARN:-}"
parent_operation_id="${RELEASE_PARENT_OPERATION_ID:-}"
deployment_manifest="${RELEASE_DEPLOYMENT_MANIFEST_JSON:-}"
mutation_intent_json="${RELEASE_MUTATION_INTENT_JSON:-}"
mutation_intent_id="${RELEASE_MUTATION_INTENT_ID:-}"
recovery_ssm_service_arn="${RELEASE_RECOVERY_SSM_SERVICE_ARN:-}"
recovery_expected_service_arn="${RELEASE_RECOVERY_EXPECTED_SERVICE_ARN:-}"
recovery_ssm_parameter_name="${RELEASE_RECOVERY_SSM_PARAMETER_NAME:-}"
recovery_build_release_id="${RELEASE_RECOVERY_BUILD_RELEASE_ID:-}"
recovery_validated_ci_run_id="${RELEASE_RECOVERY_VALIDATED_CI_RUN_ID:-}"
recovery_executor_image=""
recovery_network_evidence="${RELEASE_RECOVERY_NETWORK_EVIDENCE_JSON:-}"
recovery_parent_task_evidence="${RELEASE_RECOVERY_PARENT_TASK_EVIDENCE_JSON:-}"
bootstrap_closed_recovery="${RELEASE_BOOTSTRAP_CLOSED_RECOVERY_JSON:-}"
orphan_intent_json="${RELEASE_ORPHAN_MUTATION_INTENT_JSON:-}"
orphan_deployment_manifest="${RELEASE_ORPHAN_DEPLOYMENT_MANIFEST_JSON:-}"
orphan_task_evidence="${RELEASE_ORPHAN_TASK_EVIDENCE_JSON:-}"
operation_id="${RELEASE_OPERATION_ID:-}"
release_deploy_target="${RELEASE_DEPLOY_TARGET:-}"
release_database_authority="${RELEASE_DATABASE_AUTHORITY:-}"
production_ready_sha256="${PRODUCTION_READY_V2_SHA256:-}"
production_ready_repository_hash="${PRODUCTION_READY_REPOSITORY_CATALOG_HASH:-}"
production_ready_applied_hash="${PRODUCTION_READY_APPLIED_CATALOG_HASH:-}"
production_ready_pending_hash="${PRODUCTION_READY_PENDING_CATALOG_HASH:-}"
production_ready_pending_count="${PRODUCTION_READY_PENDING_COUNT:-}"
if [ -n "$release_database_authority" ] && [ "$mode" != release-prepare ]; then
  echo "ERROR: RELEASE_DATABASE_AUTHORITY is accepted only by release-prepare" >&2
  exit 2
fi
if [ "$release_database_authority" != PRODUCTION_READY_V2 ] \
  && [ -n "$production_ready_sha256$production_ready_repository_hash$production_ready_applied_hash$production_ready_pending_hash$production_ready_pending_count" ]; then
  echo "ERROR: PRODUCTION_READY_V2 migration authority is accepted only by release-prepare with RELEASE_DATABASE_AUTHORITY=PRODUCTION_READY_V2" >&2
  exit 2
fi
# Explicit U1 reconciliation. The target is the ORIGINAL operation/task; the reconciliation task's
# own ARN is read from ECS metadata by the wrapper and stored separately in the audit.
reconcile_operation_id="${RELEASE_RECONCILE_OPERATION_ID:-}"
reconcile_task_arn="${RELEASE_RECONCILE_TASK_ARN:-}"
reconcile_outcome="${RELEASE_RECONCILE_OUTCOME:-}"
reconcile_evidence_ref="${RELEASE_RECONCILE_EVIDENCE_REF:-}"
reconcile_reason="${RELEASE_RECONCILE_REASON:-}"
reconcile_actor_ref="${RELEASE_RECONCILE_ACTOR_REF:-}"
# F2/CC7 — the entitlement normalizer gets its OWN modes; it is never a passenger on a release.
# UAT r7 item 3: plan/apply/verify used to run as `release`, which meant every one of them also ran
# `prisma migrate deploy` and all four sync scripts — including sync-feature-launch-gates.ts, so
# merely PLANNING pre-attested the build and a "read-only" review job could migrate the database.
# The f2-* modes below run the normalizer CLI and nothing else:
#
#   f2-plan    read-only plan for the whole estate; prints the reviewable JSON artifact, exits 0.
#   f2-apply   the one-time write, AUTHORIZED by the reviewed f2-plan artifact itself
#              (F2_APPROVED_PLAN_JSON) and its aggregateHash (F2_APPROVED_HASH) — UAT r6 items 2+3.
#              The CLI re-plans read-only first and halts with zero writes if the estate moved.
#   f2-verify  independent read-only re-check that the apply actually landed.
#
# F2_APPLY / F2_VERIFY are no longer accepted as inputs: the MODE decides, so no stray environment
# variable can arm the writer, and the release command line stays a fixed literal.
f2_apply=""
f2_verify=""
f2_approved_hash="${F2_APPROVED_HASH:-}"
# The normalizer binds an apply to the reviewed ARTIFACT, not just its hash (prisma/
# normalize-entitlements.ts: `--approved-plan`), so the artifact has to reach the container. A
# Fargate task has no stdin, so it travels as an environment variable and the task command writes it
# to a file — which also keeps the JSON out of the command line and away from shell quoting.
f2_approved_plan="${F2_APPROVED_PLAN_JSON:-}"
f2_approved_plan_path="/tmp/f2-approved-plan.json"
capacity_marker="${U5_CAPACITY_MARKER:-}"
capacity_approval_ref="${U5_CAPACITY_APPROVAL_REF:-}"
capacity_baseline_hash="${U5_CAPACITY_BASELINE_HASH:-}"
case "$mode" in
  a5-capacity-preflight|a5-capacity|a5-capacity-cleanup)
  [[ "$capacity_marker" =~ ^U5C-[0-9A-F]{12,32}$ ]] || {
    echo "ERROR: capacity mode requires U5_CAPACITY_MARKER=U5C-<12..32 uppercase hex>" >&2
    exit 2
  }
  [ "$capacity_approval_ref" = 'owner-approved:2026-08-03:u5-c-v2' ] || {
    echo "ERROR: capacity mode requires the exact reviewed U5_CAPACITY_APPROVAL_REF" >&2
    exit 2
  }
  if [ "$mode" = "a5-capacity-preflight" ]; then
    [ -z "$capacity_baseline_hash" ] || {
      echo "ERROR: preflight computes U5_CAPACITY_BASELINE_HASH; it does not accept one" >&2
      exit 2
    }
  elif [[ ! "$capacity_baseline_hash" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: ${mode} requires the exact 64-hex U5_CAPACITY_BASELINE_HASH from preflight" >&2
    exit 2
  fi
  ;;
  *)
if [ -n "$capacity_marker$capacity_approval_ref$capacity_baseline_hash" ]; then
  echo "ERROR: U5 capacity authority is accepted only by exact capacity modes" >&2
  exit 2
fi
  ;;
esac
for name in F2_APPLY F2_VERIFY; do
  if [ -n "${!name:-}" ]; then
    echo "ERROR: $name is not an input — use the f2-apply / f2-verify release-task modes" >&2
    exit 2
  fi
done
case "$mode" in
  f2-apply)
    # Shape-checked here so a truncated or quoted paste fails before a task is even registered,
    # rather than reaching the normalizer and being reported as ordinary estate drift.
    if [[ ! "$f2_approved_hash" =~ ^[0-9a-f]{64}$ ]]; then
      echo "ERROR: f2-apply requires F2_APPROVED_HASH — the 64-hex aggregateHash from the reviewed f2-plan artifact" >&2
      exit 2
    fi
    # approvalReady=false means the plan had failures or dependency exceptions, so those companies
    # have no agreed final state; the CLI refuses it, and so does this, before anything is registered.
    if ! jq -e '
      .artifact == "f2-entitlement-normalization"
      and .approvalReady == true
      and (.aggregateHash | type == "string" and test("^[0-9a-f]{64}$"))
      and (.planHashes | type) == "object"
    ' <<< "$f2_approved_plan" >/dev/null 2>&1; then
      echo "ERROR: f2-apply requires F2_APPROVED_PLAN_JSON — the reviewed, approval-ready normalization artifact carrying aggregateHash and planHashes" >&2
      exit 2
    fi
    if [ "$(jq -r '.aggregateHash' <<< "$f2_approved_plan")" != "$f2_approved_hash" ]; then
      echo "ERROR: F2_APPROVED_PLAN_JSON is not the artifact F2_APPROVED_HASH names" >&2
      exit 2
    fi
    # A task definition is capped at 64 KiB in total, so say which value is too big rather than let
    # RegisterTaskDefinition fail on the whole document.
    if [ "${#f2_approved_plan}" -gt 32768 ]; then
      echo "ERROR: F2_APPROVED_PLAN_JSON is ${#f2_approved_plan} bytes — pass the approval fields (artifact, normalizerVersion, approvalReady, aggregateHash, planHashes), not the full plan" >&2
      exit 2
    fi
    f2_apply="true"
    ;;
  f2-verify) f2_verify="true" ;;
  *)
    if [ -n "$f2_approved_hash" ] || [ -n "$f2_approved_plan" ]; then
      echo "ERROR: F2_APPROVED_HASH / F2_APPROVED_PLAN_JSON are meaningless outside the f2-apply mode" >&2
      exit 2
    fi
    ;;
esac

if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: release task requires a lowercase full commit SHA" >&2
  exit 1
fi
case "$mode" in
  release-intent-recover|release-orphan-intent-recover|release-pre-intent-recover|release-bootstrap-closed-recover)
    if [[ ! "$recovery_build_release_id" =~ ^[0-9a-f]{40}$ ]]; then
      echo "ERROR: ${mode} requires RELEASE_RECOVERY_BUILD_RELEASE_ID for the held target release" >&2
      exit 2
    fi
    if [[ ! "$recovery_validated_ci_run_id" =~ ^[1-9][0-9]*$ ]]; then
      echo "ERROR: ${mode} requires the exact successful CI run id for the recovery executor" >&2
      exit 2
    fi
    if [ -n "$recovery_parent_task_evidence" ] && { [ "${#recovery_parent_task_evidence}" -gt 4096 ] \
      || ! jq -e 'type == "object"' <<< "$recovery_parent_task_evidence" >/dev/null 2>&1; }; then
      echo "ERROR: ${mode} parent-task evidence must be one bounded JSON object" >&2
      exit 2
    fi
    recovery_executor_image="$image"
    if [ "$mode" = release-bootstrap-closed-recover ]; then
      [ "$deploy_env" = production ] || {
        echo "ERROR: release-bootstrap-closed-recover is Production-only" >&2
        exit 2
      }
      if [ "${#bootstrap_closed_recovery}" -gt 32768 ] || ! jq -e '
        type == "object" and .schemaVersion == 1
        and (.artifactDigest | type == "string" and test("^sha256:[0-9a-f]{64}$"))
        and (.operationId | type == "string" and test("^[0-9a-f-]{36}$"))
        and (.sourceCommit | type == "string" and test("^[0-9a-f]{40}$"))
        and (.services | type == "array" and length == 3)
      ' <<< "$bootstrap_closed_recovery" >/dev/null 2>&1; then
        echo "ERROR: release-bootstrap-closed-recover requires bounded controller-derived evidence" >&2
        exit 2
      fi
    elif [ -n "$bootstrap_closed_recovery" ]; then
      echo "ERROR: bootstrap-closed evidence is accepted only by its exact recovery mode" >&2
      exit 2
    fi
    ;;
  *)
    if [ -n "$recovery_build_release_id$recovery_validated_ci_run_id$recovery_parent_task_evidence$bootstrap_closed_recovery" ]; then
      echo "ERROR: recovery target/CI evidence is accepted only by exact recovery modes" >&2
      exit 2
    fi
    ;;
esac

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy "$aws_bin" "$@"
}

if [ "$render_only" != "true" ]; then
  actual_account="$(aws_cmd sts get-caller-identity --query Account --output text --region "$region")"
  if [ -n "$account_id" ] && [ "$account_id" != "$actual_account" ]; then
    echo "ERROR: AWS account mismatch" >&2
    exit 1
  fi
  account_id="$actual_account"
fi
if [[ ! "$account_id" =~ ^[0-9]{12}$ ]]; then
  echo "ERROR: AWS_ACCOUNT_ID must be a 12-digit account ID" >&2
  exit 1
fi

# Durable controller provenance. GitHub identity comes only from the runner-owned default
# variables; a non-GitHub invocation is a separate MANUAL shape and records the live AWS caller.
controller_kind="MANUAL"
github_run_id=""
github_run_attempt=""
github_actor=""
github_actor_id=""
github_workflow_ref=""
github_repository=""
manual_actor_ref=""
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  controller_kind="GITHUB_ACTIONS"
  github_run_id="${GITHUB_RUN_ID:-}"
  github_run_attempt="${GITHUB_RUN_ATTEMPT:-}"
  github_actor="${GITHUB_ACTOR:-}"
  github_actor_id="${GITHUB_ACTOR_ID:-}"
  github_workflow_ref="${GITHUB_WORKFLOW_REF:-}"
  github_repository="${GITHUB_REPOSITORY:-}"
  [[ "$github_run_id" =~ ^[0-9]+$ && "$github_run_attempt" =~ ^[1-9][0-9]*$ \
    && "$github_actor_id" =~ ^[0-9]+$ && -n "$github_actor" \
    && "$github_workflow_ref" == "${github_repository}/.github/workflows/"*"@refs/"* ]] || {
    echo "ERROR: GitHub release controller provenance is incomplete or malformed" >&2
    exit 2
  }
  alternate_expected_workflow=""
  case "$mode" in
    a5-ro)
      expected_workflow="f2-normalize.yml"
      alternate_expected_workflow="f2-normalize-apply.yml"
      ;;
    f2-plan) expected_workflow="f2-normalize.yml" ;;
    f2-apply|f2-verify) expected_workflow="f2-normalize-apply.yml" ;;
    a5-capacity-preflight|a5-capacity|a5-capacity-cleanup) expected_workflow="a5-capacity-uat.yml" ;;
    release-intent-recover|release-orphan-intent-recover|release-pre-intent-recover|release-bootstrap-closed-recover) expected_workflow="recover-release-intent.yml" ;;
    *)
      expected_workflow="deploy-production.yml"
      [ "$deploy_env" = "production" ] && alternate_expected_workflow="deploy-production-v2.yml"
      [ "$deploy_env" = "uat" ] && expected_workflow="deploy-uat.yml"
      ;;
  esac
  expected_workflow_ref="${github_repository}/.github/workflows/${expected_workflow}@refs/heads/main"
  alternate_expected_workflow_ref=""
  if [ -n "$alternate_expected_workflow" ]; then
    alternate_expected_workflow_ref="${github_repository}/.github/workflows/${alternate_expected_workflow}@refs/heads/main"
  fi
  if [ "$github_workflow_ref" != "$expected_workflow_ref" ] \
    && [ "$github_workflow_ref" != "$alternate_expected_workflow_ref" ]; then
    echo "ERROR: ${deploy_env} ${mode} must be controlled by ${expected_workflow_ref}${alternate_expected_workflow_ref:+ or ${alternate_expected_workflow_ref}}" >&2
    exit 2
  fi
else
  if [ "$mode" != "operation-reconcile" ] && [ "$mode" != "a5-bootstrap" ]; then
    echo "ERROR: manual controller is allowed only for audited operation-reconcile or UAT A5 bootstrap" >&2
    exit 2
  fi
  if [ "$render_only" = "true" ]; then
    manual_actor_ref="${RELEASE_MANUAL_ACTOR_REF:-arn:aws:iam::${account_id}:role/render-only-release-test}"
  else
    manual_actor_ref="$(aws_cmd sts get-caller-identity --query Arn --output text --region "$region")"
  fi
  [[ "$manual_actor_ref" =~ ^arn:aws:(iam|sts)::${account_id}:.+ ]] || {
    echo "ERROR: manual release controller must resolve to an AWS IAM/STS actor in this account" >&2
    exit 2
  }
fi

if [ "$mode" = "operation-reconcile" ]; then
  [[ "$reconcile_operation_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || {
    echo "ERROR: RELEASE_RECONCILE_OPERATION_ID must be the UUID printed by the original task" >&2
    exit 2
  }
  [[ "$reconcile_task_arn" =~ ^arn:aws:ecs:${region}:${account_id}:task/${cluster}/[A-Za-z0-9_-]+$ ]] || {
    echo "ERROR: RELEASE_RECONCILE_TASK_ARN must be the exact original ${cluster} task ARN" >&2
    exit 2
  }
  case "$reconcile_outcome" in SUCCEEDED|FAILED_CONFIRMED) ;; *)
    echo "ERROR: RELEASE_RECONCILE_OUTCOME must be SUCCEEDED or FAILED_CONFIRMED" >&2
    exit 2
  esac
  for spec in "evidence:$reconcile_evidence_ref:512" "reason:$reconcile_reason:1000"; do
    label="${spec%%:*}"
    rest="${spec#*:}"
    limit="${rest##*:}"
    value="${rest%:*}"
    if [ -z "$value" ] || [ "${#value}" -gt "$limit" ] || [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
      echo "ERROR: reconciliation ${label} must be 1-${limit} printable characters" >&2
      exit 2
    fi
  done
  # Live runs always stamp the AWS principal that actually owns the deploy role. Render-only tests
  # supply it explicitly because they never call AWS.
  if [ "$render_only" != "true" ]; then
    reconcile_actor_ref="$(aws_cmd sts get-caller-identity --query Arn --output text --region "$region")"
  fi
  [[ "$reconcile_actor_ref" =~ ^arn:aws:(iam|sts)::${account_id}:.+ ]] || {
    echo "ERROR: reconciliation actor is not an AWS principal in account ${account_id}" >&2
    exit 2
  }
fi
if [[ ! "$image" =~ ^${account_id}\.dkr\.ecr\.${region}\.amazonaws\.com/watchdog-bms-api@sha256:[0-9a-f]{64}$ ]]; then
  echo "ERROR: release image must be the exact API repository digest" >&2
  exit 1
fi

if [ "$mode" = "release" ] || [ "$mode" = "release-prepare" ] \
  || [ "$mode" = "maintenance-preflight" ] || [ "$mode" = "incident-preflight" ]; then
  release_deploy_target="${release_deploy_target:-all}"
  case "$release_deploy_target" in all|api-web|ai-gateway|workers) ;; *)
    echo "ERROR: RELEASE_DEPLOY_TARGET must be all, api-web, ai-gateway or workers" >&2
    exit 2
  esac
  if [ "$mode" = incident-preflight ] && [ "$release_deploy_target" = all ]; then
    echo "ERROR: incident-preflight accepts one service only" >&2
    exit 2
  fi
  if [ "$mode" = maintenance-preflight ] && [ "$release_deploy_target" != all ]; then
    echo "ERROR: maintenance-preflight requires target=all" >&2
    exit 2
  fi
  if [ "$mode" != incident-preflight ] && [ "$mode" != maintenance-preflight ]; then
    operation_id="${operation_id:-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')}"
  fi
elif [ -n "$release_deploy_target" ]; then
  echo "ERROR: RELEASE_DEPLOY_TARGET is meaningful only for the pre-deploy release mode" >&2
  exit 2
fi
if [ -n "$operation_id" ] && [[ ! "$operation_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "ERROR: RELEASE_OPERATION_ID must be a UUID" >&2
  exit 2
fi
case "$mode" in
  release-intent|release-bind|release-intent-recover|release-orphan-intent-recover|release-pre-intent-recover|release-bootstrap-closed-recover|release-finalize)
    [[ "$parent_operation_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || {
      echo "ERROR: ${mode} requires RELEASE_PARENT_OPERATION_ID from this workflow's pre-deploy release task" >&2
      exit 2
    }
    ;;
  retire|reconcile)
    if [ -n "$parent_operation_id" ] \
      && [[ ! "$parent_operation_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
      echo "ERROR: RELEASE_PARENT_OPERATION_ID must be a UUID" >&2
      exit 2
    fi
    ;;
esac
if [ "$mode" = "release-intent" ]; then
  if [ "${#mutation_intent_json}" -gt 32768 ] || ! jq -e '
    type == "object"
    and (.id | type == "string" and test("^[0-9a-f-]{36}$"))
    and (.serviceKey == "api-web" or .serviceKey == "ai-gateway" or .serviceKey == "workers")
    and (.mutationKind == "CREATE" or .mutationKind == "UPDATE")
    and (.requestHash | type == "string" and test("^[0-9a-f]{64}$"))
    and (.desiredConfigHash | type == "string" and test("^[0-9a-f]{64}$"))
    and (.beforeDeploymentArns | type == "array")
    and (.beforeActiveConfigurations | type == "array")
  ' <<< "$mutation_intent_json" >/dev/null 2>&1; then
    echo "ERROR: release-intent requires a bounded canonical RELEASE_MUTATION_INTENT_JSON" >&2
    exit 2
  fi
  mutation_intent_id="$(jq -r '.id' <<< "$mutation_intent_json")"
elif [ "$mode" = "release-intent-recover" ]; then
  [[ "$mutation_intent_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || {
    echo "ERROR: release-intent-recover requires RELEASE_MUTATION_INTENT_ID" >&2
    exit 2
  }
  if [ "$recovery_ssm_service_arn" != "MISSING" ] \
    && [[ ! "$recovery_ssm_service_arn" =~ ^arn:aws:ecs:${region}:${account_id}:service/${cluster}/[^/]+$ ]]; then
    echo "ERROR: recovery SSM service identity must be MISSING or an exact ${cluster} service ARN" >&2
    exit 2
  fi
  [[ "$recovery_expected_service_arn" =~ ^arn:aws:ecs:${region}:${account_id}:service/${cluster}/[^/]+$ ]] || {
    echo "ERROR: recovery expected service ARN must exactly identify a ${cluster} service" >&2
    exit 2
  }
  [[ "$recovery_ssm_parameter_name" =~ ^/watchdog-bms/${deploy_env}/ecs-express-[A-Za-z0-9_-]+-service-arn$ ]] || {
    echo "ERROR: recovery SSM parameter is outside the ${deploy_env} service cache" >&2
    exit 2
  }
elif [ "$mode" = "release-orphan-intent-recover" ]; then
  if [ "${#orphan_intent_json}" -gt 32768 ] || ! jq -e '
    type == "object"
    and (.id | type == "string" and test("^[0-9a-f-]{36}$"))
    and (.serviceKey == "ai-gateway" or .serviceKey == "workers")
    and .mutationKind == "UPDATE"
    and (.legacyBootstrapDescriptor != null)
  ' <<< "$orphan_intent_json" >/dev/null 2>&1; then
    echo "ERROR: orphan recovery requires the bounded controller-fetched non-api intent JSON" >&2
    exit 2
  fi
  mutation_intent_id="$(jq -r '.id' <<< "$orphan_intent_json")"
  if [ "${#orphan_deployment_manifest}" -gt 16384 ] || ! jq -e '
    type == "array" and length == 1 and .[0].noOp == false
    and (.[0].deploymentArn | type == "string")
    and (.[0].sourceSha | type == "string" and test("^[0-9a-f]{40}$"))
  ' <<< "$orphan_deployment_manifest" >/dev/null 2>&1; then
    echo "ERROR: orphan recovery requires one exact controller-fetched deployment record" >&2
    exit 2
  fi
  if [ "${#orphan_task_evidence}" -gt 16384 ] || ! jq -e '
    type == "object"
    and (.parentTaskArn | type == "string")
    and (.intentTaskArn | type == "string")
    and (.binderTaskArn | type == "string")
    and (.imageDigest | type == "string" and test("@sha256:[0-9a-f]{64}$"))
    and (.originalController.controllerKind == "GITHUB_ACTIONS")
  ' <<< "$orphan_task_evidence" >/dev/null 2>&1; then
    echo "ERROR: orphan recovery requires bounded controller-fetched historical task evidence" >&2
    exit 2
  fi
elif [ "$mode" = "release-pre-intent-recover" ]; then
  # The exact api-web service and SSM parameter are derived from DEPLOY_ENV inside the fenced task;
  # this mode deliberately accepts no caller-supplied remote identity or deployment manifest.
  :
elif [ "$mode" = "release-bootstrap-closed-recover" ]; then
  :
elif [ -n "$parent_operation_id" ]; then
  if [ "${#deployment_manifest}" -gt 16384 ] || ! jq -e '
    type == "array" and length >= 1 and length <= 8
    and all(.[];
      (.service | type) == "string"
      and (.serviceArn | type) == "string"
      and (.targetRevisionArn | type) == "string"
      and (.sourceSha | type) == "string"
      and (.noOp | type) == "boolean"
      and ((.noOp == true and .deploymentArn == null)
        or (.noOp == false and (.deploymentArn | type) == "string")))
  ' <<< "$deployment_manifest" >/dev/null 2>&1; then
    echo "ERROR: held release operations require a bounded exact RELEASE_DEPLOYMENT_MANIFEST_JSON" >&2
    exit 2
  fi
  if [ "$mode" = "release-bind" ] && [ "$(jq 'length' <<< "$deployment_manifest")" -ne 1 ]; then
    echo "ERROR: release-bind accepts exactly one service deployment record" >&2
    exit 2
  fi
  if [ "$mode" = "release-bind" ] && [[ ! "$mutation_intent_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "ERROR: release-bind requires the exact RELEASE_MUTATION_INTENT_ID prepared before the AWS call" >&2
    exit 2
  fi
fi

if [ "$mode" = "release-intent-recover" ] || [ "$mode" = "release-orphan-intent-recover" ]; then
  if [ "${#recovery_network_evidence}" -gt 4096 ] || ! jq -e '
    type == "object"
    and (.serviceArn | type == "string")
    and (
      (.serviceAbsent == true and (keys | sort) == ["serviceAbsent","serviceArn"])
      or (
        (.serviceAbsent == null)
        and (.activeSecurityGroups | type == "array" and (length >= 1 and length <= 2))
        and (.requestedSecurityGroup | type == "string" and test("^sg-[0-9a-f]+$"))
      )
    )
  ' <<< "$recovery_network_evidence" >/dev/null 2>&1; then
    echo "ERROR: exact recovery requires bounded controller-verified network evidence" >&2
    exit 2
  fi
  if [ "$mode" = "release-orphan-intent-recover" ] \
    && jq -e '.serviceAbsent == true' <<< "$recovery_network_evidence" >/dev/null; then
    echo "ERROR: orphan recovery requires the historical service to exist" >&2
    exit 2
  fi
elif [ -n "$recovery_network_evidence$orphan_intent_json$orphan_deployment_manifest$orphan_task_evidence" ]; then
  echo "ERROR: orphan/network evidence is accepted only by exact intent recovery modes" >&2
  exit 2
fi

readonly_database_mode=false
case "$mode" in maintenance-preflight|incident-preflight|a5-ro|a5-capacity-preflight|f2-plan|f2-verify) readonly_database_mode=true ;; esac

database_secret_arn="${DATABASE_URL_SECRET_ARN:-}"
readonly_database_secret_arn="${A5_READONLY_DATABASE_URL_SECRET_ARN:-}"
if [ "$readonly_database_mode" = "true" ] && [ -n "$database_secret_arn" ]; then
  echo "ERROR: ${mode} rejects DATABASE_URL_SECRET_ARN; only the dedicated A5 read-only secret is accepted" >&2
  exit 2
fi
if { [ "$readonly_database_mode" = "true" ] || [ "$mode" = "a5-bootstrap" ]; } \
  && [ -z "$readonly_database_secret_arn" ] && [ "$render_only" != "true" ]; then
  readonly_database_secret_arn="$(aws_cmd secretsmanager describe-secret \
    --secret-id "${secret_prefix}/a5-readonly-database-url" \
    --query ARN --output text --region "$region")"
fi
if [ "$readonly_database_mode" = "true" ] || [ "$mode" = "a5-bootstrap" ]; then
  if [[ ! "$readonly_database_secret_arn" =~ ^arn:aws:secretsmanager:${region}:${account_id}:secret:${secret_prefix}/a5-readonly-database-url- ]]; then
    echo "ERROR: A5 read-only DATABASE_URL secret ARN is outside the expected ${deploy_env} secret" >&2
    exit 1
  fi
fi
if [ "$readonly_database_mode" != "true" ]; then
  if [ -z "$database_secret_arn" ] && [ "$render_only" != "true" ]; then
    database_secret_arn="$(aws_cmd secretsmanager describe-secret \
      --secret-id "${secret_prefix}/database-url" \
      --query ARN --output text --region "$region")"
  fi
  if [[ ! "$database_secret_arn" =~ ^arn:aws:secretsmanager:${region}:${account_id}:secret:${secret_prefix}/database-url- ]]; then
    echo "ERROR: DATABASE_URL secret ARN is outside the expected ${deploy_env} secret" >&2
    exit 1
  fi
fi

short_sha="${commit:0:12}"
container_name="release"
log_prefix="release"
# sync-feature-launch-gates runs with --verify-specialist-closed: the release task exits non-zero,
# and the deploy stops, if any SPECIALIST_LEGAL route is OPEN (v5.1 invariant, spec:272).
# normalize-entitlements runs LAST, after every migration/sync, and with an EXPLICIT --dry-run: a
# release only ever plans (F2/CC7 spec:232-238, UAT r5 ruling 3), so the writer never becomes a
# fixture of every deploy, and the flag beats the environment so nothing left on a task definition
# can arm it. The write itself is the f2-apply mode, dispatched from .github/workflows/
# f2-normalize-apply.yml against a plan a human already read.
launch_gate_sync=""
# Only an api-web rollout may attest this SHA as an API build. An AI/worker-only hotfix that
# attested here would create launch authority for code that never serves and is never retired.
if { [ "$mode" = "release" ] \
    || { [ "$mode" = "release-prepare" ] \
      && { [ "$release_database_authority" = UAT_ACCEPTED_NO_MIGRATION ] \
        || [ "$release_database_authority" = PRODUCTION_READY_V2 ]; }; }; } \
  && { [ "$release_deploy_target" = "all" ] || [ "$release_deploy_target" = "api-web" ]; }; then
  launch_gate_sync='./node_modules/.bin/tsx prisma/sync-feature-launch-gates.ts --verify-specialist-closed; '
fi
task_command="set -eu; ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma; ./node_modules/.bin/tsx prisma/sync-permissions.ts; ${launch_gate_sync}./node_modules/.bin/tsx prisma/sync-workflow-templates.ts; ./node_modules/.bin/tsx prisma/sync-thai-address-master.ts; ./node_modules/.bin/tsx prisma/normalize-entitlements.ts --dry-run --allow-exceptions; echo release-task-complete sha=\$GIT_SHA"
direct_task_command=""
omit_task_role=false
api_base_url=""
m01_run_id=""
# The FULL commit, not the 12-char tag prefix: when api-web is targeted, its per-build attestation
# must exactly match the build id the deployed service compares against (F1.5.1).
git_sha_value="$commit"
if [ "$readonly_database_mode" = "true" ]; then
  task_secrets="$(jq -cn --arg database "$readonly_database_secret_arn" \
    '[{name:"DATABASE_URL",valueFrom:$database}]')"
elif [ "$mode" = "a5-bootstrap" ]; then
  task_secrets="$(jq -cn --arg database "$database_secret_arn" --arg readonly "$readonly_database_secret_arn" '
    [
      {name:"DATABASE_URL",valueFrom:$database},
      {name:"A5_READONLY_DATABASE_URL",valueFrom:$readonly}
    ]')"
else
  task_secrets="$(jq -cn --arg database "$database_secret_arn" \
    '[{name:"DATABASE_URL",valueFrom:$database}]')"
fi

if [ "$mode" = "retire" ] || [ "$mode" = "reconcile" ]; then
  # UAT r5 item 1 — the POST-deploy half. The `release` task above only APPENDS acceptance of the
  # incoming build; taking authority away from the builds that stopped serving happens here, AFTER
  # the rollout is healthy and verified, and only against an EXPLICIT list the caller read from the
  # deployment platform. Never inferred, never guessed from the last two transitions.
  #
  # `reconcile` is the same pass after a rollout that FAILED or rolled back (UAT r6 item 4b): the
  # incoming build was pre-attested by the release task and never served, so it must lose authority
  # while the build the platform rolled back to keeps it.
  if [[ ! "$retire_active_builds" =~ ^[0-9a-f]{40}(,[0-9a-f]{40})?$ ]]; then
    echo "ERROR: RETIRE_ACTIVE_BUILDS must be one or two comma-separated full commit SHAs (got '${retire_active_builds}')" >&2
    exit 2
  fi
  if [[ ! "$retire_deployment_arn" =~ ^arn:aws:ecs:${region}:${account_id}:service-deployment/${cluster}/[^/]+/[^/]+$ ]]; then
    echo "ERROR: RETIRE_DEPLOYMENT_ARN must identify the exact ${cluster} deployment this workflow started" >&2
    exit 2
  fi
  if [[ ! "$retire_service_arn" =~ ^arn:aws:ecs:${region}:${account_id}:service/${cluster}/[^/]+$ ]]; then
    echo "ERROR: RETIRE_SERVICE_ARN must identify the exact ${cluster} service" >&2
    exit 2
  fi
  if [[ ! "$retire_target_revision_arn" =~ ^arn:aws:ecs:${region}:${account_id}:service-revision/${cluster}/[^/]+/[^/]+$ ]]; then
    echo "ERROR: RETIRE_TARGET_REVISION_ARN must identify the exact deployment target revision" >&2
    exit 2
  fi
  # UAT r7 item 1(c) — `retire` asserts "the incoming build IS the one serving now", so it must be in
  # the list. Without this, a run mislabelled as a retirement (health verified, then the platform
  # rolled back underneath it) would take authority away from every build EXCEPT the one that never
  # served. `reconcile` stays deliberately exempt: after a rollback the deployed commit is precisely
  # the one NOT serving, which is the whole reason that mode exists.
  if [ "$mode" = "retire" ] && [[ ",${retire_active_builds}," != *",${commit},"* ]]; then
    echo "ERROR: retire requires the deployed commit ${commit} to be serving (active='${retire_active_builds}') — use reconcile" >&2
    exit 2
  fi
  container_name="retire"
  log_prefix="retire"
  task_command="set -eu; ./node_modules/.bin/tsx prisma/retire-launch-builds.ts --mode=${mode} --active-builds=${retire_active_builds} --deployment-arn=${retire_deployment_arn}; echo retire-task-complete sha=\$GIT_SHA"
fi

case "$mode" in
  maintenance-preflight)
    container_name="maintenance-preflight"
    log_prefix="maintenance-preflight"
    omit_task_role=true
    direct_task_command='set -eu; REQUIRE_NO_AWS_CREDENTIALS=true ALLOW_PENDING_MIGRATIONS=true ./node_modules/.bin/tsx prisma/verify-applied-migration-catalog.ts'
    ;;
  incident-preflight)
    container_name="incident-preflight"
    log_prefix="incident-preflight"
    omit_task_role=true
    direct_task_command='set -eu; REQUIRE_NO_AWS_CREDENTIALS=true ./node_modules/.bin/tsx prisma/verify-applied-migration-catalog.ts'
    if [ "$release_deploy_target" = api-web ]; then
      direct_task_command+='; ./node_modules/.bin/tsx prisma/verify-feature-launch-build-authority.ts'
    fi
    ;;
  release-prepare)
    container_name="release-prepare"
    log_prefix="release-prepare"
    case "$release_database_authority" in
      U5_REVIEWED_APPLY)
        task_command='set -eu; ./node_modules/.bin/tsx prisma/verify-applied-migration-catalog.ts'
        ;;
      UAT_ACCEPTED_NO_MIGRATION)
        [ "${RELEASE_MODE:-}" = fast-promotion ] \
          && [[ "${UAT_ACCEPTANCE_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "${RELEASE_MANIFEST_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] || {
            echo "ERROR: UAT_ACCEPTED_NO_MIGRATION requires the verified fast-promotion acceptance and manifest" >&2
            exit 2
          }
        task_command="set -eu; ./node_modules/.bin/tsx prisma/verify-applied-migration-catalog.ts; ./node_modules/.bin/tsx prisma/sync-permissions.ts; ${launch_gate_sync}./node_modules/.bin/tsx prisma/sync-workflow-templates.ts; ./node_modules/.bin/tsx prisma/sync-thai-address-master.ts; ./node_modules/.bin/tsx prisma/normalize-entitlements.ts --dry-run --allow-exceptions"
        ;;
      PRODUCTION_READY_V2)
        [ "${RELEASE_MODE:-}" = passport-promotion ] \
          && [[ "$production_ready_sha256" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "$production_ready_repository_hash" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "$production_ready_applied_hash" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "$production_ready_pending_hash" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "$production_ready_pending_count" =~ ^[0-9]+$ ]] || {
            echo "ERROR: PRODUCTION_READY_V2 requires exact signed readiness migration authority" >&2
            exit 2
          }
        task_command="set -eu; ./node_modules/.bin/tsx prisma/verify-production-ready-migration.ts; ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma; ./node_modules/.bin/tsx prisma/verify-applied-migration-catalog.ts; ./node_modules/.bin/tsx prisma/sync-permissions.ts; ${launch_gate_sync}./node_modules/.bin/tsx prisma/sync-workflow-templates.ts; ./node_modules/.bin/tsx prisma/sync-thai-address-master.ts; ./node_modules/.bin/tsx prisma/normalize-entitlements.ts --dry-run --allow-exceptions"
        ;;
      *)
        echo "ERROR: release-prepare requires U5_REVIEWED_APPLY, UAT_ACCEPTED_NO_MIGRATION or PRODUCTION_READY_V2 authority" >&2
        exit 2
        ;;
    esac
    if [ "$release_deploy_target" = all ] || [ "$release_deploy_target" = api-web ]; then
      task_command+='; ./node_modules/.bin/tsx prisma/attest-feature-launch-build.ts'
    fi
    task_command+='; echo release-prepare-complete sha=$GIT_SHA'
    ;;
  a5-bootstrap)
    container_name="a5-bootstrap"
    log_prefix="a5-bootstrap"
    omit_task_role=true
    direct_task_command='set -eu; ./node_modules/.bin/tsx prisma/bootstrap-a5-readonly.ts; echo a5-bootstrap-complete sha=$GIT_SHA'
    ;;
  a5-ro)
    container_name="a5-ro"
    log_prefix="a5-ro"
    omit_task_role=true
    direct_task_command='set -eu; ./node_modules/.bin/tsx prisma/a5-readonly-evidence.ts; echo a5-ro-complete sha=$GIT_SHA'
    ;;
  a5-capacity-preflight|a5-capacity|a5-capacity-cleanup)
    container_name="$mode"
    log_prefix="$mode"
    omit_task_role=true
    capacity_command="run"
    [ "$mode" = "a5-capacity-preflight" ] && capacity_command="preflight"
    [ "$mode" = "a5-capacity-cleanup" ] && capacity_command="cleanup"
    direct_task_command="set -eu; ./node_modules/.bin/tsx prisma/a5-capacity-mutating.ts ${capacity_command}; echo ${mode}-complete sha=\$GIT_SHA"
    ;;
  f2-plan|f2-apply|f2-verify)
    container_name="f2"
    log_prefix="f2"
    f2_flag=""
    f2_preamble=""
    # An explicit flag as well as the mode-derived environment: the CLI resolves flags before the
    # environment, so a plan or a verify cannot be turned into a write by anything downstream.
    case "$mode" in
      f2-plan)
        f2_flag=" --dry-run --allow-exceptions --require-read-only"
        omit_task_role=true
        ;;
      f2-verify)
        f2_flag=" --verify --require-read-only"
        omit_task_role=true
        ;;
      f2-apply)
        f2_flag=" --approved-plan=${f2_approved_plan_path}"
        f2_preamble="printf '%s' \"\$F2_APPROVED_PLAN_JSON\" > ${f2_approved_plan_path}; "
        ;;
    esac
    # PLAN/VERIFY execute directly with the SELECT-only A5 credential and no task role. APPLY alone
    # remains inside the durable writer wrapper and receives the ordinary writer credential.
    if [ "$mode" = "f2-apply" ]; then
      task_command="set -eu; ${f2_preamble}./node_modules/.bin/tsx prisma/normalize-entitlements.ts${f2_flag}; echo f2-task-complete mode=${mode} sha=\$GIT_SHA"
    else
      direct_task_command="set -eu; ./node_modules/.bin/tsx prisma/normalize-entitlements.ts${f2_flag}; echo f2-task-complete mode=${mode} sha=\$GIT_SHA"
    fi
    ;;
esac

if [ "$mode" = "release-intent" ] || [ "$mode" = "release-bind" ] \
  || [ "$mode" = "release-intent-recover" ] || [ "$mode" = "release-orphan-intent-recover" ] \
  || [ "$mode" = "release-pre-intent-recover" ] || [ "$mode" = "release-bootstrap-closed-recover" ] \
  || [ "$mode" = "release-finalize" ]; then
  container_name="$mode"
  log_prefix="$mode"
  task_command=""
fi

if [ "$mode" = "m01-live" ]; then
  m01_run_id="${M01_RUN_ID:-}"
  [[ "$m01_run_id" =~ ^m01-live-${short_sha}-[0-9]+$ ]] || {
    echo "ERROR: M01_RUN_ID must match m01-live-${short_sha}-<unix-seconds>" >&2
    exit 2
  }
  redis_secret_arn="${REDIS_URL_SECRET_ARN:-}"
  internal_secret_arn="${AI_GATEWAY_INTERNAL_SECRET_ARN:-}"
  delegation_secret_arn="${AI_ACTOR_DELEGATION_SIGNING_KEY_ARN:-}"
  if [ "$render_only" != "true" ]; then
    redis_secret_arn="${redis_secret_arn:-$(aws_cmd secretsmanager describe-secret --secret-id "${secret_prefix}/redis-url" --query ARN --output text --region "$region")}"
    internal_secret_arn="${internal_secret_arn:-$(aws_cmd secretsmanager describe-secret --secret-id "${secret_prefix}/ai-gateway-internal-secret" --query ARN --output text --region "$region")}"
    delegation_secret_arn="${delegation_secret_arn:-$(aws_cmd secretsmanager describe-secret --secret-id "${secret_prefix}/ai-actor-delegation-signing-key" --query ARN --output text --region "$region")}"
    api_base_url="${M01_API_BASE_URL:-$(aws_cmd ssm get-parameter --name "/watchdog-bms/${deploy_env}/erp-core-internal-url" --query Parameter.Value --output text --region "$region")}"
  else
    api_base_url="${M01_API_BASE_URL:-}"
  fi
  for spec in \
    "redis-url:$redis_secret_arn" \
    "ai-gateway-internal-secret:$internal_secret_arn" \
    "ai-actor-delegation-signing-key:$delegation_secret_arn"; do
    secret_name="${spec%%:*}"
    secret_arn_value="${spec#*:}"
    if [[ ! "$secret_arn_value" =~ ^arn:aws:secretsmanager:${region}:${account_id}:secret:${secret_prefix}/${secret_name}- ]]; then
      echo "ERROR: ${secret_name} secret ARN is outside the expected ${deploy_env} secret" >&2
      exit 1
    fi
  done
  if [[ ! "$api_base_url" =~ ^https://[^[:space:]]+/v1$ ]]; then
    echo "ERROR: M01_API_BASE_URL must be the authorized UAT /v1 URL" >&2
    exit 1
  fi
  container_name="m01"
  log_prefix="m01"
  git_sha_value="$commit"
  task_command='set -eu; ./node_modules/.bin/tsx src/scripts/m01-actor-delegation-live-smoke.ts'
  task_secrets="$(jq -cn \
    --arg database "$database_secret_arn" \
    --arg redis "$redis_secret_arn" \
    --arg internal "$internal_secret_arn" \
    --arg delegation "$delegation_secret_arn" \
    '[
      {name:"DATABASE_URL",valueFrom:$database},
      {name:"REDIS_URL",valueFrom:$redis},
      {name:"AI_GATEWAY_INTERNAL_SECRET",valueFrom:$internal},
      {name:"AI_ACTOR_DELEGATION_SIGNING_KEY",valueFrom:$delegation}
    ]')"
fi

if [ "$mode" = "operation-reconcile" ]; then
  container_name="operation-reconcile"
  log_prefix="operation-reconcile"
  task_command=""
fi

# Bind task-definition recovery to the exact controller request and complete reviewed network.
# This preserves the stable release startedBy provenance while preventing a later run from reusing
# an old STOPPED task that happened to use the same image/command and one overlapping subnet.
if [ "$render_only" = "true" ]; then
  network_boundary="${RELEASE_TASK_RENDER_NETWORK_JSON:-}"
  if [ -z "$network_boundary" ]; then
    network_boundary='{"awsvpcConfiguration":{"subnets":["subnet-11111111"],"securityGroups":["sg-11111111"],"assignPublicIp":"ENABLED"}}'
  fi
else
  vpc_id="$(aws_cmd ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text --region "$region")"
  security_group="$(aws_cmd ec2 describe-security-groups \
    --filters Name=group-name,Values="${resource_prefix}-app-egress-sg" Name=vpc-id,Values="$vpc_id" \
    --query 'SecurityGroups[0].GroupId' --output text --region "$region")"
  subnets="$(aws_cmd ec2 describe-subnets --filters Name=vpc-id,Values="$vpc_id" \
    --query 'Subnets[?MapPublicIpOnLaunch==`true`].SubnetId' --output json --region "$region")"
  if [ "$vpc_id" = None ] || [ "$security_group" = None ] || [ "$subnets" = '[]' ]; then
    echo 'ERROR: release task network is incomplete' >&2
    exit 1
  fi
  network_boundary="$(jq -cn --argjson subnets "$subnets" --arg sg "$security_group" '
    {awsvpcConfiguration:{subnets:($subnets|sort|unique),securityGroups:[$sg],assignPublicIp:"ENABLED"}}
  ')"
fi
network_boundary="$(jq -ceS '
  .awsvpcConfiguration as $network
  |select(($network|keys|sort)==["assignPublicIp","securityGroups","subnets"])
  |select($network.assignPublicIp=="ENABLED")
  |select(($network.securityGroups|type)=="array" and ($network.securityGroups|length)==1
    and all($network.securityGroups[];test("^sg-[0-9a-f]{8,17}$")))
  |select(($network.subnets|type)=="array" and ($network.subnets|length)>=1
    and ($network.subnets|length)<=16 and all($network.subnets[];test("^subnet-[0-9a-f]{8,17}$")))
  |{awsvpcConfiguration:{subnets:($network.subnets|sort|unique),
    securityGroups:($network.securityGroups|sort|unique),assignPublicIp:$network.assignPublicIp}}
' <<< "$network_boundary")"
security_group="$(jq -er '.awsvpcConfiguration.securityGroups[0]' <<< "$network_boundary")"
subnets="$(jq -c '.awsvpcConfiguration.subnets' <<< "$network_boundary")"
if [ "$mode" = "operation-reconcile" ]; then
  run_identity="$reconcile_operation_id"
else
  run_identity="${mutation_intent_id:-${operation_id:-${parent_operation_id:-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}}}}"
fi
sha256_text() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'; fi
}
release_task_request_id="$(printf '%s' "$deploy_env:$mode:$commit:$run_identity:$network_boundary" | sha256_text)"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-release-task.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
task_definition="$tmp_dir/task-definition.json"

jq -n \
  --arg account "$account_id" \
  --arg region "$region" \
  --arg image "$image" \
  --arg family "$task_family" \
  --arg executionRole "$execution_role" \
  --arg taskRole "$release_task_role" \
  --arg logGroup "$log_group" \
  --arg containerName "$container_name" \
  --arg logPrefix "$log_prefix" \
  --arg apiBaseUrl "$api_base_url" \
  --arg m01RunId "$m01_run_id" \
  --arg gitSha "$git_sha_value" \
  --arg deployEnvironment "$deploy_env" \
  --arg awsRegion "$region" \
  --arg releaseSourceBranch "$source_branch" \
  --arg releaseControllerKind "$controller_kind" \
  --arg githubRunId "$github_run_id" \
  --arg githubRunAttempt "$github_run_attempt" \
  --arg githubActor "$github_actor" \
  --arg githubActorId "$github_actor_id" \
  --arg githubWorkflowRef "$github_workflow_ref" \
  --arg githubRepository "$github_repository" \
  --arg manualActorRef "$manual_actor_ref" \
  --arg f2Apply "$f2_apply" \
  --arg f2ApprovedHash "$f2_approved_hash" \
  --arg f2ApprovedPlan "$f2_approved_plan" \
  --arg f2Verify "$f2_verify" \
  --arg capacityMarker "$capacity_marker" \
  --arg capacityApprovalRef "$capacity_approval_ref" \
  --arg capacityBaselineHash "$capacity_baseline_hash" \
  --arg releaseOperationMode "$mode" \
  --arg releaseDeployTarget "$release_deploy_target" \
  --arg productionReadySha256 "$production_ready_sha256" \
  --arg productionReadyRepositoryHash "$production_ready_repository_hash" \
  --arg productionReadyAppliedHash "$production_ready_applied_hash" \
  --arg productionReadyPendingHash "$production_ready_pending_hash" \
  --arg productionReadyPendingCount "$production_ready_pending_count" \
  --arg releaseOperationId "$operation_id" \
  --arg releaseParentOperationId "$parent_operation_id" \
  --arg releaseDeploymentManifest "$deployment_manifest" \
  --arg releaseMutationIntentJson "$mutation_intent_json" \
  --arg releaseMutationIntentId "$mutation_intent_id" \
  --arg releaseRecoverySsmServiceArn "$recovery_ssm_service_arn" \
  --arg releaseRecoveryExpectedServiceArn "$recovery_expected_service_arn" \
  --arg releaseRecoverySsmParameterName "$recovery_ssm_parameter_name" \
  --arg releaseRecoveryBuildReleaseId "$recovery_build_release_id" \
  --arg releaseRecoveryExecutorImage "$recovery_executor_image" \
  --arg releaseRecoveryValidatedCiRunId "$recovery_validated_ci_run_id" \
  --arg releaseRecoveryNetworkEvidence "$recovery_network_evidence" \
  --arg releaseRecoveryParentTaskEvidence "$recovery_parent_task_evidence" \
  --arg releaseBootstrapClosedRecovery "$bootstrap_closed_recovery" \
  --arg releaseOrphanMutationIntent "$orphan_intent_json" \
  --arg releaseOrphanDeploymentManifest "$orphan_deployment_manifest" \
  --arg releaseOrphanTaskEvidence "$orphan_task_evidence" \
  --arg releaseOperationCommand "$task_command" \
  --arg releaseOperationDeploymentArn "$retire_deployment_arn" \
  --arg releaseOperationServiceArn "$retire_service_arn" \
  --arg releaseOperationTargetRevisionArn "$retire_target_revision_arn" \
  --arg releaseOperationActiveBuilds "$retire_active_builds" \
  --arg reconcileOperationId "$reconcile_operation_id" \
  --arg reconcileTaskArn "$reconcile_task_arn" \
  --arg reconcileOutcome "$reconcile_outcome" \
  --arg reconcileEvidenceRef "$reconcile_evidence_ref" \
  --arg reconcileReason "$reconcile_reason" \
  --arg reconcileActorRef "$reconcile_actor_ref" \
  --arg directTaskCommand "$direct_task_command" \
  --arg releaseTaskRequestId "$release_task_request_id" \
  --argjson omitTaskRole "$omit_task_role" \
  --argjson readonlyDatabaseMode "$readonly_database_mode" \
  --argjson taskSecrets "$task_secrets" \
  '{
    family: $family,
    executionRoleArn: ("arn:aws:iam::" + $account + ":role/" + $executionRole),
    taskRoleArn: ("arn:aws:iam::" + $account + ":role/" + $taskRole),
    networkMode: "awsvpc",
    containerDefinitions: [{
      name: $containerName,
      image: $image,
      user: "node",
      workingDirectory: "/app/apps/api",
      essential: true,
      dockerLabels: {"com.watchdog-bms.release-request":$releaseTaskRequestId},
      command: ["/bin/sh", "-lc", (if $directTaskCommand == ""
        then "./node_modules/.bin/tsx prisma/run-exclusive-release-operation.ts"
        else $directTaskCommand end)],
      environment: (if $directTaskCommand != "" then ([
        {name:"NODE_ENV", value:"production"},
        {name:"APP_ENV", value:"production"},
        {name:"DEPLOY_ENVIRONMENT", value:$deployEnvironment},
        {name:"DEPLOY_ENV", value:$deployEnvironment},
        {name:"GIT_SHA", value:$gitSha},
        {name:"U5_CAPACITY_MARKER", value:$capacityMarker},
        {name:"U5_CAPACITY_APPROVAL_REF", value:$capacityApprovalRef},
        {name:"U5_CAPACITY_BASELINE_HASH", value:$capacityBaselineHash},
        {name:"PGOPTIONS", value:(if $readonlyDatabaseMode
          then "-c default_transaction_read_only=on"
          else "" end)}
      ] | map(select(.value != ""))) else ([
        {name:"NODE_ENV", value:"production"},
        {name:"APP_ENV", value:"production"},
        {name:"DEPLOY_ENVIRONMENT", value:$deployEnvironment},
        {name:"AWS_REGION", value:$awsRegion},
        {name:"GIT_SHA", value:$gitSha},
        {name:"RELEASE_SOURCE_BRANCH", value:$releaseSourceBranch},
        {name:"RELEASE_CONTROLLER_KIND", value:$releaseControllerKind},
        {name:"RELEASE_GITHUB_RUN_ID", value:$githubRunId},
        {name:"RELEASE_GITHUB_RUN_ATTEMPT", value:$githubRunAttempt},
        {name:"RELEASE_GITHUB_ACTOR", value:$githubActor},
        {name:"RELEASE_GITHUB_ACTOR_ID", value:$githubActorId},
        {name:"RELEASE_GITHUB_WORKFLOW_REF", value:$githubWorkflowRef},
        {name:"RELEASE_GITHUB_REPOSITORY", value:$githubRepository},
        {name:"RELEASE_MANUAL_ACTOR_REF", value:$manualActorRef},
        {name:"M01_API_BASE_URL", value:$apiBaseUrl},
        {name:"M01_RUN_ID", value:$m01RunId},
        {name:"F2_APPLY", value:$f2Apply},
        {name:"F2_APPROVED_HASH", value:$f2ApprovedHash},
        {name:"F2_APPROVED_PLAN_JSON", value:$f2ApprovedPlan},
        {name:"F2_VERIFY", value:$f2Verify},
        {name:"RELEASE_OPERATION_MODE", value:$releaseOperationMode},
        {name:"RELEASE_DEPLOY_TARGET", value:$releaseDeployTarget},
        {name:"PRODUCTION_READY_V2_SHA256", value:$productionReadySha256},
        {name:"PRODUCTION_READY_REPOSITORY_CATALOG_HASH", value:$productionReadyRepositoryHash},
        {name:"PRODUCTION_READY_APPLIED_CATALOG_HASH", value:$productionReadyAppliedHash},
        {name:"PRODUCTION_READY_PENDING_CATALOG_HASH", value:$productionReadyPendingHash},
        {name:"PRODUCTION_READY_PENDING_COUNT", value:$productionReadyPendingCount},
        {name:"RELEASE_OPERATION_ID", value:$releaseOperationId},
        {name:"RELEASE_PARENT_OPERATION_ID", value:$releaseParentOperationId},
        {name:"RELEASE_OPERATION_DEPLOYMENT_MANIFEST", value:$releaseDeploymentManifest},
        {name:"RELEASE_MUTATION_INTENT_JSON", value:$releaseMutationIntentJson},
        {name:"RELEASE_MUTATION_INTENT_ID", value:$releaseMutationIntentId},
        {name:"RELEASE_RECOVERY_SSM_SERVICE_ARN", value:$releaseRecoverySsmServiceArn},
        {name:"RELEASE_RECOVERY_EXPECTED_SERVICE_ARN", value:$releaseRecoveryExpectedServiceArn},
        {name:"RELEASE_RECOVERY_SSM_PARAMETER_NAME", value:$releaseRecoverySsmParameterName},
        {name:"RELEASE_RECOVERY_BUILD_RELEASE_ID", value:$releaseRecoveryBuildReleaseId},
        {name:"RELEASE_RECOVERY_EXECUTOR_IMAGE", value:$releaseRecoveryExecutorImage},
        {name:"RELEASE_RECOVERY_VALIDATED_CI_RUN_ID", value:$releaseRecoveryValidatedCiRunId},
        {name:"RELEASE_RECOVERY_NETWORK_EVIDENCE_JSON", value:$releaseRecoveryNetworkEvidence},
        {name:"RELEASE_RECOVERY_PARENT_TASK_EVIDENCE_JSON", value:$releaseRecoveryParentTaskEvidence},
        {name:"RELEASE_BOOTSTRAP_CLOSED_RECOVERY_JSON", value:$releaseBootstrapClosedRecovery},
        {name:"RELEASE_ORPHAN_MUTATION_INTENT_JSON", value:$releaseOrphanMutationIntent},
        {name:"RELEASE_ORPHAN_DEPLOYMENT_MANIFEST_JSON", value:$releaseOrphanDeploymentManifest},
        {name:"RELEASE_ORPHAN_TASK_EVIDENCE_JSON", value:$releaseOrphanTaskEvidence},
        {name:"RELEASE_OPERATION_COMMAND", value:$releaseOperationCommand},
        {name:"RELEASE_OPERATION_DEPLOYMENT_ARN", value:$releaseOperationDeploymentArn},
        {name:"RELEASE_OPERATION_SERVICE_ARN", value:$releaseOperationServiceArn},
        {name:"RELEASE_OPERATION_TARGET_REVISION_ARN", value:$releaseOperationTargetRevisionArn},
        {name:"RELEASE_OPERATION_ACTIVE_BUILDS", value:$releaseOperationActiveBuilds},
        {name:"RELEASE_RECONCILE_OPERATION_ID", value:$reconcileOperationId},
        {name:"RELEASE_RECONCILE_TASK_ARN", value:$reconcileTaskArn},
        {name:"RELEASE_RECONCILE_OUTCOME", value:$reconcileOutcome},
        {name:"RELEASE_RECONCILE_EVIDENCE_REF", value:$reconcileEvidenceRef},
        {name:"RELEASE_RECONCILE_REASON", value:$reconcileReason},
        {name:"RELEASE_RECONCILE_ACTOR_REF", value:$reconcileActorRef}
      ] | map(select(.value != ""))) end),
      secrets: $taskSecrets,
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": $logGroup,
          "awslogs-region": $region,
          "awslogs-stream-prefix": $logPrefix
        }
      }
    }],
    requiresCompatibilities: ["FARGATE"],
    cpu: "512",
    memory: "1024",
    runtimePlatform: {cpuArchitecture:"X86_64", operatingSystemFamily:"LINUX"}
  } | if $omitTaskRole then del(.taskRoleArn) else . end' > "$task_definition"

if [ "$render_only" = "true" ]; then
  cat "$task_definition"
  exit 0
fi

aws_cmd logs create-log-group --log-group-name "$log_group" --region "$region" >/dev/null 2>&1 || true
task_definition_arn="$(AWS_BIN="$aws_bin" \
  bash "$(dirname "$0")/register-task-definition-with-retry.sh" "$task_definition" "$region")"

# A cancelled GitHub runner releases its workflow concurrency lock but does not stop the Fargate
# task. Reconcile that detached task before starting another one. The PostgreSQL lock in the task is
# the atomic fence; this ECS check is the friendly recovery path that waits and reports its outcome.
started_by="watchdog-bms-${resource_stage}-release"
capacity_task=false
case "$mode" in
  a5-capacity-preflight|a5-capacity|a5-capacity-cleanup)
    # ECS startedBy is capped at 36 characters. The full validated marker suffix fits exactly and
    # lets a cancelled controller discover its detached task without parsing a local log race.
    started_by="u5c-${capacity_marker#U5C-}"
    started_by="$(printf '%s' "$started_by" | tr '[:upper:]' '[:lower:]')"
    capacity_task=true
    ;;
esac
running_tasks='[]'
# Intent preparation and binding are metadata-only siblings in one concurrent service wave. Their
# exact DB parent/intent row locks are the authority; a shared startedBy scan would mistake a live
# sibling for an abandoned writer and let one sibling's exit status poison another service.
if [ "$mode" != "release-intent" ] && [ "$mode" != "release-bind" ]; then
  running_tasks="$(AWS_BIN="$aws_bin" AWS_REGION="$region" \
    bash "$(dirname "$0")/active-release-tasks.sh" --cluster "$cluster" --started-by "$started_by")"
fi
if [ "$(jq 'length' <<< "$running_tasks")" -gt 0 ]; then
  if [ "$mode" = "operation-reconcile" ]; then
    echo "ERROR: an ECS release task is still active; it cannot be reconciled while running" >&2
    jq -r '.[]' <<< "$running_tasks" >&2
    exit 1
  fi
  echo "[release-task] reconciling detached task(s): $(jq -r 'join(",")' <<< "$running_tasks")"
  detached_tasks="$(jq -r '.[]' <<< "$running_tasks")"
  # shellcheck disable=SC2086 # ECS task ARNs cannot contain whitespace; the CLI expects a list.
  aws_cmd ecs wait tasks-stopped --cluster "$cluster" --tasks $detached_tasks --region "$region"
  # shellcheck disable=SC2086 # same validated ARN list as the waiter above.
  detached_result="$(aws_cmd ecs describe-tasks --cluster "$cluster" --tasks $detached_tasks --region "$region")"
  if ! jq -e '[.tasks[].containers[] | .exitCode] | length > 0 and all(. == 0)' <<< "$detached_result" >/dev/null; then
    echo "ERROR: a detached release operation failed or has no confirmed exit code; inspect it before retrying" >&2
    jq '{tasks:[.tasks[]|{taskArn,stopCode,stoppedReason,containers:[.containers[]|{name,exitCode,reason}]}]}' \
      <<< "$detached_result" >&2
    exit 1
  fi
fi

# First exact read, immediately before task launch. The task performs the same ECS read again under
# the durable DB fence immediately before retirement mutates authority; disagreement halts UNKNOWN.
if [ "$mode" = "retire" ] || [ "$mode" = "reconcile" ]; then
  revalidated_active="$(AWS_BIN="$aws_bin" \
    bash "$(dirname "$0")/active-launch-builds.sh" \
      --service-arn "$retire_service_arn" --deployment-arn "$retire_deployment_arn" \
      --target-revision-arn "$retire_target_revision_arn")"
  if [ "$revalidated_active" != "$retire_active_builds" ]; then
    echo "ERROR: retirement platform manifest moved before task launch" >&2
    echo "expected=$retire_active_builds observed=$revalidated_active" >&2
    exit 1
  fi
fi

run_result="$tmp_dir/run-result.json"
task_result="$tmp_dir/task-result.json"
task_arn=""
exit_code="missing"
mapfile -t release_subnets < <(jq -r '.[]' <<< "$subnets")
for subnet_index in "${!release_subnets[@]}"; do
  subnet="${release_subnets[$subnet_index]}"
  network="$(jq -cn --arg sg "$security_group" --arg subnet "$subnet" \
    '{awsvpcConfiguration:{subnets:[$subnet],securityGroups:[$sg],assignPublicIp:"ENABLED"}}')"
  # Concurrent release-intent/release-bind siblings share one parent but own different mutation
  # intents. The intent must therefore win the idempotency identity while remaining stable on retry.
  run_client_token="$(printf '%s' "$release_task_request_id:$task_definition_arn:$network" | sha256_text)"
  run_args=(ecs run-task --cluster "$cluster" --task-definition "$task_definition_arn"
    --started-by "$started_by" --launch-type FARGATE --network-configuration "$network"
    --region "$region")
  if [ "$capacity_task" = "true" ]; then
    run_args+=(--tags key=WatchdogOperation,value=U5Capacity
      key=U5CapacityMarker,value="${capacity_marker#U5C-}")
  fi
  AWS_BIN="$aws_bin" bash "$(dirname "$0")/run-task-idempotently.sh" \
    "$run_client_token" -- "${run_args[@]}" > "$run_result"
  if ! jq -e '(.failures | length) == 0 and (.tasks | length) == 1' "$run_result" >/dev/null; then
    jq '{failures}' "$run_result" >&2
    exit 1
  fi
  task_arn="$(jq -r '.tasks[0].taskArn' "$run_result")"
  echo "[release-task] task=$task_arn definition=$task_definition_arn subnet=$subnet"
  aws_cmd ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn" --region "$region"
  aws_cmd ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" --region "$region" > "$task_result"
  exit_code="$(jq -r --arg name "$container_name" '.tasks[0].containers[] | select(.name == $name) | .exitCode // "missing"' "$task_result")"

  # A Fargate task that never entered its container cannot have changed the database. If one
  # public subnet cannot reach AWS control-plane endpoints, try the next reviewed public subnet.
  if [ "$exit_code" = "missing" ] \
    && [ "$subnet_index" -lt "$(( ${#release_subnets[@]} - 1 ))" ] \
    && jq -e -f "$(dirname "$0")/release-task-network-failure.jq" "$task_result" >/dev/null; then
    echo "[release-task] subnet=$subnet failed before container start; trying the next public subnet" >&2
    continue
  fi
  break
done
task_id="${task_arn##*/}"
log_messages=''
if [ "$capacity_task" = "true" ] && [ "$exit_code" = "0" ]; then
  case "$mode" in
    a5-capacity-preflight) capacity_evidence_artifact=a5-capacity-preflight-v2 ;;
    a5-capacity) capacity_evidence_artifact=a5-capacity-mutating-v2 ;;
    a5-capacity-cleanup) capacity_evidence_artifact=a5-capacity-cleanup-v2 ;;
  esac
  # Task status is authoritative before logs are necessarily readable. A successful one-shot must
  # not be consumed merely because CloudWatch Logs propagation lagged the ECS STOPPED transition.
  for _ in $(seq 1 12); do
    log_messages="$(aws_cmd logs get-log-events \
      --log-group-name "$log_group" \
      --log-stream-name "${log_prefix}/${container_name}/$task_id" \
      --query 'events[].message' --output text --region "$region" 2>/dev/null || true)"
    grep -Fq "{\"artifact\":\"${capacity_evidence_artifact}\"" <<< "$log_messages" && break
    sleep 5
  done
  grep -Fq "{\"artifact\":\"${capacity_evidence_artifact}\"" <<< "$log_messages" || {
    echo "ERROR: successful capacity task has no readable ${capacity_evidence_artifact} evidence" >&2
    exit 1
  }
  printf '%s\n' "$log_messages"
else
  aws_cmd logs get-log-events \
    --log-group-name "$log_group" \
    --log-stream-name "${log_prefix}/${container_name}/$task_id" \
    --query 'events[].message' --output text --region "$region" || true
fi
if [ "$exit_code" != "0" ]; then
  jq '{stopCode:.tasks[0].stopCode,stoppedReason:.tasks[0].stoppedReason,containers:.tasks[0].containers|map({name,exitCode,reason})}' "$task_result" >&2
  case "$exit_code" in 75|78) exit "$exit_code" ;; *) exit 1 ;; esac
fi

if [ "$mode" = "release" ] || [ "$mode" = "release-prepare" ]; then
  echo "[release-task] rollout parent operation=$operation_id"
  if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "${GITHUB_ENV:-}" ]; then
    printf 'RELEASE_PARENT_OPERATION_ID=%s\n' "$operation_id" >> "$GITHUB_ENV"
    if [ "$mode" = release-prepare ]; then
      printf 'RELEASE_DATABASE_COMPATIBILITY_PROVED_SHA=%s\n' "$commit" >> "$GITHUB_ENV"
    fi
  fi
fi
if [ "$mode" = incident-preflight ] && [ "${GITHUB_ACTIONS:-}" = true ] && [ -n "${GITHUB_ENV:-}" ]; then
  printf 'RELEASE_DATABASE_COMPATIBILITY_PROVED_SHA=%s\n' "$commit" >> "$GITHUB_ENV"
  printf 'PARTIAL_INCIDENT_READONLY_PROVED_SHA=%s\n' "$commit" >> "$GITHUB_ENV"
  if [ "$release_deploy_target" = api-web ]; then
    printf 'PARTIAL_INCIDENT_BUILD_AUTHORITY_PROVED_SHA=%s\n' "$commit" >> "$GITHUB_ENV"
  fi
fi
if [ "$mode" = maintenance-preflight ] && [ "${GITHUB_ACTIONS:-}" = true ] && [ -n "${GITHUB_ENV:-}" ]; then
  printf 'RELEASE_DATABASE_COMPATIBILITY_PROVED_SHA=%s\n' "$commit" >> "$GITHUB_ENV"
  printf 'MAINTENANCE_BOOTSTRAP_READONLY_PROVED_SHA=%s\n' "$commit" >> "$GITHUB_ENV"
fi
echo "[release-task] success mode=$mode sha=$short_sha"
