def finding_attribute($key):
  ([.attributes[]? | select(.key == $key) | .value][0] // "");

def openssl_pre35_quic_mapping_waiver:
  .severity == "HIGH"
  and .name == "CVE-2026-14456"
  and finding_attribute("package_name") == "openssl"
  and finding_attribute("package_version") == "3.0.20-1~deb12u2"
  and ((.description // "")
    | contains("The issue is present since OpenSSL 3.5 when the QUIC server implementation was added."))
  and now < 1787788800;

def waiver_record($digest):
  {
    id: "AWS-ECR-CVE-2026-14456-OPENSSL-PRE35-MAPPING",
    cve: .name,
    severity: .severity,
    packageName: finding_attribute("package_name"),
    packageVersion: finding_attribute("package_version"),
    scannedDigest: $digest,
    reachabilityEvidence: "Provider states the issue begins in OpenSSL 3.5 QUIC server; the scanned package is 3.0.20.",
    compensatingControl: "Exact CVE, severity, package, version and provider statement match; all mismatches remain blocking.",
    approvedBy: "CHAT-OWNER-DIRECTIVE-2026-08-25-EXTEND-TO-2026-08-27",
    expiresAtEpoch: 1787788800,
    providerStatement: "The issue is present since OpenSSL 3.5 when the QUIC server implementation was added."
  };

(.imageScanFindings // {}) as $scan
| (.imageId.imageDigest // "") as $digest
| (($scan.findingSeverityCounts // {}) | {
    CRITICAL: (.CRITICAL // 0),
    HIGH: (.HIGH // 0)
  }) as $raw
| ([($scan.findings // [])[], ($scan.enhancedFindings // [])[]]
    | map(select(.severity == "CRITICAL" or .severity == "HIGH"))) as $severe
| ($severe | map(select(openssl_pre35_quic_mapping_waiver))) as $waived
| ($severe | map(select((openssl_pre35_quic_mapping_waiver) | not))) as $blocking
| {
    rawSeverityCounts: $raw,
    expectedSevereCount: ($raw.CRITICAL + $raw.HIGH),
    observedSevereCount: ($severe | length),
    coverageComplete: (($severe | length) == ($raw.CRITICAL + $raw.HIGH)),
    waivers: ($waived | map(waiver_record($digest))),
    blocking: ($blocking | map({name, severity, description, uri, attributes}))
  }
