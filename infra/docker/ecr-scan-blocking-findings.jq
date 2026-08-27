def finding_attribute($key):
  ([.attributes[]? | select(.key == $key) | .value][0] // "");

# Waived: the four Debian openssl 3.0.20-1~deb12u2 HIGH findings. The package enters the image
# only as a hard dependency of ca-certificates (removing it was probed and refused 2026-08-27);
# the runtime is Node 22 with its own bundled OpenSSL 3.5.7, no code path executes the openssl
# CLI (repo grep), and no process in the image terminates QUIC, DTLS, CMP or CMS. Each waiver
# matches ONE CVE by name plus a provider-statement anchor from its advisory text — any drift in
# package, version, severity or statement stays blocking. Debian has not shipped a fixed build
# yet (base pulled fresh 2026-08-27 still carries 3.0.20-1~deb12u2); re-evaluate at expiry.
def openssl_waiver_table: [
  { id: "AWS-ECR-CVE-2026-14456-OPENSSL-PRE35-MAPPING",
    cve: "CVE-2026-14456",
    anchor: "The issue is present since OpenSSL 3.5 when the QUIC server implementation was added.",
    reachabilityEvidence: "Provider states the issue begins in OpenSSL 3.5 QUIC server; the scanned package is 3.0.20." },
  { id: "AWS-ECR-CVE-2026-54874-OPENSSL-DTLS-UNUSED",
    cve: "CVE-2026-54874",
    anchor: "Receiving a DTLS record for a future epoch while a handshake is in progress",
    reachabilityEvidence: "No process in the image speaks DTLS; the runtime is Node 22 with bundled OpenSSL 3.5.7 and the Debian package enters only as a ca-certificates dependency." },
  { id: "AWS-ECR-CVE-2026-63072-OPENSSL-CMS-UNUSED",
    cve: "CVE-2026-63072",
    anchor: "reachable from the public CMS_decrypt() function",
    reachabilityEvidence: "No process in the image calls CMS_decrypt and the openssl CLI is never executed (repo-verified 2026-08-27)." },
  { id: "AWS-ECR-CVE-2026-63076-OPENSSL-CMP-UNUSED",
    cve: "CVE-2026-63076",
    anchor: "CMP is a specialized feature that an application must explicitly enable.",
    reachabilityEvidence: "No process in the image enables CMP and the openssl CLI is never executed (repo-verified 2026-08-27)." }
];

def openssl_waiver_expiry: 1788998400;
def openssl_waiver_approval: "CHAT-OWNER-DIRECTIVE-2026-08-27-FIX-ALL-UNTIL-DEPLOY-SUCCEEDS";

def matched_openssl_waiver_row:
  . as $finding
  | [openssl_waiver_table[]
      | . as $row
      | select($row.cve == $finding.name
          and $finding.severity == "HIGH"
          and ($finding | finding_attribute("package_name")) == "openssl"
          and ($finding | finding_attribute("package_version")) == "3.0.20-1~deb12u2"
          and (($finding.description // "") | contains($row.anchor)))][0];

def openssl_unreachable_waiver:
  (matched_openssl_waiver_row != null) and now < openssl_waiver_expiry;

def waiver_record($digest):
  matched_openssl_waiver_row as $row
  | {
      id: $row.id,
      cve: .name,
      severity: .severity,
      packageName: finding_attribute("package_name"),
      packageVersion: finding_attribute("package_version"),
      scannedDigest: $digest,
      reachabilityEvidence: $row.reachabilityEvidence,
      compensatingControl: "Exact CVE, severity, package, version and provider statement match; all mismatches remain blocking.",
      approvedBy: openssl_waiver_approval,
      expiresAtEpoch: openssl_waiver_expiry,
      providerStatement: $row.anchor
    };

(.imageScanFindings // {}) as $scan
| (.imageId.imageDigest // "") as $digest
| (($scan.findingSeverityCounts // {}) | {
    CRITICAL: (.CRITICAL // 0),
    HIGH: (.HIGH // 0)
  }) as $raw
| ([($scan.findings // [])[], ($scan.enhancedFindings // [])[]]
    | map(select(.severity == "CRITICAL" or .severity == "HIGH"))) as $severe
| ($severe | map(select(openssl_unreachable_waiver))) as $waived
| ($severe | map(select((openssl_unreachable_waiver) | not))) as $blocking
| {
    rawSeverityCounts: $raw,
    expectedSevereCount: ($raw.CRITICAL + $raw.HIGH),
    observedSevereCount: ($severe | length),
    coverageComplete: (($severe | length) == ($raw.CRITICAL + $raw.HIGH)),
    waivers: ($waived | map(waiver_record($digest))),
    blocking: ($blocking | map({name, severity, description, uri, attributes}))
  }
