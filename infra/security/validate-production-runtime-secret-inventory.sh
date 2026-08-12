#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <describe-secret-array.json> <normalized-inventory.json>" >&2
  exit 2
fi
input="$1" output="$2"
[ -f "$input" ]
[ ! -e "$output" ]

required_names=(
  watchdog-bms/production/database-url
  watchdog-bms/production/redis-url
  watchdog-bms/production/line-login-channel-secret
  watchdog-bms/production/line-messaging-channel-secret
  watchdog-bms/production/line-messaging-channel-access-token
  watchdog-bms/production/ai-gateway-internal-secret
  watchdog-bms/production/ai-actor-delegation-signing-key
  watchdog-bms/production/worker-internal-token
  watchdog-bms/production/watchdog-jwt-secret
  watchdog-bms/production/credential-encryption-key
  watchdog-bms/production/pdpa-pseudonymization-key
  watchdog-bms/production/pdpa-pseudonymization-previous-keys
)
optional_name=watchdog-bms/production/typhoon-ocr-api-key
required_json="$(printf '%s\n' "${required_names[@]}" | jq -R . | jq -sS 'sort')"

jq -e --argjson required "$required_json" --arg optional "$optional_name" '
  type=="array" and length>=($required|length)
  and ([.[].Name]|length)==([.[].Name]|unique|length)
  and ([.[].Name]|sort)==($required + ([.[]|.Name|select(.==$optional)]) | sort)
  and all(.[];
    (.Name|type)=="string"
    and (.ARN == ("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:" + .Name
      + (.ARN | capture("^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:[^:]+(?<suffix>-[A-Za-z0-9]{6})$").suffix)))
    and ((.DeletedDate? // null)==null)
    and any((.VersionIdsToStages // {})[]?; index("AWSCURRENT")!=null)
    and (if ((.KmsKeyId? // "") == "") then
      ((._ReadinessKmsKeyArn? // null)==null)
    else
      (._ReadinessKmsKeyManager=="AWS"
       and ._ReadinessKmsKeyState=="Enabled"
       and (._ReadinessKmsKeyArn
         | test("^arn:aws:kms:ap-southeast-1:311414082667:key/[0-9a-f-]{36}$")))
    end))
' "$input" >/dev/null || {
  echo 'ERROR: Production runtime secret inventory is missing, deleted, has no AWSCURRENT version, has an unexpected ARN, or uses an unsupported KMS key' >&2
  exit 1
}

if jq -e --arg name "$optional_name" 'any(.[];.Name==$name)' "$input" >/dev/null; then
  missing=()
  for key in TYPHOON_PROCESSING_REGION APPROVED_AI_REGIONS APPROVED_AI_PROVIDERS; do
    [ -n "${!key:-}" ] || missing+=("$key")
  done
  [ "${#missing[@]}" -eq 0 ] || {
    printf 'ERROR: Typhoon secret exists but required Production variables are absent: %s\n' \
      "$(IFS=,; echo "${missing[*]}")" >&2
    exit 1
  }
  approved_regions=",${APPROVED_AI_REGIONS//[[:space:]]/},"
  approved_providers=",${APPROVED_AI_PROVIDERS//[[:space:]]/},"
  [[ "$approved_regions" == *",${TYPHOON_PROCESSING_REGION},"* ]] || {
    echo 'ERROR: APPROVED_AI_REGIONS does not include TYPHOON_PROCESSING_REGION' >&2
    exit 1
  }
  [[ "$approved_providers" == *',typhoon,'* ]] || {
    echo "ERROR: APPROVED_AI_PROVIDERS does not include 'typhoon'" >&2
    exit 1
  }
fi

jq -cS --arg optional "$optional_name" '
  [sort_by(.Name)[] | {
    name:.Name,arn:.ARN,required:(.Name!=$optional),hasCurrentVersion:true,
    kms:{usesDefaultAwsManagedKey:((.KmsKeyId? // "")==""),
      keyArn:(._ReadinessKmsKeyArn? // null),keyManager:"AWS",keyState:"Enabled"}
  }]
' "$input" > "$output"
