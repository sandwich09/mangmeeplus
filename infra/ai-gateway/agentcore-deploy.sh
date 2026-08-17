#!/usr/bin/env bash
# AgentCore Runtime deployment – Phase 5 (WatchDog-BMS item 10B).
# Run from workspace root: bash infra/ai-gateway/agentcore-deploy.sh
#
# Prerequisites:
#   - AWS CLI v2 with deploy role in ap-southeast-1
#   - jq
#   - Workspace packages built (contracts + config)
#   - ERP_CORE_INTERNAL_URL exported (private URL of the WatchDog API)
#   - PUBLIC_BASE_URL exported (internal/ops URL used by production config validation)
#
# NEVER commit AWS credentials, provider keys, or LINE secrets.
# AI_FINAL_MUTATION_ENABLED and AI_PROMPT_LOGGING_ENABLED MUST stay false.

set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-1}"
: "${DEPLOY_ENVIRONMENT:=production}"
case "$DEPLOY_ENVIRONMENT" in uat|production) ;; *) echo 'ERROR: DEPLOY_ENVIRONMENT must be uat or production' >&2; exit 1 ;; esac
RUNTIME_NAME="${AGENTCORE_RUNTIME_NAME:-watchdog_orchestrator_${DEPLOY_ENVIRONMENT}_candidate}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "$REGION")
BUCKET="${AGENTCORE_ARTIFACT_BUCKET:-watchdog-bms-agentcore-artifacts-${ACCOUNT_ID}}"
SOURCE_COMMIT="${SOURCE_COMMIT:-$(git rev-parse HEAD)}"
if [[ ! "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || [ "$(git rev-parse HEAD)" != "$SOURCE_COMMIT" ]; then
  echo "ERROR: SOURCE_COMMIT must be the exact checked-out commit" >&2
  exit 1
fi
GIT_SHA="$SOURCE_COMMIT"
ROLE_ARN="${AGENTCORE_EXECUTION_ROLE_ARN:-arn:aws:iam::${ACCOUNT_ID}:role/watchdog-bms-agentcore-execution-role}"
ROLE_NAME="${ROLE_ARN##*/}"
SECRET_PREFIX="${AGENTCORE_SECRET_PREFIX:-watchdog-bms/${DEPLOY_ENVIRONMENT}}"
AI_GATEWAY_SECRET_ARN=$(aws secretsmanager describe-secret \
  --secret-id "$SECRET_PREFIX/ai-gateway-internal-secret" \
  --query ARN --output text --region "$REGION")
# The runtime loads the shared aiGatewayConfigSchema, which always carries
# JWT_CLOCK_TOLERANCE_SECONDS - and validateProductionConfig requires the JWT trio of anything that
# does, whether or not it verifies a token itself. Omitting these does not degrade the runtime, it
# stops it booting: every invocation returns 500 from config validation, and AgentCore has no log
# group by default to say so.
WATCHDOG_JWT_SECRET_SOURCE_ARN=$(aws secretsmanager describe-secret \
  --secret-id "$SECRET_PREFIX/watchdog-jwt-secret" \
  --query ARN --output text --region "$REGION")

# ── Required env vars ──────────────────────────────────────────────────────────
: "${ERP_CORE_INTERNAL_URL:?ERP_CORE_INTERNAL_URL is required (private WatchDog API URL)}"
: "${PUBLIC_BASE_URL:?PUBLIC_BASE_URL is required for production config validation}"
: "${BEDROCK_MODEL_ID:=global.anthropic.claude-sonnet-4-6}"
: "${AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF:?AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF is required for the global Sonnet 4.6 profile}"
: "${SERVICE_VERSION:=$GIT_SHA}"
# L-04: these pin the token identity and must equal what the API *signs* with, not this runtime's
# own URL. They default to the values the production api-web task carries; check that task
# definition before overriding, because a mismatch boots green and then rejects every real token.
: "${WATCHDOG_JWT_ISSUER:=$PUBLIC_BASE_URL}"
: "${WATCHDOG_JWT_AUDIENCE:=watchdog-bms-production}"

echo "[agentcore-deploy] account=$ACCOUNT_ID region=$REGION sha=$GIT_SHA"

# ── 1. Resolve an exact clean-CI artifact (or build from a clean checkout) ─────
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT
if [ -n "${AGENTCORE_ARTIFACT_MANIFEST:-}" ]; then
  manifest="$(cd "$(dirname "$AGENTCORE_ARTIFACT_MANIFEST")" && pwd -P)/$(basename "$AGENTCORE_ARTIFACT_MANIFEST")"
  test "$(jq -er '.schemaVersion' "$manifest")" = "1"
  test "$(jq -er '.sourceCommit' "$manifest")" = "$SOURCE_COMMIT"
  test "$(jq -er '.artifact' "$manifest")" = "agentcore.zip"
  cp "$(dirname "$manifest")/agentcore.zip" "$STAGING/agentcore.zip"
  expected_sha="$(jq -er '.sha256' "$manifest")"
  actual_sha="$(shasum -a 256 "$STAGING/agentcore.zip" | awk '{print $1}')"
  if [[ ! "$expected_sha" =~ ^[0-9a-f]{64}$ ]] || [ "$actual_sha" != "$expected_sha" ]; then
    echo "ERROR: AgentCore artifact checksum mismatch" >&2
    exit 1
  fi
else
  bash infra/ai-gateway/build-agentcore-artifact.sh "$STAGING/built" "$SOURCE_COMMIT"
  cp "$STAGING/built/agentcore.zip" "$STAGING/agentcore.zip"
  actual_sha="$(jq -er '.sha256' "$STAGING/built/agentcore-artifact.json")"
fi
DEPLOY_KEY="agentcore/${RUNTIME_NAME}-${SOURCE_COMMIT}-${actual_sha}.zip"
ARTIFACT_SIZE=$(du -sh "$STAGING/agentcore.zip" | cut -f1)
echo "[agentcore-deploy] artifact size=$ARTIFACT_SIZE sha256=$actual_sha"

# ── 2. Upload to a versioned, content-addressed S3 key ─────────────────────────
echo "[agentcore-deploy] uploading to s3://${BUCKET}/${DEPLOY_KEY}..."
aws s3 mb "s3://${BUCKET}" --region "$REGION" 2>/dev/null || true
aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled \
  --region "$REGION"
if object_json=$(aws s3api head-object --bucket "$BUCKET" --key "$DEPLOY_KEY" \
    --region "$REGION" --output json 2>"$STAGING/head-object.err"); then
  S3_VERSION=$(jq -er '.VersionId' <<< "$object_json")
  aws s3api get-object --bucket "$BUCKET" --key "$DEPLOY_KEY" --version-id "$S3_VERSION" \
    --region "$REGION" "$STAGING/existing-agentcore.zip" >/dev/null
  test "$(shasum -a 256 "$STAGING/existing-agentcore.zip" | awk '{print $1}')" = "$actual_sha" || {
    echo 'ERROR: existing content-addressed AgentCore object has different bytes' >&2
    exit 1
  }
  echo "[agentcore-deploy] reusing existing content-addressed object version $S3_VERSION"
elif grep -qE 'Not Found|NotFound|NoSuchKey|404' "$STAGING/head-object.err"; then
  aws s3 cp "$STAGING/agentcore.zip" "s3://${BUCKET}/${DEPLOY_KEY}" --region "$REGION"
  S3_VERSION=$(aws s3api head-object --bucket "$BUCKET" --key "$DEPLOY_KEY" \
    --query VersionId --output text --region "$REGION")
else
  cat "$STAGING/head-object.err" >&2
  echo 'ERROR: cannot read the content-addressed AgentCore object; refusing to overwrite it' >&2
  exit 1
fi
if [ "$S3_VERSION" = "None" ] || [ "$S3_VERSION" = "null" ]; then
  S3_VERSION=""
fi
if [ -z "$S3_VERSION" ]; then
  echo "ERROR: AgentCore artifact has no S3 version ID; refusing a mutable runtime reference" >&2
  exit 1
fi

# ── 3. Execution role (create if missing) ─────────────────────────────────────
echo "[agentcore-deploy] ensuring execution role..."
sed -e "s|<ACCOUNT_ID>|$ACCOUNT_ID|g" \
  -e "s|<AGENTCORE_RUNTIME_ARN>|arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/${RUNTIME_NAME}-*|g" \
  infra/ai-gateway/agentcore-execution-role-trust.template.json > "$STAGING/trust.json"
if aws iam get-role --role-name "$ROLE_NAME" >"$STAGING/execution-role.json" 2>"$STAGING/execution-role.err"; then
  :
elif grep -qE 'NoSuchEntity|cannot be found' "$STAGING/execution-role.err"; then
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$STAGING/trust.json"
else
  cat "$STAGING/execution-role.err" >&2
  echo 'ERROR: cannot read the AgentCore execution role; refusing to guess that it is absent' >&2
  exit 1
fi
aws iam update-assume-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-document "file://$STAGING/trust.json"
# Replace placeholder before applying
sed -e "s|<ACCOUNT_ID>|$ACCOUNT_ID|g" \
  -e "s|<AI_GATEWAY_SECRET_ARN>|$AI_GATEWAY_SECRET_ARN|g" \
  -e "s|<WATCHDOG_JWT_SECRET_SOURCE_ARN>|$WATCHDOG_JWT_SECRET_SOURCE_ARN|g" \
  infra/ai-gateway/agentcore-execution-role-policy.json > "$STAGING/policy.json"
if grep -q '<[A-Z_]*>' "$STAGING/policy.json"; then
  echo "ERROR: execution role policy still has unsubstituted placeholders" >&2
  grep -o '<[A-Z_]*>' "$STAGING/policy.json" | sort -u >&2
  exit 1
fi
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name watchdog-bms-agentcore-permissions \
  --policy-document "file://$STAGING/policy.json"

# ── 4. Build runtime artifact JSON ────────────────────────────────────────────
ARTIFACT_JSON=$(cat <<EOF
{
  "codeConfiguration": {
    "code": {
      "s3": {
        "bucket": "${BUCKET}",
        "prefix": "${DEPLOY_KEY}",
        "versionId": "${S3_VERSION}"
      }
    },
    "runtime": "NODE_22",
    "entryPoint": ["runtime.js"]
  }
}
EOF
)

# F1.5.1 — APP_ENV alone no longer boots. validateProductionConfig demands the authoritative
# deployment identity (DEPLOY_ENVIRONMENT + full GIT_SHA) beside it, or every AgentCore invocation
# dies in config validation. This script deploys the single production runtime, so
# DEPLOY_ENVIRONMENT is a literal; GIT_SHA is the exact 40-hex SOURCE_COMMIT verified above, never
# a short tag. Keep both siblings of APP_ENV — packages/config/src/deployment-identity-manifest.test.ts
# fails CI if any runtime definition in this repo sets APP_ENV without them.
ENV_VARS=$(cat <<EOF
{
  "APP_ENV": "production",
  "DEPLOY_ENVIRONMENT": "${DEPLOY_ENVIRONMENT}",
  "SERVICE_NAME": "watchdog-agentcore-orchestrator",
  "SERVICE_VERSION": "${SERVICE_VERSION}",
  "GIT_SHA": "${GIT_SHA}",
  "AGENTCORE_ARTIFACT_SHA256": "${actual_sha}",
  "PUBLIC_BASE_URL": "${PUBLIC_BASE_URL}",
  "CORS_ALLOWED_ORIGINS": "${PUBLIC_BASE_URL}",
  "PORT": "8080",
  "LOG_FORMAT": "json",
  "LOG_REDACTION_ENABLED": "true",
  "MODEL_PROVIDER": "bedrock",
  "APPROVED_AI_PROVIDERS": "bedrock",
  "APPROVED_AI_MODEL_IDS": "${BEDROCK_MODEL_ID}",
  "APPROVED_AI_REGIONS": "${REGION}",
  "AI_GLOBAL_INFERENCE_PROFILE_APPROVED": "true",
  "AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF": "${AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF}",
  "BEDROCK_REGION": "${REGION}",
  "BEDROCK_MODEL_ID": "${BEDROCK_MODEL_ID}",
  "ERP_CORE_INTERNAL_URL": "${ERP_CORE_INTERNAL_URL}",
  "AI_GATEWAY_INTERNAL_SECRET_ARN": "${AI_GATEWAY_SECRET_ARN}",
  "WATCHDOG_JWT_SECRET_SOURCE_ARN": "${WATCHDOG_JWT_SECRET_SOURCE_ARN}",
  "WATCHDOG_JWT_ISSUER": "${WATCHDOG_JWT_ISSUER}",
  "WATCHDOG_JWT_AUDIENCE": "${WATCHDOG_JWT_AUDIENCE}",
  "AI_FINAL_MUTATION_ENABLED": "false",
  "AI_PROMPT_LOGGING_ENABLED": "false",
  "AI_TOOL_TIMEOUT_MS": "15000",
  "AI_MAX_TOOL_CALLS": "8",
  "AGENTCORE_MAX_BODY_BYTES": "${AGENTCORE_MAX_BODY_BYTES:-1048576}",
  "AGENTCORE_MAX_MESSAGE_CHARS": "${AGENTCORE_MAX_MESSAGE_CHARS:-8000}",
  "AGENTCORE_MAX_ATTACHMENTS": "${AGENTCORE_MAX_ATTACHMENTS:-10}",
  "AGENTCORE_MAX_CONCURRENT_INVOCATIONS": "${AGENTCORE_MAX_CONCURRENT_INVOCATIONS:-16}",
  "AI_TOOL_POLICY_ENFORCED": "true",
  "AI_TOOL_AUDIT_ENABLED": "true",
  "NODE_ENV": "production"
}
EOF
)
ENV_SHA=$(printf '%s' "$ENV_VARS" | jq -cS . | shasum -a 256 | awk '{print $1}')
[[ "$ENV_SHA" =~ ^[0-9a-f]{64}$ ]]

# ── 5. Create or update runtime ────────────────────────────────────────────────
EXISTING_ID=$(aws bedrock-agentcore-control list-agent-runtimes --region "$REGION" \
  --query "agentRuntimes[?agentRuntimeName=='$RUNTIME_NAME'].agentRuntimeId" \
  --output text)

wait_for_runtime_ready() {
  local phase="$1" runtime_id="$2" status="" runtime_json=""
  echo "[agentcore-deploy] waiting for ${phase} READY status (up to 5 min)..."
  for i in $(seq 1 30); do
    runtime_json=$(aws bedrock-agentcore-control get-agent-runtime \
      --region "$REGION" --agent-runtime-id "$runtime_id" --output json)
    status=$(jq -er '.status' <<< "$runtime_json")
    echo "[agentcore-deploy] ${phase} status=$status (attempt $i/30)"
    case "$status" in
      READY) return 0 ;;
      CREATE_FAILED|UPDATE_FAILED|FAILED)
        jq -r '.failureReason // "runtime failed without a reason"' <<< "$runtime_json" >&2
        return 1
        ;;
      DELETING)
        echo "ERROR: runtime entered DELETING during ${phase}" >&2
        return 1
        ;;
    esac
    sleep 10
  done
  echo "ERROR: runtime did not reach READY during ${phase} (status=${status:-unknown})" >&2
  return 1
}

