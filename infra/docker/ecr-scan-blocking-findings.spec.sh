#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
policy="$root/infra/docker/ecr-scan-blocking-findings.jq"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/ecr-scan-policy.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

expiry=1788998400
approval="CHAT-OWNER-DIRECTIVE-2026-08-27-FIX-ALL-UNTIL-DEPLOY-SUCCEEDS"
attrs='[{"key":"package_name","value":"openssl"},{"key":"package_version","value":"3.0.20-1~deb12u2"}]'

quic='{"name":"CVE-2026-14456","severity":"HIGH","description":"The issue is present since OpenSSL 3.5 when the QUIC server implementation was added.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-14456","attributes":'"$attrs"'}'
dtls='{"name":"CVE-2026-54874","severity":"HIGH","description":"Receiving a DTLS record for a future epoch while a handshake is in progress causes OpenSSL to buffer far more memory than the record itself requires.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-54874","attributes":'"$attrs"'}'
cms='{"name":"CVE-2026-63072","severity":"HIGH","description":"The write is a fixed-size heap overflow reachable from the public CMS_decrypt() function.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-63072","attributes":'"$attrs"'}'
cmp='{"name":"CVE-2026-63076","severity":"HIGH","description":"CMP is a specialized feature that an application must explicitly enable.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-63076","attributes":'"$attrs"'}'

# All four advisories together are waived with the shared approval + expiry, none blocking.
jq -cn --argjson a "$quic" --argjson b "$dtls" --argjson c "$cms" --argjson d "$cmp" \
  '{imageId:{imageDigest:("sha256:"+("1"*64))},
    imageScanFindings:{findingSeverityCounts:{HIGH:4},findings:[$a,$b,$c,$d]}}' > "$fixture/exact.json"
jq -e -f "$policy" "$fixture/exact.json" \
  | jq -e --argjson expiry "$expiry" --arg approval "$approval" \
    '.coverageComplete and (.waivers|length)==4 and (.blocking|length)==0
    and ((.waivers|map(.id)|unique|length)==4)
    and all(.waivers[]; .scannedDigest==("sha256:"+("1"*64))
      and .expiresAtEpoch==$expiry and .approvedBy==$approval
      and .packageName=="openssl" and .packageVersion=="3.0.20-1~deb12u2")' >/dev/null

# Any drift in CVE name, package version, provider statement or severity stays blocking.
for mutation in \
  '.imageScanFindings.findings[0].name="CVE-2099-1"' \
  '.imageScanFindings.findings[0].attributes[1].value="3.5.0"' \
  '.imageScanFindings.findings[0].description="provider statement missing"' \
  '.imageScanFindings.findings[0].severity="CRITICAL" | .imageScanFindings.findingSeverityCounts={CRITICAL:1,HIGH:3}'; do
  jq "$mutation" "$fixture/exact.json" \
    | jq -e -f "$policy" \
    | jq -e '.coverageComplete and (.waivers|length)==3 and (.blocking|length)==1' >/dev/null
done

# A waived advisory beside an unknown HIGH keeps the unknown one blocking.
jq '.imageScanFindings.findingSeverityCounts.HIGH=5
  | .imageScanFindings.findings += [{name:"CVE-2099-2",severity:"HIGH",description:"other",attributes:[]}]' \
  "$fixture/exact.json" | jq -e -f "$policy" \
  | jq -e '.coverageComplete and (.waivers|length)==4 and (.blocking|length)==1' >/dev/null

# A severity count the findings array cannot account for fails coverage.
jq '.imageScanFindings.findingSeverityCounts.HIGH=5' "$fixture/exact.json" \
  | jq -e -f "$policy" | jq -e '(.coverageComplete|not) and .expectedSevereCount==5' >/dev/null

echo "ECR scan blocking-findings policy specs passed"
