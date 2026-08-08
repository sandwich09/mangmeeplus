#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
account_id=311414082667
region=ap-southeast-1
source_db_identifier=watchdog-bms-prod-db
parameter_prefix=/watchdog-bms/production/a5-network
endpoint_sg_name=watchdog-bms-production-a5-endpoints
clone_task_sg_name=watchdog-bms-production-a5-clone-task
clone_db_sg_name=watchdog-bms-production-a5-clone-db
reader_task_sg_name=watchdog-bms-production-a5-readonly-task
ecr_policy="$repo_root/infra/security/production-a5-ecr-endpoint-policy.template.json"
logs_policy="$repo_root/infra/security/production-a5-logs-endpoint-policy.template.json"
secrets_policy="$repo_root/infra/security/production-a5-secretsmanager-endpoint-policy.template.json"
s3_policy="$repo_root/infra/security/production-a5-s3-endpoint-policy.template.json"
endpoint_validator="$repo_root/infra/security/validate-production-a5-private-endpoints.sh"
clone_sg_validator="$repo_root/infra/security/validate-production-a5-clone-security-groups.sh"
reader_sg_validator="$repo_root/infra/security/validate-production-a5-readonly-security-groups.sh"
jq -e . "$ecr_policy" "$logs_policy" "$secrets_policy" "$s3_policy" >/dev/null

if [ "${1:-}" != --apply ]; then
  printf '%s\n' 'Dry run only. Re-run with --apply to provision the shared endpoint-only A5 network.'
  printf '%s\n' 'Egress: exact interface-endpoint SG + read-only ECR S3 prefix list + exact DB SG; no CIDR egress.'
  exit 0
fi

test "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}" = "$account_id"
test "$(aws sts get-caller-identity --region "$region" --query Account --output text)" = "$account_id"

source_db="$(aws rds describe-db-instances --region "$region" \
  --db-instance-identifier "$source_db_identifier" --query 'DBInstances[0]' --output json)"
vpc_id="$(jq -er '.DBSubnetGroup.VpcId|select(test("^vpc-[0-9a-f]{8,17}$"))' <<< "$source_db")"
production_db_sg="$(jq -er '[.VpcSecurityGroups[]|select(.Status=="active")]
  |select(length==1)|.[0].VpcSecurityGroupId' <<< "$source_db")"
subnets="$(aws ec2 describe-subnets --region "$region" --filters "Name=vpc-id,Values=$vpc_id" \
  'Name=tag:Name,Values=watchdog-bms-prod-app-private-a,watchdog-bms-prod-app-private-b' \
  --query 'sort_by(Subnets,&SubnetId)[].{id:SubnetId,public:MapPublicIpOnLaunch,state:State}' --output json)"
jq -e 'length==2 and all(.[];.public==false and .state=="available")' <<< "$subnets" >/dev/null
subnet_csv="$(jq -er 'map(.id)|join(",")' <<< "$subnets")"
IFS=, read -r -a task_subnets <<< "$subnet_csv"

route_tables=()
for subnet in "${task_subnets[@]}"; do
  explicit="$(aws ec2 describe-route-tables --region "$region" \
    --filters "Name=vpc-id,Values=$vpc_id" "Name=association.subnet-id,Values=$subnet" \
    --query 'RouteTables[].RouteTableId' --output text)"
  if [ -n "$explicit" ] && [ "$explicit" != None ]; then
    read -r -a matches <<< "$explicit"
  else
    main="$(aws ec2 describe-route-tables --region "$region" \
      --filters "Name=vpc-id,Values=$vpc_id" 'Name=association.main,Values=true' \
      --query 'RouteTables[].RouteTableId' --output text)"
    read -r -a matches <<< "$main"
  fi
  [ "${#matches[@]}" -eq 1 ] && [[ "${matches[0]}" =~ ^rtb-[0-9a-f]{8,17}$ ]]
  route_tables+=("${matches[0]}")
