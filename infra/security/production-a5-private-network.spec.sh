#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
validator="$root/infra/security/validate-production-a5-private-endpoints.sh"
bootstrap="$root/infra/security/bootstrap-production-a5-private-network.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-private-network.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
vpc=vpc-0123456789abcdef0
endpoint_sg=sg-01111111111111111
clone_sg=sg-02222222222222222
reader_sg=sg-03333333333333333
uat_app_sg=sg-04444444444444444
uat_ai_sg=sg-05555555555555555
uat_sgs="$uat_app_sg,$uat_ai_sg"
production_app_sg=sg-06666666666666666
production_ai_sg=sg-07777777777777777
production_sgs="$production_app_sg,$production_ai_sg"
subnets=subnet-01111111111111111,subnet-02222222222222222
routes=rtb-01111111111111111,rtb-02222222222222222
prefix=pl-0123456789abcdef0

bash -n "$validator" "$bootstrap"
jq -cnS --arg id "$endpoint_sg" --arg clone "$clone_sg" --arg reader "$reader_sg" \
  --arg uatApp "$uat_app_sg" --arg uatAi "$uat_ai_sg" \
  --arg productionApp "$production_app_sg" --arg productionAi "$production_ai_sg" \
  '{SecurityGroups:[{GroupId:$id,IpPermissions:[{IpProtocol:"tcp",FromPort:443,ToPort:443,
    IpRanges:[],Ipv6Ranges:[],PrefixListIds:[],UserIdGroupPairs:[{GroupId:$clone},{GroupId:$reader},{GroupId:$uatApp},{GroupId:$uatAi},{GroupId:$productionApp},{GroupId:$productionAi}]}],
    IpPermissionsEgress:[]}]}' > "$work/endpoint-sg.json"
jq -cnS --arg vpc "$vpc" --arg sg "$endpoint_sg" \
  --slurpfile ecr "$root/infra/security/production-a5-ecr-endpoint-policy.template.json" \
  --slurpfile logs "$root/infra/security/production-a5-logs-endpoint-policy.template.json" \
  --slurpfile secrets "$root/infra/security/production-a5-secretsmanager-endpoint-policy.template.json" \
  --slurpfile s3 "$root/infra/security/production-a5-s3-endpoint-policy.template.json" '
  def interface($id;$service;$policy): {VpcEndpointId:$id,VpcEndpointType:"Interface",VpcId:$vpc,
    ServiceName:$service,State:"available",PrivateDnsEnabled:true,
    SubnetIds:["subnet-01111111111111111","subnet-02222222222222222"],
    Groups:[{GroupId:$sg}],PolicyDocument:($policy|tojson)};
  {VpcEndpoints:[
    interface("vpce-01111111111111111";"com.amazonaws.ap-southeast-1.ecr.api";$ecr[0]),
    interface("vpce-02222222222222222";"com.amazonaws.ap-southeast-1.ecr.dkr";$ecr[0]),
    interface("vpce-03333333333333333";"com.amazonaws.ap-southeast-1.logs";$logs[0]),
    interface("vpce-04444444444444444";"com.amazonaws.ap-southeast-1.secretsmanager";$secrets[0]),
    {VpcEndpointId:"vpce-05555555555555555",VpcEndpointType:"Gateway",VpcId:$vpc,
      ServiceName:"com.amazonaws.ap-southeast-1.s3",State:"available",
      RouteTableIds:["rtb-01111111111111111","rtb-02222222222222222"],
      PolicyDocument:($s3[0]|tojson)}]}
  ' > "$work/endpoints.json"
jq -cnS --arg prefix "$prefix" '{RouteTables:[
  {RouteTableId:"rtb-01111111111111111",Routes:[
    {DestinationCidrBlock:"0.0.0.0/0",NatGatewayId:"nat-01111111111111111",State:"active"},
    {DestinationPrefixListId:$prefix,GatewayId:"vpce-05555555555555555",State:"active"}]},
  {RouteTableId:"rtb-02222222222222222",Routes:[
    {DestinationCidrBlock:"0.0.0.0/0",NatGatewayId:"nat-02222222222222222",State:"active"},
    {DestinationPrefixListId:$prefix,GatewayId:"vpce-05555555555555555",State:"active"}]}
]}' > "$work/routes.json"

validate() {
  bash "$validator" "$1" "$2" "$3" "$vpc" "$endpoint_sg" "$clone_sg" "$reader_sg" \
    "$uat_sgs" "$production_sgs" "$subnets" "$routes" "$prefix" "$4"
}
validate "$work/endpoints.json" "$work/routes.json" "$work/endpoint-sg.json" "$work/boundary.json"
jq -e '.natGatewayRoutePresent==true and .publicInternetGatewayRoutePresent==false
  and .taskSecurityGroupsAllowNatEgress==false' "$work/boundary.json" >/dev/null

expect_reject() {
  local label="$1" endpoints="$2" route_file="$3" sg_file="$4"
  if validate "$endpoints" "$route_file" "$sg_file" "$work/$label-output.json" >/dev/null 2>&1; then
    echo "ERROR: $label network evidence was accepted" >&2
    exit 1
  fi
}
jq --arg bastion sg-0e363ecb391c7dd17 \
  '.SecurityGroups[0].IpPermissions[0].UserIdGroupPairs += [{GroupId:$bastion}]' \
  "$work/endpoint-sg.json" > "$work/support-bastion.json"
