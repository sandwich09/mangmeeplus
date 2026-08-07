# ADR 0010: LINE AI Turn Ledger on Redis Streams

## Status

Accepted (owner decision 2026-07-07)

## Context

Item 10F makes one LINE sentence with several commands end honestly per sub-request. A turn can legitimately end with unanswered sub-requests: tool budget exhausted, a clarify waiting on the user, or the process dying mid-turn (deploy, crash). Today all turn progress lives in process memory (the buffering plan's per-chat state flushes on shutdown but does not persist partially-completed turns), so those remainders vanish silently.

We need per-chat work items that are strictly ordered (answers must follow the order asked), individually acknowledgeable (the coverage critic confirms each sub-request), and durable across restarts — with a follow-up path that pushes late answers. Repo facts: BullMQ (Redis) already runs the workers app with a proven worker→drain-endpoint pattern (`ai-draft-worker.ts`); `REDIS_URL` already exists in `packages/config`; the LINE channel is read-only/draft-only, so re-running work is safe by construction.

## Decision

Use one Redis Stream per chat as the turn ledger, owned by apps/api (AI Gateway stays stateless):

- Key `lineai:ledger:{companyId}:{chatKey}`, consumer group `lineai-turn`.
- A `turn` entry is XADDed before the gateway call (crash durability) and XACKed on completion; `sub_request` entries are appended for critic-verdict `needs_user` (waiting_user) and `uncovered` (pending) items.
- XACK happens only on a confirmed outcome: covered, followed_up (push sent), clarify_expired, or parked.
- Stalled/pending entries are reclaimed by a BullMQ repeatable job calling a worker-token drain endpoint (`XREADGROUP` new + `XAUTOCLAIM` stalled), mirroring the ai-draft pattern; delivery-count cap parks poison entries.
- Bounds: `XADD MAXLEN ~` (default 200) + key TTL (default 24 h); clarify expiry reuses `LINE_AI_CONTEXT_WINDOW_MINUTES`.
- Every transition is mirrored into the Postgres audit log (`ai.line.ledger.*`); Redis is operational state only.
- Fail-open on ledger availability (Redis down → turn runs as today + audit warn); permissions are re-checked at execution time; entries are DATA, never instructions.

## Consequences

### Positive

- Strict per-chat ordering from monotonic stream IDs — matches the serialization discipline the buffering item established.
- Native pending/ack semantics (PEL) give "เคลียร์ของถูกต้อง ไม่หาย" without inventing a state machine.
- Survives crash/deploy mid-turn; budget remainders become push follow-ups instead of silent drops.
- Zero new infrastructure technology: Redis and the worker drain pattern already exist; `ioredis` already ships via bullmq.
- Positions the API for future multi-instance work (shared consumer group), unlike in-memory state.

### Trade-offs

- apps/api gains its first direct Redis client (lifecycle + ECS env wiring) — mitigated by flag default-off and fail-open design.
- Operational state splits from Postgres — mitigated by mirroring every transition to the audit log as source of truth.
- At-least-once delivery can duplicate a push after a crash-before-ack — accepted: the channel is read-only/draft-only and duplicates are visible in audit.

## Alternatives Considered

### Postgres ledger table + drain job (ai-draft pattern verbatim)

Rejected by owner for this feature: wanted streaming semantics, strict ordering, and ack/claim mechanics natively rather than re-implementing them over rows; Redis is already in the stack. Remains the documented fallback shape if Redis operations ever become a burden.

### BullMQ delayed jobs as the ledger

Rejected: jobs are unordered across a chat, per-entry ack/inspection (what is still owed to this chat?) is awkward, and clarify-waiting state does not map to job lifecycles.

### In-memory only (extend the buffer service)

Rejected: loses everything on deploy/crash — the exact failure this decision exists to remove.

## Implementation Notes

- See [[plans/line-ai-multi-intent-completion-plan|10F plan]] Phase 3 for envs (`LINE_AI_LEDGER_ENABLED` default false, MAXLEN, TTL, min-idle, delivery cap, reclaim interval) and the drain endpoint contract.
- Follow-up turns must route through the existing per-chat buffer serialization to preserve ordering with live inbound messages.

## Test Requirements

- Fake-Redis unit coverage for append/ack/claim/park/expiry/MAXLEN; crash-resume integration (unacked turn re-runs once, webhookEventId dedup); drain auth + idempotency; Redis-down fail-open; permission-revoked follow-up refusal.

## Follow-up Questions

- Re-tune reclaim cadence and TTL after dev-OA observation (env-only change).
