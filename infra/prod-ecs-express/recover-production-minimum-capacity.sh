#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  recover-production-minimum-capacity.sh plan <empty-output-directory>
  recover-production-minimum-capacity.sh apply <plan.json> <expected-plan-sha256> <empty-output-directory>
EOF
  exit 2
}

[ "$#" -ge 1 ] || usage
mode="$1"
shift
case "$mode" in
  plan) [ "$#" -eq 1 ] || usage ;;
  apply) [ "$#" -eq 3 ] || usage ;;
  *) usage ;;
esac

region="${AWS_REGION:-ap-southeast-1}"
account_id=311414082667
cluster=watchdog-bms-prod
aws_bin="${AWS_BIN:-aws}"
curl_bin="${CURL_BIN:-curl}"
stability_seconds="${RECOVERY_STABILITY_SECONDS:-2}"
poll_seconds="${RECOVERY_POLL_SECONDS:-10}"
poll_attempts="${RECOVERY_POLL_ATTEMPTS:-90}"

case "$stability_seconds:$poll_seconds:$poll_attempts" in
  *[!0-9:]*|*::*|:*) echo "ERROR: recovery timing values must be non-negative integers" >&2; exit 2 ;;
esac
[ "$poll_attempts" -gt 0 ] || { echo "ERROR: RECOVERY_POLL_ATTEMPTS must be positive" >&2; exit 2; }
[ "$region" = ap-southeast-1 ] || { echo "ERROR: production recovery is locked to ap-southeast-1" >&2; exit 2; }

umask 077

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

sha256_text() {
  local temporary result
  temporary="$(mktemp "${TMPDIR:-/tmp}/watchdog-capacity-sha.XXXXXX")"
  printf '%s' "$1" > "$temporary"
  result="$(sha256_file "$temporary")"
  rm -f -- "$temporary"
  printf '%s' "$result"
}

require_empty_directory() {
  local directory="$1"
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    || { echo "ERROR: output must be an existing non-symlink directory" >&2; exit 2; }
  [ -z "$(find "$directory" -mindepth 1 -maxdepth 1 -print -quit)" ] \
    || { echo "ERROR: output directory must be empty" >&2; exit 2; }
}

service_contract() {
  case "$1" in
    api-web)
      printf '%s\t%s\t%s\t%s\n' \
        'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub' \
        'watchdog-bms-api' '/watchdog-bms/production/ecs-express-api-web-url' '/v1/health'
      ;;
    ai-gateway)
      printf '%s\t%s\t%s\t%s\n' \
        'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-ai-gateway-v2' \
        'watchdog-bms-ai-gateway' '/watchdog-bms/production/ecs-express-ai-gateway-url' '/v1/health'
      ;;
    workers)
      printf '%s\t%s\t%s\t%s\n' \
        'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-workers' \
        'watchdog-bms-workers' '/watchdog-bms/production/ecs-express-workers-url' '/health'
      ;;
    *) return 2 ;;
  esac
}

read_service() {
  local arn="$1"
  aws_cmd ecs describe-express-gateway-service --service-arn "$arn" --region "$region" \
    --query 'service.{serviceArn:serviceArn,status:status.statusCode,currentDeployment:currentDeployment,activeConfigurations:activeConfigurations}' \
    --output json | jq -cS .
}

read_revision() {
  local revision="$1"
  aws_cmd ecs describe-service-revisions --service-revision-arns "$revision" --region "$region" \
    --query 'serviceRevisions[0].{serviceRevisionArn:serviceRevisionArn,serviceArn:serviceArn,clusterArn:clusterArn,taskDefinition:taskDefinition,launchType:launchType,platformVersion:platformVersion,platformFamily:platformFamily,guardDutyEnabled:guardDutyEnabled,networkConfiguration:networkConfiguration,serviceRegistries:serviceRegistries,loadBalancers:loadBalancers}' \
    --output json | jq -cS .
}

