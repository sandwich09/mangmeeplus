#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
repo_root="$(cd "$script_dir/../.." && pwd -P)"
provisioner="$script_dir/provision-legal-release-evidence.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/legal-evidence-provisioner.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

expect_reject() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ERROR: legal evidence provisioner accepted $label" >&2
    exit 1
  fi
}

mkdir -p "$fixture/repo/docs/security-evidence" "$fixture/source/legal" "$fixture/runner" "$fixture/bin"
for name in operator mailbox dpo processors counsel; do
  printf 'independently reviewed %s evidence\n' "$name" > "$fixture/source/legal/$name.txt"
done

jq -n \
  --arg operator "$(hash_file "$fixture/source/legal/operator.txt")" \
  --arg mailbox "$(hash_file "$fixture/source/legal/mailbox.txt")" \
  --arg dpo "$(hash_file "$fixture/source/legal/dpo.txt")" \
  --arg processors "$(hash_file "$fixture/source/legal/processors.txt")" \
  --arg counsel "$(hash_file "$fixture/source/legal/counsel.txt")" \
  '{
    schemaVersion: 1,
    releaseVersion: "2026-08-09.2",
    status: "VERIFIED",
    evidence: {
      operatorIdentity: {status:"VERIFIED",reference:"evidence://legal/operator.txt",sha256:$operator,reviewedAt:"2026-08-09T00:00:00Z",nextReviewAt:"2099-12-31",reviewer:"fixture reviewer"},
      rightsMailbox: {status:"VERIFIED",reference:"evidence://legal/mailbox.txt",sha256:$mailbox,reviewedAt:"2026-08-09T00:00:00Z",nextReviewAt:"2099-12-31",reviewer:"fixture reviewer"},
      dpoAssessment: {status:"VERIFIED",reference:"evidence://legal/dpo.txt",sha256:$dpo,reviewedAt:"2026-08-09T00:00:00Z",nextReviewAt:"2099-12-31",reviewer:"fixture reviewer"},
      processorCrossBorderRegister: {status:"VERIFIED",reference:"evidence://legal/processors.txt",sha256:$processors,reviewedAt:"2026-08-09T00:00:00Z",nextReviewAt:"2099-12-31",reviewer:"fixture reviewer"},
      thaiCounselApproval: {status:"VERIFIED",reference:"evidence://legal/counsel.txt",sha256:$counsel,reviewedAt:"2026-08-09T00:00:00Z",nextReviewAt:"2099-12-31",reviewer:"fixture reviewer"}
    }
  }' > "$fixture/repo/docs/security-evidence/legal-release-evidence.json"

python3 - "$fixture/source" "$fixture/evidence.zip" <<'PY'
from pathlib import Path
import sys
import zipfile

source = Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(source).as_posix())
PY

cat > "$fixture/bin/aws" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
test "$#" -eq 12
test "$1" = s3api
test "$2" = get-object
test "$3" = --bucket
test "$4" = legal-evidence-prod-123456789012
test "$5" = --key
test "$6" = releases/2026-08-09.2/reviewed-evidence.zip
test "$7" = --version-id
test "$8" = legalVersion123
test "$9" = --expected-bucket-owner
test "${10}" = 123456789012
test "${11}" = --no-cli-pager
cp "$FAKE_LEGAL_EVIDENCE_ARCHIVE" "${12}"
bytes="$(wc -c < "${12}" | tr -d '[:space:]')"
printf '{"VersionId":"%s","ContentLength":%s}\n' \
  "${FAKE_LEGAL_EVIDENCE_RESPONSE_VERSION:-legalVersion123}" "$bytes"
printf '%s\n' called >> "$FAKE_LEGAL_EVIDENCE_AWS_LOG"
SH
chmod 700 "$fixture/bin/aws"

manifest_hash="$(hash_file "$fixture/repo/docs/security-evidence/legal-release-evidence.json")"
bundle_hash="$(hash_file "$fixture/evidence.zip")"
aws_log="$fixture/aws.log"

