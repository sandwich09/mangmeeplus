#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
contract="$repo_root/packages/contracts/src/legal-acceptance.ts"
evidence_manifest="$repo_root/docs/security-evidence/legal-release-evidence.json"
evidence_dir="${LEGAL_RELEASE_EVIDENCE_DIR:-}"

fail() {
  echo "ERROR: legal release gate: $*" >&2
  exit 1
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

hash_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

file_link_count() {
  if stat -c '%h' "$1" >/dev/null 2>&1; then
    stat -c '%h' "$1"
  else
    stat -f '%l' "$1"
  fi
}

require_regular_file() {
  local path="$1" label="$2" links
  test -f "$path" && test ! -L "$path" || fail "$label must be a regular non-symlink file"
  links="$(file_link_count "$path")"
  [[ "$links" =~ ^[0-9]+$ ]] && test "$links" = 1 || fail "$label must not be hard-linked"
}

require_real_directory() {
  local path="$1" label="$2"
  test -d "$path" && test ! -L "$path" || fail "$label must be a real directory"
}

require_no_symlink_components() {
  local root="$1" relative="$2" current="$1" component
  local old_ifs="$IFS"
  IFS='/'
  read -r -a components <<< "$relative"
  IFS="$old_ifs"
  for component in "${components[@]}"; do
    current="$current/$component"
    test ! -L "$current" || fail "reviewed evidence path contains a symlink: $relative"
  done
}

verify_append_only_history() {
  git -C "$repo_root" rev-parse --verify HEAD >/dev/null 2>&1 ||
    fail "append-only legal artifacts require a git history"
  test "$(git -C "$repo_root" rev-parse --is-shallow-repository)" = false ||
    fail "append-only legal artifact validation requires complete git history"

  local historical_files current_files all_files path introduced original_hash current_hash
  local introduced_count change_count introduced_entry current_entry introduced_mode current_mode
  local introduced_type current_type introduced_blob current_blob
  historical_files="$(git -C "$repo_root" log --format= --name-only HEAD -- apps/web/public/legal/releases \
    | sed '/^$/d' | sort -u)"
  current_files="$(cd "$repo_root" && find apps/web/public/legal/releases -type f -name '*-th.html' | sort -u)"
  all_files="$(printf '%s\n%s\n' "$historical_files" "$current_files" | sed '/^$/d' | sort -u)"
  test -n "$all_files" || fail "no immutable legal artifacts were found"

  while IFS= read -r path; do
    require_regular_file "$repo_root/$path" "published legal artifact $path"
    introduced="$(git -C "$repo_root" log --diff-filter=A --format='%H' --reverse HEAD -- "$path" | sed -n '1p')"
    test -n "$introduced" || fail "legal artifact has no auditable introduction commit: $path"
    introduced_count="$(git -C "$repo_root" log --diff-filter=A --format='%H' HEAD -- "$path" | wc -l | tr -d '[:space:]')"
    test "$introduced_count" = 1 || fail "legal artifact was deleted and republished: $path"
    change_count="$(git -C "$repo_root" log --format='%H' HEAD -- "$path" | wc -l | tr -d '[:space:]')"
    test "$change_count" = 1 || fail "legal artifact changed after its publication commit: $path"

    introduced_entry="$(git -C "$repo_root" ls-tree "$introduced" -- "$path")"
    current_entry="$(git -C "$repo_root" ls-tree HEAD -- "$path")"
    read -r introduced_mode introduced_type introduced_blob _ <<< "${introduced_entry//$'\t'/ }"
    read -r current_mode current_type current_blob _ <<< "${current_entry//$'\t'/ }"
    test "$introduced_mode" = 100644 && test "$current_mode" = 100644 \
      && test "$introduced_type" = blob && test "$current_type" = blob \
      || fail "legal artifact must remain a normal 100644 Git blob: $path"
    test "$introduced_blob" = "$current_blob" || fail "legal artifact Git blob changed after publication: $path"

    original_hash="$(git -C "$repo_root" show "$introduced:$path" | hash_stdin)"
    current_hash="$(hash_file "$repo_root/$path")"
    test "$current_hash" = "$original_hash" ||
      fail "append-only legal artifact changed after publication: $path"
  done <<< "$all_files"
}

require_regular_file "$contract" "canonical legal-acceptance contract"
require_regular_file "$evidence_manifest" "legal release evidence manifest"
test -s "$contract" || fail "missing canonical legal-acceptance contract"
test -s "$evidence_manifest" || fail "missing legal release evidence manifest"
command -v jq >/dev/null 2>&1 || fail "jq is required to validate legal release evidence"

terms_version="$(sed -n "s/.*version: '\([^']*\)'.*/\1/p" "$contract" | sed -n '1p')"
privacy_version="$(sed -n "s/.*version: '\([^']*\)'.*/\1/p" "$contract" | sed -n '2p')"
terms_href="$(sed -n "s/.*href: '\([^']*terms-th\.html\)'.*/\1/p" "$contract" | sed -n '1p')"
privacy_href="$(sed -n "s/.*href: '\([^']*privacy-th\.html\)'.*/\1/p" "$contract" | sed -n '1p')"
terms_hash="$(sed -n "s/.*artifactSha256: '\([0-9a-f]\{64\}\)'.*/\1/p" "$contract" | sed -n '1p')"
privacy_hash="$(sed -n "s/.*artifactSha256: '\([0-9a-f]\{64\}\)'.*/\1/p" "$contract" | sed -n '2p')"

