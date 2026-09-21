def finding_attribute($key):
  ([.attributes[]? | select(.key == $key) | .value][0] // "");

# Every ECR HIGH/CRITICAL finding the Owner has waived, one row per finding. Each row matches ONE CVE
# by name plus its severity, package, version and a provider-statement anchor copied verbatim from the
# advisory description — any drift in any of those stays blocking, and severity/package/version are
# per row so the CRITICAL openssl row can never loosen the HIGH-only ones. Reachability is the same
# story for all five: the runtime is Node 22 with its own bundled OpenSSL and zlib, so the Debian
# packages are not reached by the api, web, workers or gateway processes; openssl enters the image
# only as a hard dependency of ca-certificates and, in the api image, of the ClamAV 1.5.3 .deb.
def waiver_rows: [
  { id: "AWS-ECR-CVE-2026-54874-OPENSSL-DTLS-UNUSED",
    cve: "CVE-2026-54874",
    severity: "HIGH",
    package: "openssl",
    version: "3.0.20-1~deb12u2",
    anchor: "Receiving a DTLS record for a future epoch while a handshake is in progress",
    reachabilityEvidence: "No process in the image speaks DTLS; the runtime is Node 22 with bundled OpenSSL 3.5.7 and the Debian package enters only as a ca-certificates dependency." },
  { id: "AWS-ECR-CVE-2026-63072-OPENSSL-CMS-UNUSED",
    cve: "CVE-2026-63072",
    severity: "HIGH",
    package: "openssl",
    version: "3.0.20-1~deb12u2",
    anchor: "reachable from the public CMS_decrypt() function",
    reachabilityEvidence: "No process in the image calls CMS_decrypt and the openssl CLI is never executed (repo-verified 2026-08-27)." },
  { id: "AWS-ECR-CVE-2026-63076-OPENSSL-CMP-UNUSED",
    cve: "CVE-2026-63076",
    severity: "HIGH",
    package: "openssl",
    version: "3.0.20-1~deb12u2",
    anchor: "CMP is a specialized feature that an application must explicitly enable.",
    reachabilityEvidence: "No process in the image enables CMP and the openssl CLI is never executed (repo-verified 2026-08-27)." },
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

# Owner-approved 2026-09-21 through 2026-10-21T00:00:00Z for the exact trixie package ECR reported.
# Debian source 1:1.3.dfsg+really1.3.1-1 has no downstream patches and predates the upstream
# non-blocking gz* support that introduced this CVE; the Debian tracker still classifies it as
# vulnerable. Keep this separate from the older batch so no other waiver receives a longer expiry.
def trixie_waiver_rows: [
  { id: "AWS-ECR-CVE-2026-85091-ZLIB-TRIXIE-131-MAPPING",
    cve: "CVE-2026-85091",
    severity: "HIGH",
    package: "zlib",
    version: "1.3.dfsg+really1.3.1-1",
    anchor: "when processing non-blocking gzwrite() operations with stale external buffer pointers",
    reachabilityEvidence: "Debian trixie source 1:1.3.dfsg+really1.3.1-1 has no Debian patches and predates upstream non-blocking gz* support introduced after zlib 1.3.1; ECR currently maps it to CVE-2026-85091. Node 22 bundles its own zlib, and no process in any image writes gzip streams through the system zlib non-blocking gzwrite()/gzprintf() API (repo-verified 2026-09-21)." }
];

# Renewed 2026-09-05 to 2026-10-05T00:00:00Z. The 2026-08 batch (expired 2026-09-10) and the 2026-09
# batch (expired 2026-09-19) were renewed together under one Owner directive, so they now share one
# expiry and one approval def. security-tracker.debian.org, read 2026-09-05: bookworm
# `openssl 3.0.20-1~deb12u2` is still `vulnerable` for CVE-2026-54874, CVE-2026-63072, CVE-2026-63076
# and CVE-2026-75803 with no bookworm fixed version (fixed only in trixie-security 3.5.7-1~deb13u2
# and sid 3.6.4-1), and CVE-2026-85091 has no fixed zlib in ANY suite — bumping the pinned
# node:22-bookworm-slim digest clears none of them. Re-evaluate at expiry: a further renewal needs
# fresh evidence and a NEW Owner approval id, never a silently extended epoch.
#
# Retired 2026-09-05: `AWS-ECR-CVE-2026-14456-OPENSSL-PRE35-MAPPING`. ECR stopped reporting the
# finding and the tracker now records bookworm openssl as `<not-affected> (Vulnerble code introduced
# later)`, so the mapping exception is deleted rather than renewed — it would block again if it ever
# returns.
def waiver_expiry: 1791158400;
def waiver_approval: "CHAT-OWNER-DIRECTIVE-2026-09-05-CVE-WAIVER-RENEWAL-2026-10-05";
def trixie_waiver_expiry: 1792540800;
def trixie_waiver_approval: "CHAT-OWNER-DIRECTIVE-2026-09-21-CVE-2026-85091-TRIXIE-WAIVER-2026-10-21";

# Expiry and approval are attached here rather than repeated on every row. A future batch that needs
# to lapse on its own schedule gets its own rows/expiry/approval defs and is appended with `+`.
def waiver_table:
  [waiver_rows[] | . + { expiry: waiver_expiry, approval: waiver_approval }]
  + [trixie_waiver_rows[] | . + { expiry: trixie_waiver_expiry, approval: trixie_waiver_approval }];

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
