#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 14 ]; then
  echo "Usage: $0 <context.zip> <artifacts.json> <output-dir> <stage> <source-sha> <repository> <parent-run-id> <parent-run-attempt> <parent-controller-sha> <parent-workflow-blob> <parent-started-epoch> <now-epoch> <pre-ref.json> <post-ref.json>" >&2
  exit 2
fi

archive="$1"
artifacts_json="$2"
output_dir="$3"
stage="$4"
source_sha="$5"
repository="$6"
parent_run_id="$7"
parent_run_attempt="$8"
parent_controller="$9"
parent_workflow_blob="${10}"
parent_started_epoch="${11}"
now_epoch="${12}"
pre_ref="${13}"
post_ref="${14}"
max_bytes=16777216

fail() {
  echo "ERROR: production A5 stage context: $*" >&2
  exit 1
}

regular_file() {
  [ -f "$1" ] && [ ! -L "$1" ] || fail "$2 is not a regular non-link file"
  local size links
  size="$(wc -c < "$1" | tr -d '[:space:]')"
  [[ "$size" =~ ^[1-9][0-9]*$ ]] && [ "$size" -le "$3" ] || fail "$2 size is invalid"
  if links="$(stat -c %h "$1" 2>/dev/null)"; then :; else links="$(stat -f %l "$1")"; fi
  [ "$links" = 1 ] || fail "$2 is hard-linked"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'; fi
}

[[ "$stage" =~ ^(PRE_MUTATION|POST_MIGRATION|POST_DEPLOYMENT)$ ]] || fail "stage is invalid"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || fail "source SHA is invalid"
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "repository is invalid"
[[ "$parent_run_id" =~ ^[1-9][0-9]*$ ]] || fail "parent run ID is invalid"
[[ "$parent_run_attempt" =~ ^[1-9][0-9]*$ ]] || fail "parent run attempt is invalid"
[[ "$parent_controller" =~ ^[0-9a-f]{40}$ ]] || fail "parent controller SHA is invalid"
[[ "$parent_workflow_blob" =~ ^[0-9a-f]{40}$ ]] || fail "parent workflow blob is invalid"
[[ "$parent_started_epoch" =~ ^[1-9][0-9]*$ ]] || fail "parent start time is invalid"
[[ "$now_epoch" =~ ^[1-9][0-9]*$ ]] || fail "current time is invalid"
[ "$parent_started_epoch" -le "$now_epoch" ] || fail "parent starts in the future"
regular_file "$archive" archive "$max_bytes"
regular_file "$artifacts_json" artifacts.json 2097152
regular_file "$pre_ref" pre-ref.json 65536
regular_file "$post_ref" post-ref.json 65536
jq -e -s 'length == 1 and (.[0] | type == "object" or . == null)' "$pre_ref" >/dev/null \
  || fail "PRE child ref is not one JSON value"
jq -e -s 'length == 1 and (.[0] | type == "object" or . == null)' "$post_ref" >/dev/null \
  || fail "POST_MIGRATION child ref is not one JSON value"
[ -d "$output_dir" ] && [ ! -L "$output_dir" ] || fail "output directory is invalid"
[ -z "$(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit)" ] || fail "output directory is not empty"

artifact_name="production-a5-stage-context-${stage}-${source_sha}-production-${parent_run_id}-attempt-${parent_run_attempt}"
archive_hash="$(sha256_file "$archive")"
archive_size="$(wc -c < "$archive" | tr -d '[:space:]')"
jq -e --arg name "$artifact_name" --arg digest "sha256:$archive_hash" \
  --arg run "$parent_run_id" --arg controller "$parent_controller" --argjson size "$archive_size" '
    (keys | sort) == ["artifacts","total_count"]
    and .total_count == 1 and (.artifacts | type == "array" and length == 1)
    and .artifacts[0].name == $name and .artifacts[0].expired == false
    and .artifacts[0].digest == $digest and .artifacts[0].size_in_bytes == $size
    and (.artifacts[0].id | type == "number" and . >= 1 and floor == .)
    and (.artifacts[0].workflow_run.id | tostring) == $run
    and .artifacts[0].workflow_run.head_sha == $controller
  ' "$artifacts_json" >/dev/null || fail "artifact metadata or immutable digest is invalid"

names="$(mktemp "${TMPDIR:-/tmp}/production-a5-context-names.XXXXXX")"
metadata="$(mktemp "${TMPDIR:-/tmp}/production-a5-context-metadata.XXXXXX")"
canonical="$(mktemp "${TMPDIR:-/tmp}/production-a5-context-canonical.XXXXXX")"
trap 'rm -f -- "$names" "$metadata" "$canonical"' EXIT
zipinfo -1 "$archive" > "$names" 2>/dev/null || fail "cannot inspect ZIP names"
[ "$(wc -l < "$names" | tr -d '[:space:]')" = 1 ] \
  && [ "$(cat "$names")" = context.json ] || fail "ZIP must contain only context.json"
zipinfo -l "$archive" 2>/dev/null \
  | awk '$1 ~ /^[-dlcbps?]/ { print $1 "\t" $4 "\t" $NF }' > "$metadata" \
  || fail "cannot inspect ZIP member"
[ "$(wc -l < "$metadata" | tr -d '[:space:]')" = 1 ] || fail "ZIP metadata count is invalid"
IFS=$'\t' read -r mode member_size member_name < "$metadata"
[[ "$mode" == -* ]] && [ "$member_name" = context.json ] \
  && [[ "$member_size" =~ ^[1-9][0-9]*$ ]] && [ "$member_size" -le "$max_bytes" ] \
  || fail "ZIP member is linked, unsafe, empty or oversized"

