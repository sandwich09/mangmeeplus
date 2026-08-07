#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <task-definition-json> <aws-region>" >&2
  exit 2
fi

task_definition="$1"
region="$2"
aws_bin="${AWS_BIN:-aws}"
max_attempts=5
attempt=1
error_file="$(mktemp "${TMPDIR:-/tmp}/watchdog-bms-register-task.XXXXXX")"
trap 'rm -f "$error_file"' EXIT

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy "$aws_bin" "$@"
}

while :; do
  if task_definition_arn="$(aws_cmd ecs register-task-definition \
    --cli-input-json "file://$task_definition" \
    --query taskDefinition.taskDefinitionArn --output text --region "$region" \
    2>"$error_file")"; then
    printf '%s\n' "$task_definition_arn"
    exit 0
  else
    status=$?
  fi
  cat "$error_file" >&2
  if ! grep -Fq 'An error occurred (ClientException) when calling the RegisterTaskDefinition operation: Too many concurrent attempts to create a new revision of the specified family.' "$error_file"; then
    exit "$status"
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[release-task] task-definition registration collision remained after $max_attempts attempts" >&2
    exit "$status"
  fi
  delay=$((1 << (attempt - 1)))
  echo "[release-task] transient task-definition registration collision; retry $((attempt + 1))/$max_attempts in ${delay}s" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done
