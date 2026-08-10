#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
validator="$script_dir/validate-legal-release-readiness.sh"

if LEGAL_RELEASE_EVIDENCE_SHA256="$(shasum -a 256 "$repo_root/docs/security-evidence/legal-release-evidence.json" | awk '{print $1}')" \
  bash "$validator" "$repo_root" >/dev/null 2>&1; then
  echo 'validator accepted the unresolved production evidence manifest' >&2
  exit 1
fi

fixture="$(mktemp -d "${TMPDIR:-/tmp}/legal-release-gate.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/packages/contracts/src" "$fixture/apps/web/public/legal/releases/v1" \
  "$fixture/apps/web/public/legal/releases/v2" \
  "$fixture/apps/web/app/privacy" "$fixture/apps/web/app/terms" "$fixture/apps/web/app/data-deletion" \
  "$fixture/docs/security-evidence" "$fixture/reviewed-evidence/test"
cp "$repo_root/packages/contracts/src/legal-acceptance.ts" "$fixture/packages/contracts/src/"
cp "$repo_root/apps/web/public/legal/releases/v1/"*.html \
  "$fixture/apps/web/public/legal/releases/v1/"
cp "$repo_root/apps/web/public/legal/releases/v2/"*.html \
  "$fixture/apps/web/public/legal/releases/v2/"
cp "$repo_root/apps/web/app/privacy/page.tsx" "$fixture/apps/web/app/privacy/"
cp "$repo_root/apps/web/app/terms/page.tsx" "$fixture/apps/web/app/terms/"
cp "$repo_root/apps/web/app/data-deletion/page.tsx" "$fixture/apps/web/app/data-deletion/"

for evidence_key in operatorIdentity rightsMailbox dpoAssessment processorCrossBorderRegister thaiCounselApproval; do
  printf 'independently reviewed fixture: %s\n' "$evidence_key" > "$fixture/reviewed-evidence/test/$evidence_key"
done

fixture_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

jq -n \
  --arg operatorIdentity "$(fixture_hash "$fixture/reviewed-evidence/test/operatorIdentity")" \
  --arg rightsMailbox "$(fixture_hash "$fixture/reviewed-evidence/test/rightsMailbox")" \
  --arg dpoAssessment "$(fixture_hash "$fixture/reviewed-evidence/test/dpoAssessment")" \
  --arg processorCrossBorderRegister "$(fixture_hash "$fixture/reviewed-evidence/test/processorCrossBorderRegister")" \
  --arg thaiCounselApproval "$(fixture_hash "$fixture/reviewed-evidence/test/thaiCounselApproval")" \
  '{
  schemaVersion: 1,
  releaseVersion: "v2",
  status: "VERIFIED",
  evidence: ([
    "operatorIdentity",
    "rightsMailbox",
    "dpoAssessment",
    "processorCrossBorderRegister",
    "thaiCounselApproval"
  ] | map({ key: ., value: {
    status: "VERIFIED",
    reference: ("evidence://test/" + .),
    sha256: $ARGS.named[.],
    reviewedAt: "2026-08-09T00:00:00Z",
    nextReviewAt: "2099-12-31",
    reviewer: "automated fixture"
  }}) | from_entries)
}' > "$fixture/docs/security-evidence/legal-release-evidence.json"

git -C "$fixture" init -q
git -C "$fixture" config user.name 'Legal Release Fixture'
git -C "$fixture" config user.email 'fixture@example.invalid'
git -C "$fixture" add .
git -C "$fixture" commit -qm 'publish immutable legal release fixture'

if command -v sha256sum >/dev/null 2>&1; then
  manifest_hash="$(sha256sum "$fixture/docs/security-evidence/legal-release-evidence.json" | awk '{print $1}')"
else
  manifest_hash="$(shasum -a 256 "$fixture/docs/security-evidence/legal-release-evidence.json" | awk '{print $1}')"
fi
LEGAL_RELEASE_EVIDENCE_SHA256="$manifest_hash" \
  LEGAL_RELEASE_EVIDENCE_DIR="$fixture/reviewed-evidence" \
  bash "$validator" "$fixture" |
  grep -Fq 'Legal release gate passed for v2'

# Hashing a symlink target is not evidence that the reviewed path itself remained
# immutable. Reject both evidence indirection and a Git working-tree type change.
mv "$fixture/reviewed-evidence/test/operatorIdentity" \
  "$fixture/reviewed-evidence/test/operatorIdentity.target"
ln -s operatorIdentity.target "$fixture/reviewed-evidence/test/operatorIdentity"
if LEGAL_RELEASE_EVIDENCE_SHA256="$manifest_hash" \
  LEGAL_RELEASE_EVIDENCE_DIR="$fixture/reviewed-evidence" \
  bash "$validator" "$fixture" >/dev/null 2>&1; then
  echo 'validator accepted a symlinked reviewed evidence file' >&2
  exit 1
fi
rm "$fixture/reviewed-evidence/test/operatorIdentity"
mv "$fixture/reviewed-evidence/test/operatorIdentity.target" \
  "$fixture/reviewed-evidence/test/operatorIdentity"

privacy_artifact="$fixture/apps/web/public/legal/releases/v2/privacy-th.html"
mv "$privacy_artifact" "$privacy_artifact.target"
ln -s "$(basename "$privacy_artifact.target")" "$privacy_artifact"
if LEGAL_RELEASE_EVIDENCE_SHA256="$manifest_hash" \
  LEGAL_RELEASE_EVIDENCE_DIR="$fixture/reviewed-evidence" \
  bash "$validator" "$fixture" >/dev/null 2>&1; then
  echo 'validator accepted a symlinked immutable legal artifact' >&2
  exit 1
fi
rm "$privacy_artifact"
mv "$privacy_artifact.target" "$privacy_artifact"

printf '\nmutation' >> "$fixture/apps/web/public/legal/releases/v2/privacy-th.html"
if LEGAL_RELEASE_EVIDENCE_SHA256="$manifest_hash" \
  LEGAL_RELEASE_EVIDENCE_DIR="$fixture/reviewed-evidence" \
  bash "$validator" "$fixture" >/dev/null 2>&1; then
  echo 'validator accepted a mutated immutable artifact' >&2
  exit 1
fi
git -C "$fixture" checkout -q -- apps/web/public/legal/releases/v2/privacy-th.html

# Returning the bytes to their original value does not erase an intervening
# publication. The history itself must prove that the path changed exactly once.
terms_artifact="$fixture/apps/web/public/legal/releases/v1/terms-th.html"
printf '\nintermediate published mutation' >> "$terms_artifact"
git -C "$fixture" add "$terms_artifact"
git -C "$fixture" commit -qm 'mutate already-published legal artifact'
git -C "$fixture" show HEAD~1:apps/web/public/legal/releases/v1/terms-th.html > "$terms_artifact"
git -C "$fixture" add "$terms_artifact"
git -C "$fixture" commit -qm 'restore published legal artifact bytes'
if LEGAL_RELEASE_EVIDENCE_SHA256="$manifest_hash" \
  LEGAL_RELEASE_EVIDENCE_DIR="$fixture/reviewed-evidence" \
  bash "$validator" "$fixture" >/dev/null 2>&1; then
  echo 'validator accepted mutate-then-restore legal artifact history' >&2
  exit 1
fi

echo 'Legal release readiness specs passed'