validate_service() {
  local name="$1" arn="$2" repository="$3" health_path="$4" document="$5"
  jq -e --arg arn "$arn" --arg account "$account_id" --arg region "$region" \
    --arg cluster "$cluster" --arg service_name "${arn##*/}" --arg repository "$repository" \
    --arg health_path "$health_path" '
    (keys | sort) == ["activeConfigurations","currentDeployment","serviceArn","status"]
    and .serviceArn == $arn and .status == "ACTIVE" and .currentDeployment == null
    and (.activeConfigurations | type == "array" and length == 1)
    and (.activeConfigurations[0] as $c
      | ($c | keys | sort) == ["cpu","createdAt","executionRoleArn","healthCheckPath","ingressPaths","memory","networkConfiguration","primaryContainer","scalingTarget","serviceRevisionArn","taskRoleArn"]
      and ($c.serviceRevisionArn | test("^arn:aws:ecs:"+$region+":"+$account+":service-revision/"+$cluster+"/"+$service_name+"/[0-9]+$"))
      and ($c.createdAt | type == "string" and length > 0)
      and ($c.executionRoleArn | test("^arn:aws:iam::"+$account+":role/[^/].*$"))
      and ($c.taskRoleArn | test("^arn:aws:iam::"+$account+":role/[^/].*$"))
      and ($c.cpu | test("^[0-9]+$")) and ($c.memory | test("^[0-9]+$"))
      and $c.healthCheckPath == $health_path
      and ($c.networkConfiguration | keys | sort) == ["securityGroups","subnets"]
      and ($c.networkConfiguration.securityGroups as $groups
        | ($groups|type) == "array" and ($groups|length) > 0
        and ($groups|unique|length) == ($groups|length))
      and ($c.networkConfiguration.subnets as $subnets
        | ($subnets|type) == "array" and ($subnets|length) > 0
        and ($subnets|unique|length) == ($subnets|length))
      and ($c.primaryContainer | keys | sort) == ["awsLogsConfiguration","containerPort","environment","image","secrets"]
      and ($c.primaryContainer.awsLogsConfiguration | keys | sort) == ["logGroup","logStreamPrefix"]
      and ($c.primaryContainer.awsLogsConfiguration.logGroup | type == "string" and length > 0)
      and ($c.primaryContainer.awsLogsConfiguration.logStreamPrefix | type == "string" and length > 0)
      and ($c.primaryContainer.image | test("^"+$account+"\\.dkr\\.ecr\\."+$region+"\\.amazonaws\\.com/"+$repository+"@sha256:[0-9a-f]{64}$"))
      and ($c.primaryContainer.containerPort | type == "number" and . > 0)
      and ($c.primaryContainer.environment as $environment
        | ($environment|type) == "array"
        and all($environment[]; (keys | sort) == ["name","value"]
          and (.name | type == "string" and length > 0) and (.value | type == "string"))
        and ($environment|map(.name)|length) == ($environment|map(.name)|unique|length))
      and ($c.primaryContainer.secrets as $secrets
        | ($secrets|type) == "array"
        and all($secrets[]; (keys | sort) == ["name","valueFrom"]
          and (.name | type == "string" and length > 0) and (.valueFrom | type == "string" and length > 0))
        and ($secrets|map(.name)|length) == ($secrets|map(.name)|unique|length))
      and ($c.scalingTarget | keys | sort) == ["autoScalingMetric","autoScalingTargetValue","maxTaskCount","minTaskCount"]
      and ($c.scalingTarget.minTaskCount | type == "number" and floor == .)
      and ($c.scalingTarget.maxTaskCount | type == "number" and floor == .)
      and ($c.scalingTarget.autoScalingTargetValue | type == "number" and floor == .)
      and ($c.scalingTarget.minTaskCount == 0 or $c.scalingTarget.minTaskCount == 1)
      and $c.scalingTarget.maxTaskCount == 2
      and $c.scalingTarget.autoScalingMetric == "AVERAGE_CPU"
      and $c.scalingTarget.autoScalingTargetValue == 70
      and $c.ingressPaths == [{accessType:"PUBLIC",endpoint:$c.ingressPaths[0].endpoint}]
      and ($c.ingressPaths[0] | keys | sort) == ["accessType","endpoint"]
      and ($c.ingressPaths[0].endpoint | test("^[a-z0-9-]+\\.ecs\\."+$region+"\\.on\\.aws$")))
  ' <<< "$document" >/dev/null \
    || { echo "ERROR: $name service configuration is outside the reviewed recovery contract" >&2; exit 1; }
}

validate_observed_service() {
  local name="$1" arn="$2" document="$3"
  jq -e --arg arn "$arn" --arg account "$account_id" --arg region "$region" \
    --arg cluster "$cluster" --arg service_name "${arn##*/}" '
    (keys | sort) == ["activeConfigurations","currentDeployment","serviceArn","status"]
    and .serviceArn == $arn and (.status | type == "string" and length > 0)
    and (.currentDeployment == null or
      (.currentDeployment | type == "string" and
       test("^arn:aws:ecs:"+$region+":"+$account+":service-deployment/"+$cluster+"/"+$service_name+"/[^/]+$")))
    and (.activeConfigurations | type == "array" and length <= 2)
    and (.activeConfigurations | map(.serviceRevisionArn) | unique | length) ==
        (.activeConfigurations | length)
    and all(.activeConfigurations[];
      (.serviceRevisionArn | type == "string" and
       test("^arn:aws:ecs:"+$region+":"+$account+":service-revision/"+$cluster+"/"+$service_name+"/[0-9]+$")))
  ' <<< "$document" >/dev/null \
    || { echo "ERROR: $name returned a contradictory recovery rollout state" >&2; exit 1; }
}

