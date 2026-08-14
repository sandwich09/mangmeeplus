#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <all|api-web>" >&2
  exit 2
fi
target="$1"
case "$target" in all|api-web) ;; *) echo "ERROR: maintenance verification target must be all or api-web" >&2; exit 2 ;; esac
[ "${PRODUCTION_SERVING_MODE:-}" = maintenance_only ] || {
  echo "ERROR: production maintenance verifier requires PRODUCTION_SERVING_MODE=maintenance_only" >&2
  exit 2
}

region="${AWS_REGION:-ap-southeast-1}"
public_url="${PUBLIC_DOMAIN_URL:-}"
[[ "$public_url" =~ ^https://[^/]+/?$ ]] || {
  echo "ERROR: PUBLIC_DOMAIN_URL must be one HTTPS origin" >&2
  exit 2
}
public_url="${public_url%/}"
aws_bin="${AWS_BIN:-aws}"
curl_bin="${CURL_BIN:-curl}"
curl_retry=(--retry 2 --retry-delay 2 --retry-max-time 70 --retry-all-errors)
work="$(mktemp -d "${TMPDIR:-/tmp}/production-maintenance-proof.XXXXXX")"
trap 'rm -rf "$work"' EXIT
: > "$work/probes.ndjson"
: > "$work/services.ndjson"

source_sha="${SOURCE_SHA:-}"
manifest="${PRODUCTION_IMAGE_MANIFEST:-}"
manifest_sha=''
controller_sha="${GITHUB_SHA:-}"
workflow_run_id="${GITHUB_RUN_ID:-}"
workflow_run_attempt="${GITHUB_RUN_ATTEMPT:-}"
workflow_ref="${GITHUB_WORKFLOW_REF:-}"
release_mode="${RELEASE_MODE:-}"
policy_validator_sha=''
if [ -n "${DEPLOYMENT_EVIDENCE_DIR:-}" ]; then
  [ "$target" = all ] || {
    echo "ERROR: DEPLOYED_NOT_LAUNCHED evidence requires target=all" >&2
    exit 2
  }
  [[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo "ERROR: SOURCE_SHA is required when writing maintenance evidence" >&2
    exit 2
  }
  [ -f "$manifest" ] || {
    echo "ERROR: PRODUCTION_IMAGE_MANIFEST is required when writing maintenance evidence" >&2
    exit 2
  }
  [[ "$controller_sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo "ERROR: GITHUB_SHA must bind maintenance evidence to the controller commit" >&2
    exit 2
  }
  [[ "$workflow_run_id" =~ ^[1-9][0-9]*$ && "$workflow_run_attempt" =~ ^[1-9][0-9]*$ ]] || {
    echo "ERROR: GitHub run id and attempt are required for maintenance evidence" >&2
    exit 2
  }
  [[ "$workflow_ref" == */.github/workflows/deploy-production.yml@refs/heads/main \
    || "$workflow_ref" == */.github/workflows/deploy-production-v2.yml@refs/heads/main ]] || {
    echo "ERROR: maintenance evidence must come from the main production controller" >&2
    exit 2
  }
  case "$release_mode" in promotion|maintenance-bootstrap|passport-promotion) ;; *)
    echo "ERROR: maintenance evidence requires a coordinated release mode" >&2
    exit 2 ;;
  esac
  jq -e --arg source "$source_sha" '
    .sourceCommit==$source
    and ([.images[].service]|sort)==["ai-gateway","api-web","workers"]
    and all(.images[];.sourceCommit==$source and (.image|type)=="string")
  ' "$manifest" >/dev/null || {
    echo "ERROR: production manifest does not match SOURCE_SHA" >&2
    exit 1
  }
  manifest_sha="$(sha256sum "$manifest" | awk '{print $1}')"
  policy_validator="$(cd "$(dirname "$0")/../.." && pwd)/infra/security/validate-production-maintenance-release.sh"
  [ -f "$policy_validator" ] || {
    echo "ERROR: maintenance release policy validator is missing" >&2
    exit 2
  }
  policy_validator_sha="$(sha256sum "$policy_validator" | awk '{print $1}')"
