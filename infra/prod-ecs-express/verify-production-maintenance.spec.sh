#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
verifier="$repo_root/infra/prod-ecs-express/verify-production-maintenance.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/production-maintenance-verifier.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/evidence"
source_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
manifest="$fixture/production-image-manifest.json"
jq -cnS --arg source "$source_sha" '
  {schemaVersion:1,sourceCommit:$source,images:[
    {service:"api-web",repository:"watchdog-bms-api",
      image:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:"+("1"*64)),
      digest:("sha256:"+("1"*64)),sourceCommit:$source},
    {service:"ai-gateway",repository:"watchdog-bms-ai-gateway",
      image:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-ai-gateway@sha256:"+("2"*64)),
      digest:("sha256:"+("2"*64)),sourceCommit:$source},
    {service:"workers",repository:"watchdog-bms-workers",
      image:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-workers@sha256:"+("3"*64)),
      digest:("sha256:"+("3"*64)),sourceCommit:$source}]}
' > "$manifest"

cat > "$fixture/bin/aws" <<'FAKE_AWS'
#!/usr/bin/env bash
set -euo pipefail
command="${1:-} ${2:-}"
name=''
service_arn=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) name="$2"; shift 2 ;;
    --service-arn) service_arn="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ "$command" = 'ssm get-parameter' ]; then
  case "$name" in
    */ecs-express-api-web-url) echo 'https://wa-api.ecs.ap-southeast-1.on.aws' ;;
    */ecs-express-ai-gateway-url) echo 'https://wa-ai.ecs.ap-southeast-1.on.aws' ;;
    */ecs-express-workers-url) echo 'https://wa-workers.ecs.ap-southeast-1.on.aws' ;;
    */ecs-express-api-web-service-arn)
      echo 'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub' ;;
    */ecs-express-ai-gateway-service-arn)
      echo 'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-ai-gateway-v2' ;;
    */ecs-express-workers-service-arn)
      echo 'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-workers' ;;
    *) exit 2 ;;
  esac
  exit 0
fi
[ "$command" = 'ecs describe-express-gateway-service' ] || exit 2
source_sha="${FAKE_SOURCE_SHA:?}"
case "$service_arn" in
  */watchdog-bms-api-web-pub)
    name=watchdog-bms-api-web-pub endpoint=wa-api digit=1 repository=watchdog-bms-api
    controls="[{\"name\":\"GLOBAL_MAINTENANCE_MODE\",\"value\":\"true\"},{\"name\":\"REIMBURSEMENT_WRITE_QUIESCE\",\"value\":\"${FAKE_REIMBURSEMENT_WRITE_QUIESCE:-true}\"},{\"name\":\"CRM_AUTO_REPLY_ENABLED\",\"value\":\"false\"},{\"name\":\"AI_GATEWAY_ENABLED\",\"value\":\"false\"},{\"name\":\"LINE_AI_LEDGER_ENABLED\",\"value\":\"false\"}]" ;;
  */watchdog-bms-ai-gateway-v2)
    name=watchdog-bms-ai-gateway-v2 endpoint=wa-ai digit=2 repository=watchdog-bms-ai-gateway
    controls='[{"name":"MODEL_PROVIDER","value":"disabled"},{"name":"AI_GATEWAY_ENABLED","value":"false"},{"name":"AI_AGENT_REGISTRY_ENABLED","value":"false"},{"name":"AI_TOOL_POLICY_ENFORCED","value":"false"},{"name":"AI_TOOL_AUDIT_ENABLED","value":"false"}]' ;;
  */watchdog-bms-workers)
    name=watchdog-bms-workers endpoint=wa-workers digit=3 repository=watchdog-bms-workers
    controls="[{\"name\":\"QUEUE_ENABLED\",\"value\":\"${FAKE_QUEUE_ENABLED:-false}\"}]" ;;
  *) exit 2 ;;
esac
jq -cnS --arg arn "$service_arn" --arg name "$name" --arg endpoint "$endpoint" \
  --arg source "$source_sha" --arg repository "$repository" --arg digit "$digit" \
  --argjson controls "$controls" '
  {service:{serviceArn:$arn,status:{statusCode:"ACTIVE"},currentDeployment:null,
    activeConfigurations:[{serviceRevisionArn:("arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/"+$name+"/1"),
      primaryContainer:{image:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/"+$repository+"@sha256:"+($digit*64)),
        environment:([{name:"GIT_SHA",value:$source},{name:"PRODUCTION_SERVING_MODE",value:"maintenance_only"}]+$controls)},
      ingressPaths:[{accessType:"PUBLIC",endpoint:($endpoint+".ecs.ap-southeast-1.on.aws")}]}]}}
'
FAKE_AWS

