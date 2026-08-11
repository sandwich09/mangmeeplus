# Production Fast Promotion Spec

Status: Implemented; awaiting first live timing evidence
Owner: Platform / release owner
Related: `docs/specs/uat-fast-selective-deployment-spec.md`,
`docs/specs/deploy-wave-rollout-and-prod-promotion-spec.md`

## Goal

Promote the exact signed three-image release accepted by UAT without rebuilding
or rerunning source tests in Production. Ordinary releases with no pending
database migration should deploy only the affected service, or all services for
shared changes, while retaining the Production canary, rollback, legal,
immutable-image, release-operation and health gates.

## Operator journey

- `target=auto` is the default coordinated promotion and requires one exact
  successful signed resolved-`all` UAT run. UAT may reach that result from an
  explicit `all` request or an `auto` request that safely classified and
  deployed all three services.
- Production compares the requested source with the full `GIT_SHA` on each
  active Production service using the same fail-safe classifier as UAT.
- One affected service selects that service. Multiple, shared, unknown,
  malformed or non-ancestor state selects `all`.
- Maintenance-mode fast promotion always resolves to `all`; a selective rollout
  is permitted only after Production is live because the closed state must be
  proved across all three services.
- The release task first proves that the complete repository migration catalog
  is already applied byte-for-byte. Only then may it run the existing
  idempotent permission, launch-gate, workflow-template and address syncs and
  create the durable rollout operation.
- A catalog mismatch stops before application rollout. The operator must rerun
  explicit `target=all` through the existing reviewed clone/migration ceremony.
- Any change below `apps/api/prisma/**` relative to the active Production API
  build disables fast promotion before the release task. This catches schema or
  migration-support edits that cannot be inferred safely from the migration
  ledger alone.
- Explicit single-service Production targets remain incident-only. Automatic
  promotion cannot manufacture or reuse incident authority.

## Trust boundaries

- Fast promotion consumes the exact UAT acceptance, manifest, image digests,
  signatures, SBOMs and source SHA. It never rebuilds an application image.
- `target=auto` cannot be used by maintenance bootstrap and cannot carry bridge
  or incident inputs.
- Production bake times, canary percentage, alarms, circuit breaker and health
  verification are unchanged.
- Live mode retains every legal/security gate. Maintenance mode retains the
  existing closed-ingress proof and direct-storage URL drain.
- A classifier result of `all` means deploy all through the no-migration fast
  path; database compatibility is still proved inside the fenced release task.

## Acceptance

- Intent tests prove only `auto + signed UAT run` enters fast promotion.
- Workflow tests prove Production build/test is skipped, the resolved target is
  used by release, rollout, verification and finalization, and full promotion
  remains the only migration path.
- Release-task tests prove fast promotion runs exact-catalog verification before
  every idempotent sync and rejects missing/malformed authority.
- Existing UAT selector, serving-mode, maintenance, release-safety and production
  image-security suites remain green.
