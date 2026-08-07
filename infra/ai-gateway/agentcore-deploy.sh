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
RUNTIME_NAME="watchdog_orchestrator"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "$REGION")
BUCKET="watchdog-bms-agentcore-artifacts-${ACCOUNT_ID}"
SOURCE_COMMIT="${SOURCE_COMMIT:-$(git rev-parse HEAD)}"
if [[ ! "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || [ "$(git rev-parse HEAD)" != "$SOURCE_COMMIT" ]; then
  echo "ERROR: SOURCE_COMMIT must be the exact checked-out commit" >&2
  exit 1
fi
GIT_SHA="$SOURCE_COMMIT"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/watchdog-bms-agentcore-execution-role"
AI_GATEWAY_SECRET_ARN=$(aws secretsmanager describe-secret \
  --secret-id watchdog-bms/production/ai-gateway-internal-secret \
  --query ARN --output text --region "$REGION")

# ── Required env vars ──────────────────────────────────────────────────────────
: "${ERP_CORE_INTERNAL_URL:?ERP_CORE_INTERNAL_URL is required (private WatchDog API URL)}"
: "${PUBLIC_BASE_URL:?PUBLIC_BASE_URL is required for production config validation}"
: "${BEDROCK_MODEL_ID:=global.anthropic.claude-sonnet-4-6}"
: "${AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF:?AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF is required for the global Sonnet 4.6 profile}"
: "${SERVICE_VERSION:=$GIT_SHA}"

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
aws s3 cp "$STAGING/agentcore.zip" "s3://${BUCKET}/${DEPLOY_KEY}" --region "$REGION"
S3_VERSION=$(aws s3api head-object --bucket "$BUCKET" --key "$DEPLOY_KEY" \
  --query VersionId --output text --region "$REGION" 2>/dev/null || echo "")
if [ "$S3_VERSION" = "None" ] || [ "$S3_VERSION" = "null" ]; then
  S3_VERSION=""
fi

# ── 3. Execution role (create if missing) ─────────────────────────────────────
echo "[agentcore-deploy] ensuring execution role..."
TRUST_POLICY=$(cat <<EOF
{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Allow",
    "Principal":{"Service":"bedrock-agentcore.amazonaws.com"},
    "Action":"sts:AssumeRole",
    "Condition":{
      "StringEquals":{"aws:SourceAccount":"${ACCOUNT_ID}"},
      "ArnLike":{"aws:SourceArn":"arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/*"}
    }
  }]
}
EOF
)
if ! aws iam get-role --role-name watchdog-bms-agentcore-execution-role 2>/dev/null; then
  aws iam create-role \
    --role-name watchdog-bms-agentcore-execution-role \
    --assume-role-policy-document "$TRUST_POLICY"
fi
aws iam update-assume-role-policy \
  --role-name watchdog-bms-agentcore-execution-role \
  --policy-document "$TRUST_POLICY"
# Replace placeholder before applying
sed -e "s|<ACCOUNT_ID>|$ACCOUNT_ID|g" \
  -e "s|<AI_GATEWAY_SECRET_ARN>|$AI_GATEWAY_SECRET_ARN|g" \
  infra/ai-gateway/agentcore-execution-role-policy.json > "$STAGING/policy.json"
aws iam put-role-policy \
  --role-name watchdog-bms-agentcore-execution-role \
  --policy-name watchdog-bms-agentcore-permissions \
  --policy-document "file://$STAGING/policy.json"

