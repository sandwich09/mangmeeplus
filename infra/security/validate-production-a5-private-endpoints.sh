#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 11 ]; then
  echo "Usage: $0 <vpc-endpoints.json> <route-tables.json> <endpoint-sg.json> <vpc-id> <endpoint-sg-id> <clone-task-sg-id> <reader-task-sg-id> <subnet-csv> <route-table-csv> <s3-prefix-list-id> <output.json>" >&2
  exit 2
fi

endpoints="$1"
routes="$2"
endpoint_sg_file="$3"
vpc_id="$4"
endpoint_sg_id="$5"
clone_task_sg_id="$6"
reader_task_sg_id="$7"
subnet_csv="$8"
route_table_csv="$9"
s3_prefix_list_id="${10}"
output="${11}"
[[ "$vpc_id" =~ ^vpc-[0-9a-f]{8,17}$ ]]
for id in "$endpoint_sg_id" "$clone_task_sg_id" "$reader_task_sg_id"; do
  [[ "$id" =~ ^sg-[0-9a-f]{8,17}$ ]]
done
[[ "$s3_prefix_list_id" =~ ^pl-[0-9a-f]{8,17}$ ]]
[[ "$subnet_csv" =~ ^subnet-[0-9a-f]{8,17}(,subnet-[0-9a-f]{8,17})+$ ]]
[[ "$route_table_csv" =~ ^rtb-[0-9a-f]{8,17}(,rtb-[0-9a-f]{8,17})*$ ]]

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ecr_policy="$root/production-a5-ecr-endpoint-policy.template.json"
logs_policy="$root/production-a5-logs-endpoint-policy.template.json"
secrets_policy="$root/production-a5-secretsmanager-endpoint-policy.template.json"
s3_policy="$root/production-a5-s3-endpoint-policy.template.json"
jq -e . "$endpoints" "$routes" "$endpoint_sg_file" \
  "$ecr_policy" "$logs_policy" "$secrets_policy" "$s3_policy" >/dev/null

subnets="$(tr ',' '\n' <<< "$subnet_csv" | sort -u | jq -R . | jq -s .)"
route_tables="$(tr ',' '\n' <<< "$route_table_csv" | sort -u | jq -R . | jq -s .)"
task_groups="$(printf '%s\n%s\n' "$clone_task_sg_id" "$reader_task_sg_id" | sort | jq -R . | jq -s .)"

jq -e --arg vpc "$vpc_id" --arg endpointSg "$endpoint_sg_id" \
  --argjson subnets "$subnets" --argjson routeTables "$route_tables" \
  --slurpfile ecr "$ecr_policy" --slurpfile logs "$logs_policy" \
  --slurpfile secrets "$secrets_policy" --slurpfile s3 "$s3_policy" '
  def policy: (.PolicyDocument | if type=="string" then fromjson else . end);
  def exact_interface($service; $policy):
    .VpcId==$vpc and .ServiceName==$service and .VpcEndpointType=="Interface"
    and .State=="available" and .PrivateDnsEnabled==true
    and ([.Groups[].GroupId]|sort)==[$endpointSg]
    and (.SubnetIds|sort)==$subnets and policy==$policy;
  (.VpcEndpoints|length)==5
  and ([.VpcEndpoints[].ServiceName]|sort)==[
    "com.amazonaws.ap-southeast-1.ecr.api","com.amazonaws.ap-southeast-1.ecr.dkr",
    "com.amazonaws.ap-southeast-1.logs","com.amazonaws.ap-southeast-1.s3",
    "com.amazonaws.ap-southeast-1.secretsmanager"]
  and all(.VpcEndpoints[];
    if .ServiceName=="com.amazonaws.ap-southeast-1.ecr.api"
      or .ServiceName=="com.amazonaws.ap-southeast-1.ecr.dkr"
    then exact_interface(.ServiceName;$ecr[0])
    elif .ServiceName=="com.amazonaws.ap-southeast-1.logs"
    then exact_interface(.ServiceName;$logs[0])
    elif .ServiceName=="com.amazonaws.ap-southeast-1.secretsmanager"
    then exact_interface(.ServiceName;$secrets[0])
    else .VpcId==$vpc and .ServiceName=="com.amazonaws.ap-southeast-1.s3"
      and .VpcEndpointType=="Gateway" and .State=="available"
      and (.RouteTableIds|sort)==$routeTables and policy==$s3[0]
    end)
  ' "$endpoints" >/dev/null

