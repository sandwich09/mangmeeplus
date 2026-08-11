# UAT Fast Selective Deployment Spec

Status: Approved for implementation
Owner: Platform / release owner
Related: `docs/specs/uat-environment-spec.md`, `docs/specs/deploy-wave-rollout-and-prod-promotion-spec.md`

## Problem

Successful UAT run `31418060978` took about 24 minutes end to end even though
hosted application tests were reused. The deploy job spent 13m38s in three
parallel ECS Express canary rollouts. Each UAT service currently has a 3-minute
canary bake and a 3-minute post-shift bake. The same run also spent about six
minutes in the release-operation fence before and after the rollout; that fence
protects migrations, service intent, rollback reconciliation and launch-build
retirement and is not removed by this change.

## Goal

- Make ordinary feature-testing releases select only the affected UAT service.
- Remove the six minutes of fixed UAT bake delay while keeping ECS health,
  alarm rollback, circuit breaker, immutable image, release-operation and
  post-deploy verification gates.
- Keep Production unchanged: Production still requires a successful signed
  `target=all` UAT acceptance for the exact source and exact three-image
  manifest.

Expected warm-run targets, including image publication and the existing
release-operation fence:

- `ai-gateway` or `workers`: 12–15 minutes;
- `api-web`: 14–17 minutes;
- `all`, shared infrastructure or database changes: 17–19 minutes.

## Operator journey

`UAT Deploy` defaults to `target=auto`.

1. The workflow reads the full `GIT_SHA` from each active UAT service.
2. For each service it diffs that service's active SHA to the requested SHA.
3. One affected service selects that service. Multiple affected services,
   missing/malformed state, non-ancestor history, controller changes or an
   unknown path select `all`.
4. The workflow records the resolved target in its log and uses it consistently
   for the release task, rollout, verification and finalization.
5. An operator may still choose an explicit service for an incident or `all`
   for the final acceptance.

The final run before Production is always explicit `target=all`. Automatic or
single-service runs never produce the signed all-target acceptance consumed by
Production.

## Change classification

Classification follows the runtime Docker build inputs, not product feature
names:

- `apps/api/**`, `apps/web/**`, `infra/api-web/**`, and
  `packages/design-tokens/**` affect `api-web`.
- `apps/ai-gateway/**` affects `ai-gateway`.
- `apps/workers/**` affects `workers`.
- root workspace manifests, `packages/config/**`, `packages/contracts/**`,
  Prisma schema/migrations/sync data, deploy controllers, or an unrecognised
  path affect `all`.

If a service is several commits behind, its own active SHA is the diff base, so
an earlier change cannot be forgotten by a later selective release.

## UAT fast canary

Before an existing UAT Express service is updated, the controller round-trips
its underlying ECS deployment configuration and changes only:

- `bakeTimeInMinutes: 3 -> 0`;
- `canaryConfiguration.canaryBakeTimeInMinutes: 3 -> 0`.

The controller preserves `strategy=CANARY`, 5% canary traffic, minimum/maximum
healthy percentages, rollback alarm names/settings and deployment circuit
breaker settings byte-for-byte. It waits for a stable singleton deployment and
re-reads the configuration. Production never enters this path. A malformed,
moving or unreadable service fails before the Express application update.

## Acceptance

- Focused classifier tests cover each service, cumulative per-service SHAs,
  shared/unknown paths and invalid history fail-safe to `all`.
- Focused fake-AWS tests prove only the two UAT bake values change, all rollback
  controls are preserved, invalid state blocks, and Production performs no
  rollout-configuration read or write.
- Workflow static checks prove `auto` is resolved once and that signed
  acceptance remains `target=all` only.
- A live UAT run must record the resolved target, show zero-minute bake values
  in the active ECS service, pass digest/health/finalization, and record the
  observed duration.