validate_revision() {
  local arn="$1" revision="$2" document="$3"
  jq -e --arg arn "$arn" --arg revision "$revision" --arg account "$account_id" \
    --arg region "$region" --arg cluster "$cluster" --arg service_name "${arn##*/}" '
    (keys | sort) == ["clusterArn","guardDutyEnabled","launchType","loadBalancers","networkConfiguration","platformFamily","platformVersion","serviceArn","serviceRegistries","serviceRevisionArn","taskDefinition"]
    and .serviceRevisionArn == $revision and .serviceArn == $arn
    and .clusterArn == ("arn:aws:ecs:"+$region+":"+$account+":cluster/"+$cluster)
    and (.taskDefinition | test("^arn:aws:ecs:"+$region+":"+$account+":task-definition/"+$cluster+"-"+$service_name+":[0-9]+$"))
    and .launchType == "FARGATE" and .platformVersion == "1.4.0" and .platformFamily == "Linux"
    and (.guardDutyEnabled | type == "boolean")
    and (.serviceRegistries | type == "array")
    and (.loadBalancers | type == "array" and length == 1)
    and (.loadBalancers[0].targetGroupArn | test("^arn:aws:elasticloadbalancing:"+$region+":"+$account+":targetgroup/"))
  ' <<< "$document" >/dev/null \
    || { echo "ERROR: service revision is outside the reviewed recovery contract: $revision" >&2; exit 1; }
}

validate_service_revision_binding() {
  local name="$1" service_document="$2" revision_document="$3"
  jq -e --argjson service "$service_document" '
    ($service.activeConfigurations[0].primaryContainer.containerPort) as $port
    | (.loadBalancers | type == "array" and length == 1)
      and .loadBalancers[0].containerName == "Main"
      and (.loadBalancers[0].containerPort | type == "number" and floor == . and . == $port)
      and (.loadBalancers[0].targetGroupArn | type == "string" and length > 0)
  ' <<< "$revision_document" >/dev/null \
    || { echo "ERROR: $name revision load balancer is not bound to the primary container port" >&2; exit 1; }
}

stable_service() {
  local name="$1" arn="$2" repository="$3" health_path="$4" first second
  first="$(read_service "$arn")"
  validate_service "$name" "$arn" "$repository" "$health_path" "$first"
  sleep "$stability_seconds"
  second="$(read_service "$arn")"
  validate_service "$name" "$arn" "$repository" "$health_path" "$second"
  [ "$first" = "$second" ] \
    || { echo "ERROR: $name changed between stable reads" >&2; exit 1; }
  printf '%s' "$second"
}

normalize_capacity_config() {
  jq -cS '.activeConfigurations[0] |= (del(.serviceRevisionArn,.createdAt) | .scalingTarget.minTaskCount = 0)'
}

normalize_revision() {
  jq -cS 'del(.serviceRevisionArn)'
}

validate_account() {
  local actual
  actual="$(aws_cmd sts get-caller-identity --region "$region" --query Account --output text)"
  [ "$actual" = "$account_id" ] || { echo "ERROR: wrong AWS account: $actual" >&2; exit 1; }
}

