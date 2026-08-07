#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 7 ]; then
  echo "Usage: $0 <task-sg.json> <database-sg.json> <task-sg-id> <db-sg-id> <endpoint-sg-id> <s3-prefix-list-id> <preflight|exact>" >&2
  exit 2
fi

task="$1"
database="$2"
task_id="$3"
database_id="$4"
endpoint_id="$5"
s3_prefix_id="$6"
mode="$7"
[[ "$task_id" =~ ^sg-[0-9a-f]{8,17}$ && "$database_id" =~ ^sg-[0-9a-f]{8,17}$ \
  && "$endpoint_id" =~ ^sg-[0-9a-f]{8,17}$ && "$s3_prefix_id" =~ ^pl-[0-9a-f]{8,17}$ ]]
[ "$task_id" != "$database_id" ] && [ "$task_id" != "$endpoint_id" ]
[ "$mode" = preflight ] || [ "$mode" = exact ]

normalize_egress() {
  jq -cS '.SecurityGroups[0].IpPermissionsEgress
    | map({protocol:.IpProtocol,from:(.FromPort//null),to:(.ToPort//null),
      groups:([.UserIdGroupPairs[]?.GroupId]|sort),cidrs:([.IpRanges[]?.CidrIp]|sort),
      ipv6:([.Ipv6Ranges[]?.CidrIpv6]|sort),prefixes:([.PrefixListIds[]?.PrefixListId]|sort)})
    | sort_by([(.from//-1),(.to//-1),(.groups|join(",")),(.prefixes|join(",")),(.cidrs|join(","))])' "$1"
}

default='[{"cidrs":["0.0.0.0/0"],"from":null,"groups":[],"ipv6":[],"prefixes":[],"protocol":"-1","to":null}]'
legacy="$(jq -cnS --arg db "$database_id" '[
  {protocol:"tcp",from:443,to:443,groups:[],cidrs:["0.0.0.0/0"],ipv6:[],prefixes:[]},
  {protocol:"tcp",from:5432,to:5432,groups:[$db],cidrs:[],ipv6:[],prefixes:[]}
] | sort_by([.from,.to,(.groups|join(",")),(.prefixes|join(",")),(.cidrs|join(","))])')"
expected="$(jq -cnS --arg db "$database_id" --arg endpoint "$endpoint_id" \
  --arg prefix "$s3_prefix_id" '[
  {protocol:"tcp",from:443,to:443,groups:[],cidrs:[],ipv6:[],prefixes:[$prefix]},
  {protocol:"tcp",from:443,to:443,groups:[$endpoint],cidrs:[],ipv6:[],prefixes:[]},
  {protocol:"tcp",from:5432,to:5432,groups:[$db],cidrs:[],ipv6:[],prefixes:[]}
] | sort_by([.from,.to,(.groups|join(",")),(.prefixes|join(",")),(.cidrs|join(","))])')"

jq -e --arg task "$task_id" '
  (.SecurityGroups|length)==1 and .SecurityGroups[0].GroupId==$task
  and .SecurityGroups[0].IpPermissions==[]
' "$task" >/dev/null
actual="$(normalize_egress "$task")"
if [ "$mode" = preflight ]; then
  test "$actual" = "$default" || test "$actual" = "$legacy" || test "$actual" = "$expected"
else
  test "$actual" = "$expected"
fi

# The production DB group is shared. Ignore unrelated application rules but allow zero (preflight)
# or exactly one narrow ingress sourced from this task SG; alternate/duplicate reader paths fail.
reader_rules="$(jq -cS --arg task "$task_id" '[.SecurityGroups[0].IpPermissions[]
  | select(any(.UserIdGroupPairs[]?; .GroupId==$task))]' "$database")"
count="$(jq -r length <<< "$reader_rules")"
if [ "$mode" = preflight ] && [ "$count" -eq 0 ]; then exit 0; fi
[ "$count" -eq 1 ]
jq -e --arg task "$task_id" '
  .[0] as $rule | $rule.IpProtocol=="tcp" and $rule.FromPort==5432 and $rule.ToPort==5432
  and ($rule.IpRanges//[])==[] and ($rule.Ipv6Ranges//[])==[] and ($rule.PrefixListIds//[])==[]
  and ([$rule.UserIdGroupPairs[]|select(.GroupId==$task)]|length)==1
' <<< "$reader_rules" >/dev/null