jq -e --arg id "$endpoint_sg_id" --argjson taskGroups "$task_groups" '
  .SecurityGroups|length==1 and .[0].GroupId==$id and .[0].IpPermissionsEgress==[]
  and ([.[0].IpPermissions[]
    | {protocol:.IpProtocol,from:.FromPort,to:.ToPort,
       groups:([.UserIdGroupPairs[]?.GroupId]|sort),cidrs:([.IpRanges[]?.CidrIp]|sort),
       ipv6:([.Ipv6Ranges[]?.CidrIpv6]|sort),prefixes:([.PrefixListIds[]?.PrefixListId]|sort)}]
    | sort_by([.from,.to,(.groups|join(","))])) == [
      {protocol:"tcp",from:443,to:443,groups:$taskGroups,cidrs:[],ipv6:[],prefixes:[]}
    ]
  ' "$endpoint_sg_file" >/dev/null

s3_endpoint_id="$(jq -er '.VpcEndpoints[]|select(.ServiceName=="com.amazonaws.ap-southeast-1.s3")
  |.VpcEndpointId|select(test("^vpce-[0-9a-f]{8,17}$"))' "$endpoints")"
jq -e --argjson expected "$route_tables" --arg s3 "$s3_endpoint_id" \
  --arg prefix "$s3_prefix_list_id" '
  (.RouteTables|length)==($expected|length)
  and ([.RouteTables[].RouteTableId]|sort)==$expected
  and all(.RouteTables[];
    ([.Routes[]|select(.DestinationPrefixListId==$prefix
      and ((.GatewayId//.VpcEndpointId//"")==$s3) and .State=="active")]|length)==1
    and all(.Routes[]|select(.DestinationCidrBlock=="0.0.0.0/0");
      (.NatGatewayId//"")|test("^nat-[0-9a-f]{8,17}$"))
    and ([.Routes[]|select(.DestinationIpv6CidrBlock=="::/0")]|length)==0)
  ' "$routes" >/dev/null

if command -v sha256sum >/dev/null 2>&1; then sha256_cmd=(sha256sum); else sha256_cmd=(shasum -a 256); fi
sha_json() { jq -cjS . "$1" | "${sha256_cmd[@]}" | awk '{print $1}'; }
jq -cnS --arg vpc "$vpc_id" --arg endpointSg "$endpoint_sg_id" \
  --arg prefix "$s3_prefix_list_id" --argjson subnets "$subnets" \
  --argjson routeTables "$route_tables" --argjson taskGroups "$task_groups" \
  --slurpfile endpoints "$endpoints" --slurpfile routes "$routes" \
  --arg endpointHash "$(sha_json "$endpoints")" --arg routeHash "$(sha_json "$routes")" \
  --arg endpointSgHash "$(sha_json "$endpoint_sg_file")" \
  --arg ecrPolicyHash "$(sha_json "$ecr_policy")" --arg logsPolicyHash "$(sha_json "$logs_policy")" \
  --arg secretsPolicyHash "$(sha_json "$secrets_policy")" --arg s3PolicyHash "$(sha_json "$s3_policy")" '
  {vpcId:$vpc,endpointSecurityGroupId:$endpointSg,authorizedTaskSecurityGroupIds:$taskGroups,
   taskSubnetIds:$subnets,taskRouteTableIds:$routeTables,s3PrefixListId:$prefix,
   interfaceEndpoints:([$endpoints[0].VpcEndpoints[]|select(.VpcEndpointType=="Interface")
     |{serviceName:.ServiceName,vpcEndpointId:.VpcEndpointId}]|sort_by(.serviceName)),
   s3GatewayEndpoint:($endpoints[0].VpcEndpoints[]|select(.ServiceName=="com.amazonaws.ap-southeast-1.s3")
     |{serviceName:.ServiceName,vpcEndpointId:.VpcEndpointId}),
   natGatewayRoutePresent:any($routes[0].RouteTables[].Routes[];
     .DestinationCidrBlock=="0.0.0.0/0" and (.NatGatewayId//""|startswith("nat-"))),
   publicInternetGatewayRoutePresent:false,taskSecurityGroupsAllowNatEgress:false,
   policies:{ecrSha256:$ecrPolicyHash,logsSha256:$logsPolicyHash,
     secretsManagerSha256:$secretsPolicyHash,s3Sha256:$s3PolicyHash},
   rawEvidence:{describeVpcEndpointsSha256:$endpointHash,describeRouteTablesSha256:$routeHash,
     describeEndpointSecurityGroupSha256:$endpointSgHash}}
  ' > "$output"