cat > "$fixture/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
method=GET
headers=''
body=''
url=''
retry=false
retry_delay=false
retry_max_time=false
retry_all_errors=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --request) method="$2"; shift 2 ;;
    --dump-header) headers="$2"; shift 2 ;;
    --output) body="$2"; shift 2 ;;
    --retry) [ "$2" = 2 ]; retry=true; shift 2 ;;
    --retry-delay) [ "$2" = 2 ]; retry_delay=true; shift 2 ;;
    --retry-max-time) [ "$2" = 70 ]; retry_max_time=true; shift 2 ;;
    --retry-all-errors) retry_all_errors=true; shift ;;
    --header|--data-binary|--proto|--max-time|--write-out) shift 2 ;;
    --silent|--show-error) shift ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
[ -n "$headers$body$url" ]
[ "$retry$retry_delay$retry_max_time$retry_all_errors" = truetruetruetrue ]
{
  echo 'HTTP/2 200'
  [ "${FAKE_MISSING_MARKER:-false}" = true ] || echo 'X-Mangmee-Maintenance: active'
  echo 'Cache-Control: no-store, max-age=0'
if [ "$method" = GET ] && [[ "$url" == */login ]]; then
    echo 'Content-Type: text/html; charset=utf-8'
  else
    echo 'Content-Type: application/json; charset=utf-8'
  fi
  [ "${FAKE_SET_COOKIE:-false}" = true ] && echo 'Set-Cookie: session=unsafe'
  echo
} > "$headers"
if [ "$method" = GET ] && [[ "$url" == */login ]]; then
  echo '<html><body data-platform-access="closed">ระบบกำลังปรับปรุง</body></html>' > "$body"
elif [ "$method" = GET ] && [[ "$url" == */v1/auth/platform-access ]]; then
  echo '{"state":"CLOSED"}' > "$body"
else
  echo '{"statusCode":200,"code":"global_maintenance","message":"Service temporarily unavailable."}' > "$body"
fi
printf 200
FAKE_CURL
chmod +x "$fixture/bin/aws" "$fixture/bin/curl"

bash -n "$verifier"
PRODUCTION_SERVING_MODE=maintenance_only \
  PUBLIC_DOMAIN_URL=https://mangmeeplus.com \
  SOURCE_SHA="$source_sha" PRODUCTION_IMAGE_MANIFEST="$manifest" \
  RELEASE_MODE=maintenance-bootstrap GITHUB_SHA="$source_sha" \
  GITHUB_RUN_ID=12345 GITHUB_RUN_ATTEMPT=2 \
  GITHUB_WORKFLOW_REF='MangmeeDev/mangmeeplus/.github/workflows/deploy-production.yml@refs/heads/main' \
  FAKE_SOURCE_SHA="$source_sha" \
  AWS_BIN="$fixture/bin/aws" CURL_BIN="$fixture/bin/curl" \
  DEPLOYMENT_EVIDENCE_DIR="$fixture/evidence" \
  bash "$verifier" all >/dev/null
