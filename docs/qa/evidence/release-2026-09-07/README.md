# Historical release evidence — 2026-09-07

Retained from the completed release task during owner-authorized workspace cleanup. This is a compact evidence archive, not a deployable bundle or a fresh live-environment check.

- Application source: `604ac785479ced5b9858d0b46d89f8d11cf2b9f6`.
- [UAT34068520561](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34068520561), [READY34076680047](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34076680047), [Production34078121808](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34078121808).
- Start with [release report](release-report.md), [summary](release-summary.json), [signed verification](signed-result-verification.json), and [config parity](config-parity-after.md).
- Signed result/passport/READY documents and bundles, source/run identities, sanitized config/health/customer acceptance readbacks, and artifact metadata are retained. Secret references are markers or resource references; no secret values were collected in these records.
- Downloaded ZIPs, extracted SBOM/build payloads, duplicated contract source and generated logs were removed. `cleanup-manifest.json` records their hashes and sizes. The corresponding full workflow artifacts are identified in the adjacent metadata files; this reduced archive does not claim to replace their full contents.
- Failed or earlier readiness/controller records are retained as historical diagnosis, not as acceptance of the final release.
