#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
script="$repo_root/infra/uat/redis-blue-green.sh"
policy="$repo_root/infra/uat/redis-blue-green-operator-policy.template.json"
deploy="$repo_root/infra/prod-ecs-express/deploy.sh"
deploy_wrapper="$repo_root/infra/uat/deploy-with-runtime-mutex.sh"
mutex_lib="$repo_root/infra/uat/lib-runtime-mutex.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-redis-blue-green-spec.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_STATE:?}"
command="$1/$2"
shift 2
printf '%s %s\n' "$command" "$*" >> "${FAKE_CALL_LOG:?}"

arg() {
  local wanted="$1" previous='' value
  shift
  for value in "$@"; do
    [ "$previous" = "$wanted" ] && { printf '%s' "$value"; return; }
    previous="$value"
  done
}

save() { local next="$1"; printf '%s\n' "$next" > "$state"; }

case "$command" in
  sts/get-caller-identity) printf '%s\n' "${FAKE_ACCOUNT:-311414082667}" ;;
  secretsmanager/describe-secret)
    printf '%s\n' 'arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/redis-url-abc123'
    ;;
  ssm/put-parameter)
    [ "$(jq -r '.lock' "$state")" = false ] || exit 254
    value="$(arg --value "$@")"
    save "$(jq --arg value "$value" '.lock=true | .lockValue=$value' "$state")"
    ;;
  ssm/delete-parameter) save "$(jq '.lock=false | .lockValue=""' "$state")" ;;
  ssm/get-parameter)
    name="$(arg --name "$@")"
    if [ "$name" = /watchdog-bms/uat/redis-migration-lock ]; then
      [ "$(jq -r '.lock' "$state")" = true ] || exit 254
      jq -r '.lockValue' "$state"
    else
      component="${name#*/ecs-express-}"; component="${component%-service-arn}"
      printf 'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-uat/watchdog-bms-uat-%s\n' "$component"
    fi
    ;;
  ecs/describe-express-gateway-service)
    cap="${FAKE_CAPACITY:-0}"
    jq -cn --argjson cap "$cap" '{service:{status:{statusCode:"ACTIVE"},activeConfigurations:[{scalingTarget:{minTaskCount:$cap,maxTaskCount:$cap}}]}}'
    ;;
  ecs/list-tasks) printf '%s\n' "${FAKE_TASKS:-0}" ;;
  elasticache/describe-cache-clusters)
    jq -cn '{CacheClusters:[{CacheClusterId:"watchdog-bms-uat-redis",CacheClusterStatus:"available",
      CacheSubnetGroupName:"watchdog-bms-uat-redis-subnets",SecurityGroups:[{SecurityGroupId:"sg-redis"}],
      CacheNodes:[{CacheNodeId:"0001",Endpoint:{Address:"legacy.cache.local",Port:6379}}]}]}'
    ;;
  elasticache/describe-cache-parameters)
    jq -cn '{Parameters:[{ParameterName:"maxmemory-policy",ParameterValue:"noeviction"}]}'
    ;;
  elasticache/describe-replication-groups)
    if [ "${FAKE_CANDIDATE_ERROR:-false}" = true ]; then
      echo 'AccessDenied: no describe permission' >&2
      exit 254
    fi
    if [ "$(jq -r '.candidate' "$state")" = true ]; then
      status="$(jq -r '.candidateStatus' "$state")"
      jq -cn --arg status "$status" '{ReplicationGroups:[{ReplicationGroupId:"watchdog-bms-uat-redis-v2",
        Status:$status,AtRestEncryptionEnabled:true,TransitEncryptionEnabled:true,AuthTokenEnabled:true,
        MemberClusters:["watchdog-bms-uat-redis-v2-001"],NodeGroups:[{PrimaryEndpoint:{Address:"v2.cache.local",Port:6379}}]}]}'
    else
      echo 'ReplicationGroupNotFoundFault: missing' >&2
      exit 254
    fi
    ;;
  elasticache/create-replication-group)
    file="$(arg --cli-input-json "$@")"; file="${file#file://}"
    jq -e '
      .ReplicationGroupId == "watchdog-bms-uat-redis-v2"
      and .AtRestEncryptionEnabled == true and .TransitEncryptionEnabled == true
      and (.AuthToken | type == "string" and length >= 32)
      and .NumCacheClusters == 1 and .CacheParameterGroupName == "watchdog-bms-uat-redis7"
      and .Tags == [{Key:"Environment",Value:"uat"},{Key:"Component",Value:"redis"},{Key:"ManagedBy",Value:"mangmeeplus-infra"}]
    ' "$file" >/dev/null
    save "$(jq '.candidate=true | .candidateStatus="available"' "$state")"
    ;;
  elasticache/wait)
    save "$(jq '.candidateStatus="available"' "$state")"
    ;;
  secretsmanager/list-secret-version-ids)
    jq '{Versions:[.versions | to_entries[] | {VersionId:.key,VersionStages:.value.stages}]}' "$state"
    ;;
  secretsmanager/get-secret-value)
    version="$(arg --version-id "$@")"
    jq -er --arg version "$version" '.versions[$version].value' "$state"
    ;;
  secretsmanager/put-secret-value)
    file="$(arg --secret-string "$@")"; file="${file#file://}"; stage="$(arg --version-stages "$@")"
    version="v$(( $(jq '.versions | length' "$state") + 1 ))"
    value="$(<"$file")"
    next="$(jq --arg version "$version" --arg value "$value" --arg stage "$stage" \
      '.versions[$version]={value:$value,stages:[$stage]}' "$state")"
    save "$next"; printf '%s\n' "$version"
    ;;
  secretsmanager/update-secret-version-stage)
    stage="$(arg --version-stage "$@")"; move="$(arg --move-to-version-id "$@")"; remove="$(arg --remove-from-version-id "$@")"
    next="$(jq --arg stage "$stage" --arg move "$move" --arg remove "$remove" '
      if $stage == "AWSCURRENT" and $move != "" then
        ([.versions | to_entries[] | select(.value.stages | index("AWSCURRENT")) | .key][0]) as $old
        | .versions |= with_entries(.value.stages -= ["AWSCURRENT","AWSPREVIOUS"])
        | .versions[$old].stages += ["AWSPREVIOUS"]
        | .versions[$move].stages += ["AWSCURRENT"]
      else
        (if $remove != "" then .versions[$remove].stages -= [$stage] else . end)
        | (if $move != "" then
            .versions |= with_entries(.value.stages -= [$stage])
            | .versions[$move].stages += [$stage]
          else . end)
      end
      | .versions |= with_entries(.value.stages |= unique)
    ' "$state")"
    save "$next"
    ;;
  *) echo "unexpected fake AWS call: $command $*" >&2; exit 9 ;;
