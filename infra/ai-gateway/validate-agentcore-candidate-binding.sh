#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <agentcore-binding.json> <line-ai-release-manifest.json> <uat|production>" >&2
  exit 2
fi
binding="$1"
release_manifest="$2"
environment="$3"
case "$environment" in uat|production) ;; *) exit 2 ;; esac

jq -e --arg environment "$environment" --slurpfile release "$release_manifest" '
  def exact($expected): (keys | sort) == ($expected | sort);
  exact(["artifact","bindingStrategy","configurationSha256","contractVersion","endpoint",
    "environment","executionRoleArn","runtime","schemaVersion","sourceCommit"])
  and .schemaVersion == 1
  and .environment == $environment
  and .sourceCommit == $release[0].sourceCommit
  and .bindingStrategy == $release[0].bindingStrategy
  and .bindingStrategy == "isolated_runtime_pinned_endpoint"
  and .executionRoleArn == ("arn:aws:iam::" + (.runtime.arn | split(":")[4]) + ":role/" +
    (if $environment == "uat" then "watchdog-bms-uat-agentcore-execution-role"
     else "watchdog-bms-production-agentcore-candidate-execution-role" end))
  and .contractVersion == $release[0].contract.runtimeContractVersion
  and (.configurationSha256 | test("^[0-9a-f]{64}$"))
  and (.artifact | exact(["bucket","objectVersionId","prefix","sha256"]))
  and .artifact.sha256 == $release[0].agentCore.artifactSha256
  and (.artifact.bucket | test("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$"))
  and .artifact.prefix == ("agentcore/watchdog_orchestrator_" + $environment + "_candidate-"
    + .sourceCommit + "-" + .artifact.sha256 + ".zip")
  and (.artifact.objectVersionId | type == "string" and length > 0)
  and (.runtime | exact(["arn","id","status","version"]))
  and .runtime.status == "READY"
  and (.runtime.version | test("^[1-9][0-9]{0,4}$"))
  and (.runtime.arn | test("^arn:aws:bedrock-agentcore:[a-z0-9-]+:[0-9]{12}:runtime/[A-Za-z][A-Za-z0-9_]{0,99}-[A-Za-z0-9]{10}$"))
  and (.runtime as $runtime | ($runtime.arn | endswith("/" + $runtime.id)))
  and (.runtime.arn | contains("/watchdog_orchestrator_" + $environment + "_candidate-"))
  and (.runtime.arn | split(":")[4]) == (.artifact.bucket | capture("-(?<account>[0-9]{12})$").account)
  and (.endpoint | exact(["arn","name","status","version"]))
  and .endpoint.status == "READY"
  and .endpoint.version == .runtime.version
  and (.endpoint.name | test("^candidate_" + $environment + "_[0-9a-f]{12}_[0-9a-f]{8}$"))
  and .endpoint.name == ("candidate_" + $environment + "_" + (.sourceCommit[0:12]) + "_" + (.artifact.sha256[0:8]))
  and .endpoint.name != "DEFAULT"
  and .endpoint.arn == (.runtime.arn + "/runtime-endpoint/" + .endpoint.name)
' "$binding" >/dev/null

jq -r '.endpoint.name' "$binding"