test -n "$terms_version" && test "$terms_version" = "$privacy_version" ||
  fail "Terms and Privacy must share the reviewed release version"
[[ "$terms_href" == "/legal/releases/$terms_version/terms-th.html" ]] ||
  fail "Terms href is not content-versioned"
[[ "$privacy_href" == "/legal/releases/$privacy_version/privacy-th.html" ]] ||
  fail "Privacy href is not content-versioned"

manifest_hash="$(hash_file "$evidence_manifest")"
[[ "${LEGAL_RELEASE_EVIDENCE_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] ||
  fail "LEGAL_RELEASE_EVIDENCE_SHA256 must pin the reviewed manifest bytes"
test "$manifest_hash" = "$LEGAL_RELEASE_EVIDENCE_SHA256" ||
  fail "legal release evidence manifest hash does not match the approved repository variable"

now_epoch="$(date -u +%s)"
jq -e --arg version "$terms_version" --argjson now "$now_epoch" '
  .schemaVersion == 1
  and .releaseVersion == $version
  and .status == "VERIFIED"
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
' "$evidence_manifest" >/dev/null ||
  fail "operator/mailbox/DPO/processor/counsel evidence is unresolved, expired or malformed"

test -n "$evidence_dir" ||
  fail "LEGAL_RELEASE_EVIDENCE_DIR must contain the independently reviewed evidence bundle"
require_real_directory "$evidence_dir" "LEGAL_RELEASE_EVIDENCE_DIR"
while IFS=$'\t' read -r evidence_key reference expected_hash; do
  relative_path="${reference#evidence://}"
  [[ "$relative_path" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "invalid evidence path for $evidence_key"
  case "/$relative_path/" in
    *"/../"*|*"/./"*) fail "evidence path traversal is not permitted for $evidence_key" ;;
  esac
  evidence_file="$evidence_dir/$relative_path"
  require_no_symlink_components "$evidence_dir" "$relative_path"
  require_regular_file "$evidence_file" "reviewed evidence artifact for $evidence_key"
  test "$(hash_file "$evidence_file")" = "$expected_hash" ||
    fail "reviewed evidence artifact hash mismatch for $evidence_key"
done < <(jq -r '.evidence | to_entries[] | [.key, .value.reference, .value.sha256] | @tsv' "$evidence_manifest")

terms_file="$repo_root/apps/web/public$terms_href"
privacy_file="$repo_root/apps/web/public$privacy_href"
require_regular_file "$terms_file" "immutable Terms artifact"
require_regular_file "$privacy_file" "immutable Privacy artifact"
test -s "$terms_file" || fail "missing immutable Terms artifact"
test -s "$privacy_file" || fail "missing immutable Privacy artifact"
test "$(hash_file "$terms_file")" = "$terms_hash" || fail "Terms artifact hash mismatch"
test "$(hash_file "$privacy_file")" = "$privacy_hash" || fail "Privacy artifact hash mismatch"

for artifact in "$terms_file" "$privacy_file"; do
  grep -Fq "mangmeeplus-legal-version\" content=\"$terms_version" "$artifact" ||
    fail "artifact metadata does not match $terms_version"
  grep -Fq 'ติดต่อเรื่องข้อมูลส่วนบุคคล' "$artifact" ||
    fail "artifact must distinguish the contact address from a verified registered office"
  grep -Fq 'contact@mangmeeplus.com' "$artifact" || fail "artifact missing the approved intake mailbox"
  if grep -Eiq 'WatchDog|SudoChatBot|support@mangmeeplus\.com' "$artifact"; then
    fail "artifact contains stale brand or unapproved mailbox copy"
  fi
done

for page in \
  "$repo_root/apps/web/app/privacy/page.tsx" \
  "$repo_root/apps/web/app/terms/page.tsx" \
  "$repo_root/apps/web/app/data-deletion/page.tsx"; do
  require_regular_file "$page" "public legal route source $page"
  test -s "$page" || fail "missing public legal route source: $page"
  if grep -Eiq 'WatchDog|SudoChatBot' "$page"; then
    fail "public legal route contains stale brand copy: $page"
  fi
done

verify_append_only_history

echo "Legal release gate passed for $terms_version"
echo "  evidence manifest: $manifest_hash"
