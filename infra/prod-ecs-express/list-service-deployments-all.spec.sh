#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
subject="$repo_root/infra/prod-ecs-express/list-service-deployments-all.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/list-service-deployments-all-spec.XXXXXX")"
trap 'rm -rf "$work"' EXIT

cat > "$work/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
next=""
query=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --next-token) next="$2"; shift 2 ;;
    --query) query="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -z "$next" ]; then
  jq -cn --arg query "$query" '{
    nextToken:"page-2",
    serviceDeployments:[range(0;100)|{
      serviceDeploymentArn:("arn:deployment:"+(.|tostring)),
      createdAt:"2026-08-14T00:00:00Z",
      providerPayload:("x"*16384),query:$query
    }]
  }'
elif [ "$next" = page-2 ]; then
  jq -cn --arg query "$query" '{
    nextToken:null,
    serviceDeployments:[range(100;184)|{
      serviceDeploymentArn:("arn:deployment:"+(.|tostring)),
      createdAt:"2026-08-14T00:01:00Z",
      providerPayload:("y"*16384),query:$query
    }]
  }'
else
  exit 90
fi
AWS
chmod +x "$work/aws"

service='arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub'
query='{nextToken:nextToken,serviceDeployments:serviceDeployments}'
AWS_BIN="$work/aws" AWS_REGION=ap-southeast-1 \
  bash "$subject" --service-arn "$service" --query "$query" > "$work/result.json"

jq -e --arg query "$query" '
  .nextToken == null
  and (.serviceDeployments|length)==184
  and ([.serviceDeployments[].serviceDeploymentArn]|unique|length)==184
  and .serviceDeployments[0].serviceDeploymentArn=="arn:deployment:0"
  and .serviceDeployments[183].serviceDeploymentArn=="arn:deployment:183"
  and all(.serviceDeployments[];.query==$query and (.providerPayload|length)==16384)
' "$work/result.json" >/dev/null
test "$(wc -c < "$work/result.json" | tr -d '[:space:]')" -gt 2097152

echo 'list-service-deployments-all: PASS'
