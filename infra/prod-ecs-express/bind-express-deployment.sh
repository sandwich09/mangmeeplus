#!/usr/bin/env bash
# Resolve an ECS Express update/create to exactly one deployment created by that request.
# Zero candidates is UNKNOWN (75); more than one is ambiguous (76). Neither case guesses.
set -euo pipefail

if [ "$#" -ne 8 ] || [ "$1" != "--service-arn" ] || [ "$3" != "--target-revision" ] \
  || [ "$5" != "--request-start-epoch" ] || [ "$7" != "--before-file" ]; then
  echo "Usage: $0 --service-arn <arn> --target-revision <arn> --request-start-epoch <epoch> --before-file <json>" >&2
  exit 2
fi
service_arn="$2"
target_revision="$4"
request_start="$6"
before_file="$8"
aws_bin="${AWS_BIN:-aws}"
region="${AWS_REGION:-ap-southeast-1}"
attempts="${BIND_DEPLOYMENT_POLL_ATTEMPTS:-12}"
poll_seconds="${BIND_DEPLOYMENT_POLL_SECONDS:-5}"

[[ "$service_arn" =~ ^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:service/[^/]+/[^/]+$ ]]
[[ "$target_revision" =~ ^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:service-revision/[^/]+/[^/]+/[^/]+$ ]]
[[ "$request_start" =~ ^[0-9]+$ ]]
jq -e 'type == "array" and all(.[]; type == "string")' "$before_file" >/dev/null
before="$(cat "$before_file")"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

for _ in $(seq 1 "$attempts"); do
  deployments="$(aws_cmd ecs list-service-deployments --service "$service_arn" --output json --region "$region")"
  possible="$(jq -c --arg target "$target_revision" --argjson before "$before" '[
    .serviceDeployments[]?
    | .serviceDeploymentArn as $arn
    | select(.targetServiceRevisionArn == $target and ($before | index($arn)) == null)
    | {arn:$arn, createdAt:.createdAt}
  ]' <<< "$deployments")"
  candidates='[]'
  while IFS= read -r row; do
    [ -n "$row" ] || continue
    created_at="$(jq -r '.createdAt // empty' <<< "$row")"
    created_epoch="$(node -e '
      const parsed = Date.parse(process.argv[1]);
      if (!Number.isFinite(parsed)) process.exit(2);
      process.stdout.write(String(Math.floor(parsed / 1000)));
    ' "$created_at")" || {
      echo "ERROR: deployment candidate carries an invalid createdAt: $row" >&2
      exit 76
    }
    now_epoch="$(date -u +%s)"
    # Ten seconds of clock skew only. Before-set exclusion plus this window are both required.
    if [ "$created_epoch" -ge $((request_start - 10)) ] && [ "$created_epoch" -le $((now_epoch + 10)) ]; then
      candidates="$(jq -c --argjson row "$row" '. + [$row]' <<< "$candidates")"
    fi
  done < <(jq -c '.[]' <<< "$possible")

  count="$(jq 'length' <<< "$candidates")"
  if [ "$count" -gt 1 ]; then
    echo "ERROR: multiple deployments match the returned target revision and request window; state is UNKNOWN" >&2
    jq . <<< "$candidates" >&2
    exit 76
  fi
  if [ "$count" -eq 1 ]; then
    jq -er '.[0].arn' <<< "$candidates"
    exit 0
  fi
  sleep "$poll_seconds"
done

echo "ERROR: no deployment matches the returned target revision and request window; state is UNKNOWN" >&2
exit 75