runtime_matches_intent() {
  jq -e \
    --arg arn "$RUNTIME_ARN" --arg role "$ROLE_ARN" \
    --argjson artifact "$ARTIFACT_JSON" --argjson environment "$ENV_VARS" '
      .agentRuntimeArn == $arn and .roleArn == $role and .status == "READY"
      and .networkConfiguration.networkMode == "PUBLIC"
      and .protocolConfiguration.serverProtocol == "HTTP"
      and .metadataConfiguration.requireMMDSV2 == true
      and .agentRuntimeArtifact == $artifact
      and .environmentVariables == $environment
    ' >/dev/null
}

if [ -z "$EXISTING_ID" ] || [ "$EXISTING_ID" = "None" ]; then
  echo "[agentcore-deploy] creating new runtime..."
  RESULT=$(aws bedrock-agentcore-control create-agent-runtime \
    --region "$REGION" \
    --agent-runtime-name "$RUNTIME_NAME" \
    --agent-runtime-artifact "$ARTIFACT_JSON" \
    --role-arn "$ROLE_ARN" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --protocol-configuration '{"serverProtocol":"HTTP"}' \
    --environment-variables "$ENV_VARS" \
    --client-token "watchdog-${DEPLOY_ENVIRONMENT}-${SOURCE_COMMIT}-${actual_sha:0:16}-${ENV_SHA:0:16}-create" \
    --tags "Environment=$DEPLOY_ENVIRONMENT,ManagedBy=watchdog-release" \
    --description "WatchDog BMS LINE AI orchestrator – item 10B")
  RUNTIME_ID=$(echo "$RESULT" | jq -r '.agentRuntimeId')
  echo "[agentcore-deploy] created runtime id=$RUNTIME_ID"
