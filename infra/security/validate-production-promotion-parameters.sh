#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <get-parameters.json> <normalized-inventory.json>" >&2
  exit 2
fi
input="$1" output="$2"
[ -f "$input" ]
[ ! -e "$output" ]
prefix=/watchdog-bms/production/

jq -e --arg prefix "$prefix" '
  def value($suffix): [.Parameters[]|select(.Name==($prefix+$suffix))|.Value]
    |select(length==1)|.[0];
  (.InvalidParameters|length)==0 and (.Parameters|length)==9
  and ([.Parameters[].Name]|length)==([.Parameters[].Name]|unique|length)
  and all(.Parameters[];.Type=="String" and (.Value|type)=="string" and (.Value|length)>0)
  and any(.Parameters[];.Name==($prefix+"ecs-express-api-web-service-arn")
    and .Value=="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub")
  and any(.Parameters[];.Name==($prefix+"ecs-express-ai-gateway-service-arn")
    and .Value=="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-ai-gateway-v2")
  and any(.Parameters[];.Name==($prefix+"ecs-express-workers-service-arn")
    and .Value=="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-workers")
  and any(.Parameters[];.Name==($prefix+"s3-bucket")
    and .Value=="watchdog-bms-prod-311414082667")
  and (value("ecs-express-api-web-url")
    |test("^https://wa-[0-9a-f]{32}\\.ecs\\.ap-southeast-1\\.on\\.aws$"))
  and value("erp-core-internal-url")==((value("ecs-express-api-web-url"))+"/v1")
  and (value("ecs-express-ai-gateway-url")
    |test("^https://wa-[0-9a-f]{32}\\.ecs\\.ap-southeast-1\\.on\\.aws$"))
  and value("ai-gateway-internal-url")==((value("ecs-express-ai-gateway-url"))+"/v1")
  and (value("ecs-express-workers-url")
    |test("^https://wa-[0-9a-f]{32}\\.ecs\\.ap-southeast-1\\.on\\.aws$"))
' "$input" >/dev/null || {
  echo 'ERROR: Production deploy SSM parameter inventory is missing or stale' >&2
  exit 1
}
jq -cS '[.Parameters|sort_by(.Name)[]|{name:.Name,type:.Type,value:.Value,version:.Version}]' \
  "$input" > "$output"
