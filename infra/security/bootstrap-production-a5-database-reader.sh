#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <watchdog-bms-migration-tool@sha256:digest> <full-main-source-sha> <LEGACY_PRE_F1|F1_CURRENT>" >&2
  exit 2
fi

image="$1"
source_sha="$2"
schema_profile="$3"
account_id=311414082667
region=ap-southeast-1
cluster=watchdog-bms-prod
parameter_prefix=/watchdog-bms/production/a5-readonly-runtime
writer_name=watchdog-bms/production/database-url
reader_name=watchdog-bms/production/a5-readonly-database-url
reader_description='Production-only SELECT credential for signed A5 evidence'
bootstrap_family_prefix=watchdog-a5-production-bootstrap-
family="${bootstrap_family_prefix}${source_sha:0:12}"
started_by="a5-bootstrap-${source_sha:0:12}"
bootstrap_execution_role_name=watchdog-bms-production-a5-bootstrap-execution
bootstrap_controller_role_name=watchdog-bms-production-a5-reader-bootstrap
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
revoked_policy="$repo_root/infra/security/production-a5-reader-bootstrap-revoked-policy.template.json"
active_policy="$repo_root/infra/security/production-a5-reader-bootstrap-policy.template.json"
controller_trust="$repo_root/infra/security/production-a5-readonly-trust.template.json"
bootstrap_execution_trust="$repo_root/infra/security/production-a5-readonly-execution-trust.template.json"
bootstrap_execution_policy="$repo_root/infra/security/production-a5-bootstrap-execution-policy.template.json"
task_definition_arn=''
task_arn=''
completed=false
bootstrap_authority_revoked=false
bootstrap_cleanup_armed=false
run_task_requested=false
secret_file=''
docker_config=''
jq -e . "$revoked_policy" "$active_policy" "$controller_trust" \
  "$bootstrap_execution_trust" "$bootstrap_execution_policy" >/dev/null

case "$schema_profile" in LEGACY_PRE_F1|F1_CURRENT) ;; *) exit 2 ;; esac
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$image" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$ ]]

active_bootstrap_task_definitions() {
  local response pattern
  pattern="^arn:aws:ecs:${region}:${account_id}:task-definition/${bootstrap_family_prefix}[0-9a-f]{12}:[1-9][0-9]*$"
  # ECS family-prefix is a full family name, not an arbitrary string prefix. List the account-wide
  # ACTIVE set and keep only the exact bootstrap-family ARN shape locally.
  response="$(aws ecs list-task-definitions --region "$region" \
    --status ACTIVE --output json)" || return 1
  jq -e '.taskDefinitionArns|type=="array" and all(.[];type=="string")' \
    <<< "$response" >/dev/null || return 1
  jq -c --arg pattern "$pattern" '[.taskDefinitionArns[]|select(test($pattern))]' \
    <<< "$response"
}

retire_bootstrap_task_definitions() {
  local definitions='' empty_checks=0 arn=''
  for check in {1..31}; do
    definitions="$(active_bootstrap_task_definitions)" || return 1
    if [ "$(jq 'length' <<< "$definitions")" -eq 0 ]; then
      empty_checks=$((empty_checks+1))
      [ "$empty_checks" -ge 3 ] && return 0
    else
      empty_checks=0
      while IFS= read -r arn; do
        [ -n "$arn" ] || continue
        aws ecs deregister-task-definition --region "$region" --task-definition "$arn" \
          >/dev/null || return 1
      done < <(jq -r '.[]' <<< "$definitions")
    fi
    [ "$check" -lt 31 ] && sleep 2
  done
  echo 'ERROR: bootstrap task definitions did not reach a stable empty ACTIVE set' >&2
  return 1
}

