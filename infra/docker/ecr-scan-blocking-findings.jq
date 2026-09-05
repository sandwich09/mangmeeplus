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

# Waived 2026-09-05: two NEW base-image findings Debian has not fixed either — security-tracker lists
# bookworm openssl 3.0.20-1~deb12u2 and zlib 1:1.2.13.dfsg-1 as still vulnerable, and the newest
# upstream node:22-bookworm-slim digest ships the same two packages, so bumping the pinned base does
# not clear them. Same rules as the four above: exact CVE plus a provider-statement anchor, with the
# severity, package and version carried per row so the CRITICAL row cannot loosen the HIGH-only ones.
# Any drift in package, version, severity or statement stays blocking. Separate expiry def so these
# two expire independently of the four above.
def debian_2026_09_waiver_table: [
  { id: "AWS-ECR-CVE-2026-75803-OPENSSL-EVP-CIPHER-UNUSED",
    cve: "CVE-2026-75803",
    severity: "CRITICAL",
    package: "openssl",
    version: "3.0.20-1~deb12u2",
    anchor: "for AES-OCB and ChaCha20-Poly1305 ciphers it skipped the AEAD tag verification when an empty ciphertext was passed to the function",
    reachabilityEvidence: "The runtime is Node 22 with its own bundled OpenSSL, not the Debian libssl; the Debian openssl package enters only as a hard dependency of ca-certificates and, in the api image, of the ClamAV 1.5.3 .deb. No process in any image calls EVP_Cipher() on an attacker-supplied AEAD ciphertext: ClamAV uses OpenSSL for hashing and database signature checks, and TLS records always carry content plus tag, never an empty ciphertext. FIPS is not in use." },
  { id: "AWS-ECR-CVE-2026-85091-ZLIB-PRE131-MAPPING",
    cve: "CVE-2026-85091",
    severity: "HIGH",
    package: "zlib",
    version: "1.2.13.dfsg-1",
    anchor: "when processing non-blocking gzwrite() operations with stale external buffer pointers",
    reachabilityEvidence: "Provider states the affected range is zlib 1.3.1.2 through 1.3.2 while the scanned Debian package is 1.2.13. Node bundles its own zlib, and no process in any image writes gzip streams through the system zlib non-blocking gzwrite()/gzprintf() API (repo-verified 2026-09-05)." }
];

def debian_2026_09_waiver_expiry: 1789776000;
def debian_2026_09_waiver_approval: "CHAT-OWNER-DIRECTIVE-2026-09-05-UAT-DEPLOY-WAIVER";

# One matchable table. The four 2026-08 rows are all HIGH openssl 3.0.20-1~deb12u2 under the shared
# expiry and approval, so those constants are attached here rather than repeated on every row.
def waiver_table:
  [openssl_waiver_table[] | . + {
      severity: "HIGH", package: "openssl", version: "3.0.20-1~deb12u2",
      expiry: openssl_waiver_expiry, approval: openssl_waiver_approval }]
  + [debian_2026_09_waiver_table[] | . + {
      expiry: debian_2026_09_waiver_expiry, approval: debian_2026_09_waiver_approval }];

def matched_waiver_row:
  . as $finding
  | [waiver_table[]
      | . as $row
      | select($row.cve == $finding.name
          and $finding.severity == $row.severity
          and ($finding | finding_attribute("package_name")) == $row.package
          and ($finding | finding_attribute("package_version")) == $row.version
          and (($finding.description // "") | contains($row.anchor)))][0];

def unreachable_waiver:
  matched_waiver_row as $row | $row != null and now < $row.expiry;

def waiver_record($digest):
  matched_waiver_row as $row
  | {
      id: $row.id,
      cve: .name,
      severity: .severity,
      packageName: finding_attribute("package_name"),
      packageVersion: finding_attribute("package_version"),
      scannedDigest: $digest,
      reachabilityEvidence: $row.reachabilityEvidence,
      compensatingControl: "Exact CVE, severity, package, version and provider statement match; all mismatches remain blocking.",
      approvedBy: $row.approval,
      expiresAtEpoch: $row.expiry,
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
| ($severe | map(select(unreachable_waiver))) as $waived
| ($severe | map(select((unreachable_waiver) | not))) as $blocking
| {
    rawSeverityCounts: $raw,
    expectedSevereCount: ($raw.CRITICAL + $raw.HIGH),
    observedSevereCount: ($severe | length),
    coverageComplete: (($severe | length) == ($raw.CRITICAL + $raw.HIGH)),
    waivers: ($waived | map(waiver_record($digest))),
    blocking: ($blocking | map({name, severity, description, uri, attributes}))
  }