invoke() {
  local archive="${1:-$fixture/evidence.zip}"
  local archive_hash="${2:-$(hash_file "$archive")}"
  local uri="${3:-s3://legal-evidence-prod-123456789012/releases/2026-08-09.2/reviewed-evidence.zip}"
  local pinned_manifest="${4:-$manifest_hash}"
  PATH="$fixture/bin:$PATH" \
    RUNNER_TEMP="$fixture/runner" \
    AWS_ACCOUNT_ID=123456789012 \
    LEGAL_RELEASE_EVIDENCE_SHA256="$pinned_manifest" \
    LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_URI="$uri" \
    LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_VERSION_ID=legalVersion123 \
    LEGAL_RELEASE_EVIDENCE_BUNDLE_SHA256="$archive_hash" \
    FAKE_LEGAL_EVIDENCE_ARCHIVE="$archive" \
    FAKE_LEGAL_EVIDENCE_AWS_LOG="$aws_log" \
    bash "$provisioner" provision "$fixture/repo"
}

LEGAL_RELEASE_EVIDENCE_SHA256="$manifest_hash" \
  bash "$provisioner" preflight "$fixture/repo" >/dev/null

evidence_dir="$(invoke)"
test -d "$evidence_dir" && test ! -L "$evidence_dir"
test "$(find "$evidence_dir" -type f | wc -l | tr -d '[:space:]')" = 5
for name in operator mailbox dpo processors counsel; do
  cmp -s "$fixture/source/legal/$name.txt" "$evidence_dir/legal/$name.txt"
done
test "$(wc -l < "$aws_log" | tr -d '[:space:]')" = 1

expect_reject wrong-archive-digest invoke "$fixture/evidence.zip" "$(printf '0%.0s' {1..64})"
expect_reject wrong-manifest-digest invoke "$fixture/evidence.zip" "$bundle_hash" \
  s3://legal-evidence-prod-123456789012/releases/2026-08-09.2/reviewed-evidence.zip \
  "$(printf '1%.0s' {1..64})"
expect_reject unsafe-s3-key invoke "$fixture/evidence.zip" "$bundle_hash" \
  s3://legal-evidence-prod-123456789012/releases/../reviewed-evidence.zip

python3 - "$fixture/source" "$fixture/traversal.zip" <<'PY'
from pathlib import Path
import sys
import zipfile

source = Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], "w") as archive:
    for path in sorted(source.rglob("*.txt")):
        name = path.relative_to(source).as_posix()
        archive.write(path, "../escape.txt" if name == "legal/operator.txt" else name)
PY
expect_reject traversal-member invoke "$fixture/traversal.zip"

python3 - "$fixture/source" "$fixture/symlink.zip" <<'PY'
from pathlib import Path
import stat
import sys
import zipfile

source = Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], "w") as archive:
    for path in sorted(source.rglob("*.txt")):
        name = path.relative_to(source).as_posix()
        if name == "legal/operator.txt":
            member = zipfile.ZipInfo(name)
            member.create_system = 3
            member.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(member, "legal/mailbox.txt")
        else:
            archive.write(path, name)
PY
expect_reject symlink-member invoke "$fixture/symlink.zip"

FAKE_LEGAL_EVIDENCE_RESPONSE_VERSION=otherVersion \
  expect_reject mismatched-s3-version invoke "$fixture/evidence.zip"

# The checked-in production manifest deliberately remains BLOCKED. Its preflight
# must fail before any bundle configuration or AWS call can become relevant.
production_manifest_hash="$(hash_file "$repo_root/docs/security-evidence/legal-release-evidence.json")"
expect_reject unresolved-production-manifest env \
  LEGAL_RELEASE_EVIDENCE_SHA256="$production_manifest_hash" \
  bash "$provisioner" preflight "$repo_root"

echo 'Legal release evidence provisioner specs passed'