active_bootstrap_tasks() {
  local listed exact_list cluster_list described page expected_cluster expected_group pattern group_pattern
  local offset
  local -a task_arns=()
  expected_cluster="arn:aws:ecs:${region}:${account_id}:cluster/${cluster}"
  expected_group="family:${family}"
  pattern="^arn:aws:ecs:${region}:${account_id}:task/${cluster}/[0-9a-f-]+$"
  group_pattern="^family:${bootstrap_family_prefix}[0-9a-f]{12}$"
  exact_list="$(aws ecs list-tasks --region "$region" --cluster "$cluster" \
    --started-by "$started_by" --query taskArns --output json)" || return 1
  # Also inspect the cluster-wide RUNNING set so a lost response from an older source cannot hide
  # behind a different stable startedBy during a later existing-secret bootstrap.
  cluster_list="$(aws ecs list-tasks --region "$region" --cluster "$cluster" \
    --desired-status RUNNING --query taskArns --output json)" || return 1
  listed="$(jq -cn --argjson exact "$exact_list" --argjson cluster "$cluster_list" \
    '$exact+$cluster|unique')" || return 1
  jq -e 'type=="array" and all(.[];type=="string")' \
    <<< "$listed" >/dev/null || return 1
  [ "$(jq 'length' <<< "$listed")" -gt 0 ] || { printf '[]\n'; return 0; }
  while IFS= read -r arn; do task_arns+=("$arn"); done < <(jq -r '.[]' <<< "$listed")
  described='{"failures":[],"tasks":[]}'
  for ((offset=0; offset<${#task_arns[@]}; offset+=100)); do
    page="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" \
      --tasks "${task_arns[@]:offset:100}" --output json)" || return 1
    described="$(jq -cn --argjson current "$described" --argjson page "$page" \
      '{failures:($current.failures+$page.failures),tasks:($current.tasks+$page.tasks)}')" \
      || return 1
  done
  jq -e --argjson expectedArns "$listed" --arg cluster "$expected_cluster" \
    --arg started "$started_by" --arg group "$expected_group" --arg pattern "$pattern" \
    --arg groupPattern "$group_pattern" --arg familyPrefix "family:${bootstrap_family_prefix}" '
      (([.tasks[].taskArn]+[.failures[].arn])|sort)==($expectedArns|sort)
      and all(.failures[];.reason=="MISSING")
      and all(.tasks[];
        .clusterArn==$cluster and (.taskArn|test($pattern))
        and (if .startedBy==$started then .group==$group
          elif (.group//""|test($groupPattern)) then
            .startedBy==("a5-bootstrap-"+(.group|ltrimstr($familyPrefix)))
          else true end))
    ' <<< "$described" >/dev/null || return 1
  jq -c --arg groupPattern "$group_pattern" '[.tasks[]
    | select((.group//"")|test($groupPattern))
    | select((.lastStatus//"")!="STOPPED" or (.desiredStatus//"")!="STOPPED")
    | .taskArn]' <<< "$described"
}

stop_bootstrap_tasks_and_prove_absent() {
  local observe_full_window="$1" known='' active='' empty_checks=0 minimum_check=1 arn=''
  local -a active_arns=()
  case "$observe_full_window" in true) minimum_check=61 ;; false) ;; *) return 2 ;; esac

  # A returned ARN is authoritative even before ListTasks becomes consistent.
  if [ -n "$task_arn" ]; then
    [[ "$task_arn" =~ ^arn:aws:ecs:${region}:${account_id}:task/${cluster}/[0-9a-f-]+$ ]] || return 1
    known="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" \
      --tasks "$task_arn" --output json)" || return 1
    if jq -e --arg arn "$task_arn" --arg started "$started_by" --arg group "family:${family}" '
        .failures==[] and (.tasks|length)==1 and .tasks[0].taskArn==$arn
        and .tasks[0].startedBy==$started and .tasks[0].group==$group
      ' <<< "$known" >/dev/null; then
      if ! jq -e '.tasks[0].lastStatus=="STOPPED" and .tasks[0].desiredStatus=="STOPPED"' \
          <<< "$known" >/dev/null; then
        aws ecs stop-task --region "$region" --cluster "$cluster" --task "$task_arn" \
          --reason production-a5-bootstrap-cleanup >/dev/null || return 1
        aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" \
          --tasks "$task_arn" >/dev/null || return 1
      fi
      task_arn=''
    else
      # A just-accepted task can briefly be absent from DescribeTasks. Use the full
      # startedBy visibility window before declaring it absent.
      observe_full_window=true
      minimum_check=61
    fi
  fi

  # Three consecutive empty observations make normal cleanup stable. If RunTask may have
  # succeeded without returning a response, observe ECS's full five-minute consistency window.
  for check in {1..64}; do
    active="$(active_bootstrap_tasks)" || return 1
    if [ "$(jq 'length' <<< "$active")" -eq 0 ]; then
      empty_checks=$((empty_checks+1))
      if [ "$check" -ge "$minimum_check" ] && [ "$empty_checks" -ge 3 ]; then
        task_arn=''
        return 0
      fi
    else
      empty_checks=0
      active_arns=()
      while IFS= read -r arn; do active_arns+=("$arn"); done < <(jq -r '.[]' <<< "$active")
      for arn in "${active_arns[@]}"; do
        aws ecs stop-task --region "$region" --cluster "$cluster" --task "$arn" \
          --reason production-a5-bootstrap-cleanup >/dev/null || return 1
      done
      aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" \
        --tasks "${active_arns[@]}" >/dev/null || return 1
    fi
    [ "$check" -lt 64 ] && sleep 5
  done
  echo 'ERROR: bootstrap tasks did not reach a stable empty active set' >&2
  return 1
}

prove_revoked_bootstrap_residue_absent() {
  local check tasks definitions
  for check in {1..3}; do
    tasks="$(active_bootstrap_tasks)" || return 1
    definitions="$(active_bootstrap_task_definitions)" || return 1
    [ "$(jq 'length' <<< "$tasks")" -eq 0 ] \
      && [ "$(jq 'length' <<< "$definitions")" -eq 0 ] || {
        echo 'ERROR: revoked reader bootstrap still has an active task or task definition' >&2
        return 1
      }
    [ "$check" -eq 3 ] || sleep 2
  done
}

assert_exact_bootstrap_role_core() {
  local role_json="$1" role="$2" trust="$3"
  jq -e --arg name "$role" --arg arn "arn:aws:iam::${account_id}:role/${role}" \
    --slurpfile expectedTrust "$trust" '
      .Role.RoleName==$name and .Role.Arn==$arn and .Role.Path=="/"
      and .Role.MaxSessionDuration==7200 and (.Role|has("PermissionsBoundary")|not)
      and .Role.AssumeRolePolicyDocument==$expectedTrust[0]
    ' <<< "$role_json" >/dev/null || return 1
}

assert_exact_bootstrap_role_shape() {
  local role_json="$1" role="$2" trust="$3" attached='' inline=''
  assert_exact_bootstrap_role_core "$role_json" "$role" "$trust" || return 1
  attached="$(aws iam list-attached-role-policies --role-name "$role" --output json)" || return 1
  test "$(jq -cS '.AttachedPolicies' <<< "$attached")" = '[]' || return 1
  inline="$(aws iam list-role-policies --role-name "$role" --output json)" || return 1
  test "$(jq -cS '.PolicyNames|sort' <<< "$inline")" \
    = "$(jq -cnS --arg name "$role" '[$name]')" || return 1
}

classify_bootstrap_execution_role() {
  local role_json="$1" attached='' inline='' policy=''
  assert_exact_bootstrap_role_core "$role_json" "$bootstrap_execution_role_name" \
    "$bootstrap_execution_trust" || return 1
  attached="$(aws iam list-attached-role-policies --role-name "$bootstrap_execution_role_name" \
    --output json)" || return 1
  test "$(jq -cS '.AttachedPolicies' <<< "$attached")" = '[]' || return 1
  inline="$(aws iam list-role-policies --role-name "$bootstrap_execution_role_name" \
    --output json)" || return 1
  case "$(jq -cS '.PolicyNames|sort' <<< "$inline")" in
    "$(jq -cnS --arg name "$bootstrap_execution_role_name" '[$name]')")
      policy="$(read_exact_bootstrap_role_policy "$bootstrap_execution_role_name")" || return 1
      jq -e --arg role "$bootstrap_execution_role_name" \
        --slurpfile expected "$bootstrap_execution_policy" '
          .RoleName==$role and .PolicyName==$role and .PolicyDocument==$expected[0]
        ' <<< "$policy" >/dev/null || return 1
      printf 'FULL\n'
      ;;
    '[]') printf 'CLEANUP_ONLY\n' ;;
    *) return 1 ;;
  esac
}