manifest_sha="$(sha256sum "$manifest" | awk '{print $1}')"
jq -e --arg source "$source_sha" --arg manifestSha "$manifest_sha" '
  .artifact=="production-maintenance-proof" and .schemaVersion==1
  and .attestationKind=="runtime-observation" and .releaseMode=="maintenance-bootstrap"
  and .mode=="maintenance_only" and .deploymentState=="DEPLOYED_NOT_LAUNCHED"
  and .notZeroProcessing==true and .target=="all"
  and .sourceSha==$source and .manifestSha256==$manifestSha
  and (.observedAtUtc|test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
  and .controller.sha==$source and .controller.runId=="12345"
  and .controller.runAttempt=="2"
  and (.controller.workflowRef|endswith("deploy-production.yml@refs/heads/main"))
  and (.controller.policyValidatorSha256|test("^[0-9a-f]{64}$"))
  and (.probes|length)==8
  and all(.probes[];.status==200 and .marker=="active" and .setCookieAbsent==true
    and (.cacheControl|contains("no-store"))
    and (.contentType|test("^(text/html|application/json)"))
    and (.bodySha256|test("^[0-9a-f]{64}$")) and .bodySizeBytes>0
    and (.observedAtUtc|test("Z$")))
  and (.services|length)==3
  and ([.services[].service]|sort)==["ai-gateway","api-web","workers"]
  and all(.services[];.status=="ACTIVE" and .currentDeployment==null
    and .gitSha==$source and .productionServingMode=="maintenance_only"
    and (.image|test("@sha256:[0-9a-f]{64}$")))
  and (.services[]|select(.service=="api-web")
    | .maintenanceControls.globalMaintenanceMode=="true"
      and .maintenanceControls.reimbursementWriteQuiesce=="true"
      and .maintenanceControls.aiGatewayEnabled=="false")
  and (.services[]|select(.service=="workers")|.maintenanceControls.queueEnabled=="false")
' "$fixture/evidence/maintenance-proof.json" >/dev/null

# Evidence mode must bind to an exact source/manifest and reject active environment drift.
if PRODUCTION_SERVING_MODE=maintenance_only PUBLIC_DOMAIN_URL=https://mangmeeplus.com \
  FAKE_SOURCE_SHA="$source_sha" AWS_BIN="$fixture/bin/aws" CURL_BIN="$fixture/bin/curl" \
  DEPLOYMENT_EVIDENCE_DIR="$fixture/missing-source" bash "$verifier" all >/dev/null 2>&1; then
  echo 'ERROR: evidence was written without SOURCE_SHA and manifest' >&2
  exit 1
fi
if PRODUCTION_SERVING_MODE=maintenance_only PUBLIC_DOMAIN_URL=https://mangmeeplus.com \
  SOURCE_SHA="$source_sha" PRODUCTION_IMAGE_MANIFEST="$manifest" FAKE_SOURCE_SHA="$source_sha" \
  AWS_BIN="$fixture/bin/aws" CURL_BIN="$fixture/bin/curl" \
  DEPLOYMENT_EVIDENCE_DIR="$fixture/api-only" bash "$verifier" api-web >/dev/null 2>&1; then
  echo 'ERROR: DEPLOYED_NOT_LAUNCHED evidence accepted target=api-web' >&2
  exit 1
fi
if PRODUCTION_SERVING_MODE=maintenance_only PUBLIC_DOMAIN_URL=https://mangmeeplus.com \
  SOURCE_SHA="$source_sha" PRODUCTION_IMAGE_MANIFEST="$manifest" \
  RELEASE_MODE=maintenance-bootstrap GITHUB_SHA="$source_sha" \
  GITHUB_RUN_ID=12345 GITHUB_RUN_ATTEMPT=2 GITHUB_WORKFLOW_REF='unsafe/ref' \
  FAKE_SOURCE_SHA="$source_sha" AWS_BIN="$fixture/bin/aws" CURL_BIN="$fixture/bin/curl" \
  DEPLOYMENT_EVIDENCE_DIR="$fixture/bad-controller" bash "$verifier" all >/dev/null 2>&1; then
  echo 'ERROR: maintenance evidence accepted an untrusted workflow ref' >&2
  exit 1
fi
if FAKE_QUEUE_ENABLED=true PRODUCTION_SERVING_MODE=maintenance_only \
  PUBLIC_DOMAIN_URL=https://mangmeeplus.com SOURCE_SHA="$source_sha" \
  PRODUCTION_IMAGE_MANIFEST="$manifest" FAKE_SOURCE_SHA="$source_sha" \
  RELEASE_MODE=maintenance-bootstrap GITHUB_SHA="$source_sha" \
  GITHUB_RUN_ID=12345 GITHUB_RUN_ATTEMPT=2 \
  GITHUB_WORKFLOW_REF='MangmeeDev/mangmeeplus/.github/workflows/deploy-production.yml@refs/heads/main' \
  AWS_BIN="$fixture/bin/aws" CURL_BIN="$fixture/bin/curl" \
  DEPLOYMENT_EVIDENCE_DIR="$fixture/queue-drift" bash "$verifier" all >/dev/null 2>&1; then
  echo 'ERROR: active worker queue drift was accepted as maintenance evidence' >&2
  exit 1
fi
if FAKE_REIMBURSEMENT_WRITE_QUIESCE=false PRODUCTION_SERVING_MODE=maintenance_only \
  PUBLIC_DOMAIN_URL=https://mangmeeplus.com SOURCE_SHA="$source_sha" \
  PRODUCTION_IMAGE_MANIFEST="$manifest" FAKE_SOURCE_SHA="$source_sha" \
  AWS_BIN="$fixture/bin/aws" CURL_BIN="$fixture/bin/curl" \
  DEPLOYMENT_EVIDENCE_DIR="$fixture/quiesce-drift" bash "$verifier" all >/dev/null 2>&1; then
  echo 'ERROR: active API write-quiesce drift was accepted as maintenance evidence' >&2
  exit 1
fi

if PRODUCTION_SERVING_MODE=live PUBLIC_DOMAIN_URL=https://mangmeeplus.com \
  AWS_BIN="$fixture/bin/aws" CURL_BIN="$fixture/bin/curl" bash "$verifier" api-web >/dev/null 2>&1; then
  echo 'ERROR: live serving mode was accepted by the maintenance verifier' >&2
  exit 1
fi
if FAKE_MISSING_MARKER=true PRODUCTION_SERVING_MODE=maintenance_only \
  PUBLIC_DOMAIN_URL=https://mangmeeplus.com FAKE_SOURCE_SHA="$source_sha" \
  AWS_BIN="$fixture/bin/aws" CURL_BIN="$fixture/bin/curl" \
  bash "$verifier" api-web >/dev/null 2>&1; then
  echo 'ERROR: missing runtime maintenance marker was accepted' >&2
  exit 1
fi
if FAKE_SET_COOKIE=true PRODUCTION_SERVING_MODE=maintenance_only \
  PUBLIC_DOMAIN_URL=https://mangmeeplus.com FAKE_SOURCE_SHA="$source_sha" \
  AWS_BIN="$fixture/bin/aws" CURL_BIN="$fixture/bin/curl" \
  bash "$verifier" api-web >/dev/null 2>&1; then
  echo 'ERROR: maintenance response with Set-Cookie was accepted' >&2
  exit 1
fi

echo 'production maintenance external verifier: PASS'
