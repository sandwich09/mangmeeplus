#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
workflow="$repo_root/.github/workflows/deploy-uat.yml"
validator="$repo_root/infra/docker/validate-uat-deployment-acceptance.sh"
manifest_validator="$repo_root/infra/docker/validate-production-manifest.sh"

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

line_of() {
  grep -nF "$1" "$workflow" | head -1 | cut -d: -f1
}

expect_reject() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ERROR: $label was accepted" >&2
    exit 1
  fi
}

validator_hash="$(sha256_file "$validator")"
manifest_validator_hash="$(sha256_file "$manifest_validator")"
bash -n "$validator" "$manifest_validator"
test -x "$validator"
test "$(grep -Fc "$validator_hash" "$workflow")" -eq 2
test "$(grep -Fc "$manifest_validator_hash" "$workflow")" -eq 3

# All candidate-controlled producers are pinned before the reusable CI job can publish to ECR.
test "$(line_of 'candidate substituted the UAT acceptance validator')" -lt "$(line_of 'build_and_publish:')"
test "$(line_of 'candidate substituted the production manifest validator')" -lt "$(line_of 'build_and_publish:')"
grep -Fq 'test "$source_deploy" = "$caller_deploy"' "$workflow"
grep -Fq 'if [ "$source_ci" != "$caller_ci" ]; then' "$workflow"

# The exact release directory and trusted manifest validator are checked before AWS credentials.
release_validation_line="$(line_of 'name: Validate release artifact')"
aws_credentials_line="$(line_of 'name: Configure AWS UAT deploy credentials')"
test "$release_validation_line" -lt "$aws_credentials_line"
grep -Fq "expected_entries=\$'cosign-ai-gateway.json:f\\ncosign-api-web.json:f\\ncosign-workers.json:f\\nproduction-image-manifest.json:f\\nsbom-ai-gateway.spdx.json:f\\nsbom-api-web.spdx.json:f\\nsbom-workers.spdx.json:f'" "$workflow"
grep -Fq 'echo "UAT_RELEASE_MANIFEST_SHA256=$(sha256sum release/production-image-manifest.json' "$workflow"
grep -Fq 'test "$manifest_sha256" = "$UAT_RELEASE_MANIFEST_SHA256"' "$workflow"

# Signing can only happen after health/finalization and signs the bytes the validator accepted.
acceptance_line="$(line_of 'name: Sign exact UAT deployment acceptance')"
test "$(line_of 'name: Verify active UAT digest and health')" -lt "$acceptance_line"
test "$(line_of 'name: Retire superseded launch builds')" -lt "$acceptance_line"
test "$(line_of 'name: Finalize non-api UAT release operation')" -lt "$acceptance_line"
test "$(line_of 'bash infra/docker/validate-uat-deployment-acceptance.sh')" -lt "$(line_of 'cosign sign-blob --yes')"
test "$(line_of 'cosign sign-blob --yes')" -lt "$(line_of 'cosign verify-blob')"
grep -Fq '. + {contentSha256:$contentHash}' "$workflow"
grep -Fq "expected_entries=\$'uat-deployment-acceptance.bundle:f\\nuat-deployment-acceptance.json:f'" "$workflow"
test "$(grep -Fc "expected_release_entries=\$'cosign-ai-gateway.json:f" "$workflow")" -eq 1
grep -Fq -- '--certificate-identity "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/deploy-uat.yml@refs/heads/main"' "$workflow"
grep -Fq -- '--certificate-oidc-issuer "https://token.actions.githubusercontent.com"' "$workflow"
grep -Fq -- '--certificate-github-workflow-repository "$GITHUB_REPOSITORY"' "$workflow"
grep -Fq -- '--certificate-github-workflow-ref refs/heads/main' "$workflow"
grep -Fq -- '--certificate-github-workflow-sha "$GITHUB_SHA"' "$workflow"
grep -Fq -- '--certificate-github-workflow-trigger workflow_dispatch' "$workflow"

