#!/usr/bin/env bash
set -euo pipefail

api_base="${INTERNAL_API_URL:?INTERNAL_API_URL is required}"
worker_token="${WORKER_INTERNAL_TOKEN:?WORKER_INTERNAL_TOKEN is required}"
snapshot_at="${RESTORED_SNAPSHOT_AT:?RESTORED_SNAPSHOT_AT is required (ISO-8601)}"

payload="$(jq -n --arg restoredSnapshotAt "$snapshot_at" \
  '{restoredSnapshotAt:$restoredSnapshotAt,confirm:"REPLAY_COMPLETED_ERASURES_AFTER_RESTORE"}')"
curl --fail-with-body --silent --show-error \
  -X POST "${api_base%/}/internal/crm/pdpa-post-restore-re-erasure" \
  -H 'Content-Type: application/json' \
  -H "X-Worker-Token: $worker_token" \
  --data "$payload"

for _ in $(seq 1 100); do
  result="$(curl --fail-with-body --silent --show-error \
    -X POST "${api_base%/}/internal/crm/pdpa-erasure-process" \
    -H "X-Worker-Token: $worker_token")"
  [ "$(jq -r '.processed' <<<"$result")" -eq 0 ] && break
done

curl --fail-with-body --silent --show-error \
  -X POST "${api_base%/}/internal/crm/pdpa-purge" \
  -H "X-Worker-Token: $worker_token"