else
  RUNTIME_ID="$EXISTING_ID"
fi
[[ "$RUNTIME_ID" =~ ^[A-Za-z][A-Za-z0-9_]{0,99}-[A-Za-z0-9]{10}$ ]]

RUNTIME_ARN="arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/${RUNTIME_ID}"
echo "[agentcore-deploy] ARN: $RUNTIME_ARN"
sed -e "s|<ACCOUNT_ID>|$ACCOUNT_ID|g" \
  -e "s|<AGENTCORE_RUNTIME_ARN>|$RUNTIME_ARN|g" \
  infra/ai-gateway/agentcore-execution-role-trust.template.json > "$STAGING/trust.json"
aws iam update-assume-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-document "file://$STAGING/trust.json"

if [ -z "$EXISTING_ID" ] || [ "$EXISTING_ID" = "None" ]; then
  # CreateAgentRuntime has no metadataConfiguration input. AWS requires MMDSv2 to be enabled through
  # UpdateAgentRuntime before invocation, so the first create must settle before this mandatory update.
  wait_for_runtime_ready create "$RUNTIME_ID"
fi

RUNTIME_JSON=$(aws bedrock-agentcore-control get-agent-runtime \
  --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --output json)
if [ "$(jq -er '.status' <<< "$RUNTIME_JSON")" != READY ]; then
  wait_for_runtime_ready existing-runtime "$RUNTIME_ID"
  RUNTIME_JSON=$(aws bedrock-agentcore-control get-agent-runtime \
    --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --output json)
