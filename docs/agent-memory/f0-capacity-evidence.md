# F0 — Capacity Evidence: Claim, Lock Wait, Throughput, Outbox Age, Safe In-Flight (Lane F0.E)

| | |
| --- | --- |
| Generated | 2026-07-31 |
| Git HEAD | `8f369e4996c0c50738135cdc0b4cad26849920a2` (branch `develop`) |
| Lane | F0.E — capacity evidence |
| Plan | `docs/plans/feature-entitlement-decoupling-plan.md` §3 F0 (:31 batch-claim gate), :38 (bounded batch "allowed only after F0 capacity evidence"), §7 (:219 "record p95/p99 and safe in-flight evidence before enabling any batch claim") |
| Runbook | `docs/runbooks/feature-launch-control.md` OPEN-6 (:317) names "F0 capacity lane" as this evidence owner |
| Upstream | `docs/agent-memory/f0-inventory-async-surface.md` §6a (the one outbox consumer), §10 (non-atomic claim named as "to fix before any batch-claim design") |
| Scope | MEASUREMENT ONLY — no schema change, no `apps/` code change, no git write. One new doc. |

> **Environment label — read before quoting any number.**
> **local: macOS Docker Postgres, not representative of ECS RDS — relative comparisons valid, absolutes are not.**
> PostgreSQL 16.14 aarch64 (Alpine) in Docker Desktop on `127.0.0.1:15432`, database `watchdog_bms`, loopback client, no network hop, no RDS storage layer, no Multi-AZ commit, no PgBouncer. Absolute latency and rows/sec are optimistic by an unknown factor. **Every recommendation below is derived only from A/B ratios and shape (linear vs flat, zero vs non-zero), never from an absolute.** The deferred UAT rerun (§8) is what converts these into thresholds.

---

## 1. What was measured and why

Plan §3 F0 blocks any batch-claim design on approved capacity evidence, and Plan §3 F1 permits "a later bounded same-company/same-vector batch … only after F0 capacity evidence, with one persisted attempt/token per item and a cap that keeps CLOSE bounded". `f0-inventory-async-surface.md` §10 names the blocker concretely: the single outbox consumer's claim is non-atomic.

| # | Probe | Question it answers | Result |
|---|---|---|---|
| P1 | Outbox claim throughput + double-claims | Does the current claim double-deliver, and how much does the atomic alternative cost? | §3 |
| P2 | Backlog-depth scaling | Is claim cost O(batch) or O(backlog)? Sets the batch cap rationale. | §4 |
| P3 | Row-lock wait (`SELECT … FOR UPDATE`) | p50/p95/p99 wait for the F1 entitlement-row lock | §5 |
| P4 | Advisory-lock wait (`pg_advisory_xact_lock`) | Is the F1 gate-claim advisory variant cheaper? | §5 |
| P5 | Outbox age scan | Cost of the F1 health-view query | §6 |
| P6 | Existing volumes | Current baseline table | §2 |

Scripts: `scratchpad/f0/capacity/f0e-capacity.js` (modes `baseline seed claim lock age scale cleanup`). Full source is embedded in **Appendix A** so the UAT rerun needs no scratchpad.

### 1.1 Method