esac
EOF
chmod +x "$tmp_dir/aws"

reset_state() {
  cat > "$tmp_dir/state.json" <<'JSON'
{"lock":false,"lockValue":"","candidate":false,"candidateStatus":"missing","versions":{"v1":{"value":"redis://legacy.cache.local:6379","stages":["AWSCURRENT"]}}}
JSON
  : > "$tmp_dir/calls.log"
}

run_mode() {
  local selected="$1"
  shift
  env AWS_BIN="$tmp_dir/aws" AWS_REGION=ap-southeast-1 FAKE_STATE="$tmp_dir/state.json" \
    FAKE_CALL_LOG="$tmp_dir/calls.log" "$@" bash "$script" "$selected"
}

# The deploy caller exposes REGION, while the Redis caller historically exposed region. The
# shared mutex must own its AWS region and must work with the lowercase caller variable absent.
reset_state
(
  unset region
  export AWS_REGION=ap-southeast-1 AWS_BIN="$tmp_dir/aws" \
    FAKE_STATE="$tmp_dir/state.json" FAKE_CALL_LOG="$tmp_dir/calls.log"
  aws_cmd() { "$AWS_BIN" "$@"; }
  . "$mutex_lib"
  uat_runtime_mutex_acquire runtime-spec
  uat_runtime_mutex_release
)
jq -e '.lock == false and .lockValue == ""' "$tmp_dir/state.json" >/dev/null