fi

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

param() {
  aws_cmd ssm get-parameter --region "$region" --name "$1" --query Parameter.Value --output text
}

header_value() {
  local name="$1" file="$2"
  awk -F: -v wanted="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" '
    tolower($1)==wanted {sub(/^[^:]*:[[:space:]]*/, ""); sub(/[[:space:]]*\r?$/, ""); value=$0}
    END {print value}
  ' "$file"
}

probe() {
  local label="$1" method="$2" url="$3" body_kind="$4" prefix status marker cache_control
  local set_cookie content_type body_sha body_size observed_at
  prefix="$work/$label"
  "$curl_bin" --silent --show-error --proto '=https' --max-time 20 "${curl_retry[@]}" \
    --request "$method" --header 'Accept: application/json, text/html' \
    --header 'Content-Type: application/json' --data-binary '{}' \
    --dump-header "$prefix.headers" --output "$prefix.body" --write-out '%{http_code}' \
    "$url" > "$prefix.status"
  status="$(cat "$prefix.status")"
  [ "$status" = 200 ] || { echo "ERROR: $label returned HTTP $status" >&2; exit 1; }
  marker="$(header_value X-Mangmee-Maintenance "$prefix.headers")"
  [ "$marker" = active ] \
    || { echo "ERROR: $label has no active maintenance marker" >&2; exit 1; }
  cache_control="$(header_value Cache-Control "$prefix.headers")"
  [[ "$cache_control" == *no-store* ]] \
    || { echo "ERROR: $label maintenance response is cacheable" >&2; exit 1; }
  set_cookie="$(header_value Set-Cookie "$prefix.headers")"
  [ -z "$set_cookie" ] \
    || { echo "ERROR: $label maintenance response set a cookie" >&2; exit 1; }
  content_type="$(header_value Content-Type "$prefix.headers")"
  if [ "$body_kind" = login-html ]; then
    [[ "$content_type" == text/html* ]]
    grep -Fq 'data-platform-access="closed"' "$prefix.body"
    grep -Fq 'ระบบกำลังปรับปรุง' "$prefix.body"
  elif [ "$body_kind" = access-json ]; then
    [[ "$content_type" == application/json* ]]
    jq -e '.state=="CLOSED"' "$prefix.body" >/dev/null
  else
    [[ "$content_type" == application/json* ]]
    jq -e '.code=="global_maintenance" and .statusCode==200' "$prefix.body" >/dev/null
  fi
  body_sha="$(sha256sum "$prefix.body" | awk '{print $1}')"
  body_size="$(wc -c < "$prefix.body" | tr -d '[:space:]')"
  [[ "$body_size" =~ ^[1-9][0-9]*$ ]] && [ "$body_size" -le 65536 ] \
    || { echo "ERROR: $label maintenance response body is invalid" >&2; exit 1; }
  observed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -cnS --arg label "$label" --arg method "$method" --arg url "$url" \
    --arg marker "$marker" --arg cacheControl "$cache_control" \
    --arg contentType "$content_type" --arg bodySha256 "$body_sha" \
    --arg observedAtUtc "$observed_at" --argjson status "$status" \
    --argjson bodySizeBytes "$body_size" '
    {label:$label,method:$method,url:$url,observedAtUtc:$observedAtUtc,
      status:$status,marker:$marker,cacheControl:$cacheControl,setCookieAbsent:true,
      contentType:$contentType,bodySha256:$bodySha256,bodySizeBytes:$bodySizeBytes}
  ' >> "$work/probes.ndjson"
}

service_contract() {
  case "$1" in
    api-web)
      printf '%s\t%s\n' \
        '/watchdog-bms/production/ecs-express-api-web-service-arn' \
        'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub' ;;
    ai-gateway)
      printf '%s\t%s\n' \
        '/watchdog-bms/production/ecs-express-ai-gateway-service-arn' \
        'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-ai-gateway-v2' ;;
    workers)
      printf '%s\t%s\n' \
        '/watchdog-bms/production/ecs-express-workers-service-arn' \
        'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-workers' ;;
    *) return 2 ;;
  esac
}