read_exact_bootstrap_role_policy() {
  local role="$1" response=''
  response="$(aws iam get-role-policy --role-name "$role" --policy-name "$role" --output json)" \
    || return 1
  jq -e --arg role "$role" '.RoleName==$role and .PolicyName==$role
    and (.PolicyDocument|type=="object")' <<< "$response" >/dev/null || return 1
  printf '%s\n' "$response"
}

assert_exact_bootstrap_role() {
  local role_json="$1" role="$2" trust="$3" expected_policy="$4" policy=''
  assert_exact_bootstrap_role_shape "$role_json" "$role" "$trust" || return 1
  policy="$(read_exact_bootstrap_role_policy "$role")" || return 1
  jq -e --arg role "$role" --slurpfile expected "$expected_policy" '
    .RoleName==$role and .PolicyName==$role and .PolicyDocument==$expected[0]
  ' <<< "$policy" >/dev/null
}

emit_revoked_bootstrap_replay_if_complete() {
  local existing_reader='' execution_lookup='' controller_lookup='' attached='' inline='' policy=''
  local secret_state=ABSENT execution_state=ABSENT controller_state='' expected_policy=''
  if existing_reader="$(aws secretsmanager describe-secret --region "$region" \
      --secret-id "$reader_name" --output json 2>&1)"; then
    secret_state=PRESENT
    jq -e --arg name "$reader_name" --arg description "$reader_description" '
      .Name==$name and .Description==$description and .DeletedDate==null
      and (.ARN|test("^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-[A-Za-z0-9]{6}$"))
      and (.Tags|sort_by(.Key,.Value))==[{Key:"purpose",Value:"production-a5-readonly"}]
    ' <<< "$existing_reader" >/dev/null || return 1
    reader_version="$(jq -er '[.VersionIdsToStages|to_entries[]
      |select(.value|index("AWSCURRENT"))|.key]|select(length==1)|.[0]
      |select(test("^[A-Fa-f0-9-]{32,64}$"))' <<< "$existing_reader")" || return 1
  elif ! grep -F ResourceNotFoundException <<< "$existing_reader" >/dev/null; then
    printf '%s\n' "$existing_reader" >&2
    return 1
  fi

  if execution_lookup="$(aws iam get-role --role-name "$bootstrap_execution_role_name" 2>&1)"; then
    execution_state="$(classify_bootstrap_execution_role "$execution_lookup")" || return 1
  elif ! grep -F NoSuchEntity <<< "$execution_lookup" >/dev/null; then
    printf '%s\n' "$execution_lookup" >&2
    return 1
  fi

  controller_lookup="$(aws iam get-role --role-name "$bootstrap_controller_role_name" --output json)" \
    || return 1
  assert_exact_bootstrap_role_shape "$controller_lookup" "$bootstrap_controller_role_name" \
    "$controller_trust" || return 1
  policy="$(read_exact_bootstrap_role_policy "$bootstrap_controller_role_name")" || return 1
  if jq -e --arg role "$bootstrap_controller_role_name" --slurpfile expected "$active_policy" '
      .RoleName==$role and .PolicyName==$role and .PolicyDocument==$expected[0]
    ' <<< "$policy" >/dev/null; then
    controller_state=FULL
  elif jq -e --arg role "$bootstrap_controller_role_name" --slurpfile expected "$revoked_policy" '
    .RoleName==$role and .PolicyName==$role and .PolicyDocument==$expected[0]
  ' <<< "$policy" >/dev/null; then
    controller_state=RECOVERY
  else
    echo 'ERROR: reader bootstrap controller is neither exact active nor exact revoked state' >&2
    return 1
  fi

  case "$controller_state:$secret_state:$execution_state" in
    FULL:ABSENT:FULL|FULL:PRESENT:FULL) return 10 ;;
    FULL:PRESENT:ABSENT|FULL:PRESENT:CLEANUP_ONLY) expected_policy="$active_policy" ;;
    RECOVERY:PRESENT:ABSENT) expected_policy="$revoked_policy" ;;
    *)
      echo "ERROR: unsafe reader bootstrap state tuple: $controller_state/$secret_state/$execution_state" >&2
      return 1
      ;;
  esac

  prove_revoked_bootstrap_residue_absent || return 1
  existing_reader="$(aws secretsmanager describe-secret --region "$region" \
    --secret-id "$reader_name" --output json)" || return 1
  jq -e --arg name "$reader_name" --arg description "$reader_description" \
    --arg version "$reader_version" '
      .Name==$name and .Description==$description and .DeletedDate==null
      and (.ARN|test("^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-[A-Za-z0-9]{6}$"))
      and (.Tags|sort_by(.Key,.Value))==[{Key:"purpose",Value:"production-a5-readonly"}]
      and [.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]==[$version]
    ' <<< "$existing_reader" >/dev/null || return 1
  if execution_lookup="$(aws iam get-role --role-name "$bootstrap_execution_role_name" 2>&1)"; then
    test "$controller_state:$execution_state" = 'FULL:CLEANUP_ONLY' || {
      echo 'ERROR: bootstrap execution role reappeared during revoked-state readback' >&2
      return 1
    }
    test "$(classify_bootstrap_execution_role "$execution_lookup")" = CLEANUP_ONLY || return 1
  elif ! grep -F NoSuchEntity <<< "$execution_lookup" >/dev/null; then
    printf '%s\n' "$execution_lookup" >&2
    return 1
  fi
  controller_lookup="$(aws iam get-role --role-name "$bootstrap_controller_role_name" --output json)" \
    || return 1
  assert_exact_bootstrap_role_shape "$controller_lookup" "$bootstrap_controller_role_name" \
    "$controller_trust" || return 1
  policy="$(read_exact_bootstrap_role_policy "$bootstrap_controller_role_name")" || return 1
  jq -e --arg role "$bootstrap_controller_role_name" --slurpfile expected "$expected_policy" '
    .RoleName==$role and .PolicyName==$role and .PolicyDocument==$expected[0]
  ' <<< "$policy" >/dev/null || return 1
  completed=true
  if [ "$controller_state" = FULL ]; then
    bootstrap_cleanup_armed=true
    remove_bootstrap_execution_authority || return 1
  fi
  printf '{"artifact":"production-a5-reader-bootstrap","state":"EXISTING","readerRole":"watchdog_a5_prod_ro","readerSecretVersionId":"%s"}\n' \
    "$reader_version"
}