validate "$work/endpoints.json" "$work/routes.json" "$work/support-bastion.json" \
  "$work/support-bastion-boundary.json"
jq --arg rogue sg-08888888888888888 \
  '.SecurityGroups[0].IpPermissions[0].UserIdGroupPairs += [{GroupId:$rogue}]' \
  "$work/endpoint-sg.json" > "$work/rogue-endpoint-source.json"
expect_reject rogue-endpoint-source "$work/endpoints.json" "$work/routes.json" \
  "$work/rogue-endpoint-source.json"
jq '.SecurityGroups[0].IpPermissionsEgress=[{IpProtocol:"tcp",FromPort:443,ToPort:443,
  IpRanges:[{CidrIp:"0.0.0.0/0"}]}]' "$work/endpoint-sg.json" > "$work/public-egress.json"
expect_reject public-egress "$work/endpoints.json" "$work/routes.json" "$work/public-egress.json"
jq '(.VpcEndpoints[]|select(.ServiceName=="com.amazonaws.ap-southeast-1.s3")
  |.PolicyDocument)=( {Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:"*",
    Action:"s3:PutObject",Resource:"*"}]}|tojson)' "$work/endpoints.json" > "$work/s3-write.json"
expect_reject s3-write "$work/s3-write.json" "$work/routes.json" "$work/endpoint-sg.json"
jq '.RouteTables[0].Routes[0]={DestinationCidrBlock:"0.0.0.0/0",
  GatewayId:"igw-01111111111111111",State:"active"}' "$work/routes.json" > "$work/public-route.json"
expect_reject public-route "$work/endpoints.json" "$work/public-route.json" "$work/endpoint-sg.json"
jq '(.VpcEndpoints[]|select(.ServiceName=="com.amazonaws.ap-southeast-1.logs")
  |.PolicyDocument) |= (fromjson
    |(.Statement[]|select(.Sid=="WriteProductionLogGroupsOnly")|.Resource)
      = ["arn:aws:logs:ap-southeast-1:311414082667:log-group:/ecs/watchdog-bms-prod-*:log-stream:*"]
    |tojson)' "$work/endpoints.json" > "$work/missing-release-log.json"
expect_reject missing-release-log "$work/missing-release-log.json" "$work/routes.json" \
  "$work/endpoint-sg.json"

if grep -En 'authorize-security-group-egress.*(--cidr|CidrIp).*0\.0\.0\.0/0' "$bootstrap"; then
  echo 'ERROR: shared bootstrap authorizes public task egress' >&2
  exit 1
fi
! grep -Fq 'aws ec2 wait vpc-endpoint-available' "$bootstrap"
grep -Fq 'failed|rejected|deleted|deleting|expired)' "$bootstrap"
jq -e 'all(.Statement[];.Action!="s3:PutObject" and (.Action|tostring|contains("PutObject")|not))' \
  "$root/infra/security/production-a5-s3-endpoint-policy.template.json" >/dev/null
jq -e '
  any(.Statement[];.Sid=="AuthenticateExactA5ExecutionRoles"
    and (.Condition.ArnEquals["aws:PrincipalArn"]
      |index("arn:aws:iam::311414082667:role/watchdog-bms-production-a5-apply-execution"))!=null)
  and any(.Statement[];.Sid=="PullExactMigrationToolOnly"
    and .Resource=="arn:aws:ecr:ap-southeast-1:311414082667:repository/watchdog-bms-migration-tool"
    and (.Condition.ArnEquals["aws:PrincipalArn"]
      |index("arn:aws:iam::311414082667:role/watchdog-bms-production-a5-apply-execution"))!=null)
' "$root/infra/security/production-a5-ecr-endpoint-policy.template.json" >/dev/null
jq -e '
  any(.Statement[];.Sid=="ReadExactApplyWriterSecret"
    and .Resource=="arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-*"
    and .Condition.ArnEquals["aws:PrincipalArn"]
      =="arn:aws:iam::311414082667:role/watchdog-bms-production-a5-apply-execution")
' "$root/infra/security/production-a5-secretsmanager-endpoint-policy.template.json" >/dev/null
jq -e '
  any(.Statement[];.Sid=="WriteExactApplyLogGroupOnly"
    and .Resource=="arn:aws:logs:ap-southeast-1:311414082667:log-group:/ecs/watchdog-bms-production-a5-apply:log-stream:*"
    and .Condition.ArnEquals["aws:PrincipalArn"]
      =="arn:aws:iam::311414082667:role/watchdog-bms-production-a5-apply-execution")
  and any(.Statement[];.Sid=="WriteProductionLogGroupsOnly"
    and (.Resource|index("arn:aws:logs:ap-southeast-1:311414082667:log-group:/ecs/watchdog-bms-release-task:log-stream:*"))!=null
    and .Condition.ArnEquals["aws:PrincipalArn"]
      =="arn:aws:iam::311414082667:role/ecsTaskExecutionRole")
' "$root/infra/security/production-a5-logs-endpoint-policy.template.json" >/dev/null

echo 'production A5 private endpoint network spec: PASS'
