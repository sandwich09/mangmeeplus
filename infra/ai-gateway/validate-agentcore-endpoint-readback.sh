#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "Usage: $0 <endpoint.json> <runtime-arn> <endpoint-name> <version> <intended|ready>" >&2
  exit 2
fi

endpoint_json="$1"
runtime_arn="$2"
endpoint_name="$3"
version="$4"
phase="$5"

[[ "$version" =~ ^[1-9][0-9]{0,4}$ ]]
case "$phase" in intended|ready) ;; *) exit 2 ;; esac

if ! jq -e --arg arn "$runtime_arn" --arg name "$endpoint_name" --arg version "$version" \
  --arg phase "$phase" '
    .agentRuntimeArn == $arn
    and .agentRuntimeEndpointArn == ($arn + "/runtime-endpoint/" + $name)
    and .name == $name
    and (if $phase == "ready" then
      .status == "READY"
      and .liveVersion == $version
      and (.targetVersion == null or .targetVersion == $version)
    else
      (.targetVersion // .liveVersion) == $version
    end)
  ' "$endpoint_json" >/dev/null; then
  echo "ERROR: AgentCore endpoint readback does not match phase=$phase name=$endpoint_name version=$version" >&2
  exit 1
fi