delete_incomplete_reader_secret_and_prove_absent() {
  local response='' delete_status=0 empty_checks=0
  response="$(aws secretsmanager delete-secret --region "$region" --secret-id "$reader_name" \
    --force-delete-without-recovery --output json 2>&1)" || delete_status=$?
  if [ "$delete_status" -ne 0 ] \
      && grep -Eq 'AccessDenied|InvalidRequest|ValidationException' <<< "$response"; then
    printf '%s\n' "$response" >&2
    return 1
  fi
  for check in {1..64}; do
    if response="$(aws secretsmanager describe-secret --region "$region" \
        --secret-id "$reader_name" --output json 2>&1)"; then
      empty_checks=0
      jq -e --arg name "$reader_name" '.Name==$name' <<< "$response" >/dev/null || return 1
    elif grep -F ResourceNotFoundException <<< "$response" >/dev/null; then
      empty_checks=$((empty_checks+1))
      [ "$empty_checks" -ge 3 ] && return 0
    else
      printf '%s\n' "$response" >&2
      return 1
    fi
    [ "$check" -lt 64 ] && sleep 5
  done
  echo 'ERROR: incomplete reader secret did not reach stable absence' >&2
  return 1
}

remove_bootstrap_execution_authority() {
  local role_lookup='' inline='' policy='' absent_checks=0 controller_lookup=''
  local max="${BOOTSTRAP_IAM_DELETE_MAX_ATTEMPTS:-12}" delay="${BOOTSTRAP_IAM_DELETE_RETRY_SECONDS:-5}"
  $bootstrap_cleanup_armed || return 0
  $bootstrap_authority_revoked && return 0
  [[ "$max" =~ ^([3-9]|[1-9][0-9]+)$ && "$delay" =~ ^[0-9]+$ ]] || return 1
  for ((attempt=1; attempt<=max; attempt++)); do
    if role_lookup="$(aws iam get-role --role-name "$bootstrap_execution_role_name" 2>&1)"; then
      absent_checks=0
      assert_exact_bootstrap_role_core "$role_lookup" "$bootstrap_execution_role_name" \
        "$bootstrap_execution_trust" || return 1
      test "$(aws iam list-attached-role-policies --role-name "$bootstrap_execution_role_name" \
        --output json | jq -cS '.AttachedPolicies')" = '[]' || return 1
      inline="$(aws iam list-role-policies --role-name "$bootstrap_execution_role_name" \
        --output json)" || return 1
      case "$(jq -cS '.PolicyNames|sort' <<< "$inline")" in
        "$(jq -cnS --arg name "$bootstrap_execution_role_name" '[$name]')")
          policy="$(read_exact_bootstrap_role_policy "$bootstrap_execution_role_name")" || return 1
          jq -e --arg role "$bootstrap_execution_role_name" \
            --slurpfile expected "$bootstrap_execution_policy" '
              .RoleName==$role and .PolicyName==$role and .PolicyDocument==$expected[0]
            ' <<< "$policy" >/dev/null || return 1
          aws iam delete-role-policy --role-name "$bootstrap_execution_role_name" \
            --policy-name "$bootstrap_execution_role_name" >/dev/null 2>&1 || true
          ;;
        '[]')
          aws iam delete-role --role-name "$bootstrap_execution_role_name" \
            >/dev/null 2>&1 || true
          ;;
        *) return 1 ;;
      esac
    elif grep -F NoSuchEntity <<< "$role_lookup" >/dev/null; then
      absent_checks=$((absent_checks+1))
      [ "$absent_checks" -ge 3 ] && break
    else
      absent_checks=0
    fi
    [ "$attempt" -lt "$max" ] && sleep "$delay"
  done
  [ "$absent_checks" -ge 3 ] || {
    echo 'ERROR: bootstrap execution role deletion did not reach stable NoSuchEntity' >&2
    return 1
  }
  controller_lookup="$(aws iam get-role --role-name "$bootstrap_controller_role_name" --output json)" \
    || return 1
  assert_exact_bootstrap_role "$controller_lookup" "$bootstrap_controller_role_name" \
    "$controller_trust" "$active_policy" || return 1
  # This is the final AWS call. Its response can be lost after IAM accepts the metadata-only
  # revoked policy, so every outcome must enter the no-cloud EXIT path.
  bootstrap_authority_revoked=true
  if ! aws iam put-role-policy --role-name "$bootstrap_controller_role_name" \
      --policy-name "$bootstrap_controller_role_name" --policy-document "file://$revoked_policy" \
      >/dev/null; then
    return 1
  fi
}

