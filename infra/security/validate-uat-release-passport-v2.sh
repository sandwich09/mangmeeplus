#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 10 ]; then
  echo "Usage: $0 <passport.json> <artifact-root> <source-sha> <uat-run-id> <uat-attempt> <controller-sha> <repository> <account-id> <region> <now-epoch>" >&2
  exit 2
fi

passport="$1"
artifact_root="$2"
source_sha="$3"
run_id="$4"
run_attempt="$5"
controller_sha="$6"
repository="$7"
account_id="$8"
region="$9"
now_epoch="${10}"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$controller_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$run_id" =~ ^[1-9][0-9]*$ ]]
[[ "$run_attempt" =~ ^[1-9][0-9]*$ ]]
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
[[ "$account_id" =~ ^[0-9]{12}$ ]]
[[ "$region" =~ ^[a-z]{2}-[a-z]+-[1-9][0-9]*$ ]]
[[ "$now_epoch" =~ ^[1-9][0-9]*$ ]]
[ -d "$artifact_root" ] && [ ! -L "$artifact_root" ]
[ -f "$passport" ] && [ ! -L "$passport" ] && [ "$(wc -c < "$passport")" -le 524288 ]

artifact_root="$(cd "$artifact_root" && pwd -P)"
passport="$(cd "$(dirname "$passport")" && pwd -P)/$(basename "$passport")"

work="$(mktemp -d "${TMPDIR:-/tmp}/uat-release-passport-v2.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
jq -cS . "$passport" > "$work/canonical.json"
cmp -s "$passport" "$work/canonical.json" || {
  echo "ERROR: UAT V2 passport is not canonical jq -cS JSON" >&2
  exit 1
}

content_sha256="$(jq -cjS 'del(.contentSha256)' "$passport" | sha256_stream)"