record_active_service() {
  local service="$1" raw_url="$2" arn_parameter expected_arn service_arn expected_image state
  IFS=$'\t' read -r arn_parameter expected_arn < <(service_contract "$service")
  service_arn="$(param "$arn_parameter")"
  [ "$service_arn" = "$expected_arn" ] || {
    echo "ERROR: $service service ARN is not the pinned production service" >&2
    exit 1
  }
  expected_image="$(jq -er --arg service "$service" '.images[]|select(.service==$service)|.image' "$manifest")"
  state="$work/${service}-state.json"
  aws_cmd ecs describe-express-gateway-service --region "$region" \
    --service-arn "$service_arn" --output json > "$state"
  jq -e --arg service "$service" --arg arn "$expected_arn" --arg image "$expected_image" \
    --arg source "$source_sha" --arg rawUrl "$raw_url" '
    .service as $state
    | def value($name):
        [$state.activeConfigurations[0].primaryContainer.environment[]?
          | select(.name==$name)|.value]
        | if length==1 then .[0] else null end;
    $state.serviceArn==$arn and $state.status.statusCode=="ACTIVE"
    and $state.currentDeployment==null
    and ($state.activeConfigurations|length)==1
    and $state.activeConfigurations[0].primaryContainer.image==$image
    and value("GIT_SHA")==$source
    and value("PRODUCTION_SERVING_MODE")=="maintenance_only"
    and ($state.activeConfigurations[0].ingressPaths|length)==1
    and $state.activeConfigurations[0].ingressPaths[0].accessType=="PUBLIC"
    and ("https://"+$state.activeConfigurations[0].ingressPaths[0].endpoint)==$rawUrl
    and (
      if $service=="api-web" then
        value("GLOBAL_MAINTENANCE_MODE")=="true"
        and value("REIMBURSEMENT_WRITE_QUIESCE")=="true"
        and value("CRM_AUTO_REPLY_ENABLED")=="false"
        and value("AI_GATEWAY_ENABLED")=="false"
        and value("LINE_AI_LEDGER_ENABLED")=="false"
      elif $service=="ai-gateway" then
        value("MODEL_PROVIDER")=="disabled"
        and value("AI_GATEWAY_ENABLED")=="false"
        and value("AI_AGENT_REGISTRY_ENABLED")=="false"
        and value("AI_TOOL_POLICY_ENFORCED")=="false"
        and value("AI_TOOL_AUDIT_ENABLED")=="false"
      elif $service=="workers" then value("QUEUE_ENABLED")=="false"
      else false end)
  ' "$state" >/dev/null || {
    echo "ERROR: $service active revision does not prove maintenance state" >&2
    exit 1
  }
  jq -cS --arg service "$service" --arg rawUrl "$raw_url" '
    .service as $state
    | def value($name):
        [$state.activeConfigurations[0].primaryContainer.environment[]?
          | select(.name==$name)|.value][0];
    {service:$service,serviceArn:$state.serviceArn,status:$state.status.statusCode,
      currentDeployment:$state.currentDeployment,
      serviceRevisionArn:$state.activeConfigurations[0].serviceRevisionArn,
      image:$state.activeConfigurations[0].primaryContainer.image,
      gitSha:value("GIT_SHA"),productionServingMode:value("PRODUCTION_SERVING_MODE"),
      rawOrigin:$rawUrl,
      maintenanceControls:(
        if $service=="api-web" then {globalMaintenanceMode:value("GLOBAL_MAINTENANCE_MODE"),
          reimbursementWriteQuiesce:value("REIMBURSEMENT_WRITE_QUIESCE"),
          crmAutoReplyEnabled:value("CRM_AUTO_REPLY_ENABLED"),
          aiGatewayEnabled:value("AI_GATEWAY_ENABLED"),lineAiLedgerEnabled:value("LINE_AI_LEDGER_ENABLED")}
        elif $service=="ai-gateway" then {modelProvider:value("MODEL_PROVIDER"),
          aiGatewayEnabled:value("AI_GATEWAY_ENABLED"),aiAgentRegistryEnabled:value("AI_AGENT_REGISTRY_ENABLED"),
          aiToolPolicyEnforced:value("AI_TOOL_POLICY_ENFORCED"),aiToolAuditEnabled:value("AI_TOOL_AUDIT_ENABLED")}
        else {queueEnabled:value("QUEUE_ENABLED")} end)}
  ' "$state" >> "$work/services.ndjson"
}

