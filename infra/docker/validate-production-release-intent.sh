#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "Usage: $0 <target> <promotion-run-id> <direct-partial-incident> <incident-ref> <incident-approval-ref>" >&2
  exit 2
fi

target="$1"
promotion_run_id="$2"
direct_partial_incident="$3"
incident_ref="$4"
incident_approval_ref="$5"
[[ "$target" =~ ^(all|api-web|ai-gateway|workers)$ ]] || {
  echo "ERROR: production deploy target is invalid" >&2
  exit 1
}

if [ "$target" = all ]; then
  [[ "$promotion_run_id" =~ ^[1-9][0-9]*$ ]] \
    && [ "$direct_partial_incident" = false ] \
    && [ -z "$incident_ref" ] \
    && [ -z "$incident_approval_ref" ] || {
      echo "ERROR: coordinated promotion requires only one exact UAT producer run ID" >&2
      exit 1
    }
  printf 'promotion\n'
  exit 0
fi

[ -z "$promotion_run_id" ] \
  && [ "$direct_partial_incident" = true ] \
  && [[ "$incident_ref" =~ ^INC-[A-Za-z0-9._-]{4,}$ ]] \
  && [[ "$incident_approval_ref" =~ ^approval://[A-Za-z0-9._/-]+$ ]] || {
    echo "ERROR: partial deploy requires explicit incident and incident-approval authority" >&2
    exit 1
  }
printf 'partial-incident\n'
