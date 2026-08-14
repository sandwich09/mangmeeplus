#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <empty-output-directory>" >&2
  exit 2
fi
output="$1"
[ -d "$output" ] && [ ! -L "$output" ] && [ -z "$(find "$output" -mindepth 1 -print -quit)" ]
region=ap-southeast-1
account=311414082667
cluster=watchdog-bms-prod
aws_bin="${AWS_BIN:-aws}"
curl_bin="${CURL_BIN:-curl}"
curl_retry=(--retry 2 --retry-delay 2 --retry-max-time 70 --retry-all-errors)
stability_seconds="${A5_HEALTH_STABILITY_SECONDS:-2}"
[[ "$stability_seconds" =~ ^[0-9]+$ ]] && [ "$stability_seconds" -le 10 ]

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}
if command -v sha256sum >/dev/null 2>&1; then sha256_cmd=(sha256sum); else sha256_cmd=(shasum -a 256); fi
sha_json() { jq -cjS . "$1" | "${sha256_cmd[@]}" | awk '{print $1}'; }

service_contract() {
  case "$1" in
    ai-gateway)
      printf '%s\t%s\t%s\n' \
        'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-ai-gateway-v2' \
        '/watchdog-bms/production/ecs-express-ai-gateway-url' '/v1/health' ;;
    api-web)
      printf '%s\t%s\t%s\n' \
        'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub' \
        '/watchdog-bms/production/ecs-express-api-web-url' '/v1/health' ;;
    workers)
      printf '%s\t%s\t%s\n' \
        'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-workers' \
        '/watchdog-bms/production/ecs-express-workers-url' '/health' ;;
    *) return 2 ;;
  esac
}

