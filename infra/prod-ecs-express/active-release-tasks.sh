#!/usr/bin/env bash
# ECS ListTasks accepts `startedBy` only as the sole server-side filter. Describe the returned tasks
# and conservatively keep anything whose desired OR last status is not STOPPED.
set -euo pipefail

if [ "$#" -ne 4 ] || [ "$1" != "--cluster" ] || [ -z "$2" ] \
  || [ "$3" != "--started-by" ] || [ -z "$4" ]; then
  echo "Usage: $0 --cluster <cluster> --started-by <value>" >&2
  exit 2
fi

cluster="$2"
started_by="$4"
aws_bin="${AWS_BIN:-aws}"
region="${AWS_REGION:-ap-southeast-1}"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

task_arns="$(aws_cmd ecs list-tasks \
  --cluster "$cluster" --started-by "$started_by" \
  --query 'taskArns' --output json --region "$region")"
if [ "$(jq 'length' <<< "$task_arns")" -eq 0 ]; then
  printf '[]\n'
  exit 0
fi

tasks="$(jq -r '.[]' <<< "$task_arns")"
# shellcheck disable=SC2086 # validated ECS task ARNs are one whitespace-free CLI list.
aws_cmd ecs describe-tasks --cluster "$cluster" --tasks $tasks --region "$region" \
  | jq -c '[.tasks[]
      | select((.lastStatus // "") != "STOPPED" or (.desiredStatus // "") != "STOPPED")
      | .taskArn]'