fixture="$(mktemp -d "${TMPDIR:-/tmp}/uat-deployment-acceptance-spec.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

source_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
controller_sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
ci_blob=cccccccccccccccccccccccccccccccccccccccc
deploy_blob=dddddddddddddddddddddddddddddddddddddddd
run_id=123456789
run_attempt=2
repository=MangmeeDev/mangmeeplus
issued=2000000000
expires=$((issued + 86400))
now=$((issued + 100))
manifest="$fixture/production-image-manifest.json"
acceptance="$fixture/uat-deployment-acceptance.json"

jq -n \
  --arg source "$source_sha" --arg run "$run_id" '
  {
    schemaVersion:1,
    sourceCommit:$source,
    workflowRunId:$run,
    validationRunId:"987654321",
    images:[
      {service:"ai-gateway",repository:"watchdog-bms-ai-gateway",image:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-ai-gateway@sha256:"+("2"*64)),digest:("sha256:"+("2"*64)),sourceCommit:$source,sbom:"sbom-ai-gateway.spdx.json"},
      {service:"api-web",repository:"watchdog-bms-api",image:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:"+("1"*64)),digest:("sha256:"+("1"*64)),sourceCommit:$source,sbom:"sbom-api-web.spdx.json"},
      {service:"workers",repository:"watchdog-bms-workers",image:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-workers@sha256:"+("3"*64)),digest:("sha256:"+("3"*64)),sourceCommit:$source,sbom:"sbom-workers.spdx.json"}
    ]
  }
' > "$manifest"

write_acceptance() {
  local release_manifest="$1" output="$2" manifest_hash body content_hash
  manifest_hash="$(sha256_file "$release_manifest")"
  body="$fixture/acceptance-body.json"
  jq -cnS \
    --arg source "$source_sha" --arg controller "$controller_sha" \
    --arg run "$run_id" --argjson attempt "$run_attempt" \
    --arg repository "$repository" --arg manifestHash "$manifest_hash" \
    --arg ciBlob "$ci_blob" --arg deployBlob "$deploy_blob" \
    --arg validatorHash "$validator_hash" --arg manifestValidatorHash "$manifest_validator_hash" \
    --argjson issuedAt "$issued" --argjson expiresAt "$expires" \
    --slurpfile releaseManifest "$release_manifest" '
      {
        schemaVersion:1,
        acceptanceKind:"UAT_DEPLOYMENT_ACCEPTANCE",
        environment:"uat",
        repository:$repository,
        workflowPath:".github/workflows/deploy-uat.yml",
        workflowRunId:$run,
        workflowRunAttempt:$attempt,
        controllerRef:"refs/heads/main",
        controllerCommit:$controller,
        sourceCommit:$source,
        ciWorkflowBlob:$ciBlob,
        deployWorkflowBlob:$deployBlob,
        validatorSha256:$validatorHash,
        manifestValidatorSha256:$manifestValidatorHash,
        issuedAtEpoch:$issuedAt,
        expiresAtEpoch:$expiresAt,
        target:"all",
        healthVerified:true,
        releaseFinalized:true,
        releaseArtifactName:("uat-accepted-release-"+$source+"-attempt-"+($attempt|tostring)),
        releaseManifestSha256:$manifestHash,
        images:($releaseManifest[0].images | map({service,image,digest,sourceCommit}) | sort_by(.service))
      }
    ' > "$body"
  content_hash="$(sha256_file "$body")"
  jq -cS --arg hash "$content_hash" '. + {contentSha256:$hash}' "$body" > "$output"
}

rehash_acceptance() {
  local input="$1" output="$2" content_hash
  content_hash="$(jq -cS 'del(.contentSha256)' "$input" | sha256_stream)"
  jq -cS --arg hash "$content_hash" '.contentSha256=$hash' "$input" > "$output"
}

validate() {
  "$validator" "$1" "$2" "$source_sha" "$run_id" "$run_attempt" \
    "$controller_sha" "$repository" "$ci_blob" "$deploy_blob" "$validator_hash" "${3:-$now}"
}

mutate_and_reject() {
  local label="$1" filter="$2" mutated rehashed
  mutated="$fixture/$label.json"
  rehashed="$fixture/$label-rehashed.json"
  jq -cS "$filter" "$acceptance" > "$mutated"
  rehash_acceptance "$mutated" "$rehashed"
  expect_reject "$label" validate "$rehashed" "$manifest"
}

write_acceptance "$manifest" "$acceptance"
validate "$acceptance" "$manifest"

jq . "$acceptance" > "$fixture/noncanonical.json"
expect_reject noncanonical validate "$fixture/noncanonical.json" "$manifest"
jq -cS '.contentSha256=("f"*64)' "$acceptance" > "$fixture/wrong-self-hash.json"
expect_reject wrong-self-hash validate "$fixture/wrong-self-hash.json" "$manifest"
mutate_and_reject unknown-root '.unknown=true'
mutate_and_reject source '.sourceCommit=("f"*40)'
mutate_and_reject run '.workflowRunId="999"'
mutate_and_reject attempt '.workflowRunAttempt=3'
mutate_and_reject controller-ref '.controllerRef="refs/heads/develop"'
mutate_and_reject controller '.controllerCommit=("f"*40)'
mutate_and_reject repository '.repository="attacker/repo"'
mutate_and_reject ci-blob '.ciWorkflowBlob=("f"*40)'
mutate_and_reject deploy-blob '.deployWorkflowBlob=("f"*40)'
mutate_and_reject validator-hash '.validatorSha256=("f"*64)'
mutate_and_reject manifest-validator-hash '.manifestValidatorSha256=("f"*64)'
mutate_and_reject lifetime '.expiresAtEpoch+=1'
mutate_and_reject partial '.target="api-web"'
mutate_and_reject unhealthy '.healthVerified=false'
mutate_and_reject unfinalized '.releaseFinalized=false'
mutate_and_reject image-digest '.images[0].digest=("sha256:"+("f"*64)) | .images[0].image=(.images[0].image|split("@")[0])+"@"+.images[0].digest'
expect_reject before-issuance validate "$acceptance" "$manifest" "$((issued - 1))"
expect_reject expiry-boundary validate "$acceptance" "$manifest" "$expires"

# Exact raw manifest bytes, its schema, service/repository mapping and image projection are all bound.
jq -cS . "$manifest" > "$fixture/nonidentical-manifest.json"
expect_reject manifest-bytes validate "$acceptance" "$fixture/nonidentical-manifest.json"
jq '.unknown=true' "$manifest" > "$fixture/manifest-extra.json"
write_acceptance "$fixture/manifest-extra.json" "$fixture/manifest-extra-acceptance.json"
expect_reject manifest-schema validate "$fixture/manifest-extra-acceptance.json" "$fixture/manifest-extra.json"
jq '.images[0].repository="attacker" | .images[0].image=(.images[0].image|split("/")[0])+"/attacker@"+.images[0].digest' \
  "$manifest" > "$fixture/manifest-repository.json"
write_acceptance "$fixture/manifest-repository.json" "$fixture/manifest-repository-acceptance.json"
expect_reject manifest-repository validate "$fixture/manifest-repository-acceptance.json" "$fixture/manifest-repository.json"
jq '.images=([.images[2],.images[1],.images[0]])' "$manifest" > "$fixture/manifest-unsorted.json"
write_acceptance "$fixture/manifest-unsorted.json" "$fixture/manifest-unsorted-acceptance.json"
expect_reject manifest-order validate "$fixture/manifest-unsorted-acceptance.json" "$fixture/manifest-unsorted.json"

echo 'UAT deployment acceptance specs passed'
