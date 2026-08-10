#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
validator="$repo_root/infra/security/validate-production-a5-stage-context.sh"
workflow="$repo_root/.github/workflows/production-a5.yml"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-workflow-spec.XXXXXX")"
trap 'rm -rf -- "$fixture"' EXIT

fail() { echo "ERROR: $*" >&2; exit 1; }
expect_reject() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then fail "$label was accepted"; fi
}
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
rehash() {
  local file="$1" hash tmp
  hash="$(jq -cS 'del(.contentSha256)' "$file" | {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
    else shasum -a 256 | awk '{print $1}'; fi
  })"
  tmp="$(mktemp "$fixture/rehash.XXXXXX")"
  jq -cS --arg hash "$hash" '.contentSha256=$hash' "$file" > "$tmp"
  mv "$tmp" "$file"
}
make_zip() {
  local source="$1" archive="$2"
  (cd "$(dirname "$source")" && zip -q -X "$archive" "$(basename "$source")")
}
write_metadata() {
  local archive="$1" target="$2"
  jq -cnS --arg name "$artifact_name" --arg digest "sha256:$(sha256_file "$archive")" \
    --arg controller "$parent_controller" --argjson size "$(wc -c < "$archive" | tr -d '[:space:]')" '
      {total_count:1,artifacts:[{id:1,name:$name,expired:false,digest:$digest,size_in_bytes:$size,
        workflow_run:{id:6001,head_sha:$controller}}]}
    ' > "$target"
}

bash -n "$validator"
[ -f "$workflow" ] || fail "production-a5 workflow is missing"

source_sha="$(printf 'a%.0s' {1..40})"
parent_controller="$(printf 'b%.0s' {1..40})"
parent_blob="$(printf 'c%.0s' {1..40})"
hash64="$(printf 'd%.0s' {1..64})"
repository=MangmeeDev/mangmeeplus
stage=PRE_MUTATION
parent_run=6001
parent_attempt=2
parent_started=1700000000
now=1700000300
artifact_name="production-a5-stage-context-${stage}-${source_sha}-production-${parent_run}-attempt-${parent_attempt}"
printf '%s\n' null > "$fixture/pre-ref.json"
printf '%s\n' null > "$fixture/post-ref.json"

mkdir -p "$fixture/good" "$fixture/out"
jq -cnS -L "$repo_root/infra/security" --arg source "$source_sha" --arg repository "$repository" \
  --arg controller "$parent_controller" --arg blob "$parent_blob" --arg hash "$hash64" '
  include "evidence-contracts.fixtures";
  {schemaVersion:1,repository:$repository,stage:"PRE_MUTATION",sourceCommit:$source,
   parentProductionRun:{workflowPath:".github/workflows/deploy-production.yml",
     controllerCommit:$controller,workflowBlob:$blob,runId:"6001",runAttempt:2},
   createdAtEpoch:1700000100,reviewedManifest:{schemaVersion:3},
   servingBuilds:[{service:"ai-gateway",sourceCommit:$controller},
     {service:"api-web",sourceCommit:$controller},{service:"workers",sourceCommit:$controller}],
   reimbursementWriteQuiesce:e0_fixture_reimbursement_quiesce("PRE_MUTATION";$source),
   invariantContext:{sourceAppliedMigrationsHash:$hash,cloneRehearsal:{result:"PASSED"},
     cloneRehearsalRef:e0_fixture_ref("PRODUCTION_A5_CLONE_REHEARSAL_V1")},
   priorEvidence:{preMutationRef:null,postMigrationRef:null},contentSha256:$hash}
  ' > "$fixture/good/context.json"
rehash "$fixture/good/context.json"
make_zip "$fixture/good/context.json" "$fixture/good.zip"
write_metadata "$fixture/good.zip" "$fixture/good-artifacts.json"
bash "$validator" "$fixture/good.zip" "$fixture/good-artifacts.json" "$fixture/out" \
  "$stage" "$source_sha" "$repository" "$parent_run" "$parent_attempt" \
  "$parent_controller" "$parent_blob" "$parent_started" "$now" \
  "$fixture/pre-ref.json" "$fixture/post-ref.json" >/dev/null
cmp -s "$fixture/good/context.json" "$fixture/out/context.json" || fail "accepted context bytes changed"