done
route_table_csv="$(printf '%s\n' "${route_tables[@]}" | sort -u | paste -sd, -)"
IFS=, read -r -a unique_route_tables <<< "$route_table_csv"

prefixes="$(aws ec2 describe-managed-prefix-lists --region "$region" \
  --filters "Name=prefix-list-name,Values=com.amazonaws.${region}.s3" --output json)"
s3_prefix_list_id="$(jq -er '.PrefixLists|select(length==1)|.[0].PrefixListId
  |select(test("^pl-[0-9a-f]{8,17}$"))' <<< "$prefixes")"

security_group_id() {
  aws ec2 describe-security-groups --region "$region" \
    --filters "Name=vpc-id,Values=$vpc_id" "Name=group-name,Values=$1" \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null
}
ensure_security_group() {
  local name="$1" description="$2" id
  id="$(security_group_id "$name")"
  if [ -z "$id" ] || [ "$id" = None ]; then
    id="$(aws ec2 create-security-group --region "$region" --vpc-id "$vpc_id" \
      --group-name "$name" --description "$description" --query GroupId --output text)"
  fi
  [[ "$id" =~ ^sg-[0-9a-f]{8,17}$ ]]
  printf '%s' "$id"
}
endpoint_sg="$(ensure_security_group "$endpoint_sg_name" 'PrivateLink endpoints for production A5 tasks')"
clone_task_sg="$(ensure_security_group "$clone_task_sg_name" 'Production A5 clone migration task')"
clone_db_sg="$(ensure_security_group "$clone_db_sg_name" 'Production A5 temporary clone database')"
reader_task_sg="$(ensure_security_group "$reader_task_sg_name" 'Production A5 read-only database task')"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-network.XXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
describe_sg() { aws ec2 describe-security-groups --region "$region" --group-ids "$1" --output json > "$2"; }
describe_sg "$clone_task_sg" "$tmp/clone-task-before.json"
describe_sg "$clone_db_sg" "$tmp/clone-db-before.json"
describe_sg "$reader_task_sg" "$tmp/reader-task-before.json"
describe_sg "$production_db_sg" "$tmp/production-db-before.json"
describe_sg "$endpoint_sg" "$tmp/endpoint-before.json"
bash "$clone_sg_validator" "$tmp/clone-task-before.json" "$tmp/clone-db-before.json" \
  "$clone_task_sg" "$clone_db_sg" "$endpoint_sg" "$s3_prefix_list_id" preflight
bash "$reader_sg_validator" "$tmp/reader-task-before.json" "$tmp/production-db-before.json" \
  "$reader_task_sg" "$production_db_sg" "$endpoint_sg" "$s3_prefix_list_id" preflight