- One synthetic tenant, marker `F0E-CAPACITY-PROBE-1785497011`: `Company.id = f0e-F0E-CAPACITY-PROBE-1785497011`, 4 `CompanyFeatureEntitlement` rows, 5,000 `OutboxEvent` rows (`aggregateType='F0ECapacityProbe'`, `eventKey` prefixed with the marker).
- Seeded `priority='NORMAL'` for **100%** of rows. This is production-faithful, not a simplification: 98 `outbox.append(...)` call sites in `apps/api/src`, **zero** pass the optional 5th `priority` argument (`outbox-append.service.ts:70` default). **The `ORDER BY priority DESC` sort key is inert in production today** — see §4.1, it is also the reason the index cannot serve the claim.
- `availableAt` spread over the preceding hour so `availableAt ASC` and the age scan are non-degenerate.
- Concurrency = N distinct PostgreSQL connections driven from one Node process via `Promise.all`. **Limitation:** the Node event loop serialises client-side work, so issue times are staggered by microseconds and wall-clock throughput includes JS overhead. Server-side lock waits (§5, dominated by a 10 ms hold) and correctness counts (§3, dominated by the server's visibility rules) are unaffected by this; rows/sec figures are a floor.
- Percentiles are `ceil(p/100 * n)`-indexed order statistics over every observation in the run.

### 1.2 Safety deviation (declared)

The real claim predicate is **cross-tenant** (`status IN ('PENDING','FAILED') AND availableAt <= now()`), which would have swept the one real `PENDING` row in this database. Every **mutating** probe therefore carries an extra `AND "companyId" = <synthetic>`.

This deviation is identical in both A/B variants, so the comparison holds. It also does not change the plan class — the true production query and the scoped probe query produce the *same* plan shape at the same backlog:

| Query | Plan | Buffers | Exec |
|---|---|---|---|
| Real, unscoped, backlog 5,001 | `Limit → Sort (top-N heapsort) → Seq Scan` | 259 | 6.73 ms |
| Probe, `companyId`-scoped, backlog 5,000 | `Limit → Sort (top-N heapsort) → Seq Scan` | 267 | 3.06 ms |

Read-only probes (§2 baseline, §6 `EXPLAIN`) used the true unscoped predicate.

---

## 2. P6 — Existing volumes (read-only baseline)

Captured before seeding, on the local seeded database. This is a *bare seed*, not a production-shaped corpus — it establishes that the probe started from a known state, not that production looks like this.

| Table | Rows |
|---|---:|
| `Company` | 5 |
| `CompanyFeatureEntitlement` | 12 |
| `OutboxEvent` | 96 |
| `WorkflowEventInbox` | 95 |
| `WorkflowRun` | 25 |
| `WorkflowActionRun` | 16 |
| `WorkflowDeadLetter` | 0 |
| `WorkflowTask` | 4 |

`OutboxEvent` by status, with age of the oldest row:

| Status | Rows | Oldest `availableAt` | Oldest age |
|---|---:|---|---:|
| `PENDING` | 1 | 2026-07-28T13:57:12Z | 2.60 days |
| `PUBLISHED` | 95 | 2026-07-13T10:10:52Z | 17.76 days |

`WorkflowActionRun`: 16 `SUCCEEDED`, 0 in any other status. `WorkflowEventInbox`: 12 `MATCHED`, 83 `SKIPPED`. `WorkflowDeadLetter`: empty.

**Finding B1 — a real stuck row already exists.** One `PENDING` outbox event has been sitting 2.6 days on a database whose drain has simply not been running. Nothing surfaced it. This is `f0-inventory-async-surface.md` §10's "outbox `DEAD` has no handler, reconciler or alert" showing up one status earlier: `PENDING` has no age alert either. The F1 health view (§6) is what makes this visible; OPEN-6 is what gives it a threshold.

---

## 3. P1 — Outbox claim: current vs atomic

`PrismaOutboxRepository.claimBatch` (`apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-outbox.repository.ts:46-71`) issues **two statements with no transaction**: a `findMany`, then an `updateMany` whose only predicate is `id IN (…)`. The update never re-checks `status`, so a second claimer that read the same rows also "wins".

Both variants replicate the real `where` / `orderBy` / `take`. Protocol: N workers loop `claim(batch)` until the pool is exhausted; every returned id is tallied. `doubleClaimedRows` = distinct rows granted to more than one claim; `duplicateGrants` = total grants minus distinct rows = the number of **redundant event deliveries** the consumer would perform.

### 3.1 Single claimer (no contention)

| Variant | Batch | Calls | Distinct claimed | Total grants | Double-claimed rows | Wall ms | Rows/sec | claim p50 | p95 | p99 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| non-atomic (current) | 20 | 251 | 5000 | 5000 | **0** | 789 | 6,334 | 3.05 | 4.28 | 5.08 |
| non-atomic (current) | 50 | 101 | 5000 | 5000 | **0** | 402 | 12,449 | 3.68 | 5.32 | 7.51 |
| non-atomic (current) | 100 | 51 | 5000 | 5000 | **0** | 266 | 18,799 | 4.98 | 7.58 | 8.83 |
| atomic `SKIP LOCKED` | 20 | 251 | 5000 | 5000 | **0** | 1175 | 4,256 | 4.18 | 8.53 | 16.56 |
| atomic `SKIP LOCKED` | 50 | 101 | 5000 | 5000 | **0** | 794 | 6,296 | 5.86 | 17.20 | 26.22 |
| atomic `SKIP LOCKED` | 100 | 51 | 5000 | 5000 | **0** | 440 | 11,377 | 7.23 | 13.11 | 30.75 |

With one claimer the current code is correct and is **1.5–1.7× faster** than the atomic form. That is the entire case for the status quo, and it holds only while exactly one drain is ever in flight.

### 3.2 Concurrent claimers, batch 25 (production default, `DrainWorkflowOutboxUseCase.execute(batchSize = 25)`)

| Variant | Workers | Calls | Distinct claimed | Total grants | **Double-claimed rows** | **Duplicate grants** | Wall ms | Rows/sec | claim p50 | p95 | p99 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| non-atomic (current) | 2 | 401 | 5000 | 9,975 | **4,975 (99.5%)** | **4,975** | 838 | 5,966 | 3.98 | 5.87 | 7.13 |
| non-atomic (current) | 5 | 962 | 5000 | 23,925 | **5,000 (100%)** | **18,925** | 1125 | 4,444 | 5.46 | 8.81 | 12.81 |
| non-atomic (current) | 10 | 1476 | 5000 | 36,650 | **5,000 (100%)** | **31,650** | 1334 | 3,748 | 8.30 | 14.70 | 23.20 |
| atomic `SKIP LOCKED` | 2 | 202 | 5000 | 5,000 | **0** | **0** | 577 | 8,668 | 5.33 | 7.43 | 9.73 |
| atomic `SKIP LOCKED` | 5 | 205 | 5000 | 5,000 | **0** | **0** | 282 | 17,744 | 6.64 | 9.86 | 11.60 |
| atomic `SKIP LOCKED` | 10 | 210 | 5000 | 5,000 | **0** | **0** | 270 | 18,517 | 11.43 | 28.39 | 35.29 |

### 3.3 Race window

The vulnerable interval is the whole claim call: any other claimer whose `SELECT` executes before this claimer's `UPDATE` commits sees the same rows. Two bounds were recorded:

| Workers | `SELECT`→`UPDATE` gap p95 | p99 | Full claim latency p95 (upper bound) |
|---:|---:|---:|---:|
| 1 (batch 20) | 1.80 ms | 2.29 ms | 4.28 ms |
| 2 | 2.50 ms | 3.22 ms | 5.87 ms |
| 5 | 4.22 ms | 6.41 ms | 8.81 ms |
| 10 | 9.20 ms | 14.05 ms | 14.70 ms |

**Window ≈ 2–15 ms, and it widens with concurrency** — the more claimers, the longer each one stays exposed. Under the atomic variant the window is structurally zero (one statement).

### 3.4 Findings

- **F1 — the current claim double-delivers under any concurrency, and the amplification is not marginal.** At 2 claimers, 99.5% of rows were delivered twice. At 10, every row was delivered and the consumer performed 36,650 ingests for 5,000 events — **7.3× amplification**. The saturated loop in this probe is a worst case (zero think-time), so treat these rates as "what happens while two drains overlap", not a steady-state daily rate. The *correctness* conclusion does not depend on the rate: the window is real, measured, and non-zero at every concurrency including N=2.
- **F2 — the atomic form is not a throughput tax; above N=2 it is a throughput win.** At N=10 it moved 18,517 rows/sec against 3,748 (**4.9×**) while granting each row exactly once. The current form *degrades* with concurrency (6,334 → 3,748 rows/sec) because claimers spend their time re-reading and re-claiming rows their peers already took; the atomic form *scales* (8,668 → 18,517). Its cost is a worse tail (p99 35 ms at N=10 vs 23 ms) from `SKIP LOCKED` contention, which is the correct trade.
- **F3 — the failure is self-reinforcing, and this is the operational risk.** Overlap is reachable today: the `workflow` BullMQ worker runs `concurrency: 2` (`apps/workers/src/modules/workflow/workflow-worker.ts:21`) with the `outbox.drain` repeatable every 30 s (`:34`), so a drain that exceeds its 30 s period runs alongside the next tick — and effective concurrency is `2 × (workers ECS task count)`, since each task registers the same repeatable against the shared Redis queue. §4 shows claim latency grows linearly with backlog. So: backlog grows → each drain gets slower → drains overlap → every event is ingested 2×+ → the consumer does more work per event → backlog grows. A gate CLOSE that pauses the drain, or any runoff pile-up, is exactly the trigger.
- **F4 — the consumer's idempotency is load-bearing today, and it is a different key.** `DrainWorkflowOutboxUseCase` is idempotent per `(companyId, eventId)` at ingest, which absorbs duplicate *ingests*. It does not absorb the duplicated `markPublished`/`markFailed` writes, the duplicated `attempts` increments (a row double-failed reaches `DEAD` in half the attempts), or duplicated work in any *future* consumer. Plan §3 F1's "one persisted attempt/token per item" cannot be satisfied on a claim that grants the same item twice.

**Verdict for the Plan §3 F0 gate: the non-atomic claim must be replaced before any batch-claim design proceeds.** The atomic `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING` is the F1 candidate and carries no throughput cost at the concurrency where it matters.

---

## 4. P2 — Backlog-depth scaling (what actually caps the batch)

Claim `SELECT` latency, 40 iterations per cell, eligible backlog varied over the synthetic pool:

| Eligible backlog | Batch 25 p50 | p95 | Batch 100 p50 | p95 |
|---:|---:|---:|---:|---:|
| 100 | 0.62 | 1.05 | 0.70 | 1.02 |
| 250 | 0.77 | 2.45 | 0.89 | 1.91 |
| 500 | 0.85 | 1.28 | 0.89 | 1.14 |
| 1,000 | 1.11 | 1.86 | 1.35 | 2.19 |
| 2,500 | 2.65 | 3.21 | 2.93 | 3.31 |
| 5,000 | 2.91 | 3.87 | 3.10 | 3.73 |

Least-squares over the 500–5,000 range: **latency ≈ 0.62 ms + 0.46 µs × backlog**, and **batch size is free** (25 vs 100 differ by less than the run-to-run noise at every depth).

### 4.1 Why — the index cannot serve the claim

`EXPLAIN (ANALYZE, BUFFERS)` on the real unscoped query at a 5,001-row backlog:

```
Limit (actual time=6.683..6.687 rows=25 loops=1)
  ->  Sort (actual time=6.682..6.684 rows=25 loops=1)
        Sort Key: priority DESC, "availableAt"
        Sort Method: top-N heapsort  Memory: 51kB
        ->  Seq Scan on "OutboxEvent" (actual rows=5001)
              Filter: status = ANY ('{PENDING,FAILED}') AND "availableAt" <= now()
Execution Time: 6.726 ms
```

The index is `@@index([status, availableAt, priority])` (`schema.prisma:648`). It cannot satisfy `ORDER BY priority DESC, availableAt ASC` — the sort columns are in the wrong order and the wrong direction — so **every eligible row is read and sorted to return 25**. At 96 rows the planner still used the index (with a Sort on top, 0.09 ms); at 5,001 it abandoned the index for a Seq Scan.

- **F5 — claim cost is O(backlog), not O(batch).** Raising the batch is free; the cost driver is queue depth. Extrapolating the local slope: ~47 ms at 100k backlog, ~460 ms at 1M. Absolutes will differ on RDS; the **linearity** is a plan-shape property and will not.
- **F6 — the sort key is inert and is the sole reason for the scan.** Zero of 98 producers set `priority`, so `ORDER BY priority DESC` sorts a constant column. An F1 index on `(status, availableAt)` matching the claim order, or dropping the dead `priority` sort key, converts the scan into a bounded index scan. Recorded as an F1 candidate, **not applied by this lane** (no schema change in scope).
- **F7 — therefore the batch cap is a CLOSE-boundedness decision, not a database decision.** Plan §3 F1 requires "a cap that keeps CLOSE bounded". The database gives no reason to prefer 25 over 200. The binding constraint is how much in-flight work an emergency CLOSE (runbook R3) must wait to drain: with one persisted attempt/token per item, worst-case CLOSE wait ≈ batch × per-item processing time.

---

## 5. P3/P4 — Lock wait: row lock vs advisory lock

One contended resource, 10 ms application-side hold inside the transaction, 20 iterations per worker. Row lock = `SELECT … FOR UPDATE` on a single `CompanyFeatureEntitlement` row (the F1 "tenant entitlement rows are local" shape). Advisory = `pg_advisory_xact_lock(k)` on one key (the F1 gate-claim shape).

| Kind | Workers | Acquisitions | wait p50 | **p95** | p99 | max | Acq/sec |
|---|---:|---:|---:|---:|---:|---:|---:|
| row `FOR UPDATE` | 5 | 100 | 50.54 | 52.94 | 53.63 | 53.66 | 78.2 |
| row `FOR UPDATE` | 10 | 200 | 112.04 | **118.44** | 119.46 | 119.60 | 79.5 |
| row `FOR UPDATE` | 20 | 400 | 232.51 | 242.41 | 292.48 | 294.43 | 80.4 |
| advisory xact | 5 | 100 | 47.35 | 48.91 | 49.18 | 49.43 | 83.6 |
| advisory xact | 10 | 200 | 106.22 | **108.51** | 108.85 | 109.41 | 84.3 |
| advisory xact | 20 | 400 | 226.41 | 229.48 | 230.10 | 230.35 | 83.6 |

### 5.1 Findings

- **F8 — throughput on a contended key is pinned at `1 / (hold + ~2 ms)` regardless of everything else.** Acquisitions/sec is flat at 78–84 across N=5→20 for both lock kinds — a 4× increase in offered concurrency bought exactly zero additional throughput. Wait scales linearly: p95 ≈ (N−1) × ~12 ms. Adding claimers to a contended key adds only queueing.
- **F9 — advisory locks are marginally cheaper and much better-behaved in the tail.** ~5–8% lower p95, and a far tighter tail: at N=20 the row lock's p99−p50 spread is 60 ms against the advisory lock's 3.7 ms, with a 294 ms max against 230 ms. Row locking pays for tuple re-check and deadlock-detector participation. **Neither offers a throughput escape** — the hold time is 100% of the budget.
- **F10 — this directly validates the Plan §3 F1 locking split, with a number.** The plan requires that "tenant entitlement rows are local, while global gate claims use shared locks/equivalent conditional CAS … so many tenants do not serialize". The measurement makes the cost of getting that wrong concrete: **any single global exclusive lock caps the entire platform at ~80 acquisitions/sec at a 10 ms hold, no matter how many tenants or workers exist.** The only levers are (a) shrink the hold — never do I/O under the lock, (b) shard the key per `(companyId)` or per `(gateKey, routeKey)`, (c) use conditional CAS instead of a held lock. Switching lock *primitive* is not a lever.
- **F11 — no starvation.** PostgreSQL lock queues are FIFO; p50 and p99 are within 6% at N=10 for both kinds. Fairness is free, a fast path does not exist.

---

## 6. P5 — Outbox age scan (the F1 health-view query)

Synthetic pool mutated to a mixed-status distribution, then the age query run 30×.

| Status | Rows | max age (s) | p95 age (s) | stuck > 10 min |
|---|---:|---:|---:|---:|
| `PENDING` | 3,901 | 224,874 | 3,445 | 0 |
| `FAILED` | 500 | 3,687 | 3,438 | 0 |
| `PROCESSING` | 500 | 3,691 | 3,442 | **500** |
| `DEAD` | 100 | 3,655 | 3,406 | 0 |

(`PENDING` max age 224,874 s = the real 2.6-day row from §2, correctly picked up.)

Latency over 30 runs at 5,001 unpublished rows: **p50 4.18 ms, p95 6.15 ms, p99 8.63 ms**. Plan: `GroupAggregate → Sort → Seq Scan`, 3,260 buffers, 4.40 ms — a full scan of the unpublished set, because `status <> 'PUBLISHED'` is not an index-usable predicate.

- **F12 — the health view is O(unpublished backlog) at ~0.84 µs/row.** Fine at ≤100k unpublished (~85 ms extrapolated); a partial index on `status WHERE status <> 'PUBLISHED'`, or a maintained counter, is needed beyond that. Poll cadence should be ≥30 s, never per-request.
- **F13 — `PROCESSING` with a stale `lockedAt` is the in-flight signal, and nothing reclaims it.** `claimBatch` sets `lockedAt`/`lockedBy` but no code path ever reaps a `PROCESSING` row whose claimer died — grep confirms `claimBatch`/`markPublished`/`markFailed` appear only in the repository and the one drain use-case (`f0-inventory-async-surface.md` §6a). A crashed drain strands its batch in `PROCESSING` permanently: invisible to the claim predicate (`status IN ('PENDING','FAILED')`), invisible to `DEAD` handling, invisible to everything. The `stuck_over_10m` column above is the metric that would surface it; a lease-expiry reclaim is the F1 fix.

---

## 7. Recommendation — safe in-flight limits

Derived **only** from relative behaviour. Every absolute is a UAT-rerun input, not a committed threshold.

### 7.1 Gating decision (Plan §3 F0 / §7:219)

| Question the plan asks | Evidence | Answer |
|---|---|---|
| May a batch-claim design proceed? | §3 F1–F4 | **Not on the current claim.** Replace the non-atomic claim with the atomic form first; it is a prerequisite, not a co-requisite. |
| Is batching expensive? | §4 F5, F7 | No. Claim cost is O(backlog); batch size is free to the database. |
| What caps the batch, then? | §4 F7 | CLOSE-boundedness only (runbook R3 drain wait), per Plan §3 F1. |
| Is the F1 lock split necessary? | §5 F8, F10 | Yes, and quantified: any single global exclusive lock caps the platform at ~1/hold. |

### 7.2 Recommended limits (conservative, UAT-revisable)

1. **Per-attempt claim is the default.** Atomic claim removes double-claims entirely at equal-or-better throughput (0 vs 31,650 duplicate grants at N=10; 4.9× rows/sec). Adopt `UPDATE … WHERE id IN (SELECT … ORDER BY … LIMIT n FOR UPDATE SKIP LOCKED) RETURNING` (Appendix A, `claimAtomic`) before any batching work.
2. **Batch ≤ 25 (keep the current default) until the UAT rerun.** The database supports far more (§4), but no measurement of per-item *processing* time exists yet, and processing time — not claim time — sets the CLOSE drain wait. Do not raise the batch on the strength of this document.
3. **Concurrent drains ≤ 2, and only after the atomic claim ships.** The `workflow` worker already runs `concurrency: 2`, so N=2 is today's real exposure and today's 99.5% duplicate rate. Post-atomic, N=2–5 is where throughput scales best (8,668 → 17,744 rows/sec) before the tail degrades.
4. **Never hold an entitlement or gate lock across I/O.** Hold time is 100% of the throughput budget (§5 F8). Prefer conditional CAS on `setVersion`/`generation`; where a lock is required, shard by `(companyId)` or `(gateKey, routeKey)` and keep the critical section to local writes.
5. **Prefer advisory over row locks for the F1 gate claim.** Same throughput ceiling, ~5–8% lower p95, ~16× tighter tail at N=20. Choose it for tail predictability, not throughput.
6. **Health view polls at ≥30 s** (§6 F12), and must include `PROCESSING` age with a stale-`lockedAt` bucket (§6 F13).

### 7.3 Candidate thresholds for OPEN-6 — **PROPOSED, not ratified**

`docs/runbooks/feature-launch-control.md:317` names this lane as OPEN-6's evidence owner. These are shapes with placeholder numbers; the release owner ratifies after §8.

| Metric | Proposed alert | Basis | Confidence |
|---|---|---|---|
| Outbox claim p95 | warn > 50 ms, page > 250 ms | §4 linearity; 50 ms ≈ 100k backlog locally | Shape high, number LOW |
| Outbox eligible backlog | warn > 10k, page > 100k | §4 slope; beyond 100k claim latency dominates the 30 s period | Shape high, number LOW |
| Oldest `PENDING` age | warn > 15 min, page > 60 min | 30 s cadence → 30× / 120× the period. §2 B1 shows 2.6 days passing unnoticed | MEDIUM |
| `PROCESSING` with `lockedAt` older than 10 min | warn > 0 | §6 F13 — nothing reclaims these; any non-zero is a stranded batch | HIGH |
| `DEAD` rows | warn > 0 | No handler exists (`f0-inventory-async-surface.md` §10) | HIGH |
| Entitlement/gate lock wait p95 | warn > 150 ms, page > 500 ms | §5: 150 ms ≈ N≈13 queued at a 10 ms hold | Shape high, number LOW |
| Duplicate grants per drain | **page > 0** | §3: atomic claim makes 0 the invariant, not a target | HIGH |

Everything marked "number LOW" is local-absolute and **must** be re-derived from §8 before it goes into an alarm.

### 7.4 Out of scope for this lane (F1 candidates, recorded not applied)

- Atomic claim rewrite (`prisma-outbox.repository.ts:46-71`) — code change.
- Index matching the claim order, or removal of the inert `priority` sort key (§4 F6) — schema change.
- `PROCESSING` lease expiry / reclaim (§6 F13) — new behaviour.
- Outbox `DEAD` reconciler — already tracked as OPEN-5 / T14 in the runbook.

---

## 8. UAT / prod rerun runbook — **DEFERRED (owner ops approval required)**

**Not executed. Do not execute without explicit owner ops approval.** The local numbers in §3–§6 are ratios and shapes; the absolutes in §7.3 need a rerun on RDS before any alarm is configured.

### 8.1 Approval gate

| | |
|---|---|
| Approver | Release owner + ops owner (the same pair that owns OPEN-6) |
| Environment | **UAT first.** Production only if UAT ratios diverge from §3–§6 by more than ~2×, and then read-only probes (§8.4 P6, P5-`EXPLAIN`) exclusively |
| Window | Off-peak; the seed writes 5,000 rows and the claim probe rewrites them ~8× |
| Blast radius | One synthetic company + its rows. The claim probe mutates **only** rows matching the marker (§1.2) |
| Rollback | `cleanup` mode; it prints before/after counts and a residue check (§8.5) |

### 8.2 Preconditions

1. Confirm the target `DATABASE_URL` (never a shared production reader endpoint).
2. Confirm no migration is mid-flight and no deploy is in progress.
3. Confirm the `workflow` worker's `outbox.drain` state. **On UAT, pause the workers service for the duration** — a live drain competing with the probe corrupts both the double-claim count and the baseline.
4. Record `select version()`, instance class, `max_connections`, and whether PgBouncer sits in front. All three change the interpretation.
5. Capture §8.4 P6 (baseline) **before** anything else.

### 8.3 Safety protocol (identical to this run)

- One synthetic company, unique timestamp marker, all rows attached to it.
- Before/after counts of every touched table, printed by the script.
- No DDL, no `ALTER`, no index creation, no existing row modified.
- Cleanup deletes `OutboxEvent` **first** — `OutboxEvent_companyId_fkey` is `ON DELETE SET NULL`, so deleting the company first orphans 5,000 rows to `companyId = NULL` instead of removing them.
- On any mid-way failure: run `cleanup` before reporting anything.

### 8.4 Exact sequence

```bash
export PATH=/path/to/node/bin:$PATH
export NODE_PATH=<repo>/apps/api/node_modules          # provides `pg`
export DATABASE_URL='<target>'                          # NEVER apps/api/.env
cd <dir containing f0e-capacity.js>                     # Appendix A

MARKER="F0E-CAPACITY-PROBE-$(date +%s)"; echo "$MARKER" | tee MARKER

node f0e-capacity.js baseline                > 00-baseline.txt   # P6, read-only
node f0e-capacity.js seed    "$MARKER" 5000  > 01-seed.txt       # before/after counts
node f0e-capacity.js claim   "$MARKER"       > 02-claim.txt      # P1
node f0e-capacity.js scale   "$MARKER"       > 03-scale.txt      # P2
node f0e-capacity.js lock    "$MARKER"       > 04-lock.txt       # P3 + P4
node f0e-capacity.js age     "$MARKER"       > 05-age.txt        # P5
node f0e-capacity.js cleanup "$MARKER"       > 06-cleanup.txt    # MANDATORY
```

Then resume the workers service and re-run `baseline`, confirming the counts equal `00-baseline.txt`.

### 8.5 Exit criteria

- `06-cleanup.txt` shows `probeOutboxRowsRemaining: 0`, `probeCompaniesRemaining: 0`, and every count back to the `00-baseline.txt` value.
- No `OutboxEvent` row has `companyId IS NULL` that did not have it before.
- The pre-existing rows' `updatedAt` values are unchanged (proof nothing real was written).

### 8.6 What the rerun must answer

1. Do the §3 **ratios** hold on RDS — duplicate grants still ~0 vs thousands, atomic still ≥ non-atomic above N=2? If yes, §7.1–§7.2 stand as written.
2. Is the §4 slope still **linear**, and what is the real µs/row? This sets the backlog thresholds in §7.3.
3. Does the §5 acquisitions/sec ceiling still equal `1/(hold + overhead)`, and what is the RDS overhead term? This sets the lock-wait thresholds.
4. What is the real per-item **processing** time in the drain (not measured by this lane, and the actual input to the batch cap in §7.2 item 2)?
5. Do UAT/prod carry stuck `PROCESSING` or `DEAD` rows (§6 F13, §2 B1)? Any non-zero is a pre-existing incident, not a probe artefact.

---

## 9. Cleanup verification (this run)

Executed at the end of the local run. Verbatim output:

```
## deleted { outboxEvents: 5000, entitlements: 4, companies: 1 }
```

| Table | Baseline (pre-seed) | Peak (post-seed) | After cleanup | Returned to baseline |
|---|---:|---:|---:|:--:|
| `Company` | 5 | 6 | 5 | yes |
| `CompanyFeatureEntitlement` | 12 | 16 | 12 | yes |
| `OutboxEvent` | 96 | 5,096 | 96 | yes |
| `WorkflowEventInbox` | 95 | 95 | 95 | yes (never touched) |
| `WorkflowRun` | 25 | 25 | 25 | yes (never touched) |
| `WorkflowActionRun` | 16 | 16 | 16 | yes (never touched) |
| `WorkflowDeadLetter` | 0 | 0 | 0 | yes (never touched) |
| `WorkflowTask` | 4 | 4 | 4 | yes (never touched) |

```
## residue check { probeOutboxRowsRemaining: 0, probeCompaniesRemaining: 0 }
```

Independent post-cleanup verification that no real row was modified:

| Check | Result |
|---|---|
| `OutboxEvent` by status | 1 `PENDING`, 95 `PUBLISHED` — identical to baseline |
| Newest `updatedAt` across all `OutboxEvent` | `2026-07-28 20:57:12` — **3 days before this probe**, so no real row was written |
| Rows with `lockedBy IS NOT NULL` | 0 |
| Rows orphaned to `companyId IS NULL` | 0 |
| Companies remaining | the same 5 seed/probe companies, no `F0E-` row |

**Cleanup verified: yes.** No DDL was executed, no existing row was modified, and no `apps/` file or git object was written by this lane.

---

## Appendix A — probe script (embedded verbatim)

Reproduces every number above. Kept at `scratchpad/f0/capacity/f0e-capacity.js` for this run; embedded here so the §8 rerun needs no scratchpad. Requires only `pg`.

```js
#!/usr/bin/env node
/**
 * F0.E capacity probe — outbox claim / row-lock / advisory-lock / age-scan evidence.
 * Read-only on every non-synthetic row. No DDL. No schema change.
 *
 * Usage (DATABASE_URL from repo ROOT .env):
 *   node f0e-capacity.js baseline
 *   node f0e-capacity.js seed    <marker> [rows]
 *   node f0e-capacity.js claim   <marker>
 *   node f0e-capacity.js lock    <marker>
 *   node f0e-capacity.js age     <marker>
 *   node f0e-capacity.js scale   <marker>
 *   node f0e-capacity.js cleanup <marker>
 *
 * <marker> is the synthetic tenant tag, e.g. F0E-CAPACITY-PROBE-1753900000000.
 * Company.id  = 'f0e-' + marker      Company.name = marker
 * OutboxEvent.eventKey LIKE marker || ':%'   aggregateType = 'F0ECapacityProbe'
 */
const { Client } = require('pg');

const DSN = process.env.DATABASE_URL;
if (!DSN) throw new Error('DATABASE_URL not set');
const MODE = process.argv[2];
const MARKER = process.argv[3];
const SEED_ROWS = Number(process.argv[4] ?? 5000);
const coId = (m) => `f0e-${m}`;

const nc = async () => { const c = new Client({ connectionString: DSN }); await c.connect(); return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hr = () => Number(process.hrtime.bigint()) / 1e6; // ms, monotonic
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)] : NaN);
const r2 = (n) => Math.round(n * 100) / 100;
const stats = (a) => ({ n: a.length, p50: r2(pct(a, 50)), p95: r2(pct(a, 95)), p99: r2(pct(a, 99)), max: r2(Math.max(...a)) });

// ---------------------------------------------------------------- baseline
const COUNT_TABLES = ['Company', 'CompanyFeatureEntitlement', 'OutboxEvent', 'WorkflowEventInbox',
  'WorkflowRun', 'WorkflowActionRun', 'WorkflowDeadLetter', 'WorkflowTask'];

async function counts(c) {
  const out = {};
  for (const t of COUNT_TABLES) out[t] = Number((await c.query(`select count(*) n from "${t}"`)).rows[0].n);
  return out;
}

async function baseline() {
  const c = await nc();
  console.log('## table row counts'); console.table(await counts(c));
  console.log('## OutboxEvent by status (+ age of oldest unpublished)');
  console.table((await c.query(`select status, count(*)::int rows,
      min("availableAt") oldest_available_at,
      round(extract(epoch from (now() - min("availableAt")))/86400.0, 2) oldest_age_days
    from "OutboxEvent" group by status order by status`)).rows);
  console.log('## WorkflowActionRun by status');
  console.table((await c.query(`select status, count(*)::int rows from "WorkflowActionRun" group by status order by status`)).rows);
  console.log('## WorkflowEventInbox by status');
  console.table((await c.query(`select status, count(*)::int rows from "WorkflowEventInbox" group by status order by status`)).rows);
  console.log('## EXPLAIN ANALYZE — REAL unscoped claim SELECT (read-only, production predicate)');
  for (const row of (await c.query(`explain (analyze, buffers, costs off)
      select * from "OutboxEvent" where status in ('PENDING','FAILED') and "availableAt" <= now()
      order by priority desc, "availableAt" asc limit 25`)).rows) console.log('   ' + row['QUERY PLAN']);
  await c.end();
}

// ---------------------------------------------------------------- seed
async function seed() {
  const c = await nc();
  const before = await counts(c);
  await c.query(`insert into "Company" (id,name,status,"createdAt","updatedAt","timezone","locale","baseCurrency")
                 values ($1,$2,'ACTIVE',now(),now(),'Asia/Bangkok','th-TH','THB')`, [coId(MARKER), MARKER]);
  for (const k of ['workflow_automation', 'crm', 'expenses', 'thai_tax'])
    await c.query(`insert into "CompanyFeatureEntitlement" (id,"companyId","featureKey",enabled,"createdAt","updatedAt")
                   values ($1,$2,$3,true,now(),now())`, [`f0e-ent-${MARKER}-${k}`, coId(MARKER), k]);

  // 100% NORMAL priority: 98 producer call sites, 0 priority overrides (verified by grep).
  // availableAt spread over the past hour so the `availableAt ASC` tiebreak and the age
  // scan are both non-degenerate.
  const CHUNK = 500;
  for (let base = 0; base < SEED_ROWS; base += CHUNK) {
    const vals = [], params = [];
    for (let i = base; i < Math.min(base + CHUNK, SEED_ROWS); i++) {
      const o = params.length;
      vals.push(`($${o + 1},$${o + 2},$${o + 3},'F0ECapacityProbe',$${o + 4},$${o + 5},$${o + 6}::jsonb,'PENDING','NORMAL',0,now() - ($${o + 7}::int * interval '1 second'),now(),now())`);
      params.push(`f0e_${MARKER}_${i}`, coId(MARKER), 'probe.event.created', `agg_${i}`,
        `${MARKER}:${i}`,
        JSON.stringify({ companyId: coId(MARKER), occurredAt: new Date().toISOString(), data: { seq: i, note: 'f0e capacity probe' } }),
        i % 3600);
    }
    await c.query(`insert into "OutboxEvent"
      (id,"companyId","eventType","aggregateType","aggregateId","eventKey","payloadJson",status,priority,attempts,"availableAt","createdAt","updatedAt")
      values ${vals.join(',')}`, params);
  }
  const after = await counts(c);
  console.log('## before'); console.table(before);
  console.log('## after'); console.table(after);
  console.log('## delta'); console.table(Object.fromEntries(COUNT_TABLES.map((t) => [t, after[t] - before[t]])));
  await c.end();
}

// ---------------------------------------------------------------- claim probes
// Both variants carry `AND "companyId" = $co` so no real row is ever mutated. The real
// query is cross-tenant; the added equality is a SAFETY deviation, identical in both
// variants, so the A/B comparison stays valid.
const WHERE = `status in ('PENDING','FAILED') and "availableAt" <= $1 and "companyId" = $2`;

async function reset(c) {
  await c.query(`update "OutboxEvent" set status='PENDING', "lockedAt"=null, "lockedBy"=null, attempts=0,
                 "publishedAt"=null, "updatedAt"=now() where "companyId"=$1`, [coId(MARKER)]);
}

/** Real shape: findMany then a separate unconditional updateMany. Two statements, autocommit. */
async function claimNonAtomic(c, who, batch) {
  const t0 = hr();
  const sel = await c.query(`select id from "OutboxEvent" where ${WHERE}
      order by priority desc, "availableAt" asc limit $3`, [new Date(), coId(MARKER), batch]);
  const tSel = hr();
  if (sel.rows.length === 0) return { ids: [], total: tSel - t0, window: 0 };
  await c.query(`update "OutboxEvent" set status='PROCESSING', "lockedAt"=now(), "lockedBy"=$2, "updatedAt"=now()
      where id = any($1::text[])`, [sel.rows.map((r) => r.id), who]);
  const t1 = hr();
  return { ids: sel.rows.map((r) => r.id), total: t1 - t0, window: t1 - tSel };
}

/** F1 candidate: one statement, FOR UPDATE SKIP LOCKED, RETURNING. */
async function claimAtomic(c, who, batch) {
  const t0 = hr();
  const res = await c.query(`update "OutboxEvent" o set status='PROCESSING', "lockedAt"=now(), "lockedBy"=$4, "updatedAt"=now()
      where o.id in (select id from "OutboxEvent" where ${WHERE}
                     order by priority desc, "availableAt" asc limit $3 for update skip locked)
      returning o.id`, [new Date(), coId(MARKER), batch, who]);
  return { ids: res.rows.map((r) => r.id), total: hr() - t0, window: 0 };
}

async function drainRun(fn, workers, batch, label) {
  const cs = await Promise.all(Array.from({ length: workers }, nc));
  await reset(cs[0]);
  const seen = new Map(); const lat = []; const win = []; let calls = 0;
  const t0 = hr();
  await Promise.all(cs.map(async (c, w) => {
    for (;;) {
      const r = await fn(c, `w${w}`, batch);
      calls++; lat.push(r.total); if (r.window) win.push(r.window);
      if (r.ids.length === 0) return;
      for (const id of r.ids) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }));
  const wall = hr() - t0;
  const distinct = seen.size;
  const grants = [...seen.values()].reduce((a, b) => a + b, 0);
  const dupRows = [...seen.values()].filter((v) => v > 1).length;
  await Promise.all(cs.map((c) => c.end()));
  return {
    variant: label, workers, batch, calls,
    distinctRowsClaimed: distinct, totalGrants: grants,
    doubleClaimedRows: dupRows, duplicateGrants: grants - distinct,
    wallMs: r2(wall), rowsPerSec: r2((distinct / wall) * 1000),
    claimP50: stats(lat).p50, claimP95: stats(lat).p95, claimP99: stats(lat).p99,
    raceWindowP95: win.length ? stats(win).p95 : 0, raceWindowP99: win.length ? stats(win).p99 : 0,
  };
}

async function claim() {
  const rows = [];
  for (const b of [20, 50, 100]) rows.push(await drainRun(claimNonAtomic, 1, b, 'non-atomic (current)'));
  for (const b of [20, 50, 100]) rows.push(await drainRun(claimAtomic, 1, b, 'atomic SKIP LOCKED'));
  console.log('## single claimer'); console.table(rows);
  const con = [];
  for (const n of [2, 5, 10]) con.push(await drainRun(claimNonAtomic, n, 25, 'non-atomic (current)'));
  for (const n of [2, 5, 10]) con.push(await drainRun(claimAtomic, n, 25, 'atomic SKIP LOCKED'));
  console.log('## concurrent claimers, batch 25 (= production DrainWorkflowOutboxUseCase default)');
  console.table(con);
  const c = await nc(); await reset(c); await c.end();
}

// ---------------------------------------------------------------- lock probes
async function lockRun(kind, workers, iters, holdMs, rowId) {
  const cs = await Promise.all(Array.from({ length: workers }, nc));
  const waits = [];
  const t0 = hr();
  await Promise.all(cs.map(async (c) => {
    for (let i = 0; i < iters; i++) {
      await c.query('begin');
      const a = hr();
      if (kind === 'row') await c.query(`select id from "CompanyFeatureEntitlement" where id=$1 for update`, [rowId]);
      else await c.query(`select pg_advisory_xact_lock($1)`, [987654321]);
      waits.push(hr() - a);
      await sleep(holdMs);
      await c.query('commit');
    }
  }));
  const wall = hr() - t0;
  await Promise.all(cs.map((c) => c.end()));
  const s = stats(waits);
  return { kind, workers, iters, holdMs, acquisitions: s.n, waitP50: s.p50, waitP95: s.p95, waitP99: s.p99, waitMax: s.max, wallMs: r2(wall), acqPerSec: r2((s.n / wall) * 1000) };
}

async function lock() {
  const rowId = `f0e-ent-${MARKER}-workflow_automation`;
  const out = [];
  for (const n of [5, 10, 20]) out.push(await lockRun('row', n, 20, 10, rowId));
  for (const n of [5, 10, 20]) out.push(await lockRun('advisory', n, 20, 10, rowId));
  console.log('## lock acquisition wait, 10ms hold, one contended resource'); console.table(out);
}

// ---------------------------------------------------------------- age scan
async function age() {
  const c = await nc();
  // Mixed statuses across the synthetic pool so the health-view query is non-degenerate.
  await c.query(`update "OutboxEvent" set status='FAILED', attempts=2, "updatedAt"=now()
                 where "companyId"=$1 and (substring(id from '[0-9]+$'))::int % 10 = 3`, [coId(MARKER)]);
  await c.query(`update "OutboxEvent" set status='PROCESSING', "lockedAt"=now()-interval '11 minutes', "lockedBy"='stuck-worker', "updatedAt"=now()
                 where "companyId"=$1 and (substring(id from '[0-9]+$'))::int % 10 = 7`, [coId(MARKER)]);
  await c.query(`update "OutboxEvent" set status='DEAD', attempts=5, "updatedAt"=now()
                 where "companyId"=$1 and (substring(id from '[0-9]+$'))::int % 50 = 11`, [coId(MARKER)]);

  const Q = `select status, count(*)::int rows,
      round(extract(epoch from max(now() - "availableAt")))::int max_age_s,
      round(percentile_disc(0.95) within group (order by extract(epoch from (now() - "availableAt"))))::int p95_age_s,
      count(*) filter (where status='PROCESSING' and "lockedAt" < now() - interval '10 minutes')::int stuck_over_10m
    from "OutboxEvent" where status <> 'PUBLISHED' group by status order by status`;
  const lat = [];
  let last;
  for (let i = 0; i < 30; i++) { const a = hr(); last = await c.query(Q); lat.push(hr() - a); }
  console.log('## outbox age distribution (F1 health-view query)'); console.table(last.rows);
  console.log('## age-scan latency over 30 runs (ms)'); console.table([stats(lat)]);
  for (const row of (await c.query('explain (analyze, buffers, costs off) ' + Q)).rows) console.log('   ' + row['QUERY PLAN']);
  await c.query(`update "OutboxEvent" set status='PENDING', attempts=0, "lockedAt"=null, "lockedBy"=null, "updatedAt"=now() where "companyId"=$1`, [coId(MARKER)]);
  await c.end();
}

// ---------------------------------------------------------------- backlog scaling
// The claim SELECT is a Seq Scan + top-N heapsort of the whole eligible set (the
// (status,availableAt,priority) index cannot serve `ORDER BY priority DESC, availableAt ASC`).
// Claim cost is therefore O(backlog), not O(batch). Measure the curve.
async function scale() {
  const c = await nc();
  const out = [];
  for (const depth of [100, 250, 500, 1000, 2500, 5000]) {
    await c.query(`update "OutboxEvent" set status = case when (substring(id from '[0-9]+$'))::int < $2
                     then 'PENDING'::"OutboxEventStatus" else 'PUBLISHED'::"OutboxEventStatus" end,
                   "updatedAt"=now() where "companyId"=$1`, [coId(MARKER), depth]);
    await c.query(`analyze "OutboxEvent"`);
    for (const batch of [25, 100]) {
      const lat = [];
      for (let i = 0; i < 40; i++) {
        const a = hr();
        await c.query(`select id from "OutboxEvent" where ${WHERE} order by priority desc, "availableAt" asc limit $3`,
          [new Date(), coId(MARKER), batch]);
        lat.push(hr() - a);
      }
      const s = stats(lat);
      out.push({ eligibleBacklog: depth, batch, selectP50: s.p50, selectP95: s.p95, selectP99: s.p99,
        usPerBacklogRowP95: r2((s.p95 * 1000) / depth) });
    }
  }
  console.log('## claim SELECT latency vs eligible backlog depth'); console.table(out);
  await reset(c); await c.query(`analyze "OutboxEvent"`); await c.end();
}

// ---------------------------------------------------------------- cleanup
async function cleanup() {
  const c = await nc();
  const before = await counts(c);
  // OutboxEvent.companyId FK is ON DELETE SET NULL — delete events FIRST or they orphan.
  const ev = await c.query(`delete from "OutboxEvent" where "aggregateType"='F0ECapacityProbe' and "eventKey" like $1`, [`${MARKER}:%`]);
  const ent = await c.query(`delete from "CompanyFeatureEntitlement" where "companyId"=$1`, [coId(MARKER)]);
  const co = await c.query(`delete from "Company" where id=$1 and name=$2`, [coId(MARKER), MARKER]);
  const after = await counts(c);
  console.log('## deleted', { outboxEvents: ev.rowCount, entitlements: ent.rowCount, companies: co.rowCount });
  console.log('## counts before cleanup'); console.table(before);
  console.log('## counts after cleanup'); console.table(after);
  const orphan = Number((await c.query(`select count(*) n from "OutboxEvent" where "aggregateType"='F0ECapacityProbe'`)).rows[0].n);
  const leftCo = Number((await c.query(`select count(*) n from "Company" where name like 'F0E-CAPACITY-PROBE-%'`)).rows[0].n);
  console.log('## residue check', { probeOutboxRowsRemaining: orphan, probeCompaniesRemaining: leftCo });
  await c.end();
}

const run = { baseline, seed, claim, lock, age, scale, cleanup }[MODE];
if (!run) { console.error('modes: baseline seed claim lock age scale cleanup'); process.exit(1); }
run().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
```

## Appendix B — verification SQL (read-only, for §8.5)

```sql
-- real rows untouched: newest updatedAt must predate the probe window
select status, count(*), max("updatedAt") as newest_updated_at
from "OutboxEvent" group by status order by 1;

-- no orphaning by the ON DELETE SET NULL FK, no stranded claim
select count(*) filter (where "lockedBy" is not null)  as any_locked,
       count(*) filter (where "companyId" is null)     as orphaned_null_company
from "OutboxEvent";

-- no synthetic residue
select id, name, status from "Company" where name like 'F0E-CAPACITY-PROBE-%';
select count(*) from "OutboxEvent" where "aggregateType" = 'F0ECapacityProbe';
```
