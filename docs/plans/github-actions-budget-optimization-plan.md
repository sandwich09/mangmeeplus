# GitHub Actions Budget Optimization Plan

Status: Complete

## Outcome

Keep routine CI and approved UAT/production promotion inside the GitHub Pro Actions
allowance more reliably without weakening the immutable release boundary.

## Users and journey

- Developers push code or documentation and receive the smallest relevant CI gate.
- A release owner dispatches UAT or production for an exact allowed commit.
- Deployment still consumes three digest-bound, scanned, signed images with SBOMs.

## Rules

- Superseded branch/PR CI may be cancelled; release/deploy runs must not be cancelled.
- Documentation/output-only changes skip code, security, and image jobs while the workflow
  still resolves the source revision.
- Routine code pushes run tests, audit, secret scan, config validation, and migration review.
- Release publishers remain the live OIDC/account verification path; the redundant
  production OIDC smoke on every development push is removed.
- Six-image compatibility builds run only for an explicit full CI release gate.
- The three active ECS images are always built, pushed, pulled by digest, filesystem-checked,
  vulnerability-checked, signed, and SBOM-recorded by the release publisher.
- UAT may reuse a successful push validation only when it is for the exact source SHA and the
  source SHA contains the exact same `ci.yml` blob as the dispatching workflow. Otherwise UAT
  falls back to the full validation path.
- Production keeps the full validation path on every deployment.
- BuildKit cache may reduce rebuild work but never replaces digest, revision, scan, signature,
  SBOM, manifest, or post-deploy verification.

## Implementation

- [x] Add direct-CI concurrency and source change classification.
- [x] Gate routine jobs and full compatibility image builds by the resolved classification.
- [x] Allow the reusable release publisher to accept an exact trusted validation run ID.
- [x] Resolve the reusable validation ID fail-closed in UAT.
- [x] Keep release-manifest assembly runnable after trusted CI reuse skips the redundant validation jobs, with explicit successful source/image-publisher guards.
- [x] Add scoped BuildKit cache to compatibility, publisher, and release-task builds.
- [x] Extend the existing production image security check with the new contracts.

## Acceptance

- Workflow YAML parses.
- `infra/docker/production-image-security.spec.sh` passes.
- Shell/static checks and scoped `git diff --check` pass.
- Docs-only direct CI cannot start code/image jobs.
- Routine pushes cannot start the six-image compatibility matrix.
- UAT cannot skip validation for a different SHA or different `ci.yml`.
- Trusted UAT validation reuse still creates the signed digest/SBOM release artifact consumed by deployment.
- Release publication retains all existing immutable-image gates.