# ── 4. Build runtime artifact JSON ────────────────────────────────────────────
ARTIFACT_JSON=$(cat <<EOF
{
  "codeConfiguration": {
    "code": {
      "s3": {
        "bucket": "${BUCKET}",
        "prefix": "${DEPLOY_KEY}"$([ -n "${S3_VERSION:-}" ] && echo ",\"versionId\":\"$S3_VERSION\"" || echo "")
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
  "DEPLOY_ENVIRONMENT": "production",
  "SERVICE_NAME": "watchdog-agentcore-orchestrator",
  "SERVICE_VERSION": "${SERVICE_VERSION}",
  "GIT_SHA": "${GIT_SHA}",
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

# ── 5. Create or update runtime ────────────────────────────────────────────────
EXISTING_ID=$(aws bedrock-agentcore-control list-agent-runtimes --region "$REGION" \
  --query "agentRuntimes[?agentRuntimeName=='$RUNTIME_NAME'].agentRuntimeId" \
  --output text 2>/dev/null || echo "")

if [ -z "$EXISTING_ID" ] || [ "$EXISTING_ID" = "None" ]; then
  echo "[agentcore-deploy] creating new runtime..."
  RESULT=$(aws bedrock-agentcore-control create-agent-runtime \
    --region "$REGION" \
    --agent-runtime-name "$RUNTIME_NAME" \
    --agent-runtime-artifact "$ARTIFACT_JSON" \
    --role-arn "$ROLE_ARN" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --metadata-configuration '{"requireMMDSV2":true}' \
    --protocol-configuration '{"serverProtocol":"HTTP"}' \
    --environment-variables "$ENV_VARS" \
    --description "WatchDog BMS LINE AI orchestrator – item 10B")
  RUNTIME_ID=$(echo "$RESULT" | jq -r '.agentRuntimeId')
  echo "[agentcore-deploy] created runtime id=$RUNTIME_ID"
else
  echo "[agentcore-deploy] updating existing runtime id=$EXISTING_ID..."
  RESULT=$(aws bedrock-agentcore-control update-agent-runtime \
    --region "$REGION" \
    --agent-runtime-id "$EXISTING_ID" \
    --agent-runtime-artifact "$ARTIFACT_JSON" \
    --role-arn "$ROLE_ARN" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --metadata-configuration '{"requireMMDSV2":true}' \
    --protocol-configuration '{"serverProtocol":"HTTP"}' \
    --environment-variables "$ENV_VARS")
  RUNTIME_ID="$EXISTING_ID"
  echo "[agentcore-deploy] updated runtime id=$RUNTIME_ID"
fi

RUNTIME_ARN="arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/${RUNTIME_ID}"
echo "[agentcore-deploy] ARN: $RUNTIME_ARN"

# ── 6. Wait for READY status ───────────────────────────────────────────────────
echo "[agentcore-deploy] waiting for READY status (up to 5 min)..."
for i in $(seq 1 30); do
  STATUS=$(aws bedrock-agentcore-control get-agent-runtime \
    --region "$REGION" \
    --agent-runtime-id "$RUNTIME_ID" \
    --query 'status' --output text 2>/dev/null || echo "UNKNOWN")
  echo "[agentcore-deploy] status=$STATUS (attempt $i/30)"
  if [ "$STATUS" = "READY" ]; then break; fi
  if [ "$STATUS" = "FAILED" ]; then
    echo "ERROR: Runtime entered FAILED status"
    exit 1
  fi
  sleep 10
done

if [ "$STATUS" != "READY" ]; then
  echo "WARN: Runtime not READY after 5 min (status=$STATUS). Check AWS console."
  exit 1
fi

# ── 7. Smoke: safe read-only Thai invocation ───────────────────────────────────
echo "[agentcore-deploy] smoke: safe read-only invocation..."
SAFE_PAYLOAD='{"turnId":"smoke-read-01","companyId":"smoke-company","userId":"smoke-user","messageText":"ดูสรุปยอดขาย","locale":"th-TH","permissions":["sales.read"]}'
SAFE_RESULT=$(aws bedrock-agentcore invoke-agent-runtime \
  --region "$REGION" \
  --agent-runtime-arn "$RUNTIME_ARN" \
  --qualifier "DEFAULT" \
  --content-type "application/json" \
  --accept "application/json" \
  --cli-binary-format raw-in-base64-out \
  --payload "$SAFE_PAYLOAD" \
  "$STAGING/safe-invoke.out" \
  --output json 2>&1 || true)
echo "[agentcore-deploy] safe invoke: $SAFE_RESULT"
cat "$STAGING/safe-invoke.out" || true

# ── 8. Smoke: mutation refusal ─────────────────────────────────────────────────
echo "[agentcore-deploy] smoke: mutation refusal..."
MUTATION_PAYLOAD='{"turnId":"smoke-mutation-01","companyId":"smoke-company","userId":"smoke-user","messageText":"อนุมัติจ่ายเงิน 50000 บาท","locale":"th-TH","permissions":["finance.approve"]}'
MUTATION_RESULT=$(aws bedrock-agentcore invoke-agent-runtime \
  --region "$REGION" \
  --agent-runtime-arn "$RUNTIME_ARN" \
  --qualifier "DEFAULT" \
  --content-type "application/json" \
  --accept "application/json" \
  --cli-binary-format raw-in-base64-out \
  --payload "$MUTATION_PAYLOAD" \
  "$STAGING/mutation-invoke.out" \
  --output json 2>&1 || true)
echo "[agentcore-deploy] mutation invoke: $MUTATION_RESULT"
cat "$STAGING/mutation-invoke.out" || true

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "==== AgentCore Runtime Deploy Complete ===="
echo "  Runtime ARN:  $RUNTIME_ARN"
echo "  Runtime ID:   $RUNTIME_ID"
echo "  Qualifier:    DEFAULT"
echo "  Region:       $REGION"
echo "  Model:        $BEDROCK_MODEL_ID"
echo "  SHA:          $GIT_SHA"
echo "  Artifact SHA: $actual_sha"
echo "  S3 version:   ${S3_VERSION:-not-returned}"
echo "  Status:       $STATUS"
echo ""
echo "Record these in docs/agent-memory/ai-runtime-production-integration.md."
echo "Set AGENTCORE_RUNTIME_ARN=$RUNTIME_ARN in AI Gateway task definition (§11.4)."
