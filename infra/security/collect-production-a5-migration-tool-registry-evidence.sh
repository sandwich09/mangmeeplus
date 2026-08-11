#!/usr/bin/env bash
set -euo pipefail

registry_evidence_sha256_json() {
  jq -cjS . "$1" | sha256sum | awk '{print $1}'
}

registry_evidence_validate() {
  if [ "$#" -ne 7 ]; then
    echo "Usage: validate <image@digest> <source-sha> <index.json> <attestation-manifest.json> <provenance.json> <sbom.json> <facts.json>" >&2
    return 2
  fi
  local image="$1" source_sha="$2" index="$3" attestation="$4" provenance="$5" sbom="$6" output="$7"
  local digest runnable_digest attestation_digest provenance_type runnable_hex

  [[ "$image" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@(sha256:[0-9a-f]{64})$ ]]
  digest="${BASH_REMATCH[1]}"
  [[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]
  for file in "$index" "$attestation" "$provenance" "$sbom"; do
    test -f "$file" && test -s "$file"
    jq -e 'type == "object"' "$file" >/dev/null
  done

  runnable_digest="$(jq -er '
    select(.mediaType == "application/vnd.oci.image.index.v1+json"
      and (.manifests | type == "array"))
    | [.manifests[]
        | select(.mediaType == "application/vnd.oci.image.manifest.v1+json")
        | select(.platform.os == "linux" and .platform.architecture == "amd64")
        | select((.annotations["vnd.docker.reference.type"] // "") != "attestation-manifest")]
    | select(length == 1) | .[0].digest
    | select(test("^sha256:[0-9a-f]{64}$"))
  ' "$index")"
  attestation_digest="$(jq -er --arg runnable "$runnable_digest" '
    [.manifests[]
      | select(.mediaType == "application/vnd.oci.image.manifest.v1+json")
      | select(.platform.os == "unknown" and .platform.architecture == "unknown")
      | select(.annotations["vnd.docker.reference.type"] == "attestation-manifest")
      | select(.annotations["vnd.docker.reference.digest"] == $runnable)]
    | select(length == 1) | .[0].digest
    | select(test("^sha256:[0-9a-f]{64}$"))
  ' "$index")"
  test "$(jq -r '[.manifests[] | select(.platform.os == "unknown" and .platform.architecture == "unknown")]|length' "$index")" = 1

  jq -e --arg provenanceDigest "$(jq -er --arg type '^https://slsa.dev/provenance/v(0\\.2|1)$' '
      [.layers[] | select(.mediaType == "application/vnd.in-toto+json")
        | select(.annotations["in-toto.io/predicate-type"] | test($type))]
      | select(length == 1) | .[0].digest
    ' "$attestation")" --arg sbomDigest "$(jq -er '
      [.layers[] | select(.mediaType == "application/vnd.in-toto+json")
        | select(.annotations["in-toto.io/predicate-type"] == "https://spdx.dev/Document")]
      | select(length == 1) | .[0].digest
    ' "$attestation")" '
    .schemaVersion == 2
    and .mediaType == "application/vnd.oci.image.manifest.v1+json"
    and (.config.digest | test("^sha256:[0-9a-f]{64}$"))
    and (.layers | type == "array" and length == 2)
    and ($provenanceDigest | test("^sha256:[0-9a-f]{64}$"))
    and ($sbomDigest | test("^sha256:[0-9a-f]{64}$"))
    and $provenanceDigest != $sbomDigest
  ' "$attestation" >/dev/null

  runnable_hex="${runnable_digest#sha256:}"
  provenance_type="$(jq -er '.predicateType
    | select(test("^https://slsa.dev/provenance/v(0\\.2|1)$"))' "$provenance")"
  jq -e --arg digest "$runnable_hex" --arg source "$source_sha" '
    ._type == "https://in-toto.io/Statement/v1"
    and (.subject | type == "array" and length >= 1)
    and any(.subject[]; .digest.sha256 == $digest)
    and ((.predicateType == "https://slsa.dev/provenance/v1"
        and .predicate.buildDefinition.buildType
          == "https://github.com/moby/buildkit/blob/master/docs/attestations/slsa-definitions.md")
      or (.predicateType == "https://slsa.dev/provenance/v0.2"
        and .predicate.buildType == "https://mobyproject.org/buildkit@v1"))
    and ([.. | strings] | any(. == $source))
  ' "$provenance" >/dev/null
  jq -e --arg digest "$runnable_hex" '
    ._type == "https://in-toto.io/Statement/v1"
    and .predicateType == "https://spdx.dev/Document"
    and (.subject | type == "array" and length >= 1)
    and any(.subject[]; .digest.sha256 == $digest)
    and .predicate.spdxVersion == "SPDX-2.3"
    and .predicate.SPDXID == "SPDXRef-DOCUMENT"
  ' "$sbom" >/dev/null

  jq -cnS --arg image "$image" --arg digest "$digest" --arg source "$source_sha" \
    --arg indexHash "$(registry_evidence_sha256_json "$index")" \
    --arg runnable "$runnable_digest" --arg attestationDigest "$attestation_digest" \
    --arg attestationHash "$(registry_evidence_sha256_json "$attestation")" \
    --arg sbomHash "$(registry_evidence_sha256_json "$sbom")" \
    --arg provenanceHash "$(registry_evidence_sha256_json "$provenance")" \
    --arg provenanceType "$provenance_type" '
      {image:$image,digest:$digest,sourceCommit:$source,
       registryBinding:{indexPath:"migration-tool.registry.index.json",sha256:$indexHash,
         runnablePlatform:"linux/amd64",runnableDigest:$runnable,
         attestationManifestDigest:$attestationDigest,
         attestationManifestSha256:$attestationHash},
       sbom:{format:"SPDX-2.3",path:"migration-tool.registry.sbom.in-toto.json",sha256:$sbomHash},
       provenance:{path:"migration-tool.registry.provenance.in-toto.json",
         predicateType:$provenanceType,sha256:$provenanceHash,
         sourceCommit:$source,subjectDigest:$runnable}}
    ' > "$output"
}

registry_evidence_collect() {
  if [ "$#" -ne 3 ]; then
    echo "Usage: collect <image@digest> <source-sha> <output-directory>" >&2
    return 2
  fi
  local image="$1" source_sha="$2" output_dir="$3"
  local repository digest index_response attestation_response index attestation provenance sbom
  local attestation_digest provenance_layer sbom_layer url
  [[ "$image" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/(watchdog-bms-migration-tool)@(sha256:[0-9a-f]{64})$ ]]
  repository="${BASH_REMATCH[1]}"
  digest="${BASH_REMATCH[2]}"
  mkdir -p "$output_dir"
  index_response="$output_dir/registry-index-response.json"
  attestation_response="$output_dir/registry-attestation-response.json"
  index="$output_dir/migration-tool.registry.index.json"
  attestation="$output_dir/migration-tool.registry.attestation-manifest.json"
  provenance="$output_dir/migration-tool.registry.provenance.in-toto.json"
  sbom="$output_dir/migration-tool.registry.sbom.in-toto.json"

  aws ecr batch-get-image --repository-name "$repository" --image-ids "imageDigest=$digest" \
    --accepted-media-types application/vnd.oci.image.index.v1+json --output json > "$index_response"
  jq -e --arg digest "$digest" '
    .failures == [] and (.images | length) == 1
    and .images[0].registryId == "311414082667"
    and .images[0].repositoryName == "watchdog-bms-migration-tool"
    and .images[0].imageId.imageDigest == $digest
    and .images[0].imageManifestMediaType == "application/vnd.oci.image.index.v1+json"
  ' "$index_response" >/dev/null
  jq -cS '.images[0].imageManifest | fromjson' "$index_response" > "$index"
  attestation_digest="$(jq -er '
    [.manifests[] | select(.annotations["vnd.docker.reference.type"] == "attestation-manifest")]
    | select(length == 1) | .[0].digest
  ' "$index")"
  aws ecr batch-get-image --repository-name "$repository" \
    --image-ids "imageDigest=$attestation_digest" \
    --accepted-media-types application/vnd.oci.image.manifest.v1+json --output json > "$attestation_response"
  jq -e --arg digest "$attestation_digest" '
    .failures == [] and (.images | length) == 1
    and .images[0].registryId == "311414082667"
    and .images[0].repositoryName == "watchdog-bms-migration-tool"
    and .images[0].imageId.imageDigest == $digest
  ' "$attestation_response" >/dev/null
  jq -cS '.images[0].imageManifest | fromjson' "$attestation_response" > "$attestation"

  provenance_layer="$(jq -er '[.layers[]
    | select(.annotations["in-toto.io/predicate-type"] | test("^https://slsa.dev/provenance/v(0\\.2|1)$"))]
    | select(length == 1) | .[0].digest' "$attestation")"
  sbom_layer="$(jq -er '[.layers[]
    | select(.annotations["in-toto.io/predicate-type"] == "https://spdx.dev/Document")]
    | select(length == 1) | .[0].digest' "$attestation")"
  url="$(aws ecr get-download-url-for-layer --repository-name "$repository" \
    --layer-digest "$provenance_layer" --query downloadUrl --output text)"
  curl --fail --silent --show-error --location --proto '=https' "$url" | jq -cS . > "$provenance"
  url="$(aws ecr get-download-url-for-layer --repository-name "$repository" \
    --layer-digest "$sbom_layer" --query downloadUrl --output text)"
  curl --fail --silent --show-error --location --proto '=https' "$url" | jq -cS . > "$sbom"

  registry_evidence_validate "$image" "$source_sha" "$index" "$attestation" \
    "$provenance" "$sbom" "$output_dir/migration-tool.registry-facts.json"
}

command_name="${1:-}"
shift || true
case "$command_name" in
  collect) registry_evidence_collect "$@" ;;
  validate) registry_evidence_validate "$@" ;;
  *) echo "Usage: $0 <collect|validate> ..." >&2; exit 2 ;;
esac
