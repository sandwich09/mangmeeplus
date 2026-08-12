#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 15 ]; then
  echo "Usage: $0 <empty-output-dir> <stage> <source-sha> <repository> <parent-run-id> <parent-run-attempt> <parent-controller-sha> <parent-workflow-blob> <parent-started-epoch> <reviewed-manifest.json> <serving-builds.json> <reimbursement-quiesce.json> <invariant-context.json> <pre-ref.json> <post-ref.json>" >&2
  exit 2
fi
output="$1"
stage="$2"
source_sha="$3"
repository="$4"
parent_run="$5"
parent_attempt="$6"
parent_controller="$7"
parent_blob="$8"
parent_started="$9"
manifest="${10}"
serving="${11}"
quiesce="${12}"
invariant="${13}"
pre_ref="${14}"
post_ref="${15}"
library="$(cd "$(dirname "$0")" && pwd -P)"

fail() { echo "ERROR: production A5 stage-context producer: $*" >&2; exit 1; }
regular_json() {
  local file="$1" max="$2" label="$3" size links
  [ -f "$file" ] && [ ! -L "$file" ] || fail "$label is not a regular non-link file"
  size="$(wc -c < "$file" | tr -d '[:space:]')"
  [[ "$size" =~ ^[1-9][0-9]*$ ]] && [ "$size" -le "$max" ] || fail "$label size is invalid"
  if links="$(stat -c %h "$file" 2>/dev/null)"; then :; else links="$(stat -f %l "$file")"; fi
  [ "$links" = 1 ] || fail "$label is hard-linked"
  jq -e -s 'length==1' "$file" >/dev/null || fail "$label is not one JSON value"
  cmp -s "$file" <(jq -cS . "$file") || fail "$label is not canonical jq -cS JSON with one LF"
}
sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'; fi
}

[ -d "$output" ] && [ ! -L "$output" ] \
  && [ -z "$(find "$output" -mindepth 1 -print -quit)" ] || fail "output directory is invalid"
[[ "$stage" =~ ^(PRE_MUTATION|POST_MIGRATION|POST_DEPLOYMENT)$ ]] || fail "stage is invalid"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || fail "source SHA is invalid"
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "repository is invalid"
[[ "$parent_run" =~ ^[1-9][0-9]*$ && "$parent_attempt" =~ ^[1-9][0-9]*$ ]] \
  || fail "parent run identity is invalid"
[[ "$parent_controller" =~ ^[0-9a-f]{40}$ && "$parent_blob" =~ ^[0-9a-f]{40}$ ]] \
  || fail "parent Git identity is invalid"
[[ "$parent_started" =~ ^[1-9][0-9]*$ ]] || fail "parent start is invalid"
for row in "$manifest:8388608:reviewed-manifest" "$serving:65536:serving-builds" \
  "$quiesce:1048576:reimbursement-quiesce" "$invariant:16777216:invariant-context" \
  "$pre_ref:65536:pre-ref" "$post_ref:65536:post-ref"; do
  IFS=: read -r file max label <<< "$row"
  regular_json "$file" "$max" "$label"
done

jq -e -L "$library" 'include "evidence-contracts"; e0_reviewed_manifest' "$manifest" >/dev/null \
  || fail "reviewed manifest contract is invalid"
jq -e -L "$library" --arg stage "$stage" --arg source "$source_sha" '
  include "evidence-contracts"; e0_serving_builds($stage;$source)
' "$serving" >/dev/null || fail "serving-build contract is invalid"
jq -e -L "$library" --arg stage "$stage" --arg source "$source_sha" '
  include "evidence-contracts"; e0_reimbursement_quiesce($stage;$source)
' "$quiesce" >/dev/null || fail "reimbursement quiesce contract is invalid"

