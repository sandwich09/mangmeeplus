# Production Fast Promotion Plan

Spec: `docs/specs/production-fast-promotion-spec.md`
Memory: `docs/agent-memory/production-fast-promotion.md`

- [x] Confirm UAT selective rollout and signed all-target acceptance contracts.
- [x] Confirm Production already skips source CI and image publication for UAT
  promotion.
- [x] Add `target=auto` as a UAT-backed, non-incident release intent.
- [x] Resolve the Production target from active per-service full SHAs after the
  existing AWS/readback boundary.
- [x] Add the exact no-migration fast release command using existing fenced and
  idempotent operations.
- [x] Route release, rollout, verification and finalization through the resolved
  target while leaving explicit full migration promotion unchanged.
- [x] Add focused contract tests and run the existing deployment/security suites.
- [x] Review the final diff for fail-open conditions and record verification.
