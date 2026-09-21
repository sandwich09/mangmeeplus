#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
policy="$root/infra/docker/ecr-scan-blocking-findings.jq"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/ecr-scan-policy.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

expiry=1791158400
approval="CHAT-OWNER-DIRECTIVE-2026-09-05-CVE-WAIVER-RENEWAL-2026-10-05"
trixie_expiry=1792540800
trixie_approval="CHAT-OWNER-DIRECTIVE-2026-09-21-CVE-2026-85091-TRIXIE-WAIVER-2026-10-21"
old_expiry=1789776000
attrs='[{"key":"package_name","value":"openssl"},{"key":"package_version","value":"3.0.20-1~deb12u2"}]'
zlib_attrs='[{"key":"package_name","value":"zlib"},{"key":"package_version","value":"1.2.13.dfsg-1"}]'
trixie_zlib_attrs='[{"key":"package_name","value":"zlib"},{"key":"package_version","value":"1.3.dfsg+really1.3.1-1"}]'

# Retired 2026-09-05: CVE-2026-14456 has no row any more, so its exact advisory text must block.
quic='{"name":"CVE-2026-14456","severity":"HIGH","description":"The issue is present since OpenSSL 3.5 when the QUIC server implementation was added.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-14456","attributes":'"$attrs"'}'
dtls='{"name":"CVE-2026-54874","severity":"HIGH","description":"Receiving a DTLS record for a future epoch while a handshake is in progress causes OpenSSL to buffer far more memory than the record itself requires.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-54874","attributes":'"$attrs"'}'
cms='{"name":"CVE-2026-63072","severity":"HIGH","description":"The write is a fixed-size heap overflow reachable from the public CMS_decrypt() function.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-63072","attributes":'"$attrs"'}'
cmp='{"name":"CVE-2026-63076","severity":"HIGH","description":"CMP is a specialized feature that an application must explicitly enable.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-63076","attributes":'"$attrs"'}'
evp='{"name":"CVE-2026-75803","severity":"CRITICAL","description":"The EVP_Cipher() API call for AEAD ciphers behaves like a one shot encryption and decryption call. It also verifies the AEAD tag after the decryption operation. However for AES-OCB and ChaCha20-Poly1305 ciphers it skipped the AEAD tag verification when an empty ciphertext was passed to the function.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-75803","attributes":'"$attrs"'}'
gz='{"name":"CVE-2026-85091","severity":"HIGH","description":"zlib versions 1.3.1.2 through 1.3.2 contain a heap buffer overflow vulnerability in the gz_vacate() function when processing non-blocking gzwrite() operations with stale external buffer pointers.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-85091","attributes":'"$zlib_attrs"'}'
trixie_gz='{"name":"CVE-2026-85091","severity":"HIGH","description":"zlib versions 1.3.1.2 through 1.3.2 contain a heap buffer overflow vulnerability in the gz_vacate() function when processing non-blocking gzwrite() operations with stale external buffer pointers.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-85091","attributes":'"$trixie_zlib_attrs"'}'

# All five renewed advisories together are waived, none blocking, all on the 2026-10-05 expiry and
# the renewal approval id.
jq -cn --argjson b "$dtls" --argjson c "$cms" --argjson d "$cmp" \
  --argjson e "$evp" --argjson f "$gz" \
  '{imageId:{imageDigest:("sha256:"+("1"*64))},
    imageScanFindings:{findingSeverityCounts:{CRITICAL:1,HIGH:4},findings:[$b,$c,$d,$e,$f]}}' > "$fixture/exact.json"
jq -e -f "$policy" "$fixture/exact.json" \
  | jq -e --argjson expiry "$expiry" --arg approval "$approval" \
    '.coverageComplete and (.waivers|length)==5 and (.blocking|length)==0
    and ((.waivers|map(.id)|unique|length)==5)
    and all(.waivers[]; .scannedDigest==("sha256:"+("1"*64))
      and .expiresAtEpoch==$expiry and .approvedBy==$approval)
    and ([.waivers[]|select(.severity=="HIGH" and .packageName=="openssl"
        and .packageVersion=="3.0.20-1~deb12u2")|.cve]|sort)
      ==["CVE-2026-54874","CVE-2026-63072","CVE-2026-63076"]
    and ([.waivers[]|select(.cve=="CVE-2026-75803")]
      | length==1 and all(.[]; .severity=="CRITICAL"
        and .packageName=="openssl" and .packageVersion=="3.0.20-1~deb12u2"))
    and ([.waivers[]|select(.cve=="CVE-2026-85091")]
      | length==1 and all(.[]; .severity=="HIGH"
        and .packageName=="zlib" and .packageVersion=="1.2.13.dfsg-1"))' >/dev/null