build_plan() {
  local output="$1" rows name arn repository url_parameter health_path service revision revision_doc action update_request pointer
  require_empty_directory "$output"
  validate_account
  rows="$(mktemp "${TMPDIR:-/tmp}/watchdog-capacity-plan.XXXXXX")"
  trap 'rm -f -- "$rows"' RETURN
  for name in api-web ai-gateway workers; do
    IFS=$'\t' read -r arn repository url_parameter health_path < <(service_contract "$name")
    pointer="$(aws_cmd ssm get-parameter --name "/watchdog-bms/production/ecs-express-${name}-service-arn" \
      --region "$region" --query Parameter.Value --output text)"
    [ "$pointer" = "$arn" ] || { echo "ERROR: $name SSM pointer does not match the reviewed ARN" >&2; exit 1; }
    service="$(stable_service "$name" "$arn" "$repository" "$health_path")"
    revision="$(jq -r '.activeConfigurations[0].serviceRevisionArn' <<< "$service")"
    revision_doc="$(read_revision "$revision")"
    validate_revision "$arn" "$revision" "$revision_doc"
    validate_service_revision_binding "$name" "$service" "$revision_doc"
    if [ "$(jq -r '.activeConfigurations[0].scalingTarget.minTaskCount' <<< "$service")" -eq 0 ]; then
      action=UPDATE_MINIMUM
      update_request="$(jq -cS '{serviceArn,scalingTarget:(.activeConfigurations[0].scalingTarget | .minTaskCount=1)}' <<< "$service")"
    else
      action=VERIFY_ONLY
      update_request=null
    fi
    jq -cnS --arg name "$name" --arg arn "$arn" --arg repository "$repository" \
      --arg urlParameter "$url_parameter" --arg healthPath "$health_path" --arg action "$action" \
      --argjson before "$service" --argjson beforeRevision "$revision_doc" \
      --argjson updateRequest "$update_request" '
      {name:$name,serviceArn:$arn,repository:$repository,urlParameter:$urlParameter,
       healthPath:$healthPath,action:$action,before:$before,beforeRevision:$beforeRevision,
       updateRequest:$updateRequest}' >> "$rows"
  done
  local payload canonical hash plan_path
  payload="$(jq -cS --arg account "$account_id" --arg region "$region" --arg cluster "$cluster" \
    -s '{schemaVersion:1,accountId:$account,region:$region,cluster:$cluster,services:.}' "$rows")"
  hash="$(sha256_text "$payload")"
  plan_path="$output/production-minimum-capacity-plan.json"
  jq -cS --arg hash "$hash" '. + {planSha256:$hash}' <<< "$payload" > "$plan_path"
  printf '%s\n' "PLAN_SHA256=$hash"
  printf '%s\n' "PLAN_FILE=$plan_path"
}

validate_plan() {
  local plan="$1" expected_hash="$2" actual_hash canonical index name arn repository health_path before revision revision_doc
  [ -f "$plan" ] && [ ! -L "$plan" ] || { echo "ERROR: plan must be a regular non-symlink file" >&2; exit 2; }
  [ "$(wc -c < "$plan")" -le 1048576 ] || { echo "ERROR: plan is too large" >&2; exit 2; }
  jq -e -s 'length == 1 and (.[0] | type == "object")' "$plan" >/dev/null \
    || { echo "ERROR: plan must contain exactly one JSON object" >&2; exit 2; }
  [[ "$expected_hash" =~ ^[0-9a-f]{64}$ ]] || { echo "ERROR: expected plan SHA must be lowercase sha256" >&2; exit 2; }
  canonical="$(jq -cS 'del(.planSha256)' "$plan")"
  actual_hash="$(sha256_text "$canonical")"
  [ "$actual_hash" = "$expected_hash" ] \
    && [ "$(jq -r '.planSha256' "$plan")" = "$expected_hash" ] \
    || { echo "ERROR: plan hash mismatch" >&2; exit 1; }
  jq -e --arg account "$account_id" --arg region "$region" --arg cluster "$cluster" '
    (keys | sort) == ["accountId","cluster","planSha256","region","schemaVersion","services"]
    and .schemaVersion == 1 and .accountId == $account and .region == $region and .cluster == $cluster
    and (.services | map(.name)) == ["api-web","ai-gateway","workers"]
    and (.services | all(
      (keys | sort) == ["action","before","beforeRevision","healthPath","name","repository","serviceArn","updateRequest","urlParameter"]
      and (.action == "UPDATE_MINIMUM" or .action == "VERIFY_ONLY")
      and (if .action == "UPDATE_MINIMUM" then
        .before.activeConfigurations[0].scalingTarget.minTaskCount == 0
        and .updateRequest == {serviceArn:.serviceArn,scalingTarget:(.before.activeConfigurations[0].scalingTarget | .minTaskCount=1)}
      else .before.activeConfigurations[0].scalingTarget.minTaskCount == 1 and .updateRequest == null end)
    ))
  ' "$plan" >/dev/null || { echo "ERROR: plan contract is invalid" >&2; exit 1; }
  for index in 0 1 2; do
    name="$(jq -r ".services[$index].name" "$plan")"
    arn="$(jq -r ".services[$index].serviceArn" "$plan")"
    repository="$(jq -r ".services[$index].repository" "$plan")"
    health_path="$(jq -r ".services[$index].healthPath" "$plan")"
    before="$(jq -cS ".services[$index].before" "$plan")"
    revision_doc="$(jq -cS ".services[$index].beforeRevision" "$plan")"
    revision="$(jq -r '.activeConfigurations[0].serviceRevisionArn' <<< "$before")"
    validate_service "$name" "$arn" "$repository" "$health_path" "$before"
    validate_revision "$arn" "$revision" "$revision_doc"
    validate_service_revision_binding "$name" "$before" "$revision_doc"
  done
}

