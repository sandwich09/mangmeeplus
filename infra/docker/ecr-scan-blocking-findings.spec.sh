#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
policy="$root/infra/docker/ecr-scan-blocking-findings.jq"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/ecr-scan-policy.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

finding='{"name":"CVE-2026-14456","severity":"HIGH","description":"The issue is present since OpenSSL 3.5 when the QUIC server implementation was added.","uri":"https://nvd.nist.gov/vuln/detail/CVE-2026-14456","attributes":[{"key":"package_name","value":"openssl"},{"key":"package_version","value":"3.0.20-1~deb12u2"}]}'
jq -cn --argjson finding "$finding" \
  '{imageId:{imageDigest:("sha256:"+("1"*64))},
    imageScanFindings:{findingSeverityCounts:{HIGH:1},findings:[$finding]}}' > "$fixture/exact.json"
jq -e -f "$policy" "$fixture/exact.json" \
  | jq -e '.coverageComplete and (.waivers|length)==1 and (.blocking|length)==0
    and .waivers[0].scannedDigest==("sha256:"+("1"*64))
    and .waivers[0].expiresAtEpoch==1787616000' >/dev/null

for mutation in \
  '.imageScanFindings.findings[0].name="CVE-2099-1"' \
  '.imageScanFindings.findings[0].attributes[1].value="3.5.0"' \
  '.imageScanFindings.findings[0].description="provider statement missing"' \
  '.imageScanFindings.findings[0].severity="CRITICAL" | .imageScanFindings.findingSeverityCounts={CRITICAL:1}'; do
  jq "$mutation" "$fixture/exact.json" \
    | jq -e -f "$policy" \
    | jq -e '.coverageComplete and (.waivers|length)==0 and (.blocking|length)==1' >/dev/null
done

jq '.imageScanFindings.findingSeverityCounts.HIGH=2
  | .imageScanFindings.findings += [{name:"CVE-2099-2",severity:"HIGH",description:"other",attributes:[]}]' \
  "$fixture/exact.json" | jq -e -f "$policy" \
  | jq -e '.coverageComplete and (.waivers|length)==1 and (.blocking|length)==1' >/dev/null

jq '.imageScanFindings.findingSeverityCounts.HIGH=2' "$fixture/exact.json" \
  | jq -e -f "$policy" | jq -e '(.coverageComplete|not) and .expectedSevereCount==2' >/dev/null

echo "ECR scan blocking-findings policy specs passed"
