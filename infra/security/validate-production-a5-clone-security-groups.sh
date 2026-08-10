#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 7 ]; then
  echo "Usage: $0 <task-sg.json> <db-sg.json> <task-sg-id> <db-sg-id> <endpoint-sg-id> <s3-prefix-list-id> <preflight|exact>" >&2
  exit 2
fi

task_file="$1"
db_file="$2"
task_id="$3"
db_id="$4"
endpoint_id="$5"
s3_prefix_id="$6"
mode="$7"
[[ "$task_id" =~ ^sg-[0-9a-f]{8,17}$ ]]
[[ "$db_id" =~ ^sg-[0-9a-f]{8,17}$ ]]
[[ "$endpoint_id" =~ ^sg-[0-9a-f]{8,17}$ ]]
[[ "$s3_prefix_id" =~ ^pl-[0-9a-f]{8,17}$ ]]
test "$task_id" != "$db_id"
test "$task_id" != "$endpoint_id"
test "$mode" = preflight || test "$mode" = exact

normalize() {
  jq -cS --arg direction "$2" '
    .SecurityGroups[0][$direction]
    | map({ipProtocol:.IpProtocol,fromPort:(.FromPort // null),toPort:(.ToPort // null),
        ipv4:([.IpRanges[]?.CidrIp]|sort),ipv6:([.Ipv6Ranges[]?.CidrIpv6]|sort),
        prefixLists:([.PrefixListIds[]?.PrefixListId]|sort),
        groups:([.UserIdGroupPairs[]?.GroupId]|sort)})
    | sort_by([.ipProtocol,(.fromPort // -1),(.toPort // -1),(.ipv4|join(",")),
        (.ipv6|join(",")),(.prefixLists|join(",")),(.groups|join(","))])
  ' "$1"
}

jq -e --arg id "$task_id" '
  .SecurityGroups|length==1 and .[0].GroupId==$id and .[0].GroupName!="default"
  and (.[0].VpcId|test("^vpc-[0-9a-f]{8,17}$"))
' "$task_file" >/dev/null
jq -e --arg id "$db_id" --slurpfile task "$task_file" '
  .SecurityGroups|length==1 and .[0].GroupId==$id and .[0].GroupName!="default"
  and .[0].VpcId==$task[0].SecurityGroups[0].VpcId
' "$db_file" >/dev/null

empty='[]'
default_egress='[{"fromPort":null,"groups":[],"ipProtocol":"-1","ipv4":["0.0.0.0/0"],"ipv6":[],"prefixLists":[],"toPort":null}]'
task_legacy_egress="$(jq -cnS --arg db "$db_id" '[
  {ipProtocol:"tcp",fromPort:443,toPort:443,ipv4:["0.0.0.0/0"],ipv6:[],prefixLists:[],groups:[]},
  {ipProtocol:"tcp",fromPort:5432,toPort:5432,ipv4:[],ipv6:[],prefixLists:[],groups:[$db]}
] | sort_by([.ipProtocol,(.fromPort // -1),(.toPort // -1),(.ipv4|join(",")),
  (.ipv6|join(",")),(.prefixLists|join(",")),(.groups|join(","))])')"
task_exact_egress="$(jq -cnS --arg db "$db_id" --arg endpoint "$endpoint_id" \
  --arg prefix "$s3_prefix_id" '[
  {ipProtocol:"tcp",fromPort:443,toPort:443,ipv4:[],ipv6:[],prefixLists:[],groups:[$endpoint]},
  {ipProtocol:"tcp",fromPort:443,toPort:443,ipv4:[],ipv6:[],prefixLists:[$prefix],groups:[]},
  {ipProtocol:"tcp",fromPort:5432,toPort:5432,ipv4:[],ipv6:[],prefixLists:[],groups:[$db]}
] | sort_by([.ipProtocol,(.fromPort // -1),(.toPort // -1),(.ipv4|join(",")),
  (.ipv6|join(",")),(.prefixLists|join(",")),(.groups|join(","))])')"
task_canonical_egress="$(jq -cnS --arg db "$db_id" --arg endpoint "$endpoint_id" \
  --arg prefix "$s3_prefix_id" '[
  {ipProtocol:"tcp",fromPort:443,toPort:443,ipv4:[],ipv6:[],prefixLists:[$prefix],groups:[$endpoint]},
  {ipProtocol:"tcp",fromPort:5432,toPort:5432,ipv4:[],ipv6:[],prefixLists:[],groups:[$db]}
] | sort_by([.ipProtocol,(.fromPort // -1),(.toPort // -1),(.ipv4|join(",")),
  (.ipv6|join(",")),(.prefixLists|join(",")),(.groups|join(","))])')"
db_exact_ingress="$(jq -cnS --arg task "$task_id" '[
  {ipProtocol:"tcp",fromPort:5432,toPort:5432,ipv4:[],ipv6:[],prefixLists:[],groups:[$task]}
]')"

task_ingress="$(normalize "$task_file" IpPermissions)"
task_egress="$(normalize "$task_file" IpPermissionsEgress)"
db_ingress="$(normalize "$db_file" IpPermissions)"
db_egress="$(normalize "$db_file" IpPermissionsEgress)"

test "$task_ingress" = "$empty"
if [ "$mode" = preflight ]; then
  { test "$task_egress" = "$empty" || test "$task_egress" = "$default_egress" \
      || test "$task_egress" = "$task_legacy_egress" \
      || test "$task_egress" = "$task_exact_egress" \
      || test "$task_egress" = "$task_canonical_egress"; }
  { test "$db_ingress" = "$empty" || test "$db_ingress" = "$db_exact_ingress"; }
  { test "$db_egress" = "$empty" || test "$db_egress" = "$default_egress"; }
else
  test "$task_egress" = "$task_exact_egress" || test "$task_egress" = "$task_canonical_egress"
  test "$db_ingress" = "$db_exact_ingress"
  test "$db_egress" = "$empty"
fi
