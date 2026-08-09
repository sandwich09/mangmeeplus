import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { OutboxRepositoryPort } from '../../domain/ports/outbox-repository.port';
import type {
  OutboxEventRecord,
  AppendOutboxEventInput,
  ClaimOutboxBatchInput,
  MarkOutboxPublishedInput,
  MarkOutboxFailedInput,
} from '../../domain/models/outbox.model';
import { redactOutboxPayload, validateOutboxPayload } from '../../domain/logic/outbox.logic';

/** F0.E §7.2 item 2 — caller-controlled below this, capped here so an emergency CLOSE stays bounded. */
export const MAX_OUTBOX_CLAIM_BATCH = 25;
/** Attempts after which a row is poison. Shared by `markFailed` and the lease reclaim. */
export const MAX_OUTBOX_ATTEMPTS = 5;
/**
 * Conservative: the only consumer is driven every 30s with batch 25, so any real drain releases its
 * rows orders of magnitude sooner. Long enough that a slow-but-alive claimer is never stolen from.
 */
export const OUTBOX_PROCESSING_LEASE_MS = 5 * 60_000;
export const OUTBOX_LEASE_EXPIRED_ERROR = 'outbox lease expired: claimer did not finish';

@Injectable()
export class PrismaOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: AppendOutboxEventInput): Promise<OutboxEventRecord> {
    const validationError = validateOutboxPayload(input.payloadJson);
    if (validationError) throw new Error(validationError);

    const safePayload = redactOutboxPayload(input.payloadJson);

    // Idempotent: skip if eventKey already exists
    const existing = await this.prisma.client.outboxEvent.findUnique({
      where: { eventKey: input.eventKey },
    });
    if (existing) return this.toRecord(existing);

