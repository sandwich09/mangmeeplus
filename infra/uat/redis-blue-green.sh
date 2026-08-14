#!/usr/bin/env bash
# Reversible migration from the legacy standalone UAT Redis node to encrypted v2.
set -euo pipefail

mode="${1:-}"
case "$mode" in
  prepare|cutover|rollback) ;;
  *) echo "Usage: $0 <prepare|cutover|rollback>" >&2; exit 2 ;;
esac

region="${AWS_REGION:-ap-southeast-1}"
aws_bin="${AWS_BIN:-aws}"
expected_account="${EXPECTED_AWS_ACCOUNT_ID:-311414082667}"
cluster="watchdog-bms-uat"
prefix="watchdog-bms-uat"
legacy_id="${prefix}-redis"
candidate_id="${prefix}-redis-v2"
parameter_group="${prefix}-redis7"
secret_id="watchdog-bms/uat/redis-url"
prepare_stage="UATREDISPREPARE"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-uat-redis.XXXXXX")"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

# shellcheck source=infra/uat/lib-runtime-mutex.sh
. "$(cd "$(dirname "$0")" && pwd)/lib-runtime-mutex.sh"

fail() { echo "ERROR: $1" >&2; exit 1; }

release_lock() {
  uat_runtime_mutex_release
  rm -rf "$tmp_dir"
}
trap release_lock EXIT

case "$mode" in
  prepare) [ "${CONFIRM_UAT_REDIS_PREPARE:-}" = "CREATE_ENCRYPTED_CANDIDATE" ] \
    || fail 'set CONFIRM_UAT_REDIS_PREPARE=CREATE_ENCRYPTED_CANDIDATE' ;;
  cutover) [ "${CONFIRM_UAT_REDIS_CUTOVER:-}" = "MOVE_CURRENT_TO_ENCRYPTED_V2" ] \
    || fail 'set CONFIRM_UAT_REDIS_CUTOVER=MOVE_CURRENT_TO_ENCRYPTED_V2' ;;
  rollback) [ "${CONFIRM_UAT_REDIS_ROLLBACK:-}" = "RESTORE_LEGACY_CURRENT" ] \
    || fail 'set CONFIRM_UAT_REDIS_ROLLBACK=RESTORE_LEGACY_CURRENT' ;;
esac

account_id="$(aws_cmd sts get-caller-identity --query Account --output text --region "$region")"
[ "$account_id" = "$expected_account" ] || fail "unexpected AWS account $account_id"
[ "$region" = ap-southeast-1 ] || fail "unexpected AWS region $region"
secret_arn="$(aws_cmd secretsmanager describe-secret --secret-id "$secret_id" \
  --query ARN --output text --region "$region")"
[[ "$secret_arn" == arn:aws:secretsmanager:"${region}":"${account_id}":secret:"${secret_id}"-* ]] \
  || fail 'unexpected or missing UAT Redis secret ARN'

uat_runtime_mutex_acquire "redis-${mode}" \
  || fail 'another UAT Redis migration operation is active; reconcile the lock before continuing'

assert_parked() {
  local component service_name expected_arn arn state desired count
  for component in api-web ai-gateway workers; do
    service_name="${prefix}-${component}"
    expected_arn="arn:aws:ecs:${region}:${account_id}:service/${cluster}/${service_name}"
    arn="$(aws_cmd ssm get-parameter \
      --name "/watchdog-bms/uat/ecs-express-${component}-service-arn" \
      --query Parameter.Value --output text --region "$region")"
    [ "$arn" = "$expected_arn" ] || fail "unexpected ${component} service ARN"
    state="$(aws_cmd ecs describe-express-gateway-service --service-arn "$arn" --output json --region "$region")"
    jq -e '
      .service.status.statusCode == "ACTIVE"
      and (.service.activeConfigurations | length) == 1
      and .service.activeConfigurations[0].scalingTarget.minTaskCount == 0
      and .service.activeConfigurations[0].scalingTarget.maxTaskCount == 0
    ' <<< "$state" >/dev/null || fail "${component} is not parked at exact capacity 0/0"
    for desired in RUNNING PENDING; do
      count="$(aws_cmd ecs list-tasks --cluster "$cluster" --service-name "$service_name" \
        --desired-status "$desired" --query 'length(taskArns)' --output text --region "$region")"
      [ "$count" = 0 ] || fail "${component} still has ${count} ${desired} task(s)"
    done
  done
}

secret_versions=''
refresh_versions() {
  secret_versions="$(aws_cmd secretsmanager list-secret-version-ids --secret-id "$secret_id" \
    --include-deprecated --output json --region "$region")"
}

