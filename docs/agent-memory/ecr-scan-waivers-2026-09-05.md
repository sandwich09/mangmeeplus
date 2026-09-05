# Agent Memory: ecr-scan-waivers-2026-09-05

Status: APPROVED — waivers landed on `codex/ecr-scan-waivers-2026-09-05`, no PR opened yet.
Owner approved both rows in chat 2026-09-05 ("อนุมัติ waiver"); approval id
`CHAT-OWNER-DIRECTIVE-2026-09-05-UAT-DEPLOY-WAIVER`, expiry 2026-09-19T00:00:00Z (epoch 1789776000).

Owner: thawatchai phuchana

Scope: `infra/docker/ecr-scan-blocking-findings.jq`,
`infra/docker/ecr-scan-blocking-findings.spec.sh`, `docs/runbooks/cloud-environment-operations.md` §7.
No Dockerfile, workflow or evidence-contract change.

## Decisions

- UAT deploy run `33947313055` (candidate `ba04e7a6`) failed at `infra/docker/verify-ecr-scan.sh`
  because two NEW `node:22-bookworm-slim` base-image findings had no waiver row.
- Debian bookworm has no fixed build for either CVE (security-tracker: `openssl 3.0.20-1~deb12u2`
  vulnerable, `zlib 1:1.2.13.dfsg-1` vulnerable), and the newest upstream `node:22-bookworm-slim`
  digest carries the same two packages — bumping the pinned base does not clear the gate.
- Waive both with the existing evidence-based, time-boxed mechanism rather than loosening the gate.
- The two new rows carry `severity`, `package` and `version` **per row** so the CRITICAL row cannot
  loosen the four existing HIGH-only openssl rows, and they use their own
  `debian_2026_09_waiver_expiry` / `debian_2026_09_waiver_approval` defs so they expire independently
  of the 2026-08 batch (which still expires 2026-09-10, epoch 1788998400).
- Renamed `matched_openssl_waiver_row` → `matched_waiver_row` and `openssl_unreachable_waiver` →
  `unreachable_waiver`: the table is no longer openssl-only, and an openssl-named predicate gating a
  zlib finding would mislead the next reader of a fail-closed security gate.

### CVE-2026-75803 — CRITICAL, `openssl` `3.0.20-1~deb12u2`

Row id `AWS-ECR-CVE-2026-75803-OPENSSL-EVP-CIPHER-UNUSED`. Anchor (verbatim from the scanned
description): `for AES-OCB and ChaCha20-Poly1305 ciphers it skipped the AEAD tag verification when an
empty ciphertext was passed to the function`.

Evidence verified in-repo 2026-09-05:

- `infra/api-web/Dockerfile.api-web:1` and `apps/workers/Dockerfile:1` both run
  `node:22-bookworm-slim`, so the runtime crypto is Node 22's own bundled OpenSSL, not Debian libssl.
- `infra/api-web/Dockerfile.api-web:3` installs `ca-certificates openssl`;
  `infra/api-web/Dockerfile.api-web:93` purges both again and `:99-:100` assert that only `libssl3`
  survives (`dpkg-query -W libssl3` succeeds, `openssl`/`ca-certificates` must be gone). The finding's
  `package_name: openssl` is the Debian **source** package for that surviving `libssl3`, which stays
  because the ClamAV 1.5.3 `.deb` (`infra/api-web/Dockerfile.api-web:64-68`) links it.
- ClamAV never receives an AEAD ciphertext from us: `clamd` listens on plain TCP
  `127.0.0.1:3310` (`infra/api-web/Dockerfile.api-web:72`) and the API talks the unencrypted INSTREAM
  protocol over `node:net`
  (`apps/api/src/modules/data-model-core/infrastructure/attachment-malware-scanner.ts:2,16,20`).
  ClamAV's own OpenSSL use is hashing and database signature verification; `freshclam`
  (`infra/api-web/Dockerfile.api-web:76`) fetches over TLS, where records always carry content plus
  tag — never an empty ciphertext.
- The only application-level AEAD is AES-256-GCM through Node's bundled `node:crypto`
  (`apps/api/src/modules/system-partner-management/domain/logic/credential-cipher.logic.ts:1,3,21,42`)
  — neither AES-OCB nor ChaCha20-Poly1305, and not the Debian library.
- The `openssl` CLI is invoked nowhere in shipped code; the only match in the repo is a test helper
  (`apps/api/src/modules/external-signup/infrastructure/sns-signature.spec.ts:173`), and specs are
  stripped from `dist` at `infra/api-web/Dockerfile.api-web:59-60` while the `openssl` binary package
  itself is purged at `:93`.
- FIPS is not in use; the advisory itself states the FIPS modules are unaffected.

### CVE-2026-85091 — HIGH, `zlib` `1.2.13.dfsg-1`

Row id `AWS-ECR-CVE-2026-85091-ZLIB-PRE131-MAPPING`. Anchor: `when processing non-blocking gzwrite()
operations with stale external buffer pointers`.