jq -e \
  --arg source "$source_sha" \
  --arg run "$run_id" \
  --argjson attempt "$run_attempt" \
  --arg controller "$controller_sha" \
  --arg repository "$repository" \
  --arg account "$account_id" \
  --arg region "$region" \
  --arg content "$content_sha256" \
  --argjson now "$now_epoch" '
    def exact_keys($keys): (keys_unsorted | sort) == ($keys | sort);
    def sha40: type == "string" and test("^[0-9a-f]{40}$");
    def sha256: type == "string" and test("^[0-9a-f]{64}$");
    def digest: type == "string" and test("^sha256:[0-9a-f]{64}$");
    exact_keys(["schemaVersion","artifactKind","environment","repository","workflow",
      "sourceCommit","requestedTarget","resolvedTarget","issuedAtEpoch","expiresAtEpoch",
      "validatedCiRunId","release","lineAiCandidate","tools","migrationCatalog","uatProof","contentSha256"])
    and .schemaVersion == 2
    and .artifactKind == "UAT_RELEASE_PASSPORT_V2"
    and .environment == "uat"
    and .repository == $repository
    and (.workflow | exact_keys(["path","runId","runAttempt","controllerRef","controllerCommit"]))
    and .workflow.path == ".github/workflows/deploy-uat.yml"
    and .workflow.runId == $run
    and .workflow.runAttempt == $attempt
    and .workflow.controllerRef == "refs/heads/main"
    and .workflow.controllerCommit == $controller
    and .sourceCommit == $source
    and (.sourceCommit | sha40)
    and (.requestedTarget == "all" or .requestedTarget == "auto")
    and .resolvedTarget == "all"
    and (.issuedAtEpoch | type == "number" and floor == . and . >= 1 and . <= $now)
    and (.expiresAtEpoch | type == "number" and floor == . and . > $now)
    and (.expiresAtEpoch - .issuedAtEpoch) == 86400
    and (.validatedCiRunId | type == "string" and test("^$|^[1-9][0-9]*$"))
    and (.contentSha256 | sha256) and .contentSha256 == $content
    and (.release | exact_keys(["artifactName","manifestPath","manifestSha256","images"]))
    and .release.artifactName == ("uat-accepted-release-" + $source + "-attempt-" + ($attempt|tostring))
    and .release.manifestPath == "release/production-image-manifest.json"
    and (.release.manifestSha256 | sha256)
    and (.release.images | type == "array" and length == 3)
    and ([.release.images[].service] | sort) == ["ai-gateway","api-web","workers"]
    and all(.release.images[];
      exact_keys(["service","repository","image","digest","sourceCommit","sbom","signature","attestations"])
      and .sourceCommit == $source and (.digest | digest)
      and (.digest as $digest | .image | endswith("@" + $digest))
      and (.sbom | exact_keys(["path","sha256"])) and (.sbom.sha256 | sha256)
      and (.signature | exact_keys(["path","sha256"])) and (.signature.sha256 | sha256)
      and .attestations == {provenance:"BUILDKIT_MAX",sbom:"BUILDKIT_REGISTRY_NATIVE"})
    and (.lineAiCandidate | exact_keys(["artifactManifestPath","artifactManifestSha256",
      "artifactPath","bindingPath","bindingSha256","contractPath","manifestPath","manifestSha256"]))
    and .lineAiCandidate.manifestPath == "release/line-ai-release-manifest.json"
    and (.lineAiCandidate.manifestSha256 | sha256)
    and .lineAiCandidate.artifactManifestPath == "release/agentcore/agentcore-artifact.json"
    and (.lineAiCandidate.artifactManifestSha256 | sha256)
    and .lineAiCandidate.artifactPath == "release/agentcore/agentcore.zip"
    and .lineAiCandidate.contractPath == "release/line-ai-contract.ts"
    and .lineAiCandidate.bindingPath == "agentcore-binding.json"
    and (.lineAiCandidate.bindingSha256 | sha256)
    and (.tools | type == "array" and length == 2)
    and ([.tools[].purpose] | sort) == ["migration-tool","release-task"]
    and all(.tools[];
      exact_keys(["purpose","repository","image","digest","sourceCommit","sbom","signature","attestations"])
      and .sourceCommit == $source and (.digest | digest)
      and (.digest as $digest | .image | endswith("@" + $digest))
      and (.sbom | exact_keys(["path","sha256"])) and (.sbom.sha256 | sha256)
      and (.signature | exact_keys(["path","sha256"])) and (.signature.sha256 | sha256)
      and .attestations == {provenance:"BUILDKIT_MAX",sbom:"BUILDKIT_REGISTRY_NATIVE"}
      and (if .purpose == "release-task" then
        .repository == "watchdog-bms-api"
        and (.image | startswith($account + ".dkr.ecr." + $region + ".amazonaws.com/watchdog-bms-api@"))
      else
        .repository == "watchdog-bms-migration-tool"
        and (.image | startswith($account + ".dkr.ecr." + $region + ".amazonaws.com/watchdog-bms-migration-tool@"))
      end))
    and (.migrationCatalog | exact_keys(["path","sha256","migrationCount","repositoryCatalogHash","prismaSchemaSha256"]))
    and .migrationCatalog.path == "migration-catalog.json"
    and (.migrationCatalog.sha256 | sha256)
    and (.migrationCatalog.migrationCount | type == "number" and floor == . and . >= 1)
    and (.migrationCatalog.repositoryCatalogHash | sha256)
    and (.migrationCatalog.prismaSchemaSha256 | sha256)
    and .uatProof == {ciVerified:true,healthVerified:true,imageScanVerified:true,releaseFinalized:true}
  ' "$passport" >/dev/null