wait_for_recovered_service() {
  local name="$1" arn="$2" repository="$3" health_path="$4" target_revision="$5" document=""
  local attempt
  for attempt in $(seq 1 "$poll_attempts"); do
    document="$(read_service "$arn")"
    validate_observed_service "$name" "$arn" "$document"
    if jq -e --arg target "$target_revision" '
      .status == "ACTIVE" and .currentDeployment == null
      and [.activeConfigurations[].serviceRevisionArn] == [$target]
      and .activeConfigurations[0].scalingTarget.minTaskCount == 1
    ' <<< "$document" >/dev/null; then
      validate_service "$name" "$arn" "$repository" "$health_path" "$document"
      printf '%s' "$document"
      return 0
    fi
    sleep "$poll_seconds"
  done
  echo "ERROR: $name did not settle on the recovered singleton revision" >&2
  return 1
}

verify_runtime_health_once() {
  local name="$1" arn="$2" health_path="$3" endpoint="$4" container_port="$5" revision_doc="$6" task_definition="$7" output="$8"
  local service_name="${arn##*/}" tasks task_args=() described target_group target_health url health_url task_ips
  local target_bindings expected_bindings body_file body_size canonical_body http_status
  tasks="$(aws_cmd ecs list-tasks --cluster "$cluster" --service-name "$service_name" --desired-status RUNNING \
    --max-results 100 --region "$region" --no-paginate --output json | jq -cS .)" || return 1
  jq -e --arg account "$account_id" --arg region "$region" --arg cluster "$cluster" '
    .nextToken == null and (.taskArns | type == "array" and length >= 1)
    and (.taskArns | unique | length) == (.taskArns | length)
    and all(.taskArns[]; test("^arn:aws:ecs:"+$region+":"+$account+":task/"+$cluster+"/[0-9a-f]{32}$"))
  ' <<< "$tasks" >/dev/null \
    || { echo "ERROR: $name has no complete RUNNING task set" >&2; return 1; }
  while IFS= read -r task; do task_args+=("$task"); done < <(jq -r '.taskArns[]' <<< "$tasks")
  described="$(aws_cmd ecs describe-tasks --cluster "$cluster" --tasks "${task_args[@]}" --region "$region" --output json | jq -cS .)" || return 1
  jq -e --arg task_definition "$task_definition" --arg group "service:$service_name" \
    --argjson expected_tasks "$(jq -cS '.taskArns | sort' <<< "$tasks")" \
    --arg account "$account_id" --arg region "$region" --arg cluster "$cluster" '
    (.failures | length) == 0 and (.tasks | length) >= 1
    and ([.tasks[].taskArn] | sort) == $expected_tasks
    and all(.tasks[];
      .lastStatus == "RUNNING" and .desiredStatus == "RUNNING"
      and .taskDefinitionArn == $task_definition and .group == $group
      and (.taskArn | test("^arn:aws:ecs:"+$region+":"+$account+":task/"+$cluster+"/[0-9a-f]{32}$"))
      and ([.attachments[]? | select(.type == "ElasticNetworkInterface") | .details[]?
        | select(.name == "privateIPv4Address") | .value] as $ips
        | ($ips | length) == 1 and ($ips[0] | test("^[0-9]{1,3}(\\.[0-9]{1,3}){3}$"))))
  ' <<< "$described" >/dev/null || { echo "ERROR: $name task state is not healthy" >&2; return 1; }
  task_ips="$(jq -cS '[.tasks[].attachments[]? | select(.type == "ElasticNetworkInterface")
    | .details[]? | select(.name == "privateIPv4Address") | .value] | sort' <<< "$described")"
  target_group="$(jq -er --argjson port "$container_port" '
    .loadBalancers[0]
    | select(.containerName == "Main" and .containerPort == $port)
    | .targetGroupArn
  ' <<< "$revision_doc")" || return 1
  target_health="$(aws_cmd elbv2 describe-target-health --target-group-arn "$target_group" --region "$region" --output json | jq -cS .)" || return 1
  jq -e --argjson port "$container_port" '
    .TargetHealthDescriptions | type == "array" and length >= 1
    and all(.[]; .TargetHealth.State == "healthy"
      and (.Target.Id | type == "string")
      and (.Target.Port | type == "number" and floor == . and . == $port))
  ' \
    <<< "$target_health" >/dev/null || { echo "ERROR: $name target group is not healthy" >&2; return 1; }
  target_bindings="$(jq -cS '[.TargetHealthDescriptions[]
    | {privateIp:.Target.Id,port:.Target.Port,state:.TargetHealth.State}]
    | sort_by(.privateIp,.port)' <<< "$target_health")"
  expected_bindings="$(jq -cnS --argjson ips "$task_ips" --argjson port "$container_port" '
    $ips | map({privateIp:.,port:$port,state:"healthy"}) | sort_by(.privateIp,.port)
  ')"
  [ "$target_bindings" = "$expected_bindings" ] \
    || { echo "ERROR: $name healthy target IP/port set does not equal its RUNNING task/container set" >&2; return 1; }
  local url_parameter
  IFS=$'\t' read -r _ _ url_parameter _ < <(service_contract "$name")
  url="$(aws_cmd ssm get-parameter --name "$url_parameter" --region "$region" --query Parameter.Value --output text)" || return 1
  [[ "$endpoint" =~ ^[a-z0-9-]+\.ecs\.ap-southeast-1\.on\.aws$ ]] \
    && [ "${url%/}" = "https://${endpoint}" ] \
    || { echo "ERROR: $name health URL is outside the reviewed production endpoint" >&2; return 1; }
  health_url="${url%/}${health_path}"
  body_file="${output}.http-body.tmp"
  rm -f -- "$body_file"
  http_status="$("$curl_bin" --proto '=https' --silent --show-error --max-time 20 \
    --max-filesize 16384 --output "$body_file" --write-out '%{http_code}' \
    "$health_url")" \
    || { rm -f -- "$body_file"; return 1; }
  [[ "$http_status" =~ ^[0-9]{3}$ ]] && [ "$http_status" = 200 ] \
    || { rm -f -- "$body_file"; echo "ERROR: $name application health HTTP status is not 200" >&2; return 1; }
  [ -f "$body_file" ] && [ ! -L "$body_file" ] \
    || { rm -f -- "$body_file"; echo "ERROR: $name application health body is missing" >&2; return 1; }
  body_size="$(wc -c < "$body_file" | tr -d '[:space:]')"
  [[ "$body_size" =~ ^[1-9][0-9]*$ ]] && [ "$body_size" -le 16384 ] \
    || { rm -f -- "$body_file"; echo "ERROR: $name application health body is empty or oversized" >&2; return 1; }
  canonical_body="$(jq -ceS -s '
    select(length == 1 and (.[0] | type == "object" and .status == "ok")) | .[0]
  ' "$body_file")" \
    || { rm -f -- "$body_file"; echo "ERROR: $name application health body is not one ok JSON object" >&2; return 1; }
  rm -f -- "$body_file"
  jq -cnS --argjson tasks "$tasks" --argjson described "$described" \
    --arg targetGroupArn "$target_group" --argjson targetHealth "$target_health" \
    --argjson healthyTargets "$target_bindings" --argjson taskIps "$task_ips" \
    --arg healthUrl "$health_url" --arg healthPath "$health_path" --arg containerName Main \
    --argjson containerPort "$container_port" --argjson httpStatus "$http_status" \
    --argjson httpBody "$canonical_body" '
    {runningTaskArns:($tasks.taskArns|sort),taskState:$described,
     runningTaskPrivateIps:$taskIps,containerName:$containerName,containerPort:$containerPort,
     targetGroupArn:$targetGroupArn,targetHealth:$targetHealth,healthyTargets:$healthyTargets,
     healthUrl:$healthUrl,healthPath:$healthPath,httpStatus:$httpStatus,httpBody:$httpBody}' > "$output"
}