fi
if runtime_matches_intent <<< "$RUNTIME_JSON"; then
  echo "[agentcore-deploy] exact runtime configuration is already READY; reusing its immutable version"
else
  echo "[agentcore-deploy] applying full runtime configuration with MMDSv2..."
  RESULT=$(aws bedrock-agentcore-control update-agent-runtime \
    --region "$REGION" \
    --agent-runtime-id "$RUNTIME_ID" \
    --agent-runtime-artifact "$ARTIFACT_JSON" \
    --role-arn "$ROLE_ARN" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --metadata-configuration '{"requireMMDSV2":true}' \
    --protocol-configuration '{"serverProtocol":"HTTP"}' \
    --environment-variables "$ENV_VARS" \
    --client-token "watchdog-${DEPLOY_ENVIRONMENT}-${SOURCE_COMMIT}-${actual_sha:0:16}-${ENV_SHA:0:16}-mmdsv2")
  test "$(jq -er '.agentRuntimeId' <<< "$RESULT")" = "$RUNTIME_ID"
  wait_for_runtime_ready mmdsv2-update "$RUNTIME_ID"
fi

# Never mint a binding from intended values alone. Read the complete provider state back before the
# endpoint or either smoke invocation can make the candidate appear usable.
RUNTIME_JSON=$(aws bedrock-agentcore-control get-agent-runtime \
  --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --output json)
