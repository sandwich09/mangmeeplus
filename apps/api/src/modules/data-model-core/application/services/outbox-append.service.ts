import { createHash } from 'node:crypto';
import type { Prisma } from '../../../../generated/prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import { LOGGER_TOKEN, type AppLogger } from '../../../../common/logger/logger.service';
import { PrismaOutboxRepository } from '../../infrastructure/repositories/prisma-outbox.repository';
import type { CoreOutboxPayload } from '@watchdog-bms/contracts';

/** Alarm-keyed event name for an outbox append that could not be persisted (L-10/L-14). */
export const OUTBOX_APPEND_FAILED_EVENT = 'outbox.append.failed';

/** Deterministic JSON: keys sorted at every depth so the fingerprint is retry-stable. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    // Honour `toJSON` the way JSON.stringify does. Without this a Date has no own
    // enumerable keys and canonicalizes to `{}`, so two events differing only in a
    // date-valued field would share a fingerprint and the second would be dropped.
    const toJson = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJson === 'function') {
      const plain = (toJson as () => unknown).call(value);
      if (plain !== value) return canonicalJson(plain);
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Idempotency key for an append that carries no requestId.
 *
 * Scope is **one occurrence**, not all time: the caller's own `occurredAt` — computed once
 * per use-case execution and carried in the payload — stamps the occurrence, so re-appending
 * the same payload de-duplicates while a legitimately recurring identical event (assign,
 * unassign, assign again) gets its own row instead of being silently dropped forever.
 *
 * Still no clock read and no randomness *inside* this function: the fingerprint is a pure
 * function of the append's arguments, so it is reproducible from the stored payload alone —
 * which is what the old `Date.now()` fallback got wrong (it never de-duplicated at all).
 */
export function outboxEventFingerprint(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: CoreOutboxPayload,
): string {
  return createHash('sha256')
    .update(canonicalJson({
      eventType,
      aggregateType,
      aggregateId,
      companyId: payload.companyId ?? null,
      actorUserId: payload.actorUserId ?? null,
      occurredAt: payload.occurredAt ?? null,
      data: payload.data,
    }))
    .digest('hex')
    .slice(0, 32);
}

@Injectable()
export class OutboxAppendService {
  constructor(
    private readonly outbox: PrismaOutboxRepository,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  async append(
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: CoreOutboxPayload,
    priority: 'LOW' | 'NORMAL' | 'HIGH' = 'NORMAL',
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const idempotencyPart = payload.requestId ?? outboxEventFingerprint(eventType, aggregateType, aggregateId, payload);
    const eventKey = `${eventType}:${aggregateType}:${aggregateId}:${idempotencyPart}`;
    try {
      await this.outbox.append({
        companyId: payload.companyId,
        eventType,
        aggregateType,
        aggregateId,
        eventKey,
        payloadJson: payload as unknown as Record<string, unknown>,
        priority,
      }, tx);
    } catch (error) {
      // A caller-owned transaction must roll back its state change when its notification fails.
      if (tx) throw error;
      // Callers `void` this today, so re-throwing would surface as an unhandled
      // rejection instead of a rollback. Make the loss investigable instead.
      this.logger.error(
        {
          event: OUTBOX_APPEND_FAILED_EVENT,
          // L-14: root-level riskLevel — the production metric filter keys on `$.riskLevel`,
          // so without it a lost event surfaces to nobody.
          riskLevel: 'HIGH',
          eventType,
          aggregateType,
          aggregateId,
          // The `OutboxEvent.eventKey` column value, named without the substring `key`:
          // L-09 redaction matches `key` and would ship the one investigable field as
          // `[REDACTED]`. No other field here collides with that pattern.
          eventDedupeId: eventKey,
          requestId: payload.requestId,
          err: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
        },
        OUTBOX_APPEND_FAILED_EVENT,
      );
    }
  }
}