verify_runtime_health() {
  local attempt
  for attempt in $(seq 1 "$poll_attempts"); do
    if verify_runtime_health_once "$@"; then
      return 0
    fi
    sleep "$poll_seconds"
  done
  echo "ERROR: $1 did not reach the exact RUNNING/target/application health contract" >&2
  return 1
}

apply_plan() {
  local plan="$1" expected_hash="$2" output="$3"
  require_empty_directory "$output"
  validate_account
  validate_plan "$plan" "$expected_hash"
  local index name arn repository url_parameter health_path action before current revision before_revision
  local update_file update_result target_revision pointer current_revision expected_arn expected_repository expected_url expected_health
  # Prove all three planned before-states before performing the first write.
  for index in 0 1 2; do
    name="$(jq -r ".services[$index].name" "$plan")"
    arn="$(jq -r ".services[$index].serviceArn" "$plan")"
    repository="$(jq -r ".services[$index].repository" "$plan")"
    url_parameter="$(jq -r ".services[$index].urlParameter" "$plan")"
    health_path="$(jq -r ".services[$index].healthPath" "$plan")"
    IFS=$'\t' read -r expected_arn expected_repository expected_url expected_health < <(service_contract "$name")
    [ "$arn:$repository:$url_parameter:$health_path" = \
      "$expected_arn:$expected_repository:$expected_url:$expected_health" ] \
      || { echo "ERROR: plan service contract mismatch for $name" >&2; exit 1; }
    pointer="$(aws_cmd ssm get-parameter --name "/watchdog-bms/production/ecs-express-${name}-service-arn" \
      --region "$region" --query Parameter.Value --output text)"
    [ "$pointer" = "$arn" ] \
      || { echo "ERROR: $name SSM pointer moved after plan approval" >&2; exit 1; }
    current="$(stable_service "$name" "$arn" "$repository" "$health_path")"
    before="$(jq -cS ".services[$index].before" "$plan")"
    [ "$current" = "$before" ] || { echo "ERROR: $name drifted after plan approval" >&2; exit 1; }
    revision="$(jq -r '.activeConfigurations[0].serviceRevisionArn' <<< "$before")"
    before_revision="$(jq -cS ".services[$index].beforeRevision" "$plan")"
    current_revision="$(read_revision "$revision")"
    validate_revision "$arn" "$revision" "$current_revision"
    validate_service_revision_binding "$name" "$current" "$current_revision"
    [ "$current_revision" = "$before_revision" ] \
      || { echo "ERROR: $name immutable revision evidence differs from the approved plan" >&2; exit 1; }
  done

  local results="$output/service-results.jsonl"
  : > "$results"
  for index in 0 1 2; do
    name="$(jq -r ".services[$index].name" "$plan")"
    arn="$(jq -r ".services[$index].serviceArn" "$plan")"
    repository="$(jq -r ".services[$index].repository" "$plan")"
    health_path="$(jq -r ".services[$index].healthPath" "$plan")"
    action="$(jq -r ".services[$index].action" "$plan")"
    before="$(jq -cS ".services[$index].before" "$plan")"
    before_revision="$(jq -cS ".services[$index].beforeRevision" "$plan")"
    revision="$(jq -r '.activeConfigurations[0].serviceRevisionArn' <<< "$before")"
    target_revision="$revision"
    update_result=null
    # Close the read/write gap as far as the API permits. A concurrent writer after this read is
    # still detected by the exact normalized after-state and causes a hard stop.
    current="$(read_service "$arn")"
    [ "$current" = "$before" ] || { echo "ERROR: $name moved immediately before recovery" >&2; exit 1; }
    if [ "$action" = UPDATE_MINIMUM ]; then
      update_file="$output/${name}-update-request.json"
      jq -cS ".services[$index].updateRequest" "$plan" > "$update_file"
      update_result="$(aws_cmd ecs update-express-gateway-service --cli-input-json "file://$update_file" \
        --region "$region" --query 'service.{targetRevision:targetConfiguration.serviceRevisionArn}' --output json | jq -cS .)"
      target_revision="$(jq -er '.targetRevision' <<< "$update_result")"
      [[ "$target_revision" =~ ^arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/${arn##*/}/[0-9]+$ ]] \
        && [ "$target_revision" != "$revision" ] \
        || { echo "ERROR: $name update returned an invalid target revision" >&2; exit 1; }
    fi
    local after after_stable after_revision before_normalized after_normalized before_revision_normalized after_revision_normalized
    after="$(wait_for_recovered_service "$name" "$arn" "$repository" "$health_path" "$target_revision")"
    sleep "$stability_seconds"
    after_stable="$(read_service "$arn")"
    [ "$after" = "$after_stable" ] || { echo "ERROR: $name recovered state is not stable" >&2; exit 1; }
    before_normalized="$(normalize_capacity_config <<< "$before")"
    after_normalized="$(normalize_capacity_config <<< "$after")"
    [ "$before_normalized" = "$after_normalized" ] \
      || { echo "ERROR: $name changed outside minTaskCount/revision metadata" >&2; exit 1; }
    after_revision="$(read_revision "$target_revision")"
    validate_revision "$arn" "$target_revision" "$after_revision"
    validate_service_revision_binding "$name" "$after" "$after_revision"
    before_revision_normalized="$(normalize_revision <<< "$before_revision")"
    after_revision_normalized="$(normalize_revision <<< "$after_revision")"
    [ "$before_revision_normalized" = "$after_revision_normalized" ] \
      || { echo "ERROR: $name service revision changed outside its revision ARN" >&2; exit 1; }
    printf '%s\n' "$after" > "$output/${name}-after-service.json"
    printf '%s\n' "$after_revision" > "$output/${name}-after-revision.json"
    printf '%s\n' "$update_result" > "$output/${name}-update-result.json"
  done

  # Close the sequential-update window with one final exact read and runtime proof per service.
  for index in 0 1 2; do
    name="$(jq -r ".services[$index].name" "$plan")"
    arn="$(jq -r ".services[$index].serviceArn" "$plan")"
    repository="$(jq -r ".services[$index].repository" "$plan")"
    health_path="$(jq -r ".services[$index].healthPath" "$plan")"
    action="$(jq -r ".services[$index].action" "$plan")"
    before="$(jq -cS ".services[$index].before" "$plan")"
    revision="$(jq -r '.activeConfigurations[0].serviceRevisionArn' <<< "$before")"
    after="$(cat "$output/${name}-after-service.json")"
    after_revision="$(cat "$output/${name}-after-revision.json")"
    target_revision="$(jq -r '.activeConfigurations[0].serviceRevisionArn' <<< "$after")"
    current="$(stable_service "$name" "$arn" "$repository" "$health_path")"
    [ "$current" = "$after" ] \
      || { echo "ERROR: $name drifted before final recovery evidence" >&2; exit 1; }
    current_revision="$(read_revision "$target_revision")"
    validate_revision "$arn" "$target_revision" "$current_revision"
    [ "$current_revision" = "$after_revision" ] \
      || { echo "ERROR: $name revision drifted before final recovery evidence" >&2; exit 1; }
    local endpoint container_port health_file after_normalized
    endpoint="$(jq -er '.activeConfigurations[0].ingressPaths[0].endpoint' <<< "$after")"
    container_port="$(jq -er '.activeConfigurations[0].primaryContainer.containerPort' <<< "$after")"
    health_file="$output/${name}-runtime-health.json"
    verify_runtime_health "$name" "$arn" "$health_path" "$endpoint" "$container_port" "$after_revision" \
      "$(jq -r '.taskDefinition' <<< "$after_revision")" "$health_file"
    after_normalized="$(normalize_capacity_config <<< "$after")"
    update_result="$(cat "$output/${name}-update-result.json")"
    jq -cnS --arg name "$name" --arg arn "$arn" --arg action "$action" \
      --arg beforeRevision "$revision" --arg afterRevision "$target_revision" \
      --arg beforeSha "$(sha256_text "$before")" --arg afterSha "$(sha256_text "$after")" \
      --arg normalizedSha "$(sha256_text "$after_normalized")" --argjson updateResult "$update_result" \
      --argjson runtimeHealth "$(cat "$health_file")" '
      {name:$name,serviceArn:$arn,action:$action,beforeRevisionArn:$beforeRevision,
       afterRevisionArn:$afterRevision,beforeConfigSha256:$beforeSha,afterConfigSha256:$afterSha,
       normalizedConfigSha256:$normalizedSha,updateResult:$updateResult,runtimeHealth:$runtimeHealth}' >> "$results"
  done
  # A second cross-service pass catches an early service moving while later runtime probes ran.
  for index in 0 1 2; do
    name="$(jq -r ".services[$index].name" "$plan")"
    arn="$(jq -r ".services[$index].serviceArn" "$plan")"
    repository="$(jq -r ".services[$index].repository" "$plan")"
    health_path="$(jq -r ".services[$index].healthPath" "$plan")"
    after="$(cat "$output/${name}-after-service.json")"
    current="$(stable_service "$name" "$arn" "$repository" "$health_path")"
    [ "$current" = "$after" ] \
      || { echo "ERROR: $name moved during cross-service runtime verification" >&2; exit 1; }
    target_revision="$(jq -r '.activeConfigurations[0].serviceRevisionArn' <<< "$after")"
    after_revision="$(cat "$output/${name}-after-revision.json")"
    current_revision="$(read_revision "$target_revision")"
    validate_revision "$arn" "$target_revision" "$current_revision"
    [ "$current_revision" = "$after_revision" ] \
      || { echo "ERROR: $name revision moved during cross-service runtime verification" >&2; exit 1; }
  done
  local result_path="$output/production-minimum-capacity-result.json"
  jq -cS --arg planSha "$expected_hash" --arg account "$account_id" --arg region "$region" \
    -s '{schemaVersion:1,planSha256:$planSha,accountId:$account,region:$region,
         mutationCount:(map(select(.action=="UPDATE_MINIMUM"))|length),services:.}' "$results" > "$result_path"
  printf '%s\n' "RESULT_FILE=$result_path"
  printf '%s\n' "RESULT_SHA256=$(sha256_file "$result_path")"
}

case "$mode" in
  plan) build_plan "$1" ;;
  apply) apply_plan "$1" "$2" "$3" ;;
esac