cleanup() {
  local status=$?
  local resources_quiescent=true observe_full_window=false
  trap - EXIT
  unset reader_url reader_password
  [ -z "$secret_file" ] || rm -f -- "$secret_file"
  if [ -n "$docker_config" ] && [ -d "$docker_config" ] \
      && [[ "$docker_config" == "${TMPDIR:-/tmp}"/production-a5-bootstrap-docker.* ]]; then
    rm -rf -- "$docker_config"
  fi
  # Any attempted self-revoke must make EXIT entirely local; an ambiguous response may mean the
  # cached role credentials are already denied.
  if $bootstrap_authority_revoked; then
    [ -z "$task_arn" ] && [ -z "$task_definition_arn" ] || status=1
    exit "$status"
  fi
  if $bootstrap_cleanup_armed; then
    $run_task_requested && [ -z "$task_arn" ] && observe_full_window=true
    stop_bootstrap_tasks_and_prove_absent "$observe_full_window" \
      || { resources_quiescent=false; status=1; }
    retire_bootstrap_task_definitions \
      || { resources_quiescent=false; status=1; }
    if $resources_quiescent; then
      task_arn=''
      task_definition_arn=''
      if ! $completed; then
        # Any incomplete attempt must not manufacture the completed recovery tuple. This includes
        # retries that started with a pre-existing secret, not only attempts that created one.
        delete_incomplete_reader_secret_and_prove_absent \
          || { resources_quiescent=false; status=1; }
      fi
      if $resources_quiescent; then
        remove_bootstrap_execution_authority || status=1
      else
        echo 'ERROR: preserving bootstrap authority because reader-secret absence was not proved' >&2
      fi
    else
      echo 'ERROR: preserving bootstrap secret/authority because task absence was not proved' >&2
    fi
  fi
  exit "$status"
}

# Tests source the real cleanup state machines with a fake AWS CLI. Executable invocations continue
# below and cannot bypass the bootstrap with an environment variable.
if [ "${BASH_SOURCE[0]}" != "$0" ]; then return 0; fi
trap cleanup EXIT

test "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}" = "$account_id"
test "$(aws sts get-caller-identity --region "$region" --query Account --output text)" = "$account_id"
replay_status=0
emit_revoked_bootstrap_replay_if_complete || replay_status=$?
case "$replay_status" in
  0) exit 0 ;;
  10) ;;
  *) exit "$replay_status" ;;
