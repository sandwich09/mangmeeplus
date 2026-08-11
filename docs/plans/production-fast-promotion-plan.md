# Production Fast Promotion Plan

Spec: `docs/specs/production-fast-promotion-spec.md`
Memory: `docs/agent-memory/production-fast-promotion.md`

- [x] Confirm UAT selective rollout and signed resolved-all acceptance contracts;
  `auto` resolving to `all` must not require a byte-identical second UAT deploy.
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
- [x] Let maintenance-only `auto` derive a read-only bootstrap when Production
  has a checksum-valid applied prefix plus pending repository migrations.
- [x] Keep live `auto` fail-closed on pending migrations and all catalog drift.
- [x] Allow a same-source reviewed bridge only behind exact all-service
  manifest and global-maintenance proof.
- [x] Add focused pending/drift/effective-mode tests and rerun the deployment,
  maintenance, release-safety, and image-security suites.
- [ ] Re-run exact UAT acceptance and Production maintenance promotion, then
  record timing and evidence.
