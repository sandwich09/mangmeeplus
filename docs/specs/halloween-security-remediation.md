# Halloween web security remediation

Status: COMPLETE_LOCAL — 2026-10-28. Owner requested remediation after the bounded security assessment and explicitly selected website vulnerability fixes only; keep the fun client-side draw unchanged. Evidence: docs/evidence/halloween-security-remediation-2026-10-28/README.md. No deployment.

## Goal and scope

Remove reported known vulnerabilities in the workspace dependency graph, starting with production Next.js, body-parser, multer and Zod, then the affected build tooling. Preserve current game/art/share/odds/theme behavior and existing authentication, permissions and audit contracts. No participant storage, signed draws, image authenticity system, anti-cheat or asset access-control redesign. No production access or deployment.

Use existing compatible package versions/overrides before wider framework changes. Package manifest edits are authorized only for necessary dependency updates. Avoid new dependencies and unrelated refreshes. If a major dependency API migration is unavoidable, trace all callers and test old behavior before accepting it.

## Acceptance

- Production and full dependency audits report no known High/Critical findings; fix Moderate items in the same affected chains where compatible. Do not suppress advisories or treat a version-only clean report as proof against all attacks.
- Resolved installed dependency versions match patched ranges; preserve frozen-lockfile reproducibility.
- Config validation behavior remains compatible for API, gateway and workers; upload/parser flows remain bounded and fail safely.
- Security helper, config, relevant upload/parser and Halloween tests pass; affected package typechecks/builds pass or exact pre-existing blockers are recorded.
- Real browser verifies game/share rendering on390 and1280 after framework update. Existing server-side theme-off gate remains effective.
- No production release or live-security certification is claimed; record precise changes, checks and remaining deployment verification.

## Completion

Full and production dependency audits report zero known findings without suppression. Frozen offline installation, 313 focused tests, parser/archive/SWC runtime checks, affected builds/typechecks and browser390/1280 checks pass. No application compatibility edits were necessary. Public card assets and unsigned source labels remain intentional; no authoritative draw/image verification was added.