jq -e --arg clone "$clone_task_sg" --arg reader "$reader_task_sg" '
  (.SecurityGroups|length==1) and (.SecurityGroups[0].IpPermissionsEgress|length<=1)
  and all(.SecurityGroups[0].IpPermissionsEgress[]; .IpProtocol=="-1" and [.IpRanges[].CidrIp]==["0.0.0.0/0"])
  and ((.SecurityGroups[0].IpPermissions==[]) or
    ([.SecurityGroups[0].IpPermissions[]|{protocol:.IpProtocol,from:.FromPort,to:.ToPort,
      groups:([.UserIdGroupPairs[].GroupId]|sort),cidrs:(.IpRanges//[]),ipv6:(.Ipv6Ranges//[]),
      prefixes:(.PrefixListIds//[])}])==[{protocol:"tcp",from:443,to:443,
        groups:([$clone,$reader]|sort),cidrs:[],ipv6:[],prefixes:[]}])
' "$tmp/endpoint-before.json" >/dev/null

revoke_default() {
  aws ec2 revoke-security-group-egress --region "$region" --group-id "$1" \
    --ip-permissions '[{"IpProtocol":"-1","IpRanges":[{"CidrIp":"0.0.0.0/0"}]}]' >/dev/null 2>&1 || true
}
revoke_public_https() {
  aws ec2 revoke-security-group-egress --region "$region" --group-id "$1" \
    --ip-permissions '[{"IpProtocol":"tcp","FromPort":443,"ToPort":443,"IpRanges":[{"CidrIp":"0.0.0.0/0"}]}]' >/dev/null 2>&1 || true
}
for sg in "$endpoint_sg" "$clone_task_sg" "$clone_db_sg" "$reader_task_sg"; do revoke_default "$sg"; done
revoke_public_https "$clone_task_sg"
revoke_public_https "$reader_task_sg"
aws ec2 authorize-security-group-ingress --region "$region" --group-id "$endpoint_sg" \
  --ip-permissions "[{\"IpProtocol\":\"tcp\",\"FromPort\":443,\"ToPort\":443,\"UserIdGroupPairs\":[{\"GroupId\":\"$clone_task_sg\"},{\"GroupId\":\"$reader_task_sg\"}]}]" >/dev/null 2>&1 || true
for tuple in "$clone_task_sg:$clone_db_sg" "$reader_task_sg:$production_db_sg"; do
  task_sg="${tuple%%:*}"
  db_sg="${tuple##*:}"
  aws ec2 authorize-security-group-egress --region "$region" --group-id "$task_sg" \
    --ip-permissions "[{\"IpProtocol\":\"tcp\",\"FromPort\":443,\"ToPort\":443,\"UserIdGroupPairs\":[{\"GroupId\":\"$endpoint_sg\"}]}]" >/dev/null 2>&1 || true
  aws ec2 authorize-security-group-egress --region "$region" --group-id "$task_sg" \
    --ip-permissions "[{\"IpProtocol\":\"tcp\",\"FromPort\":443,\"ToPort\":443,\"PrefixListIds\":[{\"PrefixListId\":\"$s3_prefix_list_id\"}]}]" >/dev/null 2>&1 || true
  aws ec2 authorize-security-group-egress --region "$region" --group-id "$task_sg" \
    --ip-permissions "[{\"IpProtocol\":\"tcp\",\"FromPort\":5432,\"ToPort\":5432,\"UserIdGroupPairs\":[{\"GroupId\":\"$db_sg\"}]}]" >/dev/null 2>&1 || true
  aws ec2 authorize-security-group-ingress --region "$region" --group-id "$db_sg" \
    --protocol tcp --port 5432 --source-group "$task_sg" >/dev/null 2>&1 || true
done

ensure_endpoint() {
  # Split the declaration: under `set -u`, a single `local a="$1" b="${a}"` evaluates ${a} before
  # bash has bound a, which aborts with "a: unbound variable". Bind the positional args first, then
  # derive service from them.
  local suffix="$1" type="$2" policy="$3"
  local service="com.amazonaws.${region}.${suffix}" matches count id
  matches="$(aws ec2 describe-vpc-endpoints --region "$region" \
    --filters "Name=vpc-id,Values=$vpc_id" "Name=service-name,Values=$service" \
    --query 'VpcEndpoints[?State!=`deleted`].VpcEndpointId' --output text)"
  if [ -n "$matches" ] && [ "$matches" != None ]; then read -r -a ids <<< "$matches"; else ids=(); fi
  count="${#ids[@]}"
  [ "$count" -le 1 ] || { echo "ERROR: multiple $service endpoints exist" >&2; exit 1; }
  if [ "$count" -eq 0 ]; then
    if [ "$type" = Interface ]; then
      id="$(aws ec2 create-vpc-endpoint --region "$region" --vpc-id "$vpc_id" \
        --vpc-endpoint-type Interface --service-name "$service" --subnet-ids "${task_subnets[@]}" \
        --security-group-ids "$endpoint_sg" --private-dns-enabled \
        --policy-document "file://$policy" --query VpcEndpoint.VpcEndpointId --output text)"
    else
      id="$(aws ec2 create-vpc-endpoint --region "$region" --vpc-id "$vpc_id" \
        --vpc-endpoint-type Gateway --service-name "$service" --route-table-ids "${unique_route_tables[@]}" \
        --policy-document "file://$policy" --query VpcEndpoint.VpcEndpointId --output text)"
    fi
  else
    id="${ids[0]}"
    aws ec2 modify-vpc-endpoint --region "$region" --vpc-endpoint-id "$id" \
      --policy-document "file://$policy" >/dev/null
  fi
  [[ "$id" =~ ^vpce-[0-9a-f]{8,17}$ ]]
  aws ec2 wait vpc-endpoint-available --region "$region" --vpc-endpoint-ids "$id"
  printf '%s' "$id"
}
ecr_api_endpoint="$(ensure_endpoint ecr.api Interface "$ecr_policy")"
ecr_dkr_endpoint="$(ensure_endpoint ecr.dkr Interface "$ecr_policy")"
logs_endpoint="$(ensure_endpoint logs Interface "$logs_policy")"
secrets_endpoint="$(ensure_endpoint secretsmanager Interface "$secrets_policy")"
s3_endpoint="$(ensure_endpoint s3 Gateway "$s3_policy")"
endpoint_ids=("$ecr_api_endpoint" "$ecr_dkr_endpoint" "$logs_endpoint" "$secrets_endpoint" "$s3_endpoint")

describe_sg "$clone_task_sg" "$tmp/clone-task.json"
describe_sg "$clone_db_sg" "$tmp/clone-db.json"
describe_sg "$reader_task_sg" "$tmp/reader-task.json"
describe_sg "$production_db_sg" "$tmp/production-db.json"
describe_sg "$endpoint_sg" "$tmp/endpoint.json"
aws ec2 describe-vpc-endpoints --region "$region" --vpc-endpoint-ids "${endpoint_ids[@]}" \
  --output json | jq -cS . > "$tmp/endpoints.json"
aws ec2 describe-route-tables --region "$region" --route-table-ids "${unique_route_tables[@]}" \
  --output json | jq -cS . > "$tmp/routes.json"
bash "$clone_sg_validator" "$tmp/clone-task.json" "$tmp/clone-db.json" \
  "$clone_task_sg" "$clone_db_sg" "$endpoint_sg" "$s3_prefix_list_id" exact
bash "$reader_sg_validator" "$tmp/reader-task.json" "$tmp/production-db.json" \
  "$reader_task_sg" "$production_db_sg" "$endpoint_sg" "$s3_prefix_list_id" exact
bash "$endpoint_validator" "$tmp/endpoints.json" "$tmp/routes.json" "$tmp/endpoint.json" \
  "$vpc_id" "$endpoint_sg" "$clone_task_sg" "$reader_task_sg" "$subnet_csv" \
  "$route_table_csv" "$s3_prefix_list_id" "$tmp/boundary.json"

put_parameter() {
  aws ssm put-parameter --region "$region" --name "$parameter_prefix/$1" --type String \
    --value "$2" --overwrite >/dev/null
}
put_parameter vpc-id "$vpc_id"
put_parameter endpoint-security-group-id "$endpoint_sg"
put_parameter clone-task-security-group-id "$clone_task_sg"
put_parameter clone-db-security-group-id "$clone_db_sg"
put_parameter reader-task-security-group-id "$reader_task_sg"
put_parameter production-db-security-group-id "$production_db_sg"
put_parameter task-subnet-ids "$subnet_csv"
put_parameter task-route-table-ids "$route_table_csv"
put_parameter s3-prefix-list-id "$s3_prefix_list_id"
put_parameter ecr-api-endpoint-id "$ecr_api_endpoint"
put_parameter ecr-dkr-endpoint-id "$ecr_dkr_endpoint"
put_parameter logs-endpoint-id "$logs_endpoint"
put_parameter secretsmanager-endpoint-id "$secrets_endpoint"
put_parameter s3-endpoint-id "$s3_endpoint"

printf '%s\n' "Provisioned endpoint-only production A5 network in $vpc_id"