stage_version() {
  local stage="$1" count
  count="$(jq --arg stage "$stage" '[.Versions[]? | select(.VersionStages | index($stage))] | length' \
    <<< "$secret_versions")"
  [ "$count" -le 1 ] || fail "secret stage $stage is attached to multiple versions"
  jq -r --arg stage "$stage" '.Versions[]? | select(.VersionStages | index($stage)) | .VersionId' \
    <<< "$secret_versions"
}

secret_value_version() {
  aws_cmd secretsmanager get-secret-value --secret-id "$secret_id" --version-id "$1" \
    --query SecretString --output text --region "$region"
}

url_scheme() {
  case "$1" in redis://*) printf redis ;; rediss://*) printf rediss ;; *) printf invalid ;; esac
}

url_host() {
  local rest="${1#*://}"
  rest="${rest##*@}"
  printf '%s' "${rest%%:*}"
}

legacy_json() {
  aws_cmd elasticache describe-cache-clusters --cache-cluster-id "$legacy_id" \
    --show-cache-node-info --output json --region "$region"
}

legacy_host() {
  jq -er '
    .CacheClusters | select(length == 1) | .[0]
    | select(.CacheClusterStatus == "available" and (.ReplicationGroupId // "") == "")
    | .CacheNodes | select(length == 1) | .[0].Endpoint.Address
  ' <<< "$1" || fail 'legacy UAT Redis is missing, unavailable or no longer standalone'
}

candidate_json_or_empty() {
  local output_file="$tmp_dir/candidate.json" error_file="$tmp_dir/candidate.err"
  if aws_cmd elasticache describe-replication-groups --replication-group-id "$candidate_id" \
    --output json --region "$region" >"$output_file" 2>"$error_file"; then
    cat "$output_file"
  elif grep -q 'ReplicationGroupNotFound' "$error_file"; then
    printf '{"ReplicationGroups":[]}'
  else
    cat "$error_file" >&2
    fail 'cannot prove whether encrypted UAT Redis v2 exists'
  fi
}

candidate_host() {
  jq -er --arg id "$candidate_id" '
    .ReplicationGroups | select(length == 1) | .[0]
    | select(.ReplicationGroupId == $id and .Status == "available"
      and .AtRestEncryptionEnabled == true
      and .TransitEncryptionEnabled == true
      and .AuthTokenEnabled == true
      and (.MemberClusters | length) == 1)
    | .NodeGroups | select(length == 1) | .[0].PrimaryEndpoint.Address
  ' <<< "$1" || fail 'encrypted UAT Redis v2 failed topology/encryption/auth validation'
}

assert_noeviction() {
  local parameters
  parameters="$(aws_cmd elasticache describe-cache-parameters \
    --cache-parameter-group-name "$parameter_group" --output json --region "$region")"
  jq -e 'any(.Parameters[]?; .ParameterName == "maxmemory-policy" and .ParameterValue == "noeviction")' \
    <<< "$parameters" >/dev/null || fail "${parameter_group} is not noeviction"
}

assert_url_matches() {
  local version="$1" scheme="$2" host="$3" value
  [ -n "$version" ] || fail "missing secret version for expected ${scheme} endpoint"
  value="$(secret_value_version "$version")"
  [ "$(url_scheme "$value")" = "$scheme" ] || fail "secret version has unexpected Redis scheme"
  [ "$(url_host "$value")" = "$host" ] || fail "secret version points at an unexpected Redis endpoint"
  unset value
}

find_matching_version() {
  local scheme="$1" host="$2" version value found='' count=0
  while IFS= read -r version; do
    [ -n "$version" ] || continue
    value="$(secret_value_version "$version")"
    if [ "$(url_scheme "$value")" = "$scheme" ] && [ "$(url_host "$value")" = "$host" ]; then
      found="$version"
      count=$((count + 1))
    fi
  done < <(jq -r '.Versions[]?.VersionId' <<< "$secret_versions")
  unset value
  [ "$count" -eq 1 ] || fail "expected exactly one ${scheme} secret version for the requested endpoint, found $count"
  printf '%s' "$found"
}

prepare() {
  local old_json old_host candidate_json candidate_host_value current_id pending_id token_id token_json
  local redis_auth='' redis_host='' candidate_version subnet_group security_groups create_input candidate_file token_file
  assert_parked
  old_json="$(legacy_json)"
  old_host="$(legacy_host "$old_json")"
  assert_noeviction
  refresh_versions
  current_id="$(stage_version AWSCURRENT)"
  assert_url_matches "$current_id" redis "$old_host"
  pending_id="$(stage_version AWSPENDING)"
  token_id="$(stage_version "$prepare_stage")"
  candidate_json="$(candidate_json_or_empty)"

  if jq -e '.ReplicationGroups | length == 0' <<< "$candidate_json" >/dev/null; then
    [ -z "$pending_id" ] || fail 'AWSPENDING exists but encrypted Redis v2 does not'
    if [ -z "$token_id" ]; then
      redis_auth="$(openssl rand -base64 48 | tr -d '/@"+= ' | cut -c1-48)"
      [ "${#redis_auth}" -ge 32 ] || fail 'generated Redis auth token is too short'
      token_file="$tmp_dir/prepare-token.json"
      jq -cn --arg token "$redis_auth" '{kind:"uat-redis-v2-prepare",authToken:$token}' > "$token_file"
      chmod 600 "$token_file"
      token_id="$(aws_cmd secretsmanager put-secret-value --secret-id "$secret_id" \
        --secret-string "file://${token_file}" --version-stages "$prepare_stage" \
        --query VersionId --output text --region "$region")"
    else
      token_json="$(secret_value_version "$token_id")"
      redis_auth="$(jq -er 'select(.kind == "uat-redis-v2-prepare") | .authToken' <<< "$token_json")" \
        || fail 'temporary Redis prepare version has an unexpected shape'
      unset token_json
    fi
    subnet_group="$(jq -er '.CacheClusters[0].CacheSubnetGroupName' <<< "$old_json")"
    security_groups="$(jq -c '[.CacheClusters[0].SecurityGroups[].SecurityGroupId]' <<< "$old_json")"
    [ "$(jq 'length' <<< "$security_groups")" -ge 1 ] || fail 'legacy Redis has no security group to reuse'
    create_input="$tmp_dir/create-replication-group.json"
    jq -n \
      --arg id "$candidate_id" --arg pg "$parameter_group" --arg subnet "$subnet_group" \
      --arg token "$redis_auth" --argjson securityGroups "$security_groups" '{
        ReplicationGroupId:$id,
        ReplicationGroupDescription:"WatchDog BMS UAT Redis v2 encrypted",
        Engine:"redis", EngineVersion:"7.1", CacheNodeType:"cache.t4g.micro", NumCacheClusters:1,
        CacheParameterGroupName:$pg, CacheSubnetGroupName:$subnet, SecurityGroupIds:$securityGroups,
        AtRestEncryptionEnabled:true, TransitEncryptionEnabled:true, AuthToken:$token,
        Tags:[
          {Key:"Environment",Value:"uat"},
          {Key:"Component",Value:"redis"},
          {Key:"ManagedBy",Value:"mangmeeplus-infra"}
        ]
      }' > "$create_input"
    chmod 600 "$create_input"
    aws_cmd elasticache create-replication-group --cli-input-json "file://${create_input}" \
      --region "$region" >/dev/null
    aws_cmd elasticache wait replication-group-available --replication-group-id "$candidate_id" \
      --region "$region"
    candidate_json="$(candidate_json_or_empty)"
  fi

  if ! jq -e '.ReplicationGroups[0].Status == "available"' <<< "$candidate_json" >/dev/null; then
    case "$(jq -r '.ReplicationGroups[0].Status // "missing"' <<< "$candidate_json")" in
      creating|modifying)
        aws_cmd elasticache wait replication-group-available --replication-group-id "$candidate_id" \
          --region "$region"
        candidate_json="$(candidate_json_or_empty)"
        ;;
      *) fail 'encrypted UAT Redis v2 is in a non-resumable state' ;;
    esac
  fi
  candidate_host_value="$(candidate_host "$candidate_json")"
  assert_noeviction
  if [ -z "$pending_id" ]; then
    refresh_versions
    token_id="$(stage_version "$prepare_stage")"
    if [ -n "$token_id" ]; then
      token_json="$(secret_value_version "$token_id")"
      redis_auth="$(jq -er 'select(.kind == "uat-redis-v2-prepare") | .authToken' <<< "$token_json")" \
        || fail 'temporary Redis prepare version has an unexpected shape'
      candidate_file="$tmp_dir/candidate-url"
      printf 'rediss://:%s@%s:6379' "$redis_auth" "$candidate_host_value" > "$candidate_file"
      chmod 600 "$candidate_file"
      candidate_version="$(aws_cmd secretsmanager put-secret-value --secret-id "$secret_id" \
        --secret-string "file://${candidate_file}" --version-stages AWSPENDING \
        --query VersionId --output text --region "$region")"
      aws_cmd secretsmanager update-secret-version-stage --secret-id "$secret_id" \
        --version-stage "$prepare_stage" --remove-from-version-id "$token_id" --region "$region" >/dev/null
      pending_id="$candidate_version"
      unset redis_auth token_json
    else
      candidate_version="$(find_matching_version rediss "$candidate_host_value")"
      aws_cmd secretsmanager update-secret-version-stage --secret-id "$secret_id" \
        --version-stage AWSPENDING --move-to-version-id "$candidate_version" --region "$region" >/dev/null
      pending_id="$candidate_version"
    fi
  fi
  assert_url_matches "$pending_id" rediss "$candidate_host_value"
  assert_parked
  jq -cn --arg state prepared --arg group "$candidate_id" \
    '{state:$state,replicationGroupId:$group,secretArnPreserved:true,runtimeChanged:false}'
}