reset_state
prepare_output="$(run_mode prepare CONFIRM_UAT_REDIS_PREPARE=CREATE_ENCRYPTED_CANDIDATE)"
jq -e '.state=="prepared" and .secretArnPreserved==true and .runtimeChanged==false' <<< "$prepare_output" >/dev/null
jq -e '
  .candidate == true and .candidateStatus == "available"
  and ([.versions[] | select(.stages | index("AWSCURRENT")) | .value] == ["redis://legacy.cache.local:6379"])
  and ([.versions[] | select(.stages | index("AWSPENDING")) | .value][0] | startswith("rediss://:"))
  and ([.versions[] | select(.stages | index("UATREDISPREPARE"))] | length) == 0
  and .lock == false
' "$tmp_dir/state.json" >/dev/null
! grep -Fq 'rediss://' <<< "$prepare_output"
! grep -Eq '[A-Za-z0-9]{32,}' <<< "$prepare_output"

cutover_output="$(run_mode cutover CONFIRM_UAT_REDIS_CUTOVER=MOVE_CURRENT_TO_ENCRYPTED_V2)"
jq -e '.state=="cutover" and .secretArnPreserved==true' <<< "$cutover_output" >/dev/null
jq -e '
  ([.versions[] | select(.stages | index("AWSCURRENT")) | .value][0] | startswith("rediss://:"))
  and ([.versions[] | select(.stages | index("AWSPREVIOUS")) | .value] == ["redis://legacy.cache.local:6379"])
  and ([.versions[] | select(.stages | index("AWSPENDING"))] | length) == 0
' "$tmp_dir/state.json" >/dev/null

rollback_output="$(run_mode rollback CONFIRM_UAT_REDIS_ROLLBACK=RESTORE_LEGACY_CURRENT)"
jq -e '.state=="rolled_back" and .secretArnPreserved==true' <<< "$rollback_output" >/dev/null
jq -e '([.versions[] | select(.stages | index("AWSCURRENT")) | .value] == ["redis://legacy.cache.local:6379"])' \
  "$tmp_dir/state.json" >/dev/null

# Re-prepare after rollback reuses the existing encrypted URL version; no auth token is regenerated.
versions_before="$(jq '.versions | length' "$tmp_dir/state.json")"
run_mode prepare CONFIRM_UAT_REDIS_PREPARE=CREATE_ENCRYPTED_CANDIDATE >/dev/null
test "$(jq '.versions | length' "$tmp_dir/state.json")" -eq "$versions_before"
jq -e '([.versions[] | select(.stages | index("AWSPENDING"))] | length) == 1' "$tmp_dir/state.json" >/dev/null

# Interrupted prepare keeps the token stage and resumes an in-flight candidate without another create.
reset_state
jq '.candidate=true | .candidateStatus="creating"
  | .versions.v2={value:"{\"kind\":\"uat-redis-v2-prepare\",\"authToken\":\"abcdefghijklmnopqrstuvwxyzABCDEF\"}",stages:["UATREDISPREPARE"]}' \
  "$tmp_dir/state.json" > "$tmp_dir/interrupted.json"
mv "$tmp_dir/interrupted.json" "$tmp_dir/state.json"
run_mode prepare CONFIRM_UAT_REDIS_PREPARE=CREATE_ENCRYPTED_CANDIDATE >/dev/null
! grep -Fq 'elasticache/create-replication-group' "$tmp_dir/calls.log"
jq -e '.candidateStatus=="available" and ([.versions[] | select(.stages | index("AWSPENDING"))] | length)==1' \
  "$tmp_dir/state.json" >/dev/null

# Capacity/task gates fail before ElastiCache or secret-version mutation.
reset_state
if run_mode prepare FAKE_CAPACITY=1 CONFIRM_UAT_REDIS_PREPARE=CREATE_ENCRYPTED_CANDIDATE >/dev/null 2>&1; then
  echo 'ERROR: accepted non-zero UAT capacity' >&2; exit 1
fi
! grep -Eq 'elasticache/create-replication-group|secretsmanager/put-secret-value|secretsmanager/update-secret-version-stage' \
  "$tmp_dir/calls.log"
reset_state
if run_mode prepare FAKE_TASKS=1 CONFIRM_UAT_REDIS_PREPARE=CREATE_ENCRYPTED_CANDIDATE >/dev/null 2>&1; then
  echo 'ERROR: accepted active UAT tasks' >&2; exit 1
