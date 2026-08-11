#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
validator="$repo_root/infra/security/collect-production-a5-migration-tool-registry-evidence.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/migration-tool-registry.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

source_sha="$(printf 'a%.0s' {1..40})"
root_digest="sha256:$(printf '1%.0s' {1..64})"
runnable_digest="sha256:$(printf '2%.0s' {1..64})"
attestation_digest="sha256:$(printf '3%.0s' {1..64})"
provenance_digest="sha256:$(printf '4%.0s' {1..64})"
sbom_digest="sha256:$(printf '5%.0s' {1..64})"
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-migration-tool@$root_digest"

jq -cnS --arg runnable "$runnable_digest" --arg attestation "$attestation_digest" '
  {schemaVersion:2,mediaType:"application/vnd.oci.image.index.v1+json",manifests:[
    {mediaType:"application/vnd.oci.image.manifest.v1+json",digest:$runnable,size:100,
      platform:{architecture:"amd64",os:"linux"}},
    {mediaType:"application/vnd.oci.image.manifest.v1+json",digest:$attestation,size:200,
      annotations:{"vnd.docker.reference.digest":$runnable,
        "vnd.docker.reference.type":"attestation-manifest"},
      platform:{architecture:"unknown",os:"unknown"}}
  ]}
' > "$fixture/index.json"
jq -cnS --arg provenance "$provenance_digest" --arg sbom "$sbom_digest" '
  {schemaVersion:2,mediaType:"application/vnd.oci.image.manifest.v1+json",
   config:{mediaType:"application/vnd.oci.empty.v1+json",digest:("sha256:"+("6"*64)),size:2},
   layers:[
    {mediaType:"application/vnd.in-toto+json",digest:$provenance,size:300,
      annotations:{"in-toto.io/predicate-type":"https://slsa.dev/provenance/v1"}},
    {mediaType:"application/vnd.in-toto+json",digest:$sbom,size:400,
      annotations:{"in-toto.io/predicate-type":"https://spdx.dev/Document"}}
   ]}
' > "$fixture/attestation.json"
jq -cnS --arg digest "${runnable_digest#sha256:}" --arg source "$source_sha" '
  {_type:"https://in-toto.io/Statement/v1",subject:[{name:"pkg",digest:{sha256:$digest}}],
   predicateType:"https://slsa.dev/provenance/v1",
   predicate:{buildDefinition:{buildType:"https://github.com/moby/buildkit/blob/master/docs/attestations/slsa-definitions.md",
     externalParameters:{args:{GIT_SHA:$source}}},runDetails:{builder:{id:"fixture"}}}}
' > "$fixture/provenance.json"
jq -cnS --arg digest "${runnable_digest#sha256:}" '
  {_type:"https://in-toto.io/Statement/v1",subject:[{name:"pkg",digest:{sha256:$digest}}],
   predicateType:"https://spdx.dev/Document",
   predicate:{spdxVersion:"SPDX-2.3",SPDXID:"SPDXRef-DOCUMENT",name:"fixture"}}
' > "$fixture/sbom.json"

bash "$validator" validate "$image" "$source_sha" "$fixture/index.json" \
  "$fixture/attestation.json" "$fixture/provenance.json" "$fixture/sbom.json" "$fixture/facts.json"
jq -e --arg image "$image" --arg runnable "$runnable_digest" --arg attestation "$attestation_digest" '
  .image == $image and .digest == ($image|split("@")|.[1])
  and .registryBinding.runnableDigest == $runnable
  and .registryBinding.attestationManifestDigest == $attestation
  and .provenance.predicateType == "https://slsa.dev/provenance/v1"
  and .sbom.format == "SPDX-2.3"
' "$fixture/facts.json" >/dev/null

expect_reject() {
  local label="$1" index="$2" attestation="$3" provenance="$4" sbom="$5"
  if bash "$validator" validate "$image" "$source_sha" "$index" "$attestation" \
      "$provenance" "$sbom" "$fixture/rejected.json" >/dev/null 2>&1; then
    echo "ERROR: $label was accepted" >&2
    exit 1
  fi
}

jq -cS '.manifests[1].annotations["vnd.docker.reference.digest"]=("sha256:"+("9"*64))' \
  "$fixture/index.json" > "$fixture/wrong-reference.json"
expect_reject copied-ref-only "$fixture/wrong-reference.json" "$fixture/attestation.json" \
  "$fixture/provenance.json" "$fixture/sbom.json"
jq -cS '.subject[0].digest.sha256=("9"*64)' "$fixture/provenance.json" \
  > "$fixture/forged-provenance.json"
expect_reject forged-subject "$fixture/index.json" "$fixture/attestation.json" \
  "$fixture/forged-provenance.json" "$fixture/sbom.json"
jq -cS '.predicateType="https://slsa.dev/provenance/v1"' "$fixture/sbom.json" \
  > "$fixture/swapped-sbom.json"
expect_reject swapped-predicate "$fixture/index.json" "$fixture/attestation.json" \
  "$fixture/provenance.json" "$fixture/swapped-sbom.json"
jq -cS '.predicate.buildDefinition.buildType="https://example.com/foreign-builder"' \
  "$fixture/provenance.json" > "$fixture/foreign-builder.json"
expect_reject foreign-builder "$fixture/index.json" "$fixture/attestation.json" \
  "$fixture/foreign-builder.json" "$fixture/sbom.json"
jq -cS 'walk(if type=="string" and .==$source then "missing" else . end)' \
  --arg source "$source_sha" "$fixture/provenance.json" > "$fixture/wrong-source.json"
expect_reject wrong-source "$fixture/index.json" "$fixture/attestation.json" \
  "$fixture/wrong-source.json" "$fixture/sbom.json"

bash -n "$validator" "$0"
printf '%s\n' 'production A5 migration-tool registry evidence specs passed'
