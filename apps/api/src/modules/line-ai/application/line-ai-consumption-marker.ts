/**
 * Durable markers for LINE intake consumption and correction idempotency (spec §8/§10).
 *
 * Why not Redis alone: `LineAiLedgerService.ack()` returns void, no-ops when Redis is absent,
 * and swallows an `XACK` error into a warn log. A swallowed ack after a committed mutation is
 * enough for the next message to inherit the same clarification and re-apply it — the original
 * duplicate-draft incident, no crash required. So the durable record of "this clarification was
 * consumed" / "this correction was applied" lives in Postgres, written INSIDE the same
 * transaction as the business mutation. Redis `XACK` stays as best-effort cleanup.
 *
 * Storage is the existing `OutboxEvent` table (no new schema): `eventKey` is globally unique —
 * which is exactly the exactly-once gate — rows are never deleted (only status-transitioned),
 * and `(aggregateType, aggregateId)` is indexed. Marker rows have no subscriber, the same shape
 * as the already-shipped `expense.line_receipt_uploaded`.
 *
 * `OutboxAppendService` must NOT be used for markers: it writes on the root client (so it would
 * escape the caller's transaction) and swallows append failures.
 */
import { redactOutboxPayload, validateOutboxPayload } from '../../data-model-core/domain/logic/outbox.logic';
import { hashMessagePreview } from '../domain/logic/line-ai-classifier.logic';

export const CLARIFICATION_CONSUMED_EVENT = 'ai.line.clarification.consumed';
export const CLARIFICATION_AGGREGATE = 'line_clarification';
export const CORRECTION_APPLIED_EVENT = 'expense.line_correction.applied';
export const CORRECTION_AGGREGATE = 'line_message';

/** The outbox writer the markers need — a `Prisma.TransactionClient` satisfies it, and specs
 *  inject a fake. Deliberately narrow so a marker can never be written off-transaction. */
export type MarkerTransactionClient = {
  outboxEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; select: Record<string, boolean> }): Promise<Array<{ eventKey: string }>>;
  };
};

/** Raised when marker state cannot be read. The dispatcher must send its safe retry reply and
 *  enter NO intake branch: continuing with an empty clarification list is not fail-closed —
 *  a bare date/amount answer would be misrouted as a brand-new capture. */
export class ConsumptionMarkerUnavailableError extends Error {
  /** Machine-readable cause for operators (`stream_absent` never reaches here — it is not an
   *  outage). The customer reply and the terminal status are the same whatever this says. */
  readonly reason: string;

  constructor(cause: unknown, reason = 'marker_unavailable') {
    super(`line_ai_consumption_marker_unavailable: ${(cause as Error)?.message ?? 'unknown'}`);
    this.name = 'ConsumptionMarkerUnavailableError';
    this.reason = reason;
  }
}

function eventKeyOf(eventType: string, aggregateType: string, aggregateId: string): string {
  return `${eventType}:${aggregateType}:${aggregateId}`;
}

/**
 * Redis stream ids are only unique WITHIN a stream, so the key is scoped by company and by a
 * hash of the ledger key. `hashMessagePreview` keeps the raw chat/group/user id out of Postgres.
 */
export function clarificationMarkerKey(companyId: string, ledgerStreamKey: string, entryId: string): string {
  return eventKeyOf(CLARIFICATION_CONSUMED_EVENT, CLARIFICATION_AGGREGATE, `${companyId}:${hashMessagePreview(ledgerStreamKey)}:${entryId}`);
}

/** Target-independent: a redelivery that resolves to a different expense still finds this key. */
export function correctionMarkerKey(companyId: string, lineMessageIdHash: string): string {
  return eventKeyOf(CORRECTION_APPLIED_EVENT, CORRECTION_AGGREGATE, `${companyId}:${lineMessageIdHash}`);
}

async function insertMarker(
  tx: MarkerTransactionClient,
  input: { companyId: string; eventType: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> },
): Promise<void> {
  const payloadJson = redactOutboxPayload(input.payload);
  const invalid = validateOutboxPayload(payloadJson);
  if (invalid) throw new Error(`line_ai_marker_payload_rejected: ${invalid}`);
  await tx.outboxEvent.create({
    data: {
      companyId: input.companyId,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventKey: eventKeyOf(input.eventType, input.aggregateType, input.aggregateId),
      payloadJson,
    },
  });
}

/**
 * Record the clarifications this turn consumed. MUST run on the same transaction client as the
 * business mutation: an after-commit append leaves the exact window this exists to close.
 * Throws on failure so the mutation rolls back — a mutation whose consumption was not recorded
 * is the incident.
 */
export async function markClarificationsConsumed(
  tx: MarkerTransactionClient,
  input: { companyId: string; ledgerStreamKey: string; entryIds: string[]; outcome: string },
): Promise<void> {
  for (const entryId of input.entryIds) {
    await insertMarker(tx, {
      companyId: input.companyId,
      eventType: CLARIFICATION_CONSUMED_EVENT,
      aggregateType: CLARIFICATION_AGGREGATE,
      aggregateId: `${input.companyId}:${hashMessagePreview(input.ledgerStreamKey)}:${entryId}`,
      payload: { entryId, outcome: input.outcome },
    });
  }
}

/**
 * Which of these clarification entries are already consumed. Exact-key lookup, batched, and
 * status-blind: a PUBLISHED or DEAD marker still means consumed.
 */
export async function findConsumedClarificationIds(
  db: MarkerTransactionClient,
  input: { companyId: string; ledgerStreamKey: string; entryIds: string[] },
): Promise<Set<string>> {
  if (input.entryIds.length === 0) return new Set();
  const byKey = new Map(input.entryIds.map((entryId) => [clarificationMarkerKey(input.companyId, input.ledgerStreamKey, entryId), entryId]));
  let rows: Array<{ eventKey: string }>;
  try {
    rows = await db.outboxEvent.findMany({
      where: { companyId: input.companyId, eventKey: { in: [...byKey.keys()] } },
      select: { eventKey: true },
    });
  } catch (err) {
    throw new ConsumptionMarkerUnavailableError(err);
  }
  return new Set(rows.map((row) => byKey.get(row.eventKey)).filter((id): id is string => id !== undefined));
}

/** What a terminal intake turn consumed, handed to the finalizer that owns the transaction. */
export type ClarificationConsumption = {
  companyId: string;
  ledgerStreamKey: string;
  entryIds: string[];
  outcome: string;
};

/** Adapter for the `withinTx` seams: undefined when there is nothing to record, so a finalizer
 *  with no clarifications to consume keeps its current single-write shape. */
export function consumptionWithinTx(
  consumption: ClarificationConsumption | undefined,
): ((tx: MarkerTransactionClient) => Promise<void>) | undefined {
  if (!consumption || consumption.entryIds.length === 0) return undefined;
  return (tx) => markClarificationsConsumed(tx, consumption);
}