cutover() {
  local old_host_value candidate_host_value current_id pending_id previous_id current_value
  assert_parked
  old_host_value="$(legacy_host "$(legacy_json)")"
  candidate_host_value="$(candidate_host "$(candidate_json_or_empty)")"
  assert_noeviction
  refresh_versions
  current_id="$(stage_version AWSCURRENT)"
  pending_id="$(stage_version AWSPENDING)"
  previous_id="$(stage_version AWSPREVIOUS)"
  current_value="$(secret_value_version "$current_id")"
  if [ "$(url_scheme "$current_value")" = rediss ] && [ "$(url_host "$current_value")" = "$candidate_host_value" ]; then
    [ -z "$pending_id" ] || aws_cmd secretsmanager update-secret-version-stage --secret-id "$secret_id" \
      --version-stage AWSPENDING --remove-from-version-id "$pending_id" --region "$region" >/dev/null
  else
    assert_url_matches "$current_id" redis "$old_host_value"
    assert_url_matches "$pending_id" rediss "$candidate_host_value"
    aws_cmd secretsmanager update-secret-version-stage --secret-id "$secret_id" \
      --version-stage AWSCURRENT --move-to-version-id "$pending_id" \
      --remove-from-version-id "$current_id" --region "$region" >/dev/null
    aws_cmd secretsmanager update-secret-version-stage --secret-id "$secret_id" \
      --version-stage AWSPENDING --remove-from-version-id "$pending_id" --region "$region" >/dev/null
    previous_id="$current_id"
  fi
  unset current_value
  refresh_versions
  current_id="$(stage_version AWSCURRENT)"
  [ "$(stage_version AWSPREVIOUS)" = "$previous_id" ] || fail 'legacy version was not retained as AWSPREVIOUS'
  assert_url_matches "$current_id" rediss "$candidate_host_value"
  assert_parked
  jq -cn --arg state cutover --arg group "$candidate_id" \
    '{state:$state,replicationGroupId:$group,secretArnPreserved:true,runtimeChanged:false}'
}

