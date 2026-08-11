#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
validator="$repo_root/infra/docker/validate-production-release-intent.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/production-release-intent-spec.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

expect_reject() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ERROR: $label was accepted" >&2
    exit 1
  fi
}

validate_with_output() {
  local event="$1" output="$2"
  shift 2
  GITHUB_EVENT_NAME="$event" GITHUB_OUTPUT="$output" "$validator" "$@"
}

bash -n "$validator"
test -x "$validator"

live_output="$fixture/live-output"
test "$(validate_with_output push "$live_output" all 123 false '' '' false false)" = promotion
test "$(cat "$live_output")" = $'serving_mode=live\nuses_uat=true'

fast_output="$fixture/fast-output"
test "$(validate_with_output push "$fast_output" auto 123 false '' '' false false)" = fast-promotion
test "$(cat "$fast_output")" = $'serving_mode=live\nuses_uat=true'

fast_maintenance_output="$fixture/fast-maintenance-output"
test "$(validate_with_output workflow_dispatch "$fast_maintenance_output" \
  auto 123 false '' '' true false)" = fast-promotion
test "$(cat "$fast_maintenance_output")" = $'serving_mode=maintenance_only\nuses_uat=true'

partial_output="$fixture/partial-output"
test "$(validate_with_output push "$partial_output" api-web '' true \
  INC-1234 approval://incident/1234 false false)" = partial-incident
test "$(cat "$partial_output")" = $'serving_mode=live\nuses_uat=false'

maintenance_output="$fixture/maintenance-output"
test "$(validate_with_output workflow_dispatch "$maintenance_output" \
  all 123 false '' '' true false)" = promotion
test "$(cat "$maintenance_output")" = $'serving_mode=maintenance_only\nuses_uat=true'

bootstrap_output="$fixture/bootstrap-output"
test "$(validate_with_output workflow_dispatch "$bootstrap_output" \
  all 123 false '' '' true true)" = maintenance-bootstrap
test "$(cat "$bootstrap_output")" = $'serving_mode=maintenance_only\nuses_uat=true'

expect_reject missing-maintenance-flags "$validator" all 123 false '' ''
expect_reject missing-bootstrap-flag "$validator" all 123 false '' '' false
for invalid in '' TRUE False 1 maintenance_only; do
  expect_reject "invalid-maintenance-flag-$invalid" \
    "$validator" all 123 false '' '' "$invalid" false
  expect_reject "invalid-bootstrap-flag-$invalid" \
    "$validator" all 123 false '' '' false "$invalid"
done
expect_reject maintenance-outside-workflow-dispatch \
  env GITHUB_EVENT_NAME=push "$validator" all 123 false '' '' true false
expect_reject maintenance-without-event \
  env -u GITHUB_EVENT_NAME "$validator" all 123 false '' '' true false
expect_reject bootstrap-without-maintenance \
  env GITHUB_EVENT_NAME=workflow_dispatch "$validator" all 123 false '' '' false true
expect_reject bootstrap-outside-workflow-dispatch \
  env GITHUB_EVENT_NAME=push "$validator" all 123 false '' '' true true
expect_reject bootstrap-without-uat-promotion \
  env GITHUB_EVENT_NAME=workflow_dispatch "$validator" all '' false '' '' true true
expect_reject bootstrap-with-zero-uat-promotion \
  env GITHUB_EVENT_NAME=workflow_dispatch "$validator" all 0 false '' '' true true
expect_reject bootstrap-with-incident-authority \
  env GITHUB_EVENT_NAME=workflow_dispatch "$validator" \
    all 123 true INC-1234 approval://incident/1234 true true
expect_reject maintenance-without-uat-promotion \
  env GITHUB_EVENT_NAME=workflow_dispatch "$validator" all '' false '' '' true false
expect_reject maintenance-with-incident-authority \
  env GITHUB_EVENT_NAME=workflow_dispatch "$validator" \
    all 123 true INC-1234 approval://incident/1234 true false
expect_reject maintenance-partial-incident \
  env GITHUB_EVENT_NAME=workflow_dispatch "$validator" \
    api-web '' true INC-1234 approval://incident/1234 true false
expect_reject maintenance-bootstrap-partial-incident \
  env GITHUB_EVENT_NAME=workflow_dispatch "$validator" \
    api-web '' true INC-1234 approval://incident/1234 true true
expect_reject fast-promotion-without-uat \
  "$validator" auto '' false '' '' false false
expect_reject fast-promotion-with-incident-authority \
  "$validator" auto 123 true INC-1234 approval://incident/1234 false false
expect_reject fast-promotion-bootstrap \
  env GITHUB_EVENT_NAME=workflow_dispatch "$validator" auto 123 false '' '' true true
expect_reject live-promotion-with-incident-authority \
  "$validator" all 123 true INC-1234 approval://incident/1234 false false
expect_reject live-partial-without-incident-authority \
  "$validator" workers '' false INC-1234 approval://incident/1234 false false
expect_reject free-form-owner-approval \
  "$validator" all 123 false '' '' false false approval://owner/u5

rejected_output="$fixture/rejected-output"
: > "$rejected_output"
expect_reject rejected-intent-emitted-outputs \
  validate_with_output push "$rejected_output" all 123 false '' '' true true
test ! -s "$rejected_output"

echo 'Production release intent specs passed'