    const row = await this.prisma.client.outboxEvent.create({
      data: {
        companyId: input.companyId,
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventKey: input.eventKey,
        payloadJson: safePayload as any,
        headersJson: (input.headersJson ?? undefined) as any,
        priority: input.priority as any ?? 'NORMAL',
        availableAt: input.availableAt ?? new Date(),
        status: 'PENDING',
      },
    });
    return this.toRecord(row);
  }

  /**
   * One statement, `FOR UPDATE SKIP LOCKED`, `RETURNING` — same result contract as before.
   *
   * The previous `findMany` → `updateMany` pair ran outside any transaction and the update's only
   * predicate was `id IN (…)`: it never re-checked `status`, so a second claimer that had read the
   * same rows also "won" them. Measured in `docs/agent-memory/f0-capacity-evidence.md` §3:
   * 99.5–100% of rows double-claimed at N>=2 claimers (the `workflow` worker already runs
   * `concurrency: 2`), 0 with this form, at 4.9x the throughput at N=10.
   *
   * `priority` is deliberately absent from the ORDER BY. All 98 `OutboxAppendService.append` call
   * sites take the `'NORMAL'` default — no producer sets it — so the key is inert, while sorting on
   * it forces the O(backlog) sort that F0.E §4 F5/F6 measured. Reinstate it only together with an
   * index that can actually serve `priority DESC, availableAt ASC`.
   *
   * P0-4: the same statement mints one fencing token per row. `gen_random_uuid()` is VOLATILE, so
   * every claimed row gets its own — the token is the lease identity every completion CASes on.
   */
  async claimBatch(input: ClaimOutboxBatchInput): Promise<OutboxEventRecord[]> {
    // F0.E §7.2 item 2: the database supports far more, but per-item *processing* time — not claim
    // time — sets the emergency-CLOSE drain wait, and that is unmeasured until the UAT rerun.
    const batchSize = Math.max(1, Math.min(Math.trunc(input.batchSize) || 1, MAX_OUTBOX_CLAIM_BATCH));
    if (input.eventTypes?.length && input.excludeEventTypes?.length) {
      throw new Error('Outbox claim cannot include and exclude event types at the same time.');
    }
    const eventTypeFilter = input.eventTypes?.length
      ? Prisma.sql`AND "eventType" IN (${Prisma.join(input.eventTypes)})`
      : input.excludeEventTypes?.length
        ? Prisma.sql`AND "eventType" NOT IN (${Prisma.join(input.excludeEventTypes)})`
        : Prisma.empty;
    const rows = await this.prisma.client.$queryRaw<any[]>(Prisma.sql`
      UPDATE "OutboxEvent" o
      SET status = 'PROCESSING', "lockedAt" = now(), "lockedBy" = ${input.claimedBy},
          "claimToken" = gen_random_uuid()::text, "updatedAt" = now()
      WHERE o.id IN (
        SELECT id FROM "OutboxEvent"
        WHERE status IN ('PENDING', 'FAILED') AND "availableAt" <= now()
        ${eventTypeFilter}
        ORDER BY "availableAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING o.*
    `);
    return rows.map((row) => this.toRecord(row));
  }

  /**
   * Lease-expiry reclaim (F0.E §6 F13): `claimBatch` stamps `lockedAt`/`lockedBy`, but nothing ever
   * reaped a `PROCESSING` row whose claimer died. Such a row is invisible to the claim predicate,
   * to `DEAD` handling and to every alert — a crashed drain stranded its batch permanently.
   *
   * Returning it to PENDING with `attempts + 1` reuses the existing `markFailed` exhaustion rule, so
   * a row that keeps killing its claimer terminalizes at DEAD instead of looping forever. Only
   * `PROCESSING` rows are in scope, so a DEAD row is never resurrected.
   *
   * P0-4: clearing `claimToken` is what actually revokes the dead claimer's lease — if it ever wakes
   * up, its completion CAS matches zero rows instead of overwriting the new claimer's work.
   */
  async reclaimStalledProcessing(now = new Date()): Promise<{ reclaimed: number; dead: number }> {
    const cutoff = new Date(now.getTime() - OUTBOX_PROCESSING_LEASE_MS);
    const rows = await this.prisma.client.$queryRaw<Array<{ status: string }>>(Prisma.sql`
      UPDATE "OutboxEvent"
      SET status = CASE WHEN attempts + 1 >= ${MAX_OUTBOX_ATTEMPTS} THEN 'DEAD'::"OutboxEventStatus"
                        ELSE 'PENDING'::"OutboxEventStatus" END,
          attempts = attempts + 1,
          "lastError" = ${OUTBOX_LEASE_EXPIRED_ERROR},
          "lockedAt" = NULL, "lockedBy" = NULL, "claimToken" = NULL, "updatedAt" = now()
      WHERE status = 'PROCESSING' AND "lockedAt" < ${cutoff}
      RETURNING status
    `);
    return {
      reclaimed: rows.filter((row) => row.status === 'PENDING').length,
      dead: rows.filter((row) => row.status === 'DEAD').length,
    };
  }

  /** Observability only — the reconciler UX is post-F1. */
  countDead(): Promise<number> {
    return this.prisma.client.outboxEvent.count({ where: { status: 'DEAD' } });
  }

  /**
   * P0-4 — completion is a CAS on {id, PROCESSING, claimToken}, never `update` by id. A worker whose
   * lease was reclaimed (or whose row was re-claimed by someone else) matches zero rows and returns
   * `false`; the caller logs it and does nothing. Never throws: a lost lease is an expected outcome
   * of the reclaim, not an error, and throwing would turn one stall into a retry storm.
   *
   * `claimToken: null` is a real predicate (`IS NULL` in SQL), so a row claimed before this column
   * existed still completes exactly once.
   */
  async markPublished(input: MarkOutboxPublishedInput): Promise<boolean> {
    const cas = await this.prisma.client.outboxEvent.updateMany({
      where: {
        id: input.id,
        status: 'PROCESSING',
        claimToken: input.claimToken ?? null,
        ...(input.expectedEventType ? { eventType: input.expectedEventType } : {}),
      },
      data: { status: 'PUBLISHED', publishedAt: new Date(), lockedAt: null, lockedBy: null, claimToken: null },
    });
    return cas.count === 1;
  }

  async markFailed(input: MarkOutboxFailedInput): Promise<boolean> {
    const row = await this.prisma.client.outboxEvent.findUnique({
      where: { id: input.id },
      select: { attempts: true, eventType: true },
    });
    if (!row || (input.expectedEventType && row.eventType !== input.expectedEventType)) return false;
    const nextAttempts = row.attempts + 1;
    const isDead = nextAttempts >= MAX_OUTBOX_ATTEMPTS;
    const backoffMs = Math.min(Math.pow(2, nextAttempts) * 1000, 300_000);
    const nextAvailableAt = input.nextAvailableAt ?? new Date(Date.now() + backoffMs);

    // The DEAD branch is the park: same fence, so a stale worker cannot park a live row either.
    const cas = await this.prisma.client.outboxEvent.updateMany({
      where: {
        id: input.id,
        status: 'PROCESSING',
        claimToken: input.claimToken ?? null,
        ...(input.expectedEventType ? { eventType: input.expectedEventType } : {}),
      },
      data: {
        status: isDead ? 'DEAD' : 'FAILED',
        attempts: nextAttempts,
        lastError: input.error,
        availableAt: nextAvailableAt,
        lockedAt: null,
        lockedBy: null,
        claimToken: null,
      },
    });
    return cas.count === 1;
  }

  private toRecord(row: any): OutboxEventRecord {
    return {
      id: row.id,
      companyId: row.companyId ?? undefined,
      eventType: row.eventType,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      eventKey: row.eventKey,
      payloadJson: row.payloadJson as Record<string, unknown>,
      headersJson: row.headersJson as Record<string, unknown> | undefined,
      status: row.status as any,
      priority: row.priority as any,
      attempts: row.attempts,
      availableAt: row.availableAt,
      lockedAt: row.lockedAt ?? undefined,
      lockedBy: row.lockedBy ?? undefined,
      claimToken: row.claimToken ?? undefined,
      publishedAt: row.publishedAt ?? undefined,
      lastError: row.lastError ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
