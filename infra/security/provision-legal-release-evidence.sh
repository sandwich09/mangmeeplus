#!/usr/bin/env bash
set -euo pipefail

# Fetches one independently reviewed legal-evidence ZIP with a narrowly scoped AWS
# identity, verifies the exact archive bytes, and extracts only the files named by
# the repository manifest. It intentionally does not validate the legal conclusions;
# validate-legal-release-readiness.sh owns that separate, fail-closed decision.

umask 077

mode="${1:-provision}"
case "$mode" in
  preflight|provision) ;;
  *) echo "Usage: $0 <preflight|provision> [repo-root]" >&2; exit 2 ;;
esac
repo_root="${2:-$(cd "$(dirname "$0")/../.." && pwd -P)}"
manifest="$repo_root/docs/security-evidence/legal-release-evidence.json"
bundle_uri="${LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_URI:-}"
bundle_version_id="${LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_VERSION_ID:-}"
bundle_sha256="${LEGAL_RELEASE_EVIDENCE_BUNDLE_SHA256:-}"
manifest_sha256="${LEGAL_RELEASE_EVIDENCE_SHA256:-}"
expected_bucket_owner="${AWS_ACCOUNT_ID:-}"
temp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"

fail() {
  echo "ERROR: legal evidence provisioner: $*" >&2
  exit 1
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

test -f "$manifest" && test ! -L "$manifest" || fail "reviewed manifest must be a regular repository file"
command -v jq >/dev/null 2>&1 || fail "jq is required"

[[ "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]] || fail "LEGAL_RELEASE_EVIDENCE_SHA256 is missing or invalid"
test "$(hash_file "$manifest")" = "$manifest_sha256" || fail "reviewed manifest bytes do not match the pinned digest"

# Fail before touching S3 when the checked-in manifest is intentionally BLOCKED or
# incomplete. The readiness validator performs the full schema/date/reviewer checks.
jq -e --argjson now "$(date -u +%s)" '
  .schemaVersion == 1
  and .status == "VERIFIED"
  and (.releaseVersion | type == "string" and length > 0)
  and (.evidence | keys | sort) == ([
    "dpoAssessment",
    "operatorIdentity",
    "processorCrossBorderRegister",
    "rightsMailbox",
    "thaiCounselApproval"
  ] | sort)
  and all(.evidence[];
    .status == "VERIFIED"
    and (.reference | type == "string" and test("^evidence://[A-Za-z0-9._/-]+$"))
    and (.reference | contains("..") | not)
    and (.sha256 | type == "string" and test("^[0-9a-f]{64}$"))
    and (.reviewedAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$") and (fromdateiso8601 <= $now))
    and (.nextReviewAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$") and ((. + "T23:59:59Z" | fromdateiso8601) >= $now))
    and (.reviewer | type == "string" and length >= 3)
  )
' "$manifest" >/dev/null || fail "reviewed manifest is BLOCKED, incomplete or malformed"

if [ "$mode" = "preflight" ]; then
  echo "Legal release evidence manifest preflight passed" >&2
  exit 0
fi

command -v python3 >/dev/null 2>&1 || fail "python3 is required"
command -v aws >/dev/null 2>&1 || fail "AWS CLI is required"
[[ "$bundle_sha256" =~ ^[0-9a-f]{64}$ ]] || fail "LEGAL_RELEASE_EVIDENCE_BUNDLE_SHA256 is missing or invalid"
[[ "$bundle_version_id" =~ ^[A-Za-z0-9][A-Za-z0-9._~+/=-]*$ ]] \
  && [ "${#bundle_version_id}" -le 1024 ] && [ "$bundle_version_id" != "null" ] \
  || fail "LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_VERSION_ID must pin a real versioned object"
[[ "$expected_bucket_owner" =~ ^[0-9]{12}$ ]] || fail "AWS_ACCOUNT_ID must identify the expected S3 bucket owner"

# Keep the fetch surface deliberately narrower than the full S3 key grammar. The
# compliance object is operational configuration, so it can and should use a safe,
# immutable-looking key without spaces, controls, query syntax or dot segments.
if [[ ! "$bundle_uri" =~ ^s3://([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])/([A-Za-z0-9._/-]+)$ ]]; then
  fail "LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_URI must be one canonical s3://bucket/key.zip URI"
fi
bucket="${BASH_REMATCH[1]}"
object_key="${BASH_REMATCH[2]}"
[[ "$bucket" != *..* && "$bucket" != *.-* && "$bucket" != *-.* ]] \
  || fail "S3 evidence bucket name is non-canonical"
case "/$object_key/" in
  *"//"*|*"/../"*|*"/./"*) fail "S3 evidence key contains an unsafe path segment" ;;
esac
[[ "$object_key" == *.zip && "$object_key" != */ ]] || fail "S3 evidence key must name a ZIP file"

test -d "$temp_root" && test ! -L "$temp_root" || fail "runner temporary directory is unavailable or unsafe"
work="$(mktemp -d "$temp_root/legal-release-evidence.XXXXXX")" || fail "cannot create private runner workspace"
archive="$work/reviewed-evidence.zip"
download_metadata="$work/s3-get-object.json"
evidence_dir="$work/reviewed-evidence"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT

# This needs only s3:GetObjectVersion on the exact object ARN. No ListBucket,
# PutObject, DeleteObject or application-bucket access is required.
aws s3api get-object \
  --bucket "$bucket" \
  --key "$object_key" \
  --version-id "$bundle_version_id" \
  --expected-bucket-owner "$expected_bucket_owner" \
  --no-cli-pager \
  "$archive" > "$download_metadata"

test -f "$archive" && test ! -L "$archive" || fail "AWS did not return a regular archive file"
archive_size="$(wc -c < "$archive" | tr -d '[:space:]')"
[[ "$archive_size" =~ ^[0-9]+$ ]] && [ "$archive_size" -gt 0 ] && [ "$archive_size" -le 33554432 ] \
  || fail "evidence archive size is outside the 1..33554432 byte bound"
jq -e --arg version "$bundle_version_id" --argjson bytes "$archive_size" '
  .VersionId == $version and .ContentLength == $bytes
' "$download_metadata" >/dev/null || fail "S3 response did not bind the requested version and downloaded byte count"
test "$(hash_file "$archive")" = "$bundle_sha256" || fail "evidence archive SHA-256 does not match the separately pinned digest"

mkdir -m 700 "$evidence_dir"
python3 - "$archive" "$manifest" "$evidence_dir" <<'PY'
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

archive = Path(sys.argv[1])
manifest_path = Path(sys.argv[2])
destination = Path(sys.argv[3])
MAX_FILES = 32
MAX_MEMBER_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
SAFE_PATH = re.compile(r"[A-Za-z0-9._/-]+")


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: legal evidence provisioner: {message}")


def safe_relative_path(value: str) -> PurePosixPath:
    if not value or SAFE_PATH.fullmatch(value) is None or "\\" in value:
        fail("archive member path contains unsupported characters")
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value:
        fail("archive member path is absolute or non-canonical")
    if any(part in ("", ".", "..") for part in path.parts):
        fail("archive member path contains an unsafe segment")
    return path


try:
    with manifest_path.open("r", encoding="utf-8") as source:
        manifest = json.load(source)
except (OSError, UnicodeError, json.JSONDecodeError) as error:
    fail(f"cannot read reviewed manifest: {error}")

evidence = manifest.get("evidence")
if not isinstance(evidence, dict) or not evidence:
    fail("reviewed manifest has no evidence map")

expected_paths: list[str] = []
for entry in evidence.values():
    if not isinstance(entry, dict):
        fail("reviewed manifest evidence entry is not an object")
    reference = entry.get("reference")
    if not isinstance(reference, str) or not reference.startswith("evidence://"):
        fail("reviewed manifest evidence reference is missing")
    relative = reference.removeprefix("evidence://")
    expected_paths.append(safe_relative_path(relative).as_posix())

if len(expected_paths) > MAX_FILES:
    fail("reviewed manifest exceeds the evidence file-count bound")
if len(set(expected_paths)) != len(expected_paths):
    fail("reviewed manifest reuses an evidence file path")
if len({path.casefold() for path in expected_paths}) != len(expected_paths):
    fail("reviewed manifest contains case-ambiguous evidence paths")

try:
    bundle = zipfile.ZipFile(archive, "r")
except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as error:
    fail(f"evidence archive is not a readable ZIP: {error}")

with bundle:
    members = bundle.infolist()
    names = [member.filename for member in members]
    if len(members) != len(expected_paths):
        fail("archive member count does not exactly match the reviewed manifest")
    if len(set(names)) != len(names):
        fail("archive contains duplicate member names")
    if len({name.casefold() for name in names}) != len(names):
        fail("archive contains case-ambiguous member names")
    for name in names:
        safe_relative_path(name)
    if set(names) != set(expected_paths):
        fail("archive contains a missing, extra or renamed evidence member")

    declared_total = 0
    by_name: dict[str, zipfile.ZipInfo] = {}
    for member in members:
        if member.is_dir() or member.flag_bits & 0x1:
            fail("archive contains a directory or encrypted member")
        unix_mode = (member.external_attr >> 16) & 0xFFFF
        file_type = stat.S_IFMT(unix_mode)
        if file_type not in (0, stat.S_IFREG):
            fail("archive contains a symlink or non-regular member")
        if member.file_size <= 0 or member.file_size > MAX_MEMBER_BYTES:
            fail("archive member size is outside the allowed bound")
        declared_total += member.file_size
        if declared_total > MAX_TOTAL_BYTES:
            fail("archive declared output exceeds the total bound")
        by_name[member.filename] = member

    actual_total = 0
    for name in sorted(expected_paths):
        relative = safe_relative_path(name)
        target = destination.joinpath(*relative.parts)
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        flags |= getattr(os, "O_NOFOLLOW", 0)
        written = 0
        try:
            descriptor = os.open(target, flags, 0o600)
            with os.fdopen(descriptor, "wb") as output, bundle.open(by_name[name], "r") as source:
                while True:
                    chunk = source.read(64 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    actual_total += len(chunk)
                    if written > MAX_MEMBER_BYTES or actual_total > MAX_TOTAL_BYTES:
                        fail("archive actual output exceeds the extraction bound")
                    output.write(chunk)
        except (OSError, RuntimeError, zipfile.BadZipFile) as error:
            fail(f"cannot extract verified evidence member: {error}")
        if written != by_name[name].file_size:
            fail("archive member output size disagrees with ZIP metadata")
        os.chmod(target, 0o600)
        if not stat.S_ISREG(os.lstat(target).st_mode):
            fail("extracted evidence member is not a regular file")
PY

test -d "$evidence_dir" && test ! -L "$evidence_dir" || fail "private evidence directory was not created"
printf '%s\n' "$evidence_dir"
trap - EXIT
