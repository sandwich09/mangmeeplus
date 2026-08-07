#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "Usage: $0 <kind> <parent-run-id> <stage> <max-wait-seconds> <empty-output-dir>" >&2
  exit 2
fi
kind="$1"
parent_run_id="$2"
stage="$3"
max_wait_seconds="$4"
output_dir="$5"
[[ "$parent_run_id" =~ ^[1-9][0-9]*$ && "$max_wait_seconds" =~ ^[1-9][0-9]*$ ]] \
  || { echo "ERROR: invalid evidence wait binding" >&2; exit 1; }
[ "$max_wait_seconds" -le 7200 ] || { echo "ERROR: evidence wait exceeds two hours" >&2; exit 1; }
test -n "${GITHUB_REPOSITORY:-}" && test -n "${GH_TOKEN:-}"

parent="$(mktemp "${RUNNER_TEMP:-/tmp}/u5-parent-run.XXXXXX.json")"
artifacts="$(mktemp "${RUNNER_TEMP:-/tmp}/u5-artifacts.XXXXXX.json")"
trap 'rm -f "$parent" "$artifacts"' EXIT
gh api "repos/$GITHUB_REPOSITORY/actions/runs/$parent_run_id" > "$parent"
source_sha="$(jq -er '.head_sha|select(test("^[0-9a-f]{40}$"))' "$parent")"
parent_attempt="$(jq -er '.run_attempt|select(type=="number" and .>=1 and floor==.)' "$parent")"
prefix="${kind}-${source_sha}-production-${parent_run_id}-attempt-${parent_attempt}-producer-"
started="$(date -u +%s)"

while :; do
  gh api --paginate "repos/$GITHUB_REPOSITORY/actions/artifacts?per_page=100" \
    | jq -s '{artifacts:(map(.artifacts[])|unique_by(.id)),total_count:(map(.artifacts[])|unique_by(.id)|length)}' \
    > "$artifacts"
  matches="$(jq -c --arg prefix "$prefix" '
    [.artifacts[] | select(.expired == false and (.name|startswith($prefix)))]
  ' "$artifacts")"
  count="$(jq 'length' <<< "$matches")"
  if [ "$count" -gt 0 ]; then
    valid_count=0
    valid_run=''
    valid_dir=''
    while IFS=$'\t' read -r producer_run_id artifact_name; do
      expected_name="${prefix}${producer_run_id}-attempt-$(sed -E 's/.*-attempt-([1-9][0-9]*)$/\1/' <<< "$artifact_name")"
      test "$artifact_name" = "$expected_name" || continue
      candidate_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/u5-evidence-candidate.XXXXXX")"
      if bash "$(dirname "$0")/fetch-verified-production-evidence.sh" \
        "$kind" "$producer_run_id" "$parent_run_id" "$stage" "$candidate_dir" \
        >/dev/null 2>/dev/null; then
        valid_count="$((valid_count + 1))"
        valid_run="$producer_run_id"
        [ -z "$valid_dir" ] || rm -rf "$valid_dir"
        valid_dir="$candidate_dir"
      else
        rm -rf "$candidate_dir"
      fi
    done < <(jq -r '.[]|[.workflow_run.id,.name]|@tsv' <<< "$matches")
    if [ "$valid_count" -gt 1 ]; then
      [ -z "$valid_dir" ] || rm -rf "$valid_dir"
      echo "ERROR: multiple valid $kind $stage artifacts target this parent attempt" >&2
      exit 1
    fi
    if [ "$valid_count" -eq 1 ]; then
      if [ -e "$output_dir" ]; then
        [ -d "$output_dir" ] && [ -z "$(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]
        rmdir "$output_dir"
      fi
      mv "$valid_dir" "$output_dir"
      printf '%s\n' "$valid_run"
      exit 0
    fi
  fi
  now="$(date -u +%s)"
  [ "$((now - started))" -lt "$max_wait_seconds" ] || {
    echo "ERROR: timed out waiting for exact $kind $stage evidence for this parent attempt" >&2
    exit 1
  }
  sleep 15
done
