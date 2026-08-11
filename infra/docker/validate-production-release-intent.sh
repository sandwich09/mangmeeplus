#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 7 ]; then
  echo "Usage: $0 <target> <promotion-run-id> <direct-partial-incident> <incident-ref> <incident-approval-ref> <maintenance-only> <maintenance-bootstrap>" >&2
  exit 2
fi

target="$1"
promotion_run_id="$2"
direct_partial_incident="$3"
incident_ref="$4"
incident_approval_ref="$5"
maintenance_only="$6"
maintenance_bootstrap="$7"
[[ "$target" =~ ^(auto|all|api-web|ai-gateway|workers)$ ]] || {
  echo "ERROR: production deploy target is invalid" >&2
  exit 1
}
[[ "$maintenance_only" =~ ^(true|false)$ ]] || {
  echo "ERROR: maintenance-only must be exactly true or false" >&2
  exit 1
}
[[ "$maintenance_bootstrap" =~ ^(true|false)$ ]] || {
  echo "ERROR: maintenance-bootstrap must be exactly true or false" >&2
  exit 1
}
[ "$maintenance_bootstrap" = false ] || [ "$maintenance_only" = true ] || {
  echo "ERROR: maintenance-bootstrap requires maintenance-only=true" >&2
  exit 1
}

serving_mode=live
if [ "$maintenance_only" = true ]; then
  [ "${GITHUB_EVENT_NAME:-}" = workflow_dispatch ] || {
    echo "ERROR: maintenance-only requires workflow_dispatch authority" >&2
    exit 1
  }
  serving_mode=maintenance_only
fi

emit_result() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'serving_mode=%s\n' "$serving_mode" >> "$GITHUB_OUTPUT"
    printf 'uses_uat=%s\n' "$2" >> "$GITHUB_OUTPUT"
  fi
  printf '%s\n' "$1"
}

if [ "$target" = auto ]; then
  [ "$maintenance_bootstrap" = false ] \
    && [[ "$promotion_run_id" =~ ^[1-9][0-9]*$ ]] \
    && [ "$direct_partial_incident" = false ] \
    && [ -z "$incident_ref" ] \
    && [ -z "$incident_approval_ref" ] || {
      echo "ERROR: automatic production promotion requires only one exact UAT producer run ID" >&2
      exit 1
    }
  emit_result fast-promotion true
  exit 0
fi

if [ "$target" = all ]; then
  [[ "$promotion_run_id" =~ ^[1-9][0-9]*$ ]] \
    && [ "$direct_partial_incident" = false ] \
    && [ -z "$incident_ref" ] \
    && [ -z "$incident_approval_ref" ] || {
      echo "ERROR: coordinated promotion requires only one exact UAT producer run ID" >&2
      exit 1
    }
  if [ "$maintenance_bootstrap" = true ]; then
    emit_result maintenance-bootstrap true
  else
    emit_result promotion true
  fi
  exit 0
fi

[ "$maintenance_only" = false ] && [ "$maintenance_bootstrap" = false ] || {
  echo "ERROR: partial deploy cannot use maintenance-only or maintenance-bootstrap" >&2
  exit 1
}
[ -z "$promotion_run_id" ] \
  && [ "$direct_partial_incident" = true ] \
  && [[ "$incident_ref" =~ ^INC-[A-Za-z0-9._-]{4,}$ ]] \
  && [[ "$incident_approval_ref" =~ ^approval://[A-Za-z0-9._/-]+$ ]] || {
    echo "ERROR: partial deploy requires explicit incident and incident-approval authority" >&2
    exit 1
  }
emit_result partial-incident false