fi

# Wrong account fails before a lock or data-plane mutation.
reset_state
if run_mode prepare FAKE_ACCOUNT=999999999999 CONFIRM_UAT_REDIS_PREPARE=CREATE_ENCRYPTED_CANDIDATE >/dev/null 2>&1; then
  echo 'ERROR: accepted the wrong AWS account' >&2; exit 1
fi
! grep -Fq 'ssm/put-parameter' "$tmp_dir/calls.log"

# Describe denial is not equivalent to a missing candidate and must not reach token/create writes.
reset_state
if run_mode prepare FAKE_CANDIDATE_ERROR=true CONFIRM_UAT_REDIS_PREPARE=CREATE_ENCRYPTED_CANDIDATE \
  >/dev/null 2>&1; then
  echo 'ERROR: treated candidate describe denial as a missing cache' >&2; exit 1
fi
! grep -Eq 'elasticache/create-replication-group|secretsmanager/put-secret-value|secretsmanager/update-secret-version-stage' \
  "$tmp_dir/calls.log"

# The shared no-overwrite mutex rejects migration while deploy owns it, before data-plane writes.
reset_state
jq '.lock=true | .lockValue="deploy-all:20260815T000000Z:123"' "$tmp_dir/state.json" > "$tmp_dir/locked.json"
mv "$tmp_dir/locked.json" "$tmp_dir/state.json"
if run_mode prepare CONFIRM_UAT_REDIS_PREPARE=CREATE_ENCRYPTED_CANDIDATE >/dev/null 2>&1; then
  echo 'ERROR: accepted migration while deploy held the UAT runtime mutex' >&2; exit 1
fi
! grep -Eq 'elasticache/create-replication-group|secretsmanager/put-secret-value|secretsmanager/update-secret-version-stage' \
  "$tmp_dir/calls.log"

# Least privilege and rollout interlock stay explicit.
jq -e '
  any(.Statement[]; .Sid=="VersionOnlyUatRedisSecret"
    and (.Action | index("secretsmanager:UpdateSecretVersionStage"))
    and (.Resource | contains("watchdog-bms/uat/redis-url-")))
  and any(.Statement[]; .Sid=="CreateOnlyEncryptedUatRedisV2"
    and .Action=="elasticache:CreateReplicationGroup"
    and .Condition.Bool["elasticache:AtRestEncryptionEnabled"]=="true"
    and .Condition.Bool["elasticache:TransitEncryptionEnabled"]=="true"
    and .Condition.Bool["elasticache:AuthTokenEnabled"]=="true"
    and .Condition.StringEquals["elasticache:CacheNodeType"]=="cache.t4g.micro"
    and (.Resource | index("arn:aws:elasticache:ap-southeast-1:<ACCOUNT_ID>:replicationgroup:watchdog-bms-uat-redis-v2")))
  and ([.Statement[].Action] | tostring | contains("DeleteReplicationGroup") | not)
  and ([.Statement[].Action] | tostring | contains("DeleteCacheCluster") | not)
' "$policy" >/dev/null
deploy_policy="$repo_root/infra/uat/github-deploy-role-policy.template.json"
jq -e 'any(.Statement[]; .Sid=="ReleaseUatRedisMigrationMutex"
  and .Action=="ssm:DeleteParameter"
  and (.Resource | endswith("parameter/watchdog-bms/uat/redis-migration-lock")))' "$deploy_policy" >/dev/null
grep -Fq '. infra/uat/lib-runtime-mutex.sh' "$deploy"
grep -Fq 'uat_runtime_mutex_acquire "deploy-${TARGET}"' "$deploy"
grep -Fq 'UAT Redis migration/deploy mutex is active or cannot be acquired' "$deploy"
grep -Fq 'exec bash infra/prod-ecs-express/deploy.sh "${1:-all}"' "$deploy_wrapper"
if grep -Eq 'lib-runtime-mutex|uat_runtime_mutex_acquire' "$deploy_wrapper"; then
  echo 'ERROR: compatibility wrapper attempts to own the mutex a second time' >&2; exit 1
fi

echo 'redis-blue-green.spec.sh: ok'
