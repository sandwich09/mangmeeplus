#!/usr/bin/env bash
# Shared UAT Redis/deploy mutex. The caller must provide aws_cmd and region.

UAT_RUNTIME_MUTEX_PARAMETER="${UAT_RUNTIME_MUTEX_PARAMETER:-/watchdog-bms/uat/redis-migration-lock}"
UAT_RUNTIME_MUTEX_HELD="${UAT_RUNTIME_MUTEX_HELD:-false}"
UAT_RUNTIME_MUTEX_VALUE="${UAT_RUNTIME_MUTEX_VALUE:-}"

uat_runtime_mutex_acquire() {
  local owner="$1"
  [ "$UAT_RUNTIME_MUTEX_HELD" != true ] || return 0
  UAT_RUNTIME_MUTEX_VALUE="${owner}:$(date -u +%Y%m%dT%H%M%SZ):$$"
  if ! aws_cmd ssm put-parameter --name "$UAT_RUNTIME_MUTEX_PARAMETER" --type String \
    --value "$UAT_RUNTIME_MUTEX_VALUE" --no-overwrite --region "$region" >/dev/null 2>&1; then
    UAT_RUNTIME_MUTEX_VALUE=''
    return 1
  fi
  UAT_RUNTIME_MUTEX_HELD=true
}

uat_runtime_mutex_release() {
  local current=''
  [ "$UAT_RUNTIME_MUTEX_HELD" = true ] || return 0
  current="$(aws_cmd ssm get-parameter --name "$UAT_RUNTIME_MUTEX_PARAMETER" \
    --query Parameter.Value --output text --region "$region" 2>/dev/null || true)"
  if [ "$current" = "$UAT_RUNTIME_MUTEX_VALUE" ]; then
    aws_cmd ssm delete-parameter --name "$UAT_RUNTIME_MUTEX_PARAMETER" \
      --region "$region" >/dev/null 2>&1 || true
  else
    echo 'WARNING: UAT runtime mutex ownership changed or cannot be read; leaving it in place' >&2
  fi
  UAT_RUNTIME_MUTEX_HELD=false
  UAT_RUNTIME_MUTEX_VALUE=''
}
