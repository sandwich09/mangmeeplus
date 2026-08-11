# Production Fast Promotion Spec

> **Historical V1 contract — execution frozen 2026-08-12:** ใช้เอกสารนี้อธิบาย
> implementation เดิมเท่านั้น A5 V2 source of truth อยู่ที่
> `docs/specs/production-a5-v2-spec.md`; ห้าม dispatch V1 promotion ใหม่ระหว่าง V2 ยังไม่ผ่าน
> readiness exit gates

Status: Maintenance-bootstrap hardening implemented; awaiting live proof
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
- When `target=auto` is explicitly maintenance-only and the source adds Prisma
  migrations, the controller changes the effective mode to a read-only
  maintenance bootstrap and deploys all three exact UAT images closed. The
  bootstrap may accept only an append-only repository catalog whose already
  applied prefix matches Production byte-for-byte and in order. It never applies
  a migration, creates release-operation authority, or claims the source is live.
- A later reviewed `target=all` promotion may use that same source and same image
  digest as its bridge. This is allowed only because the runtime bridge proof
  first requires all three Production services to match the signed manifest and
  proves the global maintenance state before any database mutation. A same-source
  input without that runtime proof still stops before migration.
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
- Live automatic promotion still rejects pending migrations. Maintenance
  bootstrap is a safe deployment state, not permission to skip the reviewed
  Production migration ceremony.
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
- The first live attempt is recorded as evidence: UAT run `31488786355` passed
  with signed resolved-all acceptance, while Production run `31490507419`
  stopped before mutation because active Production source `eb515b9e...` is
  behind ten repository migrations. The hardened contract must turn this exact
  maintenance case into a read-only bootstrap, while preserving the live-mode
  rejection.