context="$output_dir/context.json"
set +e
unzip -p "$archive" context.json 2>/dev/null | head -c "$((max_bytes + 1))" > "$context"
statuses=("${PIPESTATUS[@]}")
set -e
[ "${statuses[0]}" = 0 ] && [ "${statuses[1]}" = 0 ] || fail "context stream is corrupt"
chmod 600 "$context"
regular_file "$context" context.json "$max_bytes"
[ "$(wc -c < "$context" | tr -d '[:space:]')" = "$member_size" ] || fail "context size changed"
jq -e -s 'length == 1 and (.[0] | type == "object")' "$context" >/dev/null \
  || fail "context must contain one JSON object"
jq -cS . "$context" > "$canonical"
cmp -s "$context" "$canonical" || fail "context is not canonical jq -cS JSON with one LF"
actual_content_hash="$(jq -cS 'del(.contentSha256)' "$context" | sha256_stream)"

jq -e -L "$(cd "$(dirname "$0")" && pwd -P)" \
  --arg stage "$stage" --arg source "$source_sha" --arg repository "$repository" \
  --arg parentRun "$parent_run_id" --argjson parentAttempt "$parent_run_attempt" \
  --arg parentController "$parent_controller" --arg parentBlob "$parent_workflow_blob" \
  --arg contentHash "$actual_content_hash" --argjson parentStarted "$parent_started_epoch" \
  --argjson now "$now_epoch" --slurpfile pre "$pre_ref" --slurpfile post "$post_ref" '
    include "evidence-contracts";
    def exact_keys($wanted): keys == ($wanted | sort);
    def sha40: type == "string" and test("^[0-9a-f]{40}$");
    def hash64: type == "string" and test("^[0-9a-f]{64}$");
    def child_ref:
      exact_keys(["artifactDigest","artifactKind","artifactName","contentSha256",
        "producerRunAttempt","producerRunId"])
      and .artifactKind == "PRODUCTION_A5_EVIDENCE_V1"
      and (.producerRunId | type == "string" and test("^[1-9][0-9]*$"))
      and (.producerRunAttempt | type == "number" and . >= 1 and floor == .)
      and (.artifactName | type == "string" and length > 0)
      and (.contentSha256 | hash64)
      and (.artifactDigest | type == "string" and test("^sha256:[0-9a-f]{64}$"));
    exact_keys(["contentSha256","createdAtEpoch","invariantContext","parentProductionRun",
      "priorEvidence","repository","reviewedManifest","schemaVersion","servingBuilds",
      "sourceCommit","stage","reimbursementWriteQuiesce"])
    and .schemaVersion == 1 and .repository == $repository and .stage == $stage
    and .sourceCommit == $source and .contentSha256 == $contentHash
    and (.createdAtEpoch | type == "number" and floor == .)
    and .createdAtEpoch >= $parentStarted and .createdAtEpoch <= $now
    and (.parentProductionRun
      | exact_keys(["controllerCommit","runAttempt","runId","workflowBlob","workflowPath"])
      and .workflowPath == ".github/workflows/deploy-production.yml"
      and .controllerCommit == $parentController and .workflowBlob == $parentBlob
      and .runId == $parentRun and .runAttempt == $parentAttempt)
    and (.reviewedManifest | type == "object")
    and (.servingBuilds | type == "array" and length == 3 and . == sort_by(.service)
      and map(.service) == ["ai-gateway","api-web","workers"]
      and all(.[]; exact_keys(["service","sourceCommit"]) and (.sourceCommit | sha40)))
    and (.reimbursementWriteQuiesce | e0_reimbursement_quiesce($stage; $source))
    and (.priorEvidence | exact_keys(["postMigrationRef","preMutationRef"])
      and .preMutationRef == $pre[0] and .postMigrationRef == $post[0]
      and (if $stage == "PRE_MUTATION" then .preMutationRef == null and .postMigrationRef == null
        elif $stage == "POST_MIGRATION" then (.preMutationRef | child_ref) and .postMigrationRef == null
        else (.preMutationRef | child_ref) and (.postMigrationRef | child_ref) end))
    and (.invariantContext
      | if $stage == "PRE_MUTATION" then
          exact_keys(["cloneRehearsal","cloneRehearsalRef","sourceAppliedMigrationsHash"])
          and (.sourceAppliedMigrationsHash | hash64)
          and (.cloneRehearsal | type == "object")
          and (.cloneRehearsalRef
            | exact_keys(["artifactDigest","artifactKind","artifactName","contentSha256",
                "producerRunAttempt","producerRunId"])
              and .artifactKind == "PRODUCTION_A5_CLONE_REHEARSAL_V1"
              and (.producerRunId | type == "string" and test("^[1-9][0-9]*$"))
              and (.producerRunAttempt | type == "number" and . >= 1 and floor == .)
              and (.artifactName | type == "string" and length > 0)
              and (.contentSha256 | hash64)
              and (.artifactDigest | type == "string" and test("^sha256:[0-9a-f]{64}$")))
        elif $stage == "POST_MIGRATION" then
          exact_keys(["executedMigrations","executionBudgetResults","productionApplyAuthority",
            "sourceAppliedMigrationsHash"])
          and (.sourceAppliedMigrationsHash | hash64)
          and (.executedMigrations | type == "object")
          and (.executionBudgetResults | type == "array")
          and (.productionApplyAuthority | e0_production_apply_authority)
        else
          exact_keys(["productionApplyAuthority","sourceAppliedMigrationsHash"])
          and (.sourceAppliedMigrationsHash | hash64)
          and (.productionApplyAuthority | e0_production_apply_authority)
        end)
  ' "$context" >/dev/null || fail "context contract or parent/prior binding is invalid"

printf '%s\n' "$context"
