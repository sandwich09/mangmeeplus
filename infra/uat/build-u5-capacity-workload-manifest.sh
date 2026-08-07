#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <candidate-sha> <output.tsv> [approved-workload.tsv]" >&2
  exit 2
fi

candidate_sha="$1"
output="$2"
approved="${3:-$(dirname "$0")/u5-capacity-approved-workload.tsv}"
[[ "$candidate_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'ERROR: candidate SHA must be full lowercase hex' >&2; exit 2; }
[ -f "$approved" ] || { echo 'ERROR: approved workload allowlist is missing' >&2; exit 1; }
: > "$output"
rows=0
while IFS=$'\t' read -r filepath approved_object extra; do
  [ -n "$filepath" ] || continue
  [[ "$filepath" =~ ^[A-Za-z0-9._/-]+$ && "$approved_object" =~ ^[0-9a-f]{40}$ && -z "$extra" ]] \
    || { echo 'ERROR: malformed approved workload row' >&2; exit 1; }
  candidate_object="$(git rev-parse "${candidate_sha}:${filepath}" 2>/dev/null || true)"
  [ "$candidate_object" = "$approved_object" ] || {
    echo "ERROR: candidate workload differs from approved object: $filepath" >&2
    exit 1
  }
  printf '%s\t%s\n' "$filepath" "$approved_object" >> "$output"
  rows=$((rows + 1))
done < "$approved"
[ "$rows" -ge 6 ] || { echo 'ERROR: approved workload allowlist is incomplete' >&2; exit 1; }