esac
bootstrap_cleanup_armed=true
# A prior accepted-but-unobserved RunTask can outlive source/network changes. Spend the full ECS
# visibility window before any image or secret work, then remove every exact-prefix ACTIVE revision.
# Fresh-state floor: 61 observations at 5s plus three definition reads at 2s (~304s).
stop_bootstrap_tasks_and_prove_absent true
retire_bootstrap_task_definitions
git fetch --quiet origin main --force
git cat-file -e "${source_sha}^{commit}"
git merge-base --is-ancestor "$source_sha" origin/main
command -v cosign >/dev/null 2>&1
docker_config="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-bootstrap-docker.XXXXXX")"
aws ecr get-login-password --region "$region" \
  | DOCKER_CONFIG="$docker_config" docker login --username AWS --password-stdin \
      "$account_id.dkr.ecr.$region.amazonaws.com" >/dev/null
DOCKER_CONFIG="$docker_config" cosign verify \
  --certificate-identity "https://github.com/MangmeeDev/mangmeeplus/.github/workflows/ci.yml@refs/heads/main" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com "$image" >/dev/null
DOCKER_CONFIG="$docker_config" docker pull --platform linux/amd64 "$image" >/dev/null
DOCKER_CONFIG="$docker_config" bash "$(dirname "$0")/verify-production-a5-migration-tool.sh" \
  "$image" "$source_sha" >/dev/null
digest="${image##*@}"
aws ecr describe-images --region "$region" --repository-name watchdog-bms-migration-tool \
  --image-ids "imageDigest=$digest" --output json | jq -e --arg digest "$digest" '
    (.imageDetails|length)==1 and .imageDetails[0].imageDigest==$digest
' >/dev/null

# Re-read the normal-path tuple after image verification. Completion/revocation recovery was already
# handled before image access; an execution role disappearing now is unsafe state drift, not success.
existing_reader=''
if existing_reader="$(aws secretsmanager describe-secret --region "$region" \
    --secret-id "$reader_name" --output json 2>&1)"; then
  jq -e --arg name "$reader_name" --arg description "$reader_description" '
    .Name==$name and .Description==$description and .DeletedDate==null
  ' <<< "$existing_reader" >/dev/null
  reader_version="$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
    | select(length==1)|.[0]|select(test("^[A-Fa-f0-9-]{32,64}$"))' <<< "$existing_reader")"
  execution_lookup=''
  if execution_lookup="$(aws iam get-role --role-name "$bootstrap_execution_role_name" 2>&1)"; then
    # A runner/process loss can leave the secret and execution authority before the data-plane task
    # proves the role/password. Continue through the same idempotent hardening task below.
    assert_exact_bootstrap_role "$execution_lookup" "$bootstrap_execution_role_name" \
      "$bootstrap_execution_trust" "$bootstrap_execution_policy"
  else
    echo 'ERROR: bootstrap execution role changed after pre-image state classification' >&2
    printf '%s\n' "$execution_lookup" >&2
    exit 1
  fi
elif ! grep -F ResourceNotFoundException <<< "$existing_reader" >/dev/null; then
  printf '%s\n' "$existing_reader" >&2
  exit 1
fi

parameter() {
  aws ssm get-parameter --region "$region" --name "$parameter_prefix/$1" \
    --query Parameter.Value --output text
}
network_parameter() {
  aws ssm get-parameter --region "$region" --name "/watchdog-bms/production/a5-network/$1" \
    --query Parameter.Value --output text
}
db_identifier="$(parameter db-instance-identifier)"
db_security_group="$(parameter db-security-group-id)"
task_security_group="$(parameter task-security-group-id)"
task_subnet_csv="$(parameter task-subnet-ids)"
execution_role="$(parameter bootstrap-execution-role-arn)"
log_group="$(parameter bootstrap-log-group-name)"
endpoint_security_group="$(network_parameter endpoint-security-group-id)"
s3_prefix_list="$(network_parameter s3-prefix-list-id)"
test "$(network_parameter reader-task-security-group-id)" = "$task_security_group"
test "$(network_parameter production-db-security-group-id)" = "$db_security_group"
test "$db_identifier" = watchdog-bms-prod-db
test "$execution_role" = arn:aws:iam::311414082667:role/watchdog-bms-production-a5-bootstrap-execution
test "$log_group" = /ecs/watchdog-bms-production-a5-bootstrap
[[ "$db_security_group" =~ ^sg-[0-9a-f]{8,17}$ && "$task_security_group" =~ ^sg-[0-9a-f]{8,17}$ ]]
IFS=, read -r -a task_subnets <<< "$task_subnet_csv"
[ "${#task_subnets[@]}" -eq 2 ]
for subnet in "${task_subnets[@]}"; do [[ "$subnet" =~ ^subnet-[0-9a-f]{8,17}$ ]]; done

network_work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-bootstrap-network.XXXXXX")"
aws ec2 describe-security-groups --region "$region" --group-ids "$task_security_group" \
  --output json > "$network_work/task.json"
aws ec2 describe-security-groups --region "$region" --group-ids "$db_security_group" \
  --output json > "$network_work/database.json"
