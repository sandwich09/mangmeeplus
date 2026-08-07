#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 <docker-bin> <dockerfile> <image> [docker build options...]" >&2
  exit 2
fi

docker_bin="$1"
dockerfile="$2"
image="$3"
shift 3

repo_root="$(git rev-parse --show-toplevel)"
revision="${SOURCE_COMMIT:-HEAD}"
commit="$(git -C "$repo_root" rev-parse "${revision}^{commit}")"
context="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-production-context.XXXXXX")"
trap 'rm -rf "$context"' EXIT

git -C "$repo_root" archive --format=tar "$commit" | tar -xf - -C "$context"
if [ ! -f "$context/$dockerfile" ]; then
  echo "ERROR: Dockerfile is not tracked in commit $commit: $dockerfile" >&2
  exit 1
fi

echo "[production-image] source=$commit dockerfile=$dockerfile image=$image"
"$docker_bin" build \
  --label "org.opencontainers.image.revision=$commit" \
  "$@" \
  --file "$context/$dockerfile" \
  --tag "$image" \
  "$context"
"$context/infra/docker/verify-production-image.sh" "$image" "$docker_bin"