test "$(aws_cmd sts get-caller-identity --region "$region" --query Account --output text)" = "$account"
rows="$output/services.ndjson"
: > "$rows"
for service in ai-gateway api-web workers; do
  IFS=$'\t' read -r service_arn url_parameter health_path < <(service_contract "$service")
  service_name="${service_arn##*/}"
  directory="$output/$service"
  mkdir "$directory"

  ssm="$directory/ssm.json"
  aws_cmd ssm get-parameter --region "$region" --name "$url_parameter" --output json \
    | jq -cS . > "$ssm"
  ssm_url="$(jq -er --arg name "$url_parameter" '
    select(.Parameter.Name==$name and .Parameter.Type=="String"
      and (.Parameter.Value|test("^https://[a-z0-9][a-z0-9.-]*$") and (endswith("/")|not)))
    | .Parameter.Value
  ' "$ssm")"

  first="$directory/express-first.json"
  second="$directory/express-second.json"
  aws_cmd ecs describe-express-gateway-service --region "$region" --service-arn "$service_arn" \
    --output json | jq -cS . > "$first"
  sleep "$stability_seconds"
  aws_cmd ecs describe-express-gateway-service --region "$region" --service-arn "$service_arn" \
    --output json | jq -cS . > "$second"
  cmp -s "$first" "$second" || { echo "ERROR: $service changed between stable reads" >&2; exit 1; }
  jq -e --arg arn "$service_arn" --arg url "$ssm_url" --arg path "$health_path" '
    .service.serviceArn==$arn and .service.status.statusCode=="ACTIVE"
    and .service.currentDeployment==null and (.service.activeConfigurations|length)==1
    and (.service.activeConfigurations[0] as $active
      | $active.scalingTarget=={minTaskCount:1,maxTaskCount:2,
          autoScalingMetric:"AVERAGE_CPU",autoScalingTargetValue:70}
      and $active.healthCheckPath==$path
      and ($active.primaryContainer.containerPort|type=="number" and .>=1 and .<=65535)
      and ($active.ingressPaths|length)==1
      and $active.ingressPaths[0].accessType=="PUBLIC"
      and ("https://"+$active.ingressPaths[0].endpoint)==$url)
  ' "$second" >/dev/null
  express="$directory/express.json"
  jq -cnS --slurpfile first "$first" --slurpfile second "$second" \
    '{first:$first[0],second:$second[0]}' > "$express"
  revision_arn="$(jq -er '.service.activeConfigurations[0].serviceRevisionArn' "$second")"
  container_port="$(jq -er '.service.activeConfigurations[0].primaryContainer.containerPort' "$second")"
  scaling="$(jq -cS '.service.activeConfigurations[0].scalingTarget' "$second")"
  serving_mode="$(jq -er --arg service "$service" '
    def values($active; $name):
      [$active.primaryContainer.environment[]? | select(.name==$name) | .value];
    def controls($active; $service; $mode):
      if $service=="api-web" then
        values($active; "GLOBAL_MAINTENANCE_MODE")
            == [if $mode=="live" then "false" else "true" end]
        and values($active; "AI_GATEWAY_ENABLED")
            == [if $mode=="live" then "true" else "false" end]
        and values($active; "LINE_AI_LEDGER_ENABLED")
            == [if $mode=="live" then "true" else "false" end]
        and values($active; "REIMBURSEMENT_WRITE_QUIESCE")
            == [if $mode=="live" then "false" else "true" end]
        and (values($active; "CRM_AUTO_REPLY_ENABLED") as $crm
          | if $mode=="live" then ($crm==["true"] or $crm==["false"])
            else $crm==["false"] end)
      elif $service=="ai-gateway" then
        values($active; "MODEL_PROVIDER") as $providers
        | values($active; "APPROVED_AI_PROVIDERS") as $approved
        | (if $mode=="live" then (($providers==["bedrock"] or $providers==["openai"])
            and ($approved|length)==1
            and ($approved[0]|split(",")|map(gsub("^\\s+|\\s+$";""))|index($providers[0]))!=null)
          else $providers==["disabled"] end)
        and values($active; "AI_GLOBAL_INFERENCE_PROFILE_APPROVED")
          == [if $mode=="live" then "true" else empty end]
        and (values($active; "AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF") as $refs
          | ($refs|length)==1 and ($refs[0]|length)>0)
        and all(["LINE_AI_AGENT_ORCHESTRATION_ENABLED","LINE_AI_TOOLUSE_LOOP_ENABLED",
          "LINE_AI_COVERAGE_CRITIC_ENABLED","AI_GATEWAY_ENABLED","AI_AGENT_REGISTRY_ENABLED",
          "AI_TOOL_POLICY_ENFORCED","AI_TOOL_AUDIT_ENABLED"][];
          values($active; .)==[if $mode=="live" then "true" else "false" end])
        and values($active; "AI_FINAL_MUTATION_ENABLED")==["false"]
        and values($active; "AI_PROMPT_LOGGING_ENABLED")==["false"]
      elif $service=="workers" then
        values($active; "QUEUE_ENABLED")==[if $mode=="live" then "true" else "false" end]
      else false end;
    {
      "ai-gateway":{
        source:"eb515b9e1e92ca970bd14c67fdeebb6f859cf838",
        image:"311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-ai-gateway@sha256:8a159d8e1f3047ec0698f8b4e5209502129f2b2ebed8ba9e043abeff1bce3011",
        controls:{
          MODEL_PROVIDER:["bedrock"],APPROVED_AI_PROVIDERS:["bedrock,openai,typhoon"],
          AI_GLOBAL_INFERENCE_PROFILE_APPROVED:["true"],
          AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF:["DPO-2026-07-23-bedrock-global"],
          LINE_AI_AGENT_ORCHESTRATION_ENABLED:["true"],LINE_AI_TOOLUSE_LOOP_ENABLED:["true"],
          LINE_AI_COVERAGE_CRITIC_ENABLED:["true"],AI_GATEWAY_ENABLED:["true"],
          AI_AGENT_REGISTRY_ENABLED:["true"],AI_TOOL_POLICY_ENFORCED:["true"],
          AI_TOOL_AUDIT_ENABLED:["true"],AI_FINAL_MUTATION_ENABLED:["false"],
          AI_PROMPT_LOGGING_ENABLED:["false"]}},
      "api-web":{
        source:"eb515b9e1e92ca970bd14c67fdeebb6f859cf838",
        image:"311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:9c655e1a06ba0d4acb4bcfbd2975aac57ef5e34ef25cc455ae8e1c1f59c46e1c",
        controls:{GLOBAL_MAINTENANCE_MODE:[],AI_GATEWAY_ENABLED:["true"],
          CRM_AUTO_REPLY_ENABLED:["true"],LINE_AI_LEDGER_ENABLED:["true"],
          REIMBURSEMENT_WRITE_QUIESCE:["false"]}},
      workers:{
        source:"0bdbe5088c2e121b74c74da9f28bf2a64e3576d7",
        image:"311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-workers@sha256:e9495744a9708d04c06564f6ddb2fd66342c3ccca87efd77d7e02fdce786c23f",
        controls:{QUEUE_ENABLED:["true"]}}
    }[$service] as $legacy
    | .service.activeConfigurations[0] as $active
    | values($active; "PRODUCTION_SERVING_MODE") as $modes
    | if ($modes|length)==1 and ($modes[0]=="live" or $modes[0]=="maintenance_only")
        and controls($active; $service; $modes[0]) then
        $modes[0]
      elif $modes==[] and $active.primaryContainer.image==$legacy.image
        and values($active; "GIT_SHA")==[$legacy.source]
        and all(($legacy.controls|to_entries)[];
          . as $control | values($active; $control.key)==$control.value) then
        "live"
      else empty end
  ' "$second")"

  revision="$directory/revision.json"
  aws_cmd ecs describe-service-revisions --region "$region" \
    --service-revision-arns "$revision_arn" --output json | jq -cS . > "$revision"
  target_group="$(jq -er --arg service "$service_arn" --arg revision "$revision_arn" '
    .serviceRevisions
    | select(type=="array" and length==1)
    | .[0]
    | select(.serviceArn==$service and .serviceRevisionArn==$revision)
    | [.resolvedConfiguration.loadBalancers[]?.targetGroupArn]
    | select(length==1)
    | .[0]
    | select(test("^arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:targetgroup/[^/]+/[0-9a-f]+$"))
  ' "$revision")"
  task_definition="$(jq -er --arg service "$service_arn" --arg revision "$revision_arn" \
    --arg target "$target_group" --arg endpoint "${ssm_url#https://}" --arg path "$health_path" \
    --argjson port "$container_port" --argjson scaling "$scaling" '
    (.serviceRevisions[0].loadBalancers[0].targetGroupArn) as $primary
    | (.serviceRevisions[0].loadBalancers[0].advancedConfiguration.alternateTargetGroupArn) as $alternate
    | select((.serviceRevisions|length)==1 and .serviceRevisions[0].serviceArn==$service
      and .serviceRevisions[0].serviceRevisionArn==$revision
      and (.serviceRevisions[0].resolvedConfiguration.loadBalancers|length)==1
      and .serviceRevisions[0].resolvedConfiguration.loadBalancers[0].targetGroupArn==$target
      and (.serviceRevisions[0].loadBalancers|length)==1
      and .serviceRevisions[0].loadBalancers[0].containerName=="Main"
      and .serviceRevisions[0].loadBalancers[0].containerPort==$port
      and $primary!=$alternate and ($target==$primary or $target==$alternate)
      and ([.serviceRevisions[0].ecsManagedResources.ingressPaths[]?
        | select(.accessType=="PUBLIC" and .endpoint==$endpoint)
        | .targetGroups[]?
        | select(.arn==$target and .healthCheckPath==$path and .healthCheckPort==$port
          and .port==(if $target==$primary then $port else 0 end)
          and .status=="ACTIVE")] | length)==1
      and ([.serviceRevisions[0].ecsManagedResources.ingressPaths[]?
        | select(.accessType=="PUBLIC" and .endpoint==$endpoint)
        | .targetGroups[]?
        | select(.arn==(if $target==$primary then $alternate else $primary end)
          and .healthCheckPath==$path and .healthCheckPort==$port
          and .port==(if $target==$primary then 0 else $port end)
          and .status=="ACTIVE")] | length)==1
      and .serviceRevisions[0].ecsManagedResources.autoScaling.scalableTarget.minCapacity
        == $scaling.minTaskCount
      and .serviceRevisions[0].ecsManagedResources.autoScaling.scalableTarget.maxCapacity
        == $scaling.maxTaskCount
      and .serviceRevisions[0].ecsManagedResources.autoScaling.scalableTarget.status=="ACTIVE"
      and (.serviceRevisions[0].ecsManagedResources.autoScaling.applicationAutoScalingPolicies|length)==1
      and .serviceRevisions[0].ecsManagedResources.autoScaling.applicationAutoScalingPolicies[0].metric
        == $scaling.autoScalingMetric
      and .serviceRevisions[0].ecsManagedResources.autoScaling.applicationAutoScalingPolicies[0].targetValue
        == $scaling.autoScalingTargetValue
      and .serviceRevisions[0].ecsManagedResources.autoScaling.applicationAutoScalingPolicies[0].policyType
        == "TargetTrackingScaling"
      and .serviceRevisions[0].ecsManagedResources.autoScaling.applicationAutoScalingPolicies[0].status
        == "ACTIVE")
    | .serviceRevisions[0].taskDefinition
  ' "$revision")"
  [[ "$task_definition" =~ ^arn:aws:ecs:ap-southeast-1:311414082667:task-definition/[A-Za-z0-9_-]+:[1-9][0-9]*$ ]]
  task_revision="${task_definition##*:}"

  list_tasks="$directory/list-tasks.json"
  aws_cmd ecs list-tasks --region "$region" --cluster "$cluster" --service-name "$service_name" \
    --desired-status RUNNING --no-paginate --output json | jq -cS . > "$list_tasks"
  jq -e '(.taskArns|type)=="array" and (.taskArns|length)>=1
    and (.taskArns|length)==(.taskArns|unique|length) and (.nextToken//null)==null' \
    "$list_tasks" >/dev/null
  task_arns=()
  while IFS= read -r task_arn; do task_arns+=("$task_arn"); done \
    < <(jq -r '.taskArns[]' "$list_tasks" | sort)
  tasks="$directory/describe-tasks.json"
  aws_cmd ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "${task_arns[@]}" \
    --output json | jq -cS . > "$tasks"
  jq -e --arg definition "$task_definition" --arg group "service:$service_name" \
    --argjson expected "$(printf '%s\n' "${task_arns[@]}" | jq -R . | jq -sS .)" '
    .failures==[] and (.tasks|length)==($expected|length)
    and ([.tasks[].taskArn]|sort)==$expected
    and all(.tasks[];.lastStatus=="RUNNING" and .desiredStatus=="RUNNING"
      and .taskDefinitionArn==$definition and .group==$group
      and ([.attachments[]|select(.type=="ElasticNetworkInterface")
        |.details[]|select(.name=="privateIPv4Address")]|length)==1)
  ' "$tasks" >/dev/null
  eni_ids=()
  while IFS= read -r eni_id; do eni_ids+=("$eni_id"); done \
    < <(jq -r '.tasks[].attachments[]
      |select(.type=="ElasticNetworkInterface")|.details[]|select(.name=="networkInterfaceId")|.value' \
      "$tasks" | sort -u)
  [ "${#eni_ids[@]}" -eq "${#task_arns[@]}" ]
  enis="$directory/describe-network-interfaces.json"
  aws_cmd ec2 describe-network-interfaces --region "$region" --network-interface-ids "${eni_ids[@]}" \
    --output json | jq -cS . > "$enis"
  running_ips="$(jq -cS '[.tasks[].attachments[]|select(.type=="ElasticNetworkInterface")
    |.details[]|select(.name=="privateIPv4Address")|.value]|unique|sort' "$tasks")"
  jq -e --argjson expected "$running_ips" '
    (.NetworkInterfaces|length)==($expected|length) and all(.NetworkInterfaces[];.Status=="in-use")
    and ([.NetworkInterfaces[].PrivateIpAddress]|sort)==$expected
  ' "$enis" >/dev/null

  target_groups="$directory/describe-target-groups.json"
  target_health="$directory/describe-target-health.json"
  aws_cmd elbv2 describe-target-groups --region "$region" --target-group-arns "$target_group" \
    --output json | jq -cS . > "$target_groups"
  jq -e --arg target "$target_group" --arg path "$health_path" --argjson port "$container_port" '
    (.TargetGroups|length)==1 and .TargetGroups[0].TargetGroupArn==$target
    and .TargetGroups[0].TargetType=="ip" and .TargetGroups[0].Protocol=="HTTP"
    and .TargetGroups[0].Port==80 and .TargetGroups[0].HealthCheckPort==($port|tostring)
    and .TargetGroups[0].HealthCheckPath==$path
  ' "$target_groups" >/dev/null
  aws_cmd elbv2 describe-target-health --region "$region" --target-group-arn "$target_group" \
    --output json | jq -cS . > "$target_health"
  normalized_health="$(jq -cS --argjson port "$container_port" '
    [.TargetHealthDescriptions[]
      | select(.TargetHealth.State=="healthy" and .Target.Port==$port)
      | {privateIp:.Target.Id,port:.Target.Port,state:.TargetHealth.State}]|sort_by(.privateIp)
  ' "$target_health")"
  jq -e --argjson expected "$running_ips" --argjson normalized "$normalized_health" \
    --argjson port "$container_port" '
    (.TargetHealthDescriptions|length)==($expected|length)
    and all(.TargetHealthDescriptions[];.TargetHealth.State=="healthy" and .Target.Port==$port)
    and ([.TargetHealthDescriptions[].Target.Id]|unique|sort)==$expected
    and ($normalized|length)==($expected|length)
  ' "$target_health" >/dev/null

  health_url="${ssm_url}${health_path}"
  body_raw="$directory/health-body.raw.json"
  http_status="$("$curl_bin" --silent --show-error --proto '=https' --max-time 20 "${curl_retry[@]}" \
    --max-filesize 16384 --output "$body_raw" --write-out '%{http_code}' "$health_url")"
  [[ "$http_status" =~ ^[0-9]{3}$ ]] && [ "$http_status" -eq 200 ]
  body_size="$(wc -c < "$body_raw" | tr -d '[:space:]')"
  [[ "$body_size" =~ ^[1-9][0-9]*$ ]] && [ "$body_size" -le 16384 ]
  jq -e -s 'length==1 and (.[0]|type)=="object" and .[0].status=="ok"' "$body_raw" >/dev/null
  health_body="$(jq -ceS . "$body_raw")"
  checked_at="$(date -u +%s)"
  public_health="$directory/public-health.json"
  jq -cnS --arg url "$health_url" --argjson status "$http_status" \
    --argjson body "$health_body" --argjson checked "$checked_at" \
    '{url:$url,httpStatus:$status,body:$body,checkedAtEpoch:$checked}' > "$public_health"

  service_output="$directory/service.json"
  jq -cnS --arg service "$service" --arg serviceArn "$service_arn" --arg revision "$revision_arn" \
    --arg taskDefinition "$task_definition" --argjson taskRevision "$task_revision" \
    --arg servingMode "$serving_mode" --argjson scaling "$scaling" \
    --argjson tasks "$(printf '%s\n' "${task_arns[@]}" | jq -R . | jq -sS .)" \
    --argjson ips "$running_ips" --arg targetGroup "$target_group" --argjson health "$normalized_health" \
    --arg endpoint "$ssm_url" --arg parameter "$url_parameter" --arg healthPath "$health_path" \
    --arg healthUrl "$health_url" --argjson port "$container_port" --argjson http "$http_status" \
    --argjson body "$health_body" --argjson observed "$checked_at" \
    --slurpfile express "$express" --arg expressHash "$(sha_json "$express")" \
    --slurpfile revisionRaw "$revision" --arg revisionHash "$(sha_json "$revision")" \
    --slurpfile listRaw "$list_tasks" --arg listHash "$(sha_json "$list_tasks")" \
    --slurpfile tasksRaw "$tasks" --arg tasksHash "$(sha_json "$tasks")" \
    --slurpfile eniRaw "$enis" --arg eniHash "$(sha_json "$enis")" \
    --slurpfile groupsRaw "$target_groups" --arg groupsHash "$(sha_json "$target_groups")" \
    --slurpfile healthRaw "$target_health" --arg healthHash "$(sha_json "$target_health")" \
    --slurpfile ssmRaw "$ssm" --arg ssmHash "$(sha_json "$ssm")" \
    --slurpfile publicRaw "$public_health" --arg publicHash "$(sha_json "$public_health")" '
    {service:$service,serviceArn:$serviceArn,serviceRevisionArn:$revision,serviceStatus:"ACTIVE",
     currentDeployment:null,servingMode:$servingMode,containerName:"Main",containerPort:$port,
     taskDefinition:{arn:$taskDefinition,revision:$taskRevision},scalingTarget:$scaling,
     runningTaskArns:$tasks,runningTaskPrivateIps:$ips,targetGroupArn:$targetGroup,targetHealth:$health,
     ingress:{accessType:"PUBLIC",endpoint:$endpoint},ssmUrlParameter:$parameter,
     healthPath:$healthPath,healthUrl:$healthUrl,httpStatus:$http,healthBody:$body,
     observedAtEpoch:$observed,rawEvidence:{
       describeExpressGatewayService:{raw:$express[0],sha256:$expressHash},
       describeServiceRevisions:{raw:$revisionRaw[0],sha256:$revisionHash},
       listTasks:{raw:$listRaw[0],sha256:$listHash},describeTasks:{raw:$tasksRaw[0],sha256:$tasksHash},
       describeNetworkInterfaces:{raw:$eniRaw[0],sha256:$eniHash},
       describeTargetGroups:{raw:$groupsRaw[0],sha256:$groupsHash},
       describeTargetHealth:{raw:$healthRaw[0],sha256:$healthHash},
       ssmParameter:{raw:$ssmRaw[0],sha256:$ssmHash},
       publicHealth:{raw:$publicRaw[0],sha256:$publicHash}}}
  ' > "$service_output"
  jq -e -L "$(dirname "$0")" --argjson issued "$checked_at" '
    include "evidence-contracts"; e0_health_service($issued)
  ' "$service_output" >/dev/null
  cat "$service_output" >> "$rows"
done

observed_at="$(date -u +%s)"
health="$output/current-health.json"
jq -csS --argjson observed "$observed_at" '
  sort_by(.service) as $services
  | {status:"PASS",observedAtEpoch:$observed,services:$services,
      servicesHash:($services|tojson|@base64)}
' "$rows" > "$health.tmp"
# jq cannot SHA-256 itself; replace the temporary base64 placeholder with the canonical byte hash.
services_hash="$(jq -cjS '.services' "$health.tmp" | "${sha256_cmd[@]}" | awk '{print $1}')"
jq -cS --arg hash "$services_hash" '.servicesHash=$hash' "$health.tmp" > "$health"
rm -f -- "$health.tmp" "$rows"
jq -e -L "$(dirname "$0")" --argjson issued "$observed_at" '
  include "evidence-contracts"; e0_current_health($issued)
' "$health" >/dev/null
printf '%s\n' "$health"