bash "$(dirname "$0")/validate-production-a5-readonly-security-groups.sh" \
  "$network_work/task.json" "$network_work/database.json" "$task_security_group" "$db_security_group" \
  "$endpoint_security_group" "$s3_prefix_list" exact
aws ec2 describe-subnets --region "$region" --subnet-ids "${task_subnets[@]}" --output json \
  | jq -e --argjson expected "$(printf '%s\n' "${task_subnets[@]}" | jq -R . | jq -sS .)" '
      (.Subnets|length)==2 and all(.Subnets[];.State=="available" and .MapPublicIpOnLaunch==false)
      and ([.Subnets[].SubnetId]|sort)==$expected
    ' >/dev/null
rm -rf -- "$network_work"

database="$(aws rds describe-db-instances --region "$region" --db-instance-identifier "$db_identifier" \
  --query 'DBInstances[0]' --output json)"
jq -e --arg id "$db_identifier" --arg sg "$db_security_group" '
  .DBInstanceIdentifier==$id and .Engine=="postgres" and .DBInstanceStatus=="available"
  and .PubliclyAccessible==false and .StorageEncrypted==true
  and ([.VpcSecurityGroups[]|select(.Status=="active")|.VpcSecurityGroupId])==[$sg]
  and (.Endpoint.Address|type=="string" and length>0) and (.Endpoint.Port|type=="number")
  and (.DBName|type=="string" and length>0)
' <<< "$database" >/dev/null
db_host="$(jq -er '.Endpoint.Address' <<< "$database")"
db_port="$(jq -er '.Endpoint.Port' <<< "$database")"
db_name="$(jq -er '.DBName' <<< "$database")"

writer_metadata="$(aws secretsmanager describe-secret --region "$region" --secret-id "$writer_name" --output json)"
writer_arn="$(jq -er '.ARN|select(test("^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-"))' <<< "$writer_metadata")"
writer_version="$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  | select(length==1)|.[0]|select(test("^[A-Fa-f0-9-]{32,64}$"))' <<< "$writer_metadata")"

reader_status=0
reader_metadata="$(aws secretsmanager describe-secret --region "$region" --secret-id "$reader_name" \
  --output json 2>&1)" || reader_status=$?
if [ "$reader_status" -ne 0 ]; then
  grep -F ResourceNotFoundException <<< "$reader_metadata" >/dev/null
  reader_password="$(openssl rand -base64 48 | tr -d '\n')"
  reader_url="$(READER_PASSWORD="$reader_password" DB_HOST="$db_host" DB_PORT="$db_port" DB_NAME="$db_name" node -e '
    const url = new URL("postgresql://placeholder/placeholder");
    url.username = "watchdog_a5_prod_ro";
    url.password = process.env.READER_PASSWORD || "";
    url.hostname = process.env.DB_HOST || "";
    url.port = process.env.DB_PORT || "5432";
    url.pathname = `/${encodeURIComponent(process.env.DB_NAME || "")}`;
    url.searchParams.set("schema", "public");
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set("sslrootcert", "/etc/ssl/certs/aws-rds-global-bundle.pem");
    process.stdout.write(url.toString());
  ')"
  secret_file="$(mktemp "${TMPDIR:-/tmp}/production-a5-reader-secret.XXXXXX")"
  chmod 600 "$secret_file"
  printf '%s' "$reader_url" > "$secret_file"
  reader_arn="$(aws secretsmanager create-secret --region "$region" --name "$reader_name" \
    --description "$reader_description" --secret-string "file://$secret_file" \
    --tags Key=purpose,Value=production-a5-readonly --query ARN --output text)"
  rm -f -- "$secret_file"
  secret_file=''
  unset reader_url reader_password
  reader_metadata="$(aws secretsmanager describe-secret --region "$region" --secret-id "$reader_name" --output json)"
else
  jq -e --arg name "$reader_name" --arg description "$reader_description" '
    .Name==$name and .Description==$description and .DeletedDate==null
  ' <<< "$reader_metadata" >/dev/null
  reader_arn="$(jq -er '.ARN' <<< "$reader_metadata")"
fi
[[ "$reader_arn" =~ ^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url- ]]
reader_version="$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  | select(length==1)|.[0]|select(test("^[A-Fa-f0-9-]{32,64}$"))' <<< "$reader_metadata")"

