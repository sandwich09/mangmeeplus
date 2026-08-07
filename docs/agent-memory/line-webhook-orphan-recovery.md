# Agent Memory: LINE webhook orphan recovery

Status: Implemented on branch `fix/line-webhook-orphan-recovery`; verified locally; not merged, not deployed.
Owner: Claude (implementation)
Scope: Close the one path where an employee LINE message is silently lost, and give
`LineWebhookEventLog` the retention it never had.

## Problem

`LineMessageBufferService.enqueue` writes the `received` row, acks LINE 200, and keeps the
message in **process memory**. A hard exit (SIGKILL/OOM/crash, or a shutdown drain that times
out) between the ack and the turn loses it permanently: LINE only redelivers un-acked events,
and the payload died with the process. The row sits at `received` forever, and nothing can even
notify the user — the log stored only `lineUserIdHash`, no chat id.

Not affected (verified in code, do not "fix" again):

- Duplicate/claim-race drops in `claimWebhookEvent` — every branch means the user already has a
  reply or a sibling worker holds a fresh claim.
- Gateway error / undelivered answer — `DrainLineLedgerUseCase` re-runs the turn and pushes.
- Dispatch exceptions — `deliverDispatchFailure` parks the row and sends a truthful message.
- Normal deploys — `onModuleDestroy` flushes and drains within the ECS grace period.

## Decisions

- Store the buffered `LineBufferEnvelope` on the row `acceptEvent` already creates before the
  ack: **zero extra queries on the pre-ack hot path**.
- Replay through `LineMessageBufferService.enqueue`, not `ProcessLineWebhookUseCase.execute` —
  fragment joining, ordering, dedup, reply-token→push fallback and the dispatch-failure notice
  all come for free, and multi-bubble utterances stay ONE turn instead of N answers.
- The sweep replays only rows the employee never heard from: `received` + `errorCode IS NULL`,
  or `delivery_pending` + `RETRYABLE_*`. `executeReceiptUpload` and the media-download path
  answer with ERROR_REPLY and *then* release the row as `RETRYABLE_*`; sweeping those would send
  a second error message every minute.
- That same predicate bounds replay without a counter column: the sweep's stamp is itself
  `RETRYABLE_ORPHAN_REPLAY`, and `acceptEvent` clears it only once the buffer really took the
  message back. A second replay therefore requires a second real crash.
- Replay window 2–60 min. Past 60 min the employee has moved on, so the row is parked
  (`orphan_expired`) instead of answering a stale question. No apology push: reaching that age
  means the sweep itself was down, and an outage would fan out one push per affected employee.
  One-line change if the owner wants the apology instead.
- Payload cleared at every terminal write (`updateEventLog`, `markBatched`, overflow, dispatch
  delivered, ledger-drain completion, `releaseWebhookEvent`). Steady state holds **no raw chat
  ids**: only in-flight rows (seconds) and un-swept orphans (≤ ~1 tick) carry one.
- Retention reuses `AI_DATA_RETENTION_DAYS` (90, already deployed) rather than adding a knob.
  This table had no purge at all — it is the dedup ledger for every LINE event ever received.
- Ran on the existing `line-ai-ledger` worker tick (60 s) via a second internal endpoint on the
  existing worker-token controller. No new worker, queue, or env var. The two calls are
  independent (`Promise.allSettled`) so a ledger failure cannot block orphan recovery.

## Accepted residual

If a process dies in the millisecond window *after* `deliverReply` succeeded but *before* the
status write, the replay answers the employee twice. At-least-once is the correct trade against
silence; the alternative is losing the message.

## Artifacts

- `apps/api/prisma/schema.prisma` + `prisma/migrations/20260804190000_line_webhook_orphan_recovery/`
  — `payloadJson`, `@@index([status, createdAt])`, `@@index([createdAt])`
- `apps/api/src/modules/line-ai/application/use-cases/recover-orphan-line-events.use-case.ts` (new)
- `apps/api/src/modules/line-ai/application/line-message-buffer.service.ts` — persist + clear
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — clear
- `apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.ts` — clear
- `apps/api/src/modules/line-ai/presentation/http/line-ai-ledger-internal.controller.ts` — `sweep-orphan-events`
- `apps/workers/src/modules/line-ai-ledger/line-ai-ledger-worker.ts` — both endpoints per tick
- `.../recover-orphan-line-events.use-case.spec.ts` (new, registered in `apps/api/package.json`)

## Verification

| Command | Result |
|---|---|
| `pnpm --filter @watchdog-bms/api typecheck` | PASS |
| `pnpm --filter @watchdog-bms/workers typecheck` | PASS |
| new spec | 11/11 pass |
| LINE spec set (orphan, buffer, webhook, ledger drain, webhook controller) | 110/110 pass |
| `pnpm --filter @watchdog-bms/workers test` | 15/15 pass |
| api main suite | 3985/4009 pass; the 24 failures are pre-existing reimbursement spec fakes missing `beginCancellationAtomic` / `assertClaimPaymentReady` / `assertSettlementPostingReady` (added by `d1d3b23e`, untouched here) |
| api DB-backed pretest specs | PASS |
| migration SQL | applied inside `BEGIN/ROLLBACK` on the local DB, then `prisma migrate deploy` (local DB was 6 migrations behind from other sessions; that staleness, not this change, caused 29 of the earlier failures) |

Not run: live LINE round trip. The failure it recovers from is a hard pod kill mid-turn, which
needs a UAT environment to stage.

## Next

1. Review + merge; deploy needs the migration (additive: one nullable column, two indexes).
2. After deploy, watch `line_orphan_sweep` logs / `ai.line.orphan_sweep` audit for a week — the
   counts are the first real evidence of how often this happens. `orphan_expired > 0` means the
   worker or API was down, not that a message was mishandled.
3. Owner call still open: apology push for `orphan_expired` rows (currently log/audit only).