rollback() {
  local old_host_value candidate_host_value current_id previous_id current_value
  assert_parked
  old_host_value="$(legacy_host "$(legacy_json)")"
  candidate_host_value="$(candidate_host "$(candidate_json_or_empty)")"
  refresh_versions
  current_id="$(stage_version AWSCURRENT)"
  previous_id="$(stage_version AWSPREVIOUS)"
  current_value="$(secret_value_version "$current_id")"
  if [ "$(url_scheme "$current_value")" = redis ] && [ "$(url_host "$current_value")" = "$old_host_value" ]; then
    : # idempotent: already rolled back
  else
    [ "$(url_scheme "$current_value")" = rediss ] \
      && [ "$(url_host "$current_value")" = "$candidate_host_value" ] \
      || fail 'AWSCURRENT is neither legacy nor encrypted v2'
    assert_url_matches "$previous_id" redis "$old_host_value"
    aws_cmd secretsmanager update-secret-version-stage --secret-id "$secret_id" \
      --version-stage AWSCURRENT --move-to-version-id "$previous_id" \
      --remove-from-version-id "$current_id" --region "$region" >/dev/null
  fi
  unset current_value
  refresh_versions
  current_id="$(stage_version AWSCURRENT)"
  assert_url_matches "$current_id" redis "$old_host_value"
  assert_parked
  jq -cn --arg state rolled_back --arg cache "$legacy_id" \
    '{state:$state,cacheClusterId:$cache,secretArnPreserved:true,runtimeChanged:false}'
}

"$mode"