jq -e -L "$library" --arg stage "$stage" '
  include "evidence-contracts";
  def exact($wanted): (keys|sort) == ($wanted|sort);
  def hash64: type=="string" and test("^[0-9a-f]{64}$");
  def child($kind):
    exact(["artifactDigest","artifactKind","artifactName","contentSha256",
      "producerRunAttempt","producerRunId"])
    and .artifactKind==$kind
    and (.producerRunId|type=="string" and test("^[1-9][0-9]*$"))
    and (.producerRunAttempt|type=="number" and .>=1 and floor==.)
    and (.artifactName|type=="string" and length>0)
    and (.contentSha256|hash64)
    and (.artifactDigest|type=="string" and test("^sha256:[0-9a-f]{64}$"));
  if $stage=="PRE_MUTATION" then
    exact(["cloneRehearsal","cloneRehearsalRef","sourceAppliedMigrationsHash"])
    and (.sourceAppliedMigrationsHash|hash64)
    and (.cloneRehearsal|type=="object")
    and (.cloneRehearsalRef|child("PRODUCTION_A5_CLONE_REHEARSAL_V1"))
  elif $stage=="POST_MIGRATION" then
    exact(["executedMigrations","executionBudgetResults","productionApplyAuthority",
      "sourceAppliedMigrationsHash"])
    and (.sourceAppliedMigrationsHash|hash64)
    and (.executedMigrations|type=="object") and (.executionBudgetResults|type=="array")
    and (.productionApplyAuthority|e0_production_apply_authority)
  else
    exact(["productionApplyAuthority","sourceAppliedMigrationsHash"])
    and (.sourceAppliedMigrationsHash|hash64)
    and (.productionApplyAuthority|e0_production_apply_authority)
  end
' "$invariant" >/dev/null || fail "stage invariant context is invalid"

jq -e --arg stage "$stage" '
  def exact($wanted): (keys|sort) == ($wanted|sort);
  def child:
    exact(["artifactDigest","artifactKind","artifactName","contentSha256",
      "producerRunAttempt","producerRunId"])
    and .artifactKind=="PRODUCTION_A5_EVIDENCE_V1"
    and (.producerRunId|type=="string" and test("^[1-9][0-9]*$"))
    and (.producerRunAttempt|type=="number" and .>=1 and floor==.)
    and (.artifactName|type=="string" and length>0)
    and (.contentSha256|type=="string" and test("^[0-9a-f]{64}$"))
    and (.artifactDigest|type=="string" and test("^sha256:[0-9a-f]{64}$"));
  if $stage=="PRE_MUTATION" then .==null
  else child end
' "$pre_ref" >/dev/null || fail "PRE reference does not match stage"
jq -e --arg stage "$stage" '
  def exact($wanted): (keys|sort) == ($wanted|sort);
  def child:
    exact(["artifactDigest","artifactKind","artifactName","contentSha256",
      "producerRunAttempt","producerRunId"])
    and .artifactKind=="PRODUCTION_A5_EVIDENCE_V1"
    and (.producerRunId|type=="string" and test("^[1-9][0-9]*$"))
    and (.producerRunAttempt|type=="number" and .>=1 and floor==.)
    and (.artifactName|type=="string" and length>0)
    and (.contentSha256|type=="string" and test("^[0-9a-f]{64}$"))
    and (.artifactDigest|type=="string" and test("^sha256:[0-9a-f]{64}$"));
  if $stage=="POST_DEPLOYMENT" then child else .==null end
' "$post_ref" >/dev/null || fail "POST_MIGRATION reference does not match stage"

created="${A5_CONTEXT_CREATED_AT_EPOCH:-$(date -u +%s)}"
[[ "$created" =~ ^[1-9][0-9]*$ ]] && [ "$created" -ge "$parent_started" ] \
  || fail "created time predates parent"
temporary="$output/context.tmp"
jq -cnS --arg stage "$stage" --arg source "$source_sha" --arg repository "$repository" \
  --arg parentRun "$parent_run" --argjson parentAttempt "$parent_attempt" \
  --arg controller "$parent_controller" --arg blob "$parent_blob" \
  --argjson created "$created" --slurpfile manifest "$manifest" --slurpfile serving "$serving" \
  --slurpfile quiesce "$quiesce" --slurpfile invariant "$invariant" \
  --slurpfile pre "$pre_ref" --slurpfile post "$post_ref" '
    {schemaVersion:1,repository:$repository,stage:$stage,sourceCommit:$source,
     parentProductionRun:{workflowPath:".github/workflows/deploy-production.yml",
       controllerCommit:$controller,workflowBlob:$blob,runId:$parentRun,runAttempt:$parentAttempt},
     createdAtEpoch:$created,reviewedManifest:$manifest[0],servingBuilds:$serving[0],
     reimbursementWriteQuiesce:$quiesce[0],invariantContext:$invariant[0],
     priorEvidence:{preMutationRef:$pre[0],postMigrationRef:$post[0]},contentSha256:("0"*64)}
' > "$temporary"
content_hash="$(jq -cS 'del(.contentSha256)' "$temporary" | sha256_stream)"
jq -cS --arg hash "$content_hash" '.contentSha256=$hash' "$temporary" > "$output/context.json"
rm -f -- "$temporary"
printf 'production-a5-stage-context-%s-%s-production-%s-attempt-%s\n' \
  "$stage" "$source_sha" "$parent_run" "$parent_attempt"
