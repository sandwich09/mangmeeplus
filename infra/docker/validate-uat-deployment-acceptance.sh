#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 11 ]; then
  echo "Usage: $0 <acceptance.json> <release-manifest.json> <source-sha> <run-id> <run-attempt> <controller-sha> <repository> <ci-workflow-blob> <deploy-workflow-blob> <validator-sha256> <now-epoch>" >&2
  exit 2
fi

acceptance="$1"
manifest="$2"
source_sha="$3"
run_id="$4"
run_attempt="$5"
controller_sha="$6"
repository="$7"
ci_workflow_blob="$8"
deploy_workflow_blob="$9"
validator_sha256="${10}"
now_epoch="${11}"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  fi
}

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  else
    openssl dgst -sha256 | awk '{print $NF}'
  fi
}

[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$controller_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$run_id" =~ ^[1-9][0-9]*$ ]]
[[ "$run_attempt" =~ ^[1-9][0-9]*$ ]]
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
[[ "$ci_workflow_blob" =~ ^[0-9a-f]{40}$ ]]
[[ "$deploy_workflow_blob" =~ ^[0-9a-f]{40}$ ]]
[[ "$validator_sha256" =~ ^[0-9a-f]{64}$ && ! "$validator_sha256" =~ ^0{64}$ ]]
[[ "$now_epoch" =~ ^[1-9][0-9]*$ ]]
[ -f "$acceptance" ] && [ ! -L "$acceptance" ] && [ "$(wc -c < "$acceptance")" -le 262144 ]
[ -f "$manifest" ] && [ ! -L "$manifest" ] && [ "$(wc -c < "$manifest")" -le 1048576 ]

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
self_validator_sha256="$(sha256_file "$script_dir/validate-uat-deployment-acceptance.sh")"
manifest_validator_sha256="$(sha256_file "$script_dir/validate-production-manifest.sh")"
test "$validator_sha256" = "$self_validator_sha256"

validator_tmp="$(mktemp -d "${TMPDIR:-/tmp}/uat-deployment-acceptance.XXXXXX")"
trap 'rm -rf "$validator_tmp"' EXIT
jq -cS . "$acceptance" > "$validator_tmp/canonical.json"
cmp -s "$acceptance" "$validator_tmp/canonical.json" || {
  echo "ERROR: UAT acceptance is not canonical jq -cS JSON with one trailing LF" >&2
  exit 1
}

content_sha256="$(jq -cS 'del(.contentSha256)' "$acceptance" | sha256_stream)"
manifest_sha256="$(sha256_file "$manifest")"

jq -e \
  --arg source "$source_sha" \
  --arg run "$run_id" \
  --argjson attempt "$run_attempt" \
  --arg controller "$controller_sha" \
  --arg repository "$repository" \
  --arg ciWorkflowBlob "$ci_workflow_blob" \
  --arg deployWorkflowBlob "$deploy_workflow_blob" \
  --arg validatorHash "$validator_sha256" \
  --arg manifestValidatorHash "$manifest_validator_sha256" \
  --arg contentHash "$content_sha256" \
  --arg manifestHash "$manifest_sha256" \
  --argjson now "$now_epoch" \
  --slurpfile manifest "$manifest" '
    def exact_keys($expected): (keys | sort) == ($expected | sort);
    def sha40: type == "string" and test("^[0-9a-f]{40}$");
    def sha256: type == "string" and test("^[0-9a-f]{64}$");
    def digest: type == "string" and test("^sha256:[0-9a-f]{64}$");
    exact_keys([
      "schemaVersion","acceptanceKind","environment","repository","workflowPath",
      "workflowRunId","workflowRunAttempt","controllerRef","controllerCommit",
      "sourceCommit","ciWorkflowBlob","deployWorkflowBlob","validatorSha256",
      "manifestValidatorSha256","contentSha256","issuedAtEpoch","expiresAtEpoch",
      "target","healthVerified","releaseFinalized","releaseArtifactName",
      "releaseManifestSha256","images"
    ])
    and .schemaVersion == 1
    and .acceptanceKind == "UAT_DEPLOYMENT_ACCEPTANCE"
    and .environment == "uat"
    and .repository == $repository
    and .workflowPath == ".github/workflows/deploy-uat.yml"
    and .workflowRunId == $run
    and .workflowRunAttempt == $attempt
    and .controllerRef == "refs/heads/main"
    and .controllerCommit == $controller
    and .sourceCommit == $source
    and .ciWorkflowBlob == $ciWorkflowBlob
    and .deployWorkflowBlob == $deployWorkflowBlob
    and .validatorSha256 == $validatorHash
    and .manifestValidatorSha256 == $manifestValidatorHash
    and (.contentSha256 | sha256) and .contentSha256 == $contentHash
    and (.issuedAtEpoch | type == "number" and . >= 1 and floor == .)
    and (.expiresAtEpoch | type == "number" and . >= 1 and floor == .)
    and .issuedAtEpoch <= $now
    and $now < .expiresAtEpoch
    and (.expiresAtEpoch - .issuedAtEpoch) == 86400
    and .target == "all"
    and .healthVerified == true
    and .releaseFinalized == true
    and .releaseArtifactName == ("uat-accepted-release-" + $source + "-attempt-" + ($attempt | tostring))
    and .releaseManifestSha256 == $manifestHash
    and (.images | type) == "array"
    and (.images | length) == 3
    and ([.images[].service] | sort) == ["ai-gateway","api-web","workers"]
    and all(.images[];
      exact_keys(["service","image","digest","sourceCommit"])
      and .sourceCommit == $source
      and (.digest | digest)
      and (.digest as $digest | .image | endswith("@" + $digest))
    )
    and ($manifest | length) == 1
    and ($manifest[0] | exact_keys(["schemaVersion","sourceCommit","workflowRunId","validationRunId","images"]))
    and $manifest[0].schemaVersion == 1
    and ($manifest[0].sourceCommit | sha40) and $manifest[0].sourceCommit == $source
    and $manifest[0].workflowRunId == $run
    and ($manifest[0].validationRunId | type == "string" and test("^$|^[1-9][0-9]*$"))
    and ($manifest[0].images | type) == "array"
    and ($manifest[0].images | length) == 3
    and $manifest[0].images == ($manifest[0].images | sort_by(.service))
    and ([$manifest[0].images[].service] | sort) == ["ai-gateway","api-web","workers"]
    and all($manifest[0].images[];
      exact_keys(["service","repository","image","digest","sourceCommit","sbom"])
      and .sourceCommit == $source
      and (.digest | digest)
      and (
        (.service == "api-web" and .repository == "watchdog-bms-api" and .sbom == "sbom-api-web.spdx.json")
        or (.service == "ai-gateway" and .repository == "watchdog-bms-ai-gateway" and .sbom == "sbom-ai-gateway.spdx.json")
        or (.service == "workers" and .repository == "watchdog-bms-workers" and .sbom == "sbom-workers.spdx.json")
      )
      and (.repository as $repository | .digest as $digest | .image | endswith("/" + $repository + "@" + $digest))
    )
    and .images == (
      $manifest[0].images
      | map({service, image, digest, sourceCommit})
      | sort_by(.service)
    )
  ' "$acceptance" >/dev/null