# The retired CVE-2026-14456 row is gone: its exact advisory text and package now block.
jq --argjson q "$quic" '.imageScanFindings.findingSeverityCounts.HIGH=5
  | .imageScanFindings.findings += [$q]' "$fixture/exact.json" | jq -e -f "$policy" \
  | jq -e '.coverageComplete and (.waivers|length)==5
    and (.blocking|map(.name))==["CVE-2026-14456"]' >/dev/null

# Any drift in CVE name, package version, provider statement or severity stays blocking — including
# severity drift in EITHER direction, so the CRITICAL row never loosens the HIGH-only rows.
for mutation in \
  '.imageScanFindings.findings[0].name="CVE-2099-1"' \
  '.imageScanFindings.findings[0].attributes[1].value="3.5.0"' \
  '.imageScanFindings.findings[0].description="provider statement missing"' \
  '.imageScanFindings.findings[0].severity="CRITICAL" | .imageScanFindings.findingSeverityCounts={CRITICAL:2,HIGH:3}' \
  '.imageScanFindings.findings[3].severity="HIGH" | .imageScanFindings.findingSeverityCounts={CRITICAL:0,HIGH:5}' \
  '.imageScanFindings.findings[3].attributes[1].value="3.0.20-1~deb12u3"' \
  '.imageScanFindings.findings[3].description="provider statement missing"' \
  '.imageScanFindings.findings[4].severity="CRITICAL" | .imageScanFindings.findingSeverityCounts={CRITICAL:2,HIGH:3}' \
  '.imageScanFindings.findings[4].attributes[1].value="1.3.1.2"' \
  '.imageScanFindings.findings[4].description="provider statement missing"'; do
  jq "$mutation" "$fixture/exact.json" \
    | jq -e -f "$policy" \
    | jq -e '.coverageComplete and (.waivers|length)==4 and (.blocking|length)==1' >/dev/null
done

# The renewal is load-bearing: every row still holds one second past the superseded 2026-09-19 epoch
# and all five block on 2026-10-05. `def now` shadows the jq builtin for the whole policy.
policy_at() {
  local input="${2:-$fixture/exact.json}"
  printf 'def now: %s;\n' "$1" > "$fixture/policy-at-$1.jq"
  cat "$policy" >> "$fixture/policy-at-$1.jq"
  jq -e -f "$fixture/policy-at-$1.jq" "$input"
}
policy_at "$old_expiry" | jq -e --argjson expiry "$expiry" \
  '.coverageComplete and (.waivers|length)==5 and (.blocking|length)==0
  and all(.waivers[]; .expiresAtEpoch==$expiry)' >/dev/null
policy_at "$((expiry - 1))" \
  | jq -e '.coverageComplete and (.waivers|length)==5 and (.blocking|length)==0' >/dev/null
policy_at "$expiry" \
  | jq -e '.coverageComplete and (.waivers|length)==0 and (.blocking|length)==5' >/dev/null

# The trixie mapping is a separate exact row: it survives the older batch expiry, lapses on
# 2026-10-21, and does not match even a one-character package-version drift.
jq -cn --argjson gz "$trixie_gz" \
  '{imageId:{imageDigest:("sha256:"+("2"*64))},
    imageScanFindings:{findingSeverityCounts:{HIGH:1},findings:[$gz]}}' > "$fixture/trixie.json"
policy_at "$expiry" "$fixture/trixie.json" \
  | jq -e --argjson expiry "$trixie_expiry" --arg approval "$trixie_approval" '
    .coverageComplete and (.waivers|length)==1 and (.blocking|length)==0
    and .waivers[0].expiresAtEpoch==$expiry and .waivers[0].approvedBy==$approval' >/dev/null
policy_at "$trixie_expiry" "$fixture/trixie.json" \
  | jq -e '.coverageComplete and (.waivers|length)==0 and (.blocking|length)==1' >/dev/null
jq '.imageScanFindings.findings[0].attributes[1].value="1.3.dfsg+really1.3.1-1+b1"' \
  "$fixture/trixie.json" | jq -e -f "$policy" \
  | jq -e '.coverageComplete and (.waivers|length)==0 and (.blocking|length)==1' >/dev/null

# A waived advisory beside an unknown HIGH keeps the unknown one blocking.
jq '.imageScanFindings.findingSeverityCounts.HIGH=5
  | .imageScanFindings.findings += [{name:"CVE-2099-2",severity:"HIGH",description:"other",attributes:[]}]' \
  "$fixture/exact.json" | jq -e -f "$policy" \
  | jq -e '.coverageComplete and (.waivers|length)==5 and (.blocking|length)==1' >/dev/null

# A severity count the findings array cannot account for fails coverage.
jq '.imageScanFindings.findingSeverityCounts.HIGH=5' "$fixture/exact.json" \
  | jq -e -f "$policy" | jq -e '(.coverageComplete|not) and .expectedSevereCount==6' >/dev/null

echo "ECR scan blocking-findings policy specs passed"