task_definition="$(mktemp "${TMPDIR:-/tmp}/production-a5-bootstrap-task.XXXXXX")"
jq -cnS --arg family "$family" --arg execution "$execution_role" --arg image "$image" \
  --arg writer "${writer_arn}:::${writer_version}" --arg reader "${reader_arn}:::${reader_version}" \
  --arg source "$source_sha" --arg profile "$schema_profile" --arg region "$region" \
  --arg logGroup "$log_group" '
  {family:$family,executionRoleArn:$execution,networkMode:"awsvpc",requiresCompatibilities:["FARGATE"],
   cpu:"1024",memory:"2048",runtimePlatform:{cpuArchitecture:"X86_64",operatingSystemFamily:"LINUX"},
   volumes:[{name:"tmp"}],containerDefinitions:[{
     name:"bootstrap",image:$image,essential:true,readonlyRootFilesystem:true,user:"node",
     workingDirectory:"/app",command:["/app/node_modules/.bin/tsx","--tsconfig",
       "/app/apps/api/tsconfig.json","/app/apps/api/prisma/bootstrap-a5-readonly.ts"],
     environment:[{name:"DEPLOY_ENV",value:"production"},{name:"A5_TARGET_ENVIRONMENT",value:"production"},
       {name:"A5_SCHEMA_PROFILE",value:$profile},{name:"GIT_SHA",value:$source},
       {name:"HOME",value:"/tmp"},{name:"TMPDIR",value:"/tmp"}],
     secrets:[{name:"DATABASE_URL",valueFrom:$writer},{name:"A5_READONLY_DATABASE_URL",valueFrom:$reader}],
     mountPoints:[{sourceVolume:"tmp",containerPath:"/tmp",readOnly:false}],portMappings:[],
     linuxParameters:{initProcessEnabled:true},stopTimeout:120,
     logConfiguration:{logDriver:"awslogs",options:{"awslogs-group":$logGroup,
       "awslogs-region":$region,"awslogs-stream-prefix":"production-a5"}}
   }]}
' > "$task_definition"
task_definition_arn="$(AWS_BIN=aws \
  bash "$(dirname "$0")/../prod-ecs-express/register-task-definition-with-retry.sh" \
    "$task_definition" "$region")"
registered="$(aws ecs describe-task-definition --region "$region" \
  --task-definition "$task_definition_arn" --include TAGS --output json)"
rm -f -- "$task_definition"
jq -e --arg execution "$execution_role" --arg image "$image" --arg writerVersion "$writer_version" \
  --arg readerVersion "$reader_version" '
  .taskDefinition.executionRoleArn==$execution and .taskDefinition.taskRoleArn==null
  and (.taskDefinition.containerDefinitions|length)==1
  and .taskDefinition.containerDefinitions[0].image==$image
  and (.taskDefinition.containerDefinitions[0].secrets|length)==2
  and all(.taskDefinition.containerDefinitions[0].secrets[]; . as $secret
    | $secret.valueFrom|endswith(":::"+(if $secret.name=="DATABASE_URL" then $writerVersion else $readerVersion end)))
' <<< "$registered" >/dev/null

network="$(jq -cn --arg subnets "$task_subnet_csv" --arg sg "$task_security_group" '
  {awsvpcConfiguration:{subnets:($subnets|split(",")|sort),securityGroups:[$sg],assignPublicIp:"DISABLED"}}
')"
task_revision="${task_definition_arn##*:}"
[[ "$task_revision" =~ ^[1-9][0-9]*$ ]]
run_client_token="${started_by}-r${task_revision}"
[ "${#run_client_token}" -le 64 ]
run_task_requested=true
run="$(AWS_BIN=aws bash "$(dirname "$0")/../prod-ecs-express/run-task-idempotently.sh" \
  "$run_client_token" -- ecs run-task --region "$region" --cluster "$cluster" --launch-type FARGATE \
    --platform-version 1.4.0 --task-definition "$task_definition_arn" \
    --network-configuration "$network" --started-by "$started_by" \
    --output json)"
jq -e '.failures==[] and (.tasks|length)==1' <<< "$run" >/dev/null
task_arn="$(jq -er '.tasks[0].taskArn' <<< "$run")"
jq -e --arg arn "$task_arn" --arg definition "$task_definition_arn" \
  --arg started "$started_by" --arg group "family:${family}" '
    .tasks[0].taskArn==$arn and .tasks[0].taskDefinitionArn==$definition
    and .tasks[0].startedBy==$started and .tasks[0].group==$group
  ' <<< "$run" >/dev/null
aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" --tasks "$task_arn"
task="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$task_arn" --output json)"
jq -e --arg definition "$task_definition_arn" --arg started "$started_by" '
  .failures==[] and (.tasks|length)==1 and .tasks[0].lastStatus=="STOPPED"
  and .tasks[0].taskDefinitionArn==$definition
  and .tasks[0].startedBy==$started and .tasks[0].desiredStatus=="STOPPED"
  and (.tasks[0].group|startswith("family:watchdog-a5-production-bootstrap-"))
  and (.tasks[0].containers|length)==1 and .tasks[0].containers[0].exitCode==0
' <<< "$task" >/dev/null

# The AWSCURRENT version used by the task must still be the sole current version after hardening.
reader_after="$(aws secretsmanager describe-secret --region "$region" --secret-id "$reader_name" --output json)"
reader_version_after="$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  | select(length==1)|.[0]' <<< "$reader_after")"
test "$reader_version_after" = "$reader_version"
completed_task_definition_arn="$task_definition_arn"
completed_task_arn="$task_arn"
stop_bootstrap_tasks_and_prove_absent false
retire_bootstrap_task_definitions
task_arn=''
task_definition_arn=''
completed=true
remove_bootstrap_execution_authority
printf '{"artifact":"production-a5-reader-bootstrap","state":"CREATED","readerRole":"watchdog_a5_prod_ro","readerSecretVersionId":"%s","taskDefinitionArn":"%s","taskArn":"%s"}\n' \
  "$reader_version" "$completed_task_definition_arn" "$completed_task_arn"
