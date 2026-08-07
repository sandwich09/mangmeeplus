# Agent Memory: M-12 rate-limit store-failure policy

Status: Code + tests + checklist done and verified locally. Not committed (shared dirty tree —
see Coordination). Live closure evidence still owed by the release owner.

Owner: This lane owns only the store-failure policy. The surrounding M-12 remediation is owned by
Codex `/root` (`docs/agent-memory/p1-security-remediation-m04-m18.md`); the in-flight L-01
refresh-token-family work is owned by session "P2 Low informational hardening".

Scope:
- Decide, explicitly, what the API does when the shared rate-limit store is unavailable.
- Implement the decision, alarm on the condition, and record it in the canonical checklist.
- Do not touch the L-01 auth/web files another session is editing right now.

## Decision

**Option B — per-bucket policy.** The global `api-ip` bucket degrades to the per-process counter
when Redis is unavailable; every cost-bearing and credential-guarding bucket keeps failing closed.

Why this and not "keep fail-closed with a recorded risk acceptance":

- The M-12 spec already says fail closed **"for cost-bearing/sensitive paths"**
  (`docs/specs/p1-security-remediation-m04-m18-spec.md` § M-12). The shipped code fails closed for
  *every* path via the global guard, so it overshot its own spec. This is a correction back to the
  authorised design, not a weakening of it.
- P2 spec §4 rule 6: "Liveness is not sacrificed for safety."
- The `api-ip` bucket guards no spend and no credential. Trading total API availability for a blunt
  DoS damper is the wrong trade, and on the ECS Express canary the resulting 5xx spike trips the
  RollbackAlarm — so the fail-closed posture could also block the very deploy that fixes it.
- Degraded is not unlimited. The same limit applies per task instead of per fleet, so a distributed
  flood gets task-count× the budget, not an open door. ALB/WAF remains in front.

Accepted residual risk: during a Redis outage the global IP limit is per-task. Recorded in the
checklist under M-12.

## Implementation

- `apps/api/src/common/security/redis-rate-limit.service.ts` — new `StoreFailurePolicy`
  (`'fail-closed'` | `'degrade-to-local'`), **default `'fail-closed'`** so every existing call site
  keeps its behaviour untouched. `RateLimitDecision` gains `degraded?: boolean`.
- `apps/api/src/common/security/api-rate-limit.guard.ts` — the one call site that opts into
  `'degrade-to-local'`; emits the alarm on the degraded/recovered transition.
- `apps/api/src/common/logger/security-event.ts` (+ byte-identical AI Gateway copy) — new
  `api.rate_limit.store_degraded`. Name shape is forced by the convention test: first segment has
  no underscore.

The guard's `catch` was left alone on purpose: a broken guard is still fail-closed (503). Only
store unavailability degrades, and only for that one bucket.

Decisions:
- Policy is an explicit per-call argument, not derived from the scope string — a security posture
  should not be implied by a name.
- Alarm is edge-triggered. An outage lasts thousands of requests; per-request emission would make
  the alarm key on volume instead of the condition.
- `session-refresh` untouched — L-01 already fails it open at the call site for the same liveness
  reason, and that file is being edited concurrently.

Open questions:
- None blocking. Live closure (synthetic degraded alarm from pre-prod) is release-owner work.

Artifacts:
- `docs/security-remediation-checklist-merged-2026-07-17.md` § M-12 (availability decision entry)
- `apps/api/src/common/security/redis-rate-limit.service.ts` + `.spec.ts`
- `apps/api/src/common/security/api-rate-limit.guard.ts` + `.spec.ts`
- `apps/api/src/common/logger/security-event.ts`, `apps/ai-gateway/src/common/logger/security-event.ts`
- `apps/api/src/common/logger/security-event-emitters.spec.ts`

Verification:
- Focused (limiter + guard + event + emitters): 35/35 pass.
- `pnpm --filter api test:p1`: 21/21 pass.
- Auth + OCR neighbours (`auth-rate-limit`, `refresh-session-reuse`, `auth-endpoints`,
  `receipt-ocr-client`): 44/44 pass.
- `tsc --noEmit` clean for `apps/api` and `apps/ai-gateway`.
- Byte-identical `security-event.ts` guard test passes (both copies updated).

## Follow-on: boot-level DI coverage (added same session)

The DI bug that another session found in this file (`Pick<AppConfigService, …>` compiles to
`design:paramtypes: [Object]`, so Nest had no token and the API died at boot) was fixed by the
L-01 session. The gap that let it ship is not fixed by that: **no spec in apps/api builds the Nest
graph**, every one uses `new`, so any DI mistake passes the full 2,566-test suite and CI, and only
fails when the container starts. CI had no boot step either.

Added `apps/api/src/scripts/boot-di-smoke.ts` + `pnpm --filter @watchdog-bms/api test:boot`, wired
into the `typecheck-and-test` CI job. Resolves the whole graph in ~200ms with no database, Redis,
or S3, and no new dependency.

Two constraints discovered while building it, both load-bearing:

- **It cannot be a `*.spec.ts`.** tsx compiles with esbuild, which does not implement
  `emitDecoratorMetadata` — under `tsx --test` *every* constructor parameter looks unresolvable
  (a probe reported a false `IssueTokenUseCase` failure this way). Only the swc build emits the
  metadata Nest reads (`.swcrc` → `decoratorMetadata: true`), so the check runs against `dist/`.
- **It must fail on config-validation errors, not just DI errors.** The config schema validates at
  module load, before DI resolution. A check that only failed on DI exceptions would exit 0 in CI
  the moment a new required env var appeared, silently testing nothing. The script sets the four
  keys the schema needs (`APP_ENV`, `SERVICE_NAME`, `S3_BUCKET`, `DATABASE_URL`) and treats a clean
  resolve as the only pass.

Proved in both directions: exit 0 on the current tree; exit 1 with the original
`UnknownDependenciesException: RedisRateLimitService (?)` when the `@Inject` is removed from the
compiled output.

A source-scan alternative was measured and rejected: across 279 `@Injectable` classes and 565
constructor parameters it flagged 3, of which 0 were real (`CompositePolicyEvaluator` is built by a
factory, the other 2 were parser artifacts). It guards one narrow pattern; the boot check catches
every DI wiring error for less code.

## Coordination

The premise this lane was handed said the limiter was "untracked/in-flight". It is not: it landed
in `23c61c08` and is **already pushed to `origin/develop`**. This change is therefore a new
commit on a shared branch, not an edit to a scratch file.

Session "P2 Low informational hardening" (main checkout, L-01 refresh-token-family) had already
diagnosed the same root cause at the same lines and was actively editing
`refresh-session.use-case.ts`, `auth-rate-limit.service.ts`, `apps/web/app/api/auth/refresh/route.ts`
minutes before this work started. Those files were left untouched; it was notified of this decision.

Next:
- Owner of the M-12 lane confirms the per-bucket split before this is committed.
- Commit alongside, or after, the L-01 work so the shared dirty tree lands coherently.
- Release owner fires a synthetic degraded alarm from pre-prod for M-12 live closure.
