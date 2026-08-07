#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <prefixed-tag|full-commit-sha> <allowed-branch-ref> [release|uat]" >&2
  exit 2
fi

release_ref="$1"
allowed_branch="$2"
tag_prefix="${3:-release}"
case "$tag_prefix" in
  release|uat) ;;
  *) echo "ERROR: tag prefix must be release or uat" >&2; exit 2 ;;
esac

if [[ "$release_ref" =~ ^${tag_prefix}-[A-Za-z0-9._-]+$ ]]; then
  commit="$(git rev-parse --verify "refs/tags/${release_ref}^{commit}")"
elif [[ "$release_ref" =~ ^[0-9a-f]{40}$ ]]; then
  commit="$(git rev-parse --verify "${release_ref}^{commit}")"
else
  echo "ERROR: release ref must be a ${tag_prefix}-* tag or a lowercase full commit SHA" >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$commit" "$allowed_branch"; then
  echo "ERROR: release commit is not reachable from $allowed_branch" >&2
  exit 1
fi

printf '%s\n' "$commit"