api_url="$(param /watchdog-bms/production/ecs-express-api-web-url)"
[[ "$api_url" =~ ^https://[a-z0-9-]+\.ecs\.ap-southeast-1\.on\.aws/?$ ]] \
  || { echo "ERROR: api-web raw origin is invalid" >&2; exit 1; }
api_url="${api_url%/}"

probe custom-page GET "$public_url/login" login-html
probe custom-access GET "$public_url/v1/auth/platform-access" access-json
probe custom-line POST "$public_url/v1/line/webhook" json
probe custom-crm-line POST "$public_url/v1/crm/line/webhook/maintenance-proof" json
probe raw-page GET "$api_url/login" login-html
probe raw-access GET "$api_url/v1/auth/platform-access" access-json
probe raw-line POST "$api_url/v1/line/webhook" json

if [ "$target" = all ]; then
  ai_url="$(param /watchdog-bms/production/ecs-express-ai-gateway-url)"
  [[ "$ai_url" =~ ^https://[a-z0-9-]+\.ecs\.ap-southeast-1\.on\.aws/?$ ]] \
    || { echo "ERROR: AI gateway raw origin is invalid" >&2; exit 1; }
  probe raw-ai POST "${ai_url%/}/v1/internal/line-ai/turn" json
fi

if [ -n "${DEPLOYMENT_EVIDENCE_DIR:-}" ]; then
  record_active_service api-web "$api_url"
  if [ "$target" = all ]; then
    record_active_service ai-gateway "${ai_url%/}"
    workers_url="$(param /watchdog-bms/production/ecs-express-workers-url)"
    [[ "$workers_url" =~ ^https://[a-z0-9-]+\.ecs\.ap-southeast-1\.on\.aws/?$ ]] \
      || { echo "ERROR: workers raw origin is invalid" >&2; exit 1; }
    record_active_service workers "${workers_url%/}"
  fi
  mkdir -p "$DEPLOYMENT_EVIDENCE_DIR"
  observed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -cnS --arg target "$target" --arg sourceSha "$source_sha" \
    --arg manifestSha256 "$manifest_sha" --arg observedAtUtc "$observed_at" \
    --arg controllerSha "$controller_sha" --arg workflowRunId "$workflow_run_id" \
    --arg workflowRunAttempt "$workflow_run_attempt" --arg workflowRef "$workflow_ref" \
    --arg releaseMode "$release_mode" --arg policyValidatorSha256 "$policy_validator_sha" \
    --slurpfile probes "$work/probes.ndjson" --slurpfile services "$work/services.ndjson" '
    {artifact:"production-maintenance-proof",schemaVersion:1,mode:"maintenance_only",
      attestationKind:"runtime-observation",releaseMode:$releaseMode,
      deploymentState:"DEPLOYED_NOT_LAUNCHED",notZeroProcessing:true,target:$target,
      observedAtUtc:$observedAtUtc,sourceSha:$sourceSha,manifestSha256:$manifestSha256,
      controller:{sha:$controllerSha,workflowRef:$workflowRef,runId:$workflowRunId,
        runAttempt:$workflowRunAttempt,policyValidatorSha256:$policyValidatorSha256},
      services:$services,probes:$probes}
  ' > "$DEPLOYMENT_EVIDENCE_DIR/maintenance-proof.json"
fi
echo "[maintenance] target=$target custom-and-raw-ingress=closed"
