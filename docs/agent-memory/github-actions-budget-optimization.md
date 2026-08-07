# Agent Memory: GitHub Actions budget optimization

Status: Complete
Owner: Platform/CI
Scope: Routine CI triggers, reusable release validation, UAT promotion, Docker build cache, and CI security assertions.
Decisions:
- Preserve every immutable release image, digest, scan, signature, SBOM, manifest, and deploy verification boundary.
- Use native GitHub concurrency, job conditions, REST API, git blob comparison, and BuildKit cache; add no dependency.
- Reuse a prior validation only for UAT and only for the exact SHA with an identical `ci.yml`; production remains full-gate.
- Keep test/audit/scan/config/migration job names to avoid changing required-check contracts.
- Remove the standalone development-push AWS OIDC smoke because every UAT/production
  publisher already obtains scoped OIDC credentials with an allowed-account check.
Open questions:
- Measure the next full billing cycle before considering job consolidation or self-hosted runners.
Artifacts:
- `docs/plans/github-actions-budget-optimization-plan.md`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-uat.yml`
- `.github/workflows/deploy-production.yml`
- `infra/docker/production-image-security.spec.sh`
- `infra/docker/README.md`
Verification:
- `actionlint 1.7.12` passes all three workflows with shellcheck/pyflakes integrations
  intentionally disabled because they are not installed locally.
- Ruby YAML parsing passes all three workflows.
- `bash infra/docker/production-image-security.spec.sh`: pass.
- Focused workflow condition assertions and scoped `git diff --check`: pass.
- Live GitHub run was not dispatched because the account Actions budget is currently stopped;
  merge/push remains the integration check.
Next:
- Merge/push the workflow change, then compare Actions usage after one normal code push, one
  docs-only push, and the next UAT deploy. Revisit job consolidation only if a full cycle still
  exceeds the 3,000-minute allowance.
