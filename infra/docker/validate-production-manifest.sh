#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <manifest.json> <aws-account-id> <aws-region>" >&2
  exit 2
fi

manifest="$1"
registry="$2.dkr.ecr.$3.amazonaws.com/"

jq -er --arg registry "$registry" '
  .sourceCommit as $source
  | select(
      .schemaVersion == 1
      and ($source | test("^[0-9a-f]{40}$"))
      and ([.images[].service] | sort) == ["ai-gateway", "api-web", "workers"]
      and all(.images[];
        .sourceCommit == $source
        and (.digest | test("^sha256:[0-9a-f]{64}$"))
        and (
          (.service == "api-web" and .repository == "watchdog-bms-api")
          or (.service == "ai-gateway" and .repository == "watchdog-bms-ai-gateway")
          or (.service == "workers" and .repository == "watchdog-bms-workers")
        )
        and .image == ($registry + .repository + "@" + .digest)
      )
    )
  | $source
' "$manifest"
