#!/usr/bin/env bash
# Exhaustive ListServiceDeployments.
#
# The AWS CLI does not auto-paginate this operation: an unqualified call returns one default
# page of 20 and `--max-results 100` caps at 100, both alongside a nextToken. Every caller in
# this directory reasons over *the* deployment set - a before/after ARN set, the single newest
# deployment, two reads that must agree byte-for-byte - so a truncated page is not a smaller
# answer, it is a wrong one. Each of them already refuses a paginated read; this walks every
# page so that refusal stays a tripwire instead of a wall.
#
# Nothing caught this earlier because the guard only trips past 100: UAT api-web sat at 93
# deployments while production api-web had reached 184.
#
# Emits one response-shaped object whose nextToken is always null. With --query, the caller's
# JMESPath is applied per page and must keep both the nextToken and serviceDeployments keys.
set -euo pipefail

usage() {
  echo "Usage: $0 --service-arn <arn> [--query <jmespath>]" >&2
}

service_arn=""
query=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --service-arn)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      service_arn="$2"
      shift 2
      ;;
    --query)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      query="$2"
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

aws_bin="${AWS_BIN:-aws}"
region="${AWS_REGION:-ap-southeast-1}"
max_pages="${LIST_DEPLOYMENTS_MAX_PAGES:-50}"

[[ "$service_arn" =~ ^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:service/[^/]+/[^/]+$ ]] || { usage; exit 2; }
[[ "$max_pages" =~ ^[1-9][0-9]*$ ]] || { echo "ERROR: LIST_DEPLOYMENTS_MAX_PAGES must be a positive integer" >&2; exit 2; }

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

page_token=""
pages=0
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-list-service-deployments.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
deployments_file="$tmp_dir/deployments.jsonl"
: > "$deployments_file"
while :; do
  pages=$((pages + 1))
  if [ "$pages" -gt "$max_pages" ]; then
    echo "ERROR: deployment history exceeds ${max_pages} pages; refusing a non-exhaustive read" >&2
    exit 75
  fi
  args=(ecs list-service-deployments --service "$service_arn" --max-results 100 \
    --output json --region "$region")
  if [ -n "$query" ]; then
    args=("${args[@]}" --query "$query")
  fi
  if [ -n "$page_token" ]; then
    args=("${args[@]}" --next-token "$page_token")
  fi
  response="$(aws_cmd "${args[@]}")"
  jq -c '.serviceDeployments[]?' <<< "$response" >> "$deployments_file"
  page_token="$(jq -r '.nextToken // empty' <<< "$response")"
  if [ -z "$page_token" ]; then
    break
  fi
done

jq -sc '{nextToken:null,serviceDeployments:.}' "$deployments_file"