RUNTIME_STATUS=$(jq -er '.status' <<< "$RUNTIME_JSON")
runtime_matches_intent <<< "$RUNTIME_JSON"

# Every runtime update creates an immutable version. Bind this candidate to a source-specific custom
# endpoint; DEFAULT follows latest and can silently move Production before ECS is promoted.
RUNTIME_VERSION=$(jq -er '.agentRuntimeVersion' <<< "$RUNTIME_JSON")
[[ "$RUNTIME_VERSION" =~ ^[1-9][0-9]{0,4}$ ]]
ENDPOINT_NAME="candidate_${DEPLOY_ENVIRONMENT}_${SOURCE_COMMIT:0:12}"

# AWS counts DEFAULT in its per-runtime endpoint quota. Preserve every qualifier referenced by any
# active ECS configuration and retire only old endpoints inside this environment's isolated runtime.
service_arn=$(aws ssm get-parameter --region "$REGION" \
  --name "/watchdog-bms/${DEPLOY_ENVIRONMENT}/ecs-express-ai-gateway-service-arn" \
  --query Parameter.Value --output text)
[[ "$service_arn" == arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/* ]]
service_json=$(aws ecs describe-express-gateway-service \
  --region "$REGION" --service "$service_arn" --output json)
jq -e '.service.activeConfigurations | type == "array" and length > 0' \
  <<< "$service_json" >/dev/null
PROTECTED_ENDPOINT_NAMES_JSON=$(jq -ce --arg runtime "$RUNTIME_ARN" '
  [.service.activeConfigurations[] | (.primaryContainer.environment // [] | from_entries)
      | select(.AGENTCORE_RUNTIME_ARN == $runtime)
      | .AGENTCORE_RUNTIME_QUALIFIER
      | select(type == "string" and length > 0)]
  | unique
' <<< "$service_json")
endpoint_is_protected() {
  jq -e --arg endpoint "$1" 'index($endpoint) != null' \
    <<< "$PROTECTED_ENDPOINT_NAMES_JSON" >/dev/null
}

if endpoint_json=$(aws bedrock-agentcore-control get-agent-runtime-endpoint \
    --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --endpoint-name "$ENDPOINT_NAME" \
    --output json 2>"$STAGING/endpoint.err"); then
  printf '%s\n' "$endpoint_json" > "$STAGING/endpoint.json"
  if ! bash infra/ai-gateway/validate-agentcore-endpoint-readback.sh \
      "$STAGING/endpoint.json" "$RUNTIME_ARN" "$ENDPOINT_NAME" "$RUNTIME_VERSION" intended \
      2>"$STAGING/endpoint-validation.err"; then
    jq -e --arg arn "$RUNTIME_ARN" --arg name "$ENDPOINT_NAME" '
      .agentRuntimeArn == $arn
      and .agentRuntimeEndpointArn == ($arn + "/runtime-endpoint/" + $name)
      and .name == $name
    ' "$STAGING/endpoint.json" >/dev/null || {
      cat "$STAGING/endpoint-validation.err" >&2
      echo 'ERROR: refusing to update an endpoint with mismatched provider identity' >&2
      exit 1
    }
    if endpoint_is_protected "$ENDPOINT_NAME"; then
      echo 'ERROR: refusing to repoint the source endpoint while active ECS still references it' >&2
      exit 1
    fi
    endpoint_json=$(aws bedrock-agentcore-control update-agent-runtime-endpoint \
      --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --endpoint-name "$ENDPOINT_NAME" \
      --agent-runtime-version "$RUNTIME_VERSION" \
      --description "WatchDog LINE AI ${DEPLOY_ENVIRONMENT} candidate ${SOURCE_COMMIT}" \
      --client-token "watchdog-${DEPLOY_ENVIRONMENT}-${SOURCE_COMMIT}-${actual_sha:0:16}-update" \
      --output json)
  fi
elif grep -qE 'ResourceNotFoundException|does not exist|cannot be found' "$STAGING/endpoint.err"; then
  endpoints_json=$(aws bedrock-agentcore-control list-agent-runtime-endpoints \
    --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --max-results 100 --output json)
  while IFS= read -r stale_endpoint; do
    [ -n "$stale_endpoint" ] || continue
    if endpoint_is_protected "$stale_endpoint"; then
      echo "[agentcore-deploy] preserving live endpoint $stale_endpoint"
      continue
    fi
    echo "[agentcore-deploy] retiring stale endpoint $stale_endpoint"
    aws bedrock-agentcore-control delete-agent-runtime-endpoint \
      --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --endpoint-name "$stale_endpoint" \
      --client-token "watchdog-${DEPLOY_ENVIRONMENT}-${SOURCE_COMMIT}-${stale_endpoint}-delete" \
      --output json >/dev/null
    deleted=false
    for i in $(seq 1 30); do
      if ! aws bedrock-agentcore-control get-agent-runtime-endpoint \
          --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --endpoint-name "$stale_endpoint" \
          --output json >"$STAGING/deleting-endpoint.json" 2>"$STAGING/deleting-endpoint.err"; then
        if grep -qE 'ResourceNotFoundException|does not exist|cannot be found' "$STAGING/deleting-endpoint.err"; then
          deleted=true
          break
        fi
        cat "$STAGING/deleting-endpoint.err" >&2
        exit 1
      fi
      sleep 2
    done
    [ "$deleted" = true ] || { echo "ERROR: stale endpoint $stale_endpoint did not delete" >&2; exit 1; }
  done < <(jq -r --arg environment "$DEPLOY_ENVIRONMENT" --arg intended "$ENDPOINT_NAME" \
    --argjson protected "$PROTECTED_ENDPOINT_NAMES_JSON" \
    -f infra/ai-gateway/select-retirable-agentcore-endpoints.jq <<< "$endpoints_json")
  endpoint_json=$(aws bedrock-agentcore-control create-agent-runtime-endpoint \
    --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --name "$ENDPOINT_NAME" \
    --agent-runtime-version "$RUNTIME_VERSION" \
    --description "WatchDog LINE AI ${DEPLOY_ENVIRONMENT} candidate ${SOURCE_COMMIT}" \
    --client-token "watchdog-${DEPLOY_ENVIRONMENT}-${SOURCE_COMMIT}-${actual_sha:0:16}" \
    --tags "Environment=$DEPLOY_ENVIRONMENT,ManagedBy=watchdog-release" \
    --output json)
else
  cat "$STAGING/endpoint.err" >&2
  echo 'ERROR: cannot read the candidate endpoint; refusing to guess that it is absent' >&2
  exit 1
fi
for i in $(seq 1 30); do
  endpoint_json=$(aws bedrock-agentcore-control get-agent-runtime-endpoint \
    --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --endpoint-name "$ENDPOINT_NAME" --output json)
  ENDPOINT_STATUS=$(jq -er '.status' <<< "$endpoint_json")
  [ "$ENDPOINT_STATUS" = READY ] && break
  case "$ENDPOINT_STATUS" in
    CREATE_FAILED|UPDATE_FAILED)
      jq -r '.failureReason // "candidate endpoint failed without a reason"' <<< "$endpoint_json" >&2
      exit 1
      ;;
    DELETING)
      echo 'ERROR: source-specific candidate endpoint is being deleted' >&2
      exit 1
      ;;
  esac
  sleep 10
done
printf '%s\n' "$endpoint_json" > "$STAGING/endpoint.json"
bash infra/ai-gateway/validate-agentcore-endpoint-readback.sh \
  "$STAGING/endpoint.json" "$RUNTIME_ARN" "$ENDPOINT_NAME" "$RUNTIME_VERSION" ready
ENDPOINT_ARN=$(jq -er '.agentRuntimeEndpointArn' <<< "$endpoint_json")

# A smoke result that is only printed is not a check. Both invocations below used to swallow their
# exit status with `|| true` and let the script reach "Deploy Complete" and exit 0 - which is how a
# runtime that answered 500 to every request was reported as a successful deploy. `invoke-agent-runtime`
# exits non-zero on a runtime error, so the status is the signal; keep the body for diagnosis.
smoke_invoke() {
  local label="$1" payload="$2" out="$3" result rc=0
  # `if !` rather than `result=$(...); rc=$?` - under `set -e` a failing command substitution
  # aborts at the assignment, so the diagnosis below would never print on the one path that needs it.
  if ! result=$(aws bedrock-agentcore invoke-agent-runtime \
    --region "$REGION" \
    --agent-runtime-arn "$RUNTIME_ARN" \
    --qualifier "$ENDPOINT_NAME" \
    --content-type "application/json" \
    --accept "application/json" \
    --cli-binary-format raw-in-base64-out \
    --payload "$payload" \
    "$out" \
    --output json 2>&1); then
    rc=1
  fi
  echo "[agentcore-deploy] ${label} invoke: $result"
  [ -f "$out" ] && cat "$out" || true
  if [ "$rc" -ne 0 ]; then
    echo "ERROR: ${label} smoke invocation failed (exit ${rc}). The runtime is deployed but not serving." >&2
    echo "       AgentCore writes no log group by default, so reproduce locally with the same env:" >&2
    echo "       bash infra/ai-gateway/build-agentcore-artifact.sh /tmp/ac \"\$SOURCE_COMMIT\" && node /tmp/ac/runtime.js" >&2
    return 1
  fi
}

# ── 7. Smoke: safe read-only Thai invocation ───────────────────────────────────
echo "[agentcore-deploy] smoke: safe read-only invocation..."
SAFE_PAYLOAD='{"turnId":"smoke-read-01","companyId":"smoke-company","userId":"smoke-user","messageText":"ดูสรุปยอดขาย","locale":"th-TH","permissions":["sales.read"]}'
smoke_invoke safe "$SAFE_PAYLOAD" "$STAGING/safe-invoke.out"

# ── 8. Smoke: mutation refusal ─────────────────────────────────────────────────
echo "[agentcore-deploy] smoke: mutation refusal..."
MUTATION_PAYLOAD='{"turnId":"smoke-mutation-01","companyId":"smoke-company","userId":"smoke-user","messageText":"อนุมัติจ่ายเงิน 50000 บาท","locale":"th-TH","permissions":["finance.approve"]}'
smoke_invoke mutation "$MUTATION_PAYLOAD" "$STAGING/mutation-invoke.out"

if [ -n "${AGENTCORE_BINDING_OUTPUT:-}" ]; then
  [ ! -e "$AGENTCORE_BINDING_OUTPUT" ]
  jq -cS -n \
    --arg environment "$DEPLOY_ENVIRONMENT" --arg source "$SOURCE_COMMIT" \
    --arg artifactSha "$actual_sha" --arg bucket "$BUCKET" --arg prefix "$DEPLOY_KEY" \
    --arg objectVersion "$S3_VERSION" --arg runtimeArn "$RUNTIME_ARN" --arg runtimeId "$RUNTIME_ID" \
    --arg runtimeVersion "$RUNTIME_VERSION" --arg endpointName "$ENDPOINT_NAME" \
    --arg endpointArn "$ENDPOINT_ARN" --arg envSha "$ENV_SHA" --arg roleArn "$ROLE_ARN" '
      {schemaVersion:1,environment:$environment,sourceCommit:$source,
       executionRoleArn:$roleArn,
       artifact:{sha256:$artifactSha,bucket:$bucket,prefix:$prefix,objectVersionId:$objectVersion},
       runtime:{arn:$runtimeArn,id:$runtimeId,version:$runtimeVersion,status:"READY"},
       endpoint:{arn:$endpointArn,name:$endpointName,version:$runtimeVersion,status:"READY"},
       bindingStrategy:"isolated_runtime_pinned_endpoint",configurationSha256:$envSha,
       contractVersion:1}
    ' > "$AGENTCORE_BINDING_OUTPUT"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "==== AgentCore Runtime Deploy Complete ===="
echo "  Runtime ARN:  $RUNTIME_ARN"
echo "  Runtime ID:   $RUNTIME_ID"
echo "  Version:      $RUNTIME_VERSION"
echo "  Qualifier:    $ENDPOINT_NAME"
echo "  Region:       $REGION"
echo "  Model:        $BEDROCK_MODEL_ID"
echo "  SHA:          $GIT_SHA"
echo "  Artifact SHA: $actual_sha"
echo "  S3 version:   ${S3_VERSION:-not-returned}"
echo "  Status:       $RUNTIME_STATUS"
echo ""
echo "Record these in docs/agent-memory/ai-runtime-production-integration.md."
echo "Set AGENTCORE_RUNTIME_ARN=$RUNTIME_ARN and AGENTCORE_RUNTIME_QUALIFIER=$ENDPOINT_NAME in the AI Gateway task definition."