bad="$fixture/bad-context.json"
jq -cS '.parentProductionRun.runAttempt=3' "$fixture/good/context.json" > "$bad"
rehash "$bad"
mkdir "$fixture/bad-dir" "$fixture/bad-out"
cp "$bad" "$fixture/bad-dir/context.json"
make_zip "$fixture/bad-dir/context.json" "$fixture/bad-parent.zip"
write_metadata "$fixture/bad-parent.zip" "$fixture/bad-parent-artifacts.json"
expect_reject wrong-parent bash "$validator" "$fixture/bad-parent.zip" \
  "$fixture/bad-parent-artifacts.json" "$fixture/bad-out" "$stage" "$source_sha" "$repository" \
  "$parent_run" "$parent_attempt" "$parent_controller" "$parent_blob" "$parent_started" "$now" \
  "$fixture/pre-ref.json" "$fixture/post-ref.json"

printf ' {"not":"canonical"}\n' > "$fixture/bad-dir/context.json"
make_zip "$fixture/bad-dir/context.json" "$fixture/noncanonical.zip"
write_metadata "$fixture/noncanonical.zip" "$fixture/noncanonical-artifacts.json"
mkdir "$fixture/noncanonical-out"
expect_reject noncanonical bash "$validator" "$fixture/noncanonical.zip" \
  "$fixture/noncanonical-artifacts.json" "$fixture/noncanonical-out" "$stage" "$source_sha" "$repository" \
  "$parent_run" "$parent_attempt" "$parent_controller" "$parent_blob" "$parent_started" "$now" \
  "$fixture/pre-ref.json" "$fixture/post-ref.json"

cp "$fixture/good/context.json" "$fixture/bad-dir/context.json"
printf '%s\n' extra > "$fixture/bad-dir/extra.txt"
(cd "$fixture/bad-dir" && zip -q -X "$fixture/extra.zip" context.json extra.txt)
write_metadata "$fixture/extra.zip" "$fixture/extra-artifacts.json"
mkdir "$fixture/extra-out"
expect_reject extra-member bash "$validator" "$fixture/extra.zip" "$fixture/extra-artifacts.json" \
  "$fixture/extra-out" "$stage" "$source_sha" "$repository" "$parent_run" "$parent_attempt" \
  "$parent_controller" "$parent_blob" "$parent_started" "$now" \
  "$fixture/pre-ref.json" "$fixture/post-ref.json"

jq -cS '.artifacts[0].digest="sha256:"+("0"*64)' "$fixture/good-artifacts.json" \
  > "$fixture/wrong-digest-artifacts.json"
mkdir "$fixture/wrong-digest-out"
expect_reject wrong-digest bash "$validator" "$fixture/good.zip" \
  "$fixture/wrong-digest-artifacts.json" "$fixture/wrong-digest-out" "$stage" "$source_sha" \
  "$repository" "$parent_run" "$parent_attempt" "$parent_controller" "$parent_blob" \
  "$parent_started" "$now" "$fixture/pre-ref.json" "$fixture/post-ref.json"

# Static workflow safety: input binding and child/context checks precede the only AWS credential step.
ruby - "$workflow" <<'RUBY'
require "yaml"
path = ARGV.fetch(0)
doc = YAML.load_file(path)
dispatch = doc.fetch(true).fetch("workflow_dispatch").fetch("inputs")
raise unless dispatch.keys == [
  "parent_production_run_id", "stage", "source_commit", "clone_rehearsal_run_id",
  "pre_mutation_run_id", "post_migration_run_id",
]
steps = doc.fetch("jobs").fetch("evidence").fetch("steps")
uses = steps.map { |step| step["uses"] }.compact
raise unless uses.include?("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020")
names = steps.map { |step| step.fetch("name", "") }
aws_index = steps.index { |step| step.fetch("uses", "").start_with?("aws-actions/configure-aws-credentials@") }
raise unless aws_index
[
  "Bind main controller, parent attempt and stage inputs",
  "Verify required prior signed stages",
  "Verify exact isolated-clone rehearsal and migration tool",
  "Download and validate exact parent stage context",
].each { |required| raise unless names.index(required) < aws_index }
raise unless steps.count { |step| step.fetch("uses", "").start_with?("aws-actions/configure-aws-credentials@") } == 1
workflow_text = File.read(path)
["DATABASE_URL:", "A5_READONLY_DATABASE_URL", "get-secret-value", "task-role",
 "prisma migrate", "prisma db execute", "migrate resolve"].each do |forbidden|
  raise if workflow_text.include?(forbidden)
end
raise unless workflow_text.include?("watchdog-bms/production/a5-readonly-database-url")
raise unless workflow_text.include?("run-production-a5-readonly.sh")
raise unless workflow_text.include?("collect-production-a5-current-health.sh")
raise unless workflow_text.include?("EXPECTED_READER_SECRET_VERSION_ID")
raise unless workflow_text.include?("MIGRATION_IMAGE")
raise unless workflow_text.include?("if-no-files-found: error")
RUBY

echo "production A5 workflow safety spec: PASS"
