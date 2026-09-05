# Agent Memory: ecr-scan-waivers-2026-09-05

Status: APPROVED — waivers landed on `codex/ecr-scan-waivers-2026-09-05`, no PR opened yet.
Owner approved both rows in chat 2026-09-05 ("อนุมัติ waiver"); approval id
`CHAT-OWNER-DIRECTIVE-2026-09-05-UAT-DEPLOY-WAIVER`, expiry 2026-09-19T00:00:00Z (epoch 1789776000).

Owner: thawatchai phuchana

Scope: `infra/docker/ecr-scan-blocking-findings.jq`,
`infra/docker/ecr-scan-blocking-findings.spec.sh`, `docs/runbooks/cloud-environment-operations.md` §7.
No Dockerfile or workflow change; the evidence-contract change lands on the follow-on branch, see
"Production evidence contract" below.

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

- ~~**Blocks production promotion, not UAT.**~~ RESOLVED 2026-09-05 on
  `codex/evidence-contract-2026-09-waivers` — see "Production evidence contract" below. Original note:
  `infra/security/evidence-contracts.jq:1298-1312`
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

## Production evidence contract

Branch `codex/evidence-contract-2026-09-waivers`, cut from `codex/ecr-scan-waivers-2026-09-05`
(PR #421) because `origin/develop` does not carry the policy rows yet — rebase onto `develop` after
#421 merges.

### What changed — `infra/security/evidence-contracts.jq`

| Was | Now |
| --- | --- |
| `e0_openssl_waiver_rows` (`:1283-1296`): id + cve + statement + evidence only | `e0_ecr_waiver_rows` (`:1290-1327`): 6 rows, each carrying `severity`, `packageName`, `packageVersion`, `providerStatement`, `reachabilityEvidence`, `approvedBy`, `expiresAtEpoch` |
| `e0_ecr_openssl_unreachable_waiver($digest)` (`:1298-1312`): hard-coded `severity == "HIGH"`, `packageName == "openssl"`, `packageVersion == "3.0.20-1~deb12u2"`, 2026-08 approval, `expiresAtEpoch == 1788998400` | `e0_ecr_unreachable_waiver($digest; $issued_at)` (`:1334-1344`): record minus `compensatingControl`/`scannedDigest` must **equal its allowlist row**, so all nine fields match at once; expiry must be `> $issued_at` |
| — | `e0_ecr_scan_waivers($digest; $issued_at; $counts; $critical; $high)` (`:1349-1355`): list cap, unique ids, per-record match, and the severity accounting, in one place used by both scan shapes |
| `waivers \| length <= 4` (`:1372`, `:1435`) | `length <= (e0_ecr_waiver_rows \| length)` — 6 today, tracks the table |
| `(.scanSeverityCounts.CRITICAL // 0) == .critical` (`:1371`, `:1434`) | `== critical + (waived rows with severity CRITICAL \| length)`; same shape for HIGH, which previously used a severity-blind `+ (waivers \| length)` |
| `e0_h3_security_service_evidence($source; $repository)` (`:1334`, call `:1399`) | `+ $issued_at` (`:1377`, call `:1439-1440`) |
| `e0_h3_migration_tool_verification` waiver block (`:1434-1438`) | one `e0_ecr_scan_waivers` call (`:1475-1476`) using `$evidence.issuedAtEpoch` |

The 2026-08 rows are byte-identical in effect: same ids, statements, evidence strings, and the
severity/package/version/approval/expiry that were previously hard-coded are now written on each row.

`$issued_at` is `$evidence.issuedAtEpoch`, the only time the contract already trusts —
`signed-evidence.sh:417` binds it to real time (`issuedAtEpoch <= now < expiresAtEpoch`). No
wall-clock `now` was introduced; validating the same artifact twice still gives the same answer.

Grep of `.github/workflows/production-security-preflight.yml`, `infra/security/*.sh` and
`*.spec.sh` found no other copy of the 2026-08 approval id, `1788998400`, or `length <= 4` outside
the contract and the specs — nothing else needed updating.

Why the CRITICAL rule had to change: the workflow derives `critical`/`high` from `.blocking` only
(`production-security-preflight.yml:481-484`, `:584-585`) and passes ECR's raw
`findingSeverityCounts` through as `scanSeverityCounts` (`:477`, `:511`), so a waived CRITICAL makes
`critical = 0` while `scanSeverityCounts.CRITICAL = 1`. Adding the waived rows back per severity
keeps the count meaningful instead of dropping the check.

### Specs — `infra/security/production-security-preflight.spec.sh`

Accepting fixtures: api service (index 1) with the 5 waivers the real scan produces —
`CVE-2026-54874`, `CVE-2026-63072`, `CVE-2026-63076` HIGH openssl, `CVE-2026-75803` CRITICAL
openssl, `CVE-2026-85091` HIGH zlib — at `scanSeverityCounts {CRITICAL:1, HIGH:4}`, `critical`/`high`
0; and workers (index 2) with the zlib waiver alone at `{HIGH:1}`. Every field is written out in the
spec rather than read from the contract, so drift in the table fails here.

Rejects (all verified to flip `e0_ecr_scan_waivers` to `false`, i.e. rejected by the waiver rule
itself and not by an unrelated check):

| Mutation | Rule that rejects it |
| --- | --- |
| `unknown-waiver-row` — id `AWS-ECR-CVE-2099-0001-NOT-APPROVED` | no allowlist row |
| `drifted-provider-statement` — truncated anchor | row equality |
| `drifted-package-version` — `3.0.20-1~deb12u3` | row equality |
| `swapped-waiver-severity` — CRITICAL row → HIGH, zlib row → CRITICAL (counts still balance) | row equality |
| `wrong-waiver-approval` — 2026-08 approval on the 2026-09 row | row equality |
| `duplicate-waiver-id` | unique ids |
| `seven-waivers` (counts adjusted to `{CRITICAL:1, HIGH:6}`) | cap + unique ids |
| `blocking-beside-waiver` — `critical = 1` | `.critical == 0` and CRITICAL accounting |
| `waived-critical-uncounted` — `scanSeverityCounts.CRITICAL = 1`, no waivers, `critical = 0` | CRITICAL accounting |

Expiry boundary, run directly on `e0_ecr_scan_waivers` because the h2 fixture pins
`issuedAtEpoch = 1700000000`: api mix `true` at 1788998399 / `false` at 1788998400, workers zlib
`true` at 1789775999 / `false` at 1789776000 — the two batches lapse independently.

### Verification

- `bash infra/security/production-security-preflight.spec.sh` → `production security preflight E2
  specs passed` (exit 0).
- `bash infra/security/signed-evidence.spec.sh` → `signed evidence E0 specs passed` (exit 0).
- `bash infra/security/u5-production-chain.spec.sh` → `U5 production evidence-chain specs passed`
  (exit 0).
- `bash infra/docker/ecr-scan-blocking-findings.spec.sh` → `ECR scan blocking-findings policy specs
  passed` (exit 0), unchanged by this branch.
- `bash -n infra/security/production-security-preflight.spec.sh` → exit 0 (only shell file touched).
- `jq -n -L infra/security 'include "evidence-contracts"; ...'` → contract compiles.
- Negative control: with `evidence-contracts.jq` restored to its pre-change content the new spec
  exits 1 (`ERROR: signed-evidence payload contract failed`), so the added cases are load-bearing.
- `node infra/security/sync-production-maintenance-release-pins.mjs --check` →
  `exactFiles=45 status=current`, exit 0. Neither `evidence-contracts.jq` nor
  `production-security-preflight.spec.sh` is in the 45 `check_file` pins, so no re-sync and no pin
  commit. Both files are still hashed into the preflight validator set
  (`e0_h3_validator_paths`, `production-security-preflight.yml:645`), which reads them from the
  source commit — no stored hash to update.

## Next

1. Open the PR for `codex/ecr-scan-waivers-2026-09-05` and re-run the UAT deploy.
2. Rebase `codex/evidence-contract-2026-09-waivers` onto `develop` once #421 merges, then PR it —
   production promotion is blocked until the contract change lands.
3. Set up the nightly ECR re-scan alert described in the runbook so the next new CVE surfaces before
   deploy day.
4. ~~Re-evaluate both waivers on 2026-09-19~~ — SUPERSEDED 2026-09-05: renewed to 2026-10-05
   (epoch `1791158400`) together with the 2026-08 batch, and `CVE-2026-14456` retired. See
   `docs/agent-memory/cve-waiver-renewal-2026-10-05.md`. A renewal still needs the row edited in
   **both** `infra/docker/ecr-scan-blocking-findings.jq` and `e0_ecr_waiver_rows`.
