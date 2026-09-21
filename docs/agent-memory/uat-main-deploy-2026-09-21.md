# Agent Memory: UAT main deploy 2026-09-21

Status: In progress
Owner: Codex
Scope: Release the complete exact `main` source to UAT through the mandatory Kamal protocol.
Decisions:
- Preserve the dirty primary checkout and operate from an isolated worktree sharing `.env.kamal` release state.
- Align two stale test expectations without changing runtime behavior; commit `30839411d96956f2d41150af351a3dcf69868c89` is on `main` and `develop`.
- Owner approved a separate exact-match waiver for `CVE-2026-85091` on trixie `zlib 1.3.dfsg+really1.3.1-1` through 2026-10-21T00:00:00Z. Do not extend any other waiver.
Open questions: None.
Artifacts:
- Initial exact-main CI `35623421180` failed only on the two stale expectations.
- Replacement exact-main CI `35624546959` passed source/test/image validation but failed the workers ECR scan gate on the new trixie zlib package version.
Verification:
- `bash infra/docker/ecr-scan-blocking-findings.spec.sh` passed.
- `bash infra/security/production-security-preflight.spec.sh` passed.
- Exact-main CI, UAT prepare/apply, signed acceptance, KMS verification, and customer OPEN readback remain pending.
Next: Commit the scoped waiver, run one exact-main CI, then prepare and apply that accepted source to UAT.