Evidence verified in-repo 2026-09-05:

- Version mapping, same shape as the existing `AWS-ECR-CVE-2026-14456-OPENSSL-PRE35-MAPPING` row: the
  provider text says "zlib versions 1.3.1.2 through 1.3.2", while the scanned Debian package is
  1.2.13.
- Repo-wide grep for `gzwrite|gzprintf|gzopen|gzclose` (excluding `node_modules`) returns nothing —
  no process calls the C `gz*` streaming API at all, let alone in non-blocking mode.
- The only zlib users are Node's bundled `node:zlib`: `deflateSync` in
  `apps/api/prisma/seed-attachment-storage.ts:12` and `gunzipSync` in
  `apps/api/prisma/production-a5/run-readonly-evidence-task.ts:12,62` — both in Prisma tooling, both
  in Node's statically linked copy rather than the Debian shared library.

## Open questions

- **Blocks production promotion, not UAT.** `infra/security/evidence-contracts.jq:1298-1312`
  (`e0_ecr_openssl_unreachable_waiver`) still pins waivers to the 2026-08 batch only: `severity ==
  "HIGH"`, `packageName == "openssl"`, `packageVersion == "3.0.20-1~deb12u2"`, `approvedBy ==
  "CHAT-OWNER-DIRECTIVE-2026-08-27-…"`, `expiresAtEpoch == 1788998400`, plus the row-id allowlist in
  `e0_openssl_waiver_rows` (`:1283-1296`). Two more constraints break as well: `waivers | length <= 4`
  (`:1372`, `:1435`) and `(.scanSeverityCounts.CRITICAL // 0) == .critical` (`:1371`, `:1434`) — the
  preflight derives `critical` from `.blocking` only, so a waived CRITICAL makes `critical = 0` while
  `severityCounts.CRITICAL = 1`. Deliberately left unchanged: it is the signed production evidence
  contract, out of the requested scope, and it needs its own review pass.
- Should the two waivers be renewed at expiry or should the base image move off bookworm? Decide
  before 2026-09-19.

## Artifacts

- `infra/docker/ecr-scan-blocking-findings.jq` — `debian_2026_09_waiver_table`,
  `debian_2026_09_waiver_expiry` (1789776000), `debian_2026_09_waiver_approval`, unified
  `waiver_table`.
- `infra/docker/ecr-scan-blocking-findings.spec.sh` — six-finding fixture from the real provider
  descriptions, severity drift in both directions, `package_version` drift, anchor drift, per-row
  expiry.
- `docs/runbooks/cloud-environment-operations.md` §7 — "ECR scan gate — CVE ใหม่ใน base image".

## Verification

- `bash infra/docker/ecr-scan-blocking-findings.spec.sh` → `ECR scan blocking-findings policy specs
  passed` (exit 0). Negative controls (scratch copies, repo untouched): loosening the row-level
  severity match, and collapsing the two expiry defs into one, each make the spec exit 1.
- `bash -n infra/docker/verify-ecr-scan.sh` → exit 0.
- Real scan, `watchdog-bms-api@sha256:85275263599f191f784ac73ec2492a7312954788ddc1d9767884ed80a1fe1a86`:
  `coverageComplete: true`, `blocking: []`, **5 waivers** (`CVE-2026-63076`, `CVE-2026-54874`,
  `CVE-2026-63072` at the 2026-08 expiry; `CVE-2026-75803`, `CVE-2026-85091` at the 2026-09 expiry).
  Not 6 — `CVE-2026-14456` is no longer reported for this image, so only 3 of the 4 older rows fire.
  `rawSeverityCounts` = `{CRITICAL: 1, HIGH: 4}`.
- Real scan,
  `watchdog-bms-workers@sha256:6c5e3db32f04b9385f5dfbac8a57981f5a43550496ea4b9a6f1371e535d76745`:
  `coverageComplete: true`, `blocking: []`, **1 waiver** (`CVE-2026-85091`).
- Production maintenance pin list: neither `ecr-scan-blocking-findings.jq` nor its spec is pinned in
  `infra/security/validate-production-maintenance-release.sh` (24 `check_file` entries, none matching
  `ecr`/`scan`), so no pin re-sync is needed. Both files ARE hashed into the production preflight
  validator set (`.github/workflows/production-security-preflight.yml:645`,
  `infra/security/evidence-contracts.jq:1271-1281`), which reads them from the source commit — no
  hard-coded hash to update there either.

## Next

1. Open the PR for `codex/ecr-scan-waivers-2026-09-05` and re-run the UAT deploy.
2. Before any production promotion, extend `infra/security/evidence-contracts.jq` to accept the
   2026-09 waiver batch (row ids, CRITICAL severity, `length <= 6`, and the
   `severityCounts.CRITICAL == critical` rule) with its own spec coverage.
3. Set up the nightly ECR re-scan alert described in the runbook so the next new CVE surfaces before
   deploy day.
4. Re-evaluate both waivers on 2026-09-19.
