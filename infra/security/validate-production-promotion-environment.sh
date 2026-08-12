#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <output.json>" >&2
  exit 2
fi
output="$1"
[ ! -e "$output" ]
account=311414082667
required_variables=(AWS_DEPLOY_ROLE_ARN PUBLIC_DOMAIN_URL WORKFLOW_WEBHOOK_ALLOWED_HOSTS CLAMAV_HOST
  LOG_KMS_KEY_ID SECURITY_ALERT_TOPIC_ARN LINE_LOGIN_CHANNEL_ID LINE_LIFF_ID
  LINE_MESSAGING_CHANNEL_ID LINE_AI_AGENT_RUNTIME AGENTCORE_REGION AGENTCORE_RUNTIME_ARN
  AGENTCORE_RUNTIME_QUALIFIER)
missing=()
for key in "${required_variables[@]}"; do [ -n "${!key:-}" ] || missing+=("$key"); done
[ "${#missing[@]}" -eq 0 ] || {
  printf 'ERROR: required Production variables are absent: %s\n' \
    "$(IFS=,; echo "${missing[*]}")" >&2
  exit 1
}
test "$AWS_DEPLOY_ROLE_ARN" = "arn:aws:iam::$account:role/watchdog-bms-deploy-production" || {
  echo 'ERROR: AWS_DEPLOY_ROLE_ARN is not the exact Production deploy role' >&2; exit 1;
}
test "$PUBLIC_DOMAIN_URL" = https://mangmeeplus.com || {
  echo 'ERROR: PUBLIC_DOMAIN_URL is not the canonical Production origin' >&2; exit 1;
}
case "$WORKFLOW_WEBHOOK_ALLOWED_HOSTS" in
  none) ;;
  *[!A-Za-z0-9.,_-]*|'')
    echo 'ERROR: WORKFLOW_WEBHOOK_ALLOWED_HOSTS is not an explicit host allowlist or none' >&2
    exit 1 ;;
esac
[[ "$CLAMAV_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || {
  echo 'ERROR: CLAMAV_HOST must be a hostname without a scheme or port' >&2; exit 1;
}
[[ "$LOG_KMS_KEY_ID" =~ ^arn:aws:kms:ap-southeast-1:311414082667:key/[0-9a-f-]{36}$ ]] || {
  echo 'ERROR: LOG_KMS_KEY_ID is not a key ARN in the Production account/region' >&2; exit 1;
}
[[ "$SECURITY_ALERT_TOPIC_ARN" =~ ^arn:aws:sns:ap-southeast-1:311414082667:[A-Za-z0-9_-]+$ ]] || {
  echo 'ERROR: SECURITY_ALERT_TOPIC_ARN is not a topic ARN in the Production account/region' >&2; exit 1;
}
[[ "$LINE_LOGIN_CHANNEL_ID" =~ ^[0-9]+$ && "$LINE_MESSAGING_CHANNEL_ID" =~ ^[0-9]+$ ]] || {
  echo 'ERROR: LINE channel IDs must be numeric' >&2; exit 1;
}
[[ "$LINE_LIFF_ID" =~ ^[0-9]+-[A-Za-z0-9_-]+$ ]] || {
  echo 'ERROR: LINE_LIFF_ID has an invalid shape' >&2; exit 1;
}
test "$LINE_AI_AGENT_RUNTIME" = agentcore || {
  echo 'ERROR: LINE_AI_AGENT_RUNTIME is not agentcore' >&2; exit 1;
}
test "$AGENTCORE_REGION" = ap-southeast-1 || {
  echo 'ERROR: AGENTCORE_REGION is not ap-southeast-1' >&2; exit 1;
}
test "$AGENTCORE_RUNTIME_ARN" = \
  "arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0" || {
  echo 'ERROR: AGENTCORE_RUNTIME_ARN is not the exact Production runtime' >&2; exit 1;
}
test "$AGENTCORE_RUNTIME_QUALIFIER" = DEFAULT || {
  echo 'ERROR: AGENTCORE_RUNTIME_QUALIFIER is not DEFAULT' >&2; exit 1;
}
test "${PRODUCTION_POLICY_READ_TOKEN_CONFIGURED:-}" = true || {
  echo 'ERROR: PRODUCTION_POLICY_READ_TOKEN is absent from the Production environment' >&2; exit 1;
}

names="$(printf '%s\n' "${required_variables[@]}" | jq -R . | jq -sS .)"
values='[]'
for key in "${required_variables[@]}"; do
  values="$(jq -cnS --argjson current "$values" --arg key "$key" --arg value "${!key}" \
    '$current+[{key:$key,value:$value}]')"
done
if command -v sha256sum >/dev/null 2>&1; then
  values_hash="$(printf '%s' "$values" | sha256sum | awk '{print $1}')"
else
  values_hash="$(printf '%s' "$values" | shasum -a 256 | awk '{print $1}')"
fi
unset values
jq -cnS --argjson variables "$names" --arg hash "$values_hash" '
  {requiredVariables:$variables,requiredSecrets:["PRODUCTION_POLICY_READ_TOKEN"],
   requiredVariableValuesSha256:$hash,valuesExposed:false,allConfigured:true}' > "$output"