safe_file() {
  local relative="$1" limit="$2" resolved
  [[ "$relative" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]]
  [[ "$relative" != /* && "$relative" != *".."* && "$relative" != *"//"* ]]
  resolved="$artifact_root/$relative"
  [ -f "$resolved" ] && [ ! -L "$resolved" ] && [ "$(wc -c < "$resolved")" -le "$limit" ]
  printf '%s' "$resolved"
}

manifest_path="$(safe_file "$(jq -er '.release.manifestPath' "$passport")" 1048576)"
test "$(sha256_file "$manifest_path")" = "$(jq -er '.release.manifestSha256' "$passport")"
manifest_source="$(bash "$(dirname "$0")/../docker/validate-production-manifest.sh" \
  "$manifest_path" "$account_id" "$region")"
test "$manifest_source" = "$source_sha"
jq -e --slurpfile passport "$passport" '
  .images == ($passport[0].release.images
    | map(. as $image | {service:$image.service,repository:$image.repository,image:$image.image,
      digest:$image.digest,sourceCommit:$image.sourceCommit,
      sbom:("sbom-" + $image.service + ".spdx.json")}) | sort_by(.service))
' "$manifest_path" >/dev/null

line_ai_manifest_path="$(safe_file "$(jq -er '.lineAiCandidate.manifestPath' "$passport")" 1048576)"
agentcore_artifact_manifest_path="$(safe_file "$(jq -er '.lineAiCandidate.artifactManifestPath' "$passport")" 1048576)"
agentcore_artifact_path="$(safe_file "$(jq -er '.lineAiCandidate.artifactPath' "$passport")" 104857600)"
line_ai_contract_path="$(safe_file "$(jq -er '.lineAiCandidate.contractPath' "$passport")" 1048576)"
agentcore_binding_path="$(safe_file "$(jq -er '.lineAiCandidate.bindingPath' "$passport")" 1048576)"
test "$(sha256_file "$line_ai_manifest_path")" = "$(jq -er '.lineAiCandidate.manifestSha256' "$passport")"
test "$(sha256_file "$agentcore_artifact_manifest_path")" = "$(jq -er '.lineAiCandidate.artifactManifestSha256' "$passport")"
test "$(sha256_file "$agentcore_binding_path")" = "$(jq -er '.lineAiCandidate.bindingSha256' "$passport")"
test "$(bash "$(dirname "$0")/../ai-gateway/validate-line-ai-release-manifest.sh" \
  "$line_ai_manifest_path" "$manifest_path" "$(dirname "$agentcore_artifact_path")" \
  "$line_ai_contract_path" "$source_sha")" = "$source_sha"
test "$(bash "$(dirname "$0")/../ai-gateway/validate-agentcore-candidate-binding.sh" \
  "$agentcore_binding_path" "$line_ai_manifest_path" uat)" = \
  "$(jq -er '.endpoint.name' "$agentcore_binding_path")"

while IFS=$'\t' read -r path expected kind; do
  case "$kind" in sbom) limit=104857600 ;; signature) limit=1048576 ;; *) exit 2 ;; esac
  file="$(safe_file "$path" "$limit")"
  test "$(sha256_file "$file")" = "$expected"
  if [ "$kind" = sbom ]; then
    jq -e '.spdxVersion | startswith("SPDX-")' "$file" >/dev/null
  else
    jq -e 'type == "array" and length >= 1' "$file" >/dev/null
  fi
done < <(jq -r '.release.images[] | [.sbom.path,.sbom.sha256,"sbom"],
  [.signature.path,.signature.sha256,"signature"] | @tsv' "$passport")

catalog_relative="$(jq -er '.migrationCatalog.path' "$passport")"
catalog_path="$(safe_file "$catalog_relative" 1048576)"
test "$(sha256_file "$catalog_path")" = "$(jq -er '.migrationCatalog.sha256' "$passport")"
jq -cS . "$catalog_path" > "$work/catalog.json"
cmp -s "$catalog_path" "$work/catalog.json"
jq -e --arg source "$source_sha" --slurpfile passport "$passport" '
  (keys | sort) == (["migrations","prismaSchemaSha256","repositoryCatalogHash","schemaVersion","sourceCommit"] | sort)
  and .schemaVersion == 1 and .sourceCommit == $source
  and (.migrations | type == "array" and length == $passport[0].migrationCatalog.migrationCount)
  and all(.migrations[];
    (keys | sort) == (["checksum","name"] | sort)
    and (.name | type == "string" and test("^[0-9]{14}_[A-Za-z0-9_-]+$"))
    and (.checksum | type == "string" and test("^[0-9a-f]{64}$")))
  and .repositoryCatalogHash == $passport[0].migrationCatalog.repositoryCatalogHash
  and .prismaSchemaSha256 == $passport[0].migrationCatalog.prismaSchemaSha256
' "$catalog_path" >/dev/null
catalog_hash="$(jq -cjS '.migrations | map({name,checksum})' "$catalog_path" | sha256_stream)"
test "$catalog_hash" = "$(jq -er '.repositoryCatalogHash' "$catalog_path")"

while IFS=$'\t' read -r path expected kind; do
  case "$kind" in
    sbom) limit=104857600 ;;
    signature) limit=1048576 ;;
    *) exit 2 ;;
  esac
  file="$(safe_file "$path" "$limit")"
  test "$(sha256_file "$file")" = "$expected"
  if [ "$kind" = sbom ]; then
    jq -e '.spdxVersion | startswith("SPDX-")' "$file" >/dev/null
  else
    jq -e 'type == "array" and length >= 1' "$file" >/dev/null
  fi
done < <(jq -r '.tools[] | [.sbom.path,.sbom.sha256,"sbom"],
  [.signature.path,.signature.sha256,"signature"] | @tsv' "$passport")

echo "$source_sha"
