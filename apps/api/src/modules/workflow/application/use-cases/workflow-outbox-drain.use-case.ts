import { Inject, Injectable } from '@nestjs/common';
import { PrismaOutboxRepository } from '../../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { LOGGER_TOKEN, type AppLogger } from '../../../../common/logger/logger.service';
import { IngestWorkflowEventUseCase } from './workflow-event-ingest.use-case';
import type { CoreOutboxPayload, WorkflowEventEnvelope } from '@watchdog-bms/contracts';
import { OBJECT_VERSION_CLEANUP_EVENT_TYPE } from '../../../data-model-core/application/services/object-version-cleanup.service';
import {
  ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
  SIGNUP_REJECTION_NOTICE_EVENT_TYPE,
} from '../../../external-signup/application/signup-claim-email.service';
import { SIGNUP_PENDING_REVIEW_EVENT_TYPE } from '../../../external-signup/application/signup-admin-notify.service';
import { LINE_SIGNUP_PUSH_EVENT_TYPE } from '../../../external-signup/application/line-signup-notify.service';

const WORKER_ID = 'workflow-outbox-drain';
const OUTBOX_DEAD_EVENT = 'outbox.dead_rows';
/** P0-4: this worker's claim lease was revoked mid-handler; another claimer owns the row now. */
const OUTBOX_LOST_LEASE_EVENT = 'outbox.lost_lease';

/**
 * The producing feature behind an outbox event type, keyed by its first segment
 * (`docs/agent-memory/f0-inventory-async-surface.md` §6b). SHADOW ONLY: it decides what gets
 * measured, never what gets dispatched. An unmapped prefix is recorded as `unmapped_feature`
 * rather than guessed — the drain stays entitlement-blind until enforcement flips.
 */
const OUTBOX_EVENT_FEATURE_BY_PREFIX: Readonly<Record<string, string>> = {
  journal: 'double_entry_ledger',
  period: 'double_entry_ledger',
  expense: 'expenses',
  crm: 'crm',
  accounting: 'sales_documents',
  tax: 'thai_tax',
  purchase_request: 'procurement',
  purchase_order: 'procurement',
  goods_receipt: 'procurement',
  vendor_bill: 'procurement',
  supplier: 'procurement',
  supplier_payment: 'procurement',
  inventory: 'inventory',
  reimbursement: 'reimbursement',
  banking: 'bank_reconciliation',
};

export function outboxEventFeatureKey(eventType: string): string | null {
  return OUTBOX_EVENT_FEATURE_BY_PREFIX[eventType.split('.')[0] ?? ''] ?? null;
}

// Best-effort label for the informational WorkflowEventInbox.sourceModule column.
// Authoritative ABAC/permission gating uses the matched rule's own template.sourceModule,
// not this string — see IngestWorkflowEventUseCase.
function deriveSourceModuleLabel(eventType: string): string {
  return eventType.split('.')[0] ?? 'unknown';
}

@Injectable()
export class DrainWorkflowOutboxUseCase {
  constructor(
    private readonly outbox: PrismaOutboxRepository,
    private readonly ingest: IngestWorkflowEventUseCase,
    private readonly shadow: LaunchShadowProbe,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  // Reuses item-04's outbox claim/publish/fail primitives (previously unused by any
  // consumer). Safe to call repeatedly/concurrently: claimBatch is a single atomic
  // FOR UPDATE SKIP LOCKED statement, and event ingestion is itself idempotent per
  // (companyId, eventId).
  async execute(batchSize = 25): Promise<{ claimed: number; published: number; failed: number; reclaimed: number; dead: number }> {
    // Before claiming: return rows whose claimer died to PENDING. Without this a crashed drain
    // strands its batch in PROCESSING forever — invisible to the claim predicate, to DEAD handling
    // and to every alert (F0.E §6 F13).
    const { reclaimed, dead: reclaimedDead } = await this.outbox.reclaimStalledProcessing();
    const dead = await this.outbox.countDead();
    if (dead > 0) {
      // Observability only; the dead-letter reconciler UX is post-F1. Unlike workflow action runs,
      // outbox DEAD rows have no handler or replay path at all today.
      this.logger.warn({ event: OUTBOX_DEAD_EVENT, riskLevel: 'HIGH', dead, reclaimed, reclaimedDead }, OUTBOX_DEAD_EVENT);
    }

    const events = await this.outbox.claimBatch({
      batchSize,
      claimedBy: WORKER_ID,
      excludeEventTypes: [
        OBJECT_VERSION_CLEANUP_EVENT_TYPE,
        // Reserved for their own consumers. Without these the generic drain would claim a claim
        // email and "publish" it as a workflow event — the applicant would never receive it. The
        // admin announcement carries no companyId at all, so this drain would mark it published
        // without doing anything and the operators would never be told.
        ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
        SIGNUP_REJECTION_NOTICE_EVENT_TYPE,
        SIGNUP_PENDING_REVIEW_EVENT_TYPE,
        LINE_SIGNUP_PUSH_EVENT_TYPE,
      ],
    });
    const sweep = this.shadow.startSweep('outbox.drain');
    let published = 0;
    let failed = 0;

    try {
      for (const event of events) {
        // SHADOW: record what the CC1 guard would decide for this event's producing feature, then
        // dispatch exactly as before. F1 does not flip enforcement (plan §3 F1).
        await sweep.record(event.companyId ?? null, outboxEventFeatureKey(event.eventType));
        if (!event.companyId) {
          if (await this.complete(event, () => this.outbox.markPublished({ id: event.id, claimToken: event.claimToken }))) {
            published++;
          }
          continue;
        }
        try {
          const payload = event.payloadJson as unknown as CoreOutboxPayload;
          const envelope: WorkflowEventEnvelope = {
            eventId: event.id,
            eventType: event.eventType,
            companyId: event.companyId,
            sourceModule: deriveSourceModuleLabel(event.eventType),
            sourceType: event.aggregateType,
            sourceId: event.aggregateId,
            occurredAt: payload.occurredAt ?? event.createdAt.toISOString(),
            actorUserId: payload.actorUserId,
            dedupKey: event.eventKey,
            payload: (payload.data ?? {}) as Record<string, unknown>,
            schemaVersion: 1,
          };
          await this.ingest.execute(envelope);
          if (await this.complete(event, () => this.outbox.markPublished({ id: event.id, claimToken: event.claimToken }))) {
            published++;
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          if (await this.complete(event, () => this.outbox.markFailed({ id: event.id, error, claimToken: event.claimToken }))) {
            failed++;
          }
        }
      }
    } finally {
      // `finally`, not a trailing await: an observation already recorded IS evidence. The per-event
      // catch above only covers ingestion — a throw from `sweep.record`, `complete`, or the outbox
      // repository escapes it, and without this the whole sweep's buffered counts would vanish with
      // no bucket row and no persist_failed warn. `flush()` never throws (it swallows and warns), so
      // this cannot mask the original error. The hour is still stamped inside flush.
      await sweep.flush();
    }
    return { claimed: events.length, published, failed, reclaimed, dead };
  }

  /**
   * P0-4 — the completion only counts when this worker still held the lease. A lost lease means the
   * reclaim already requeued the row (or another claimer owns it), so writing nothing is correct:
   * the row is not lost, it belongs to someone else. Logged, never thrown.
   */
  private async complete(event: { id: string; eventKey: string }, write: () => Promise<boolean>): Promise<boolean> {
    const written = await write();
    if (!written) {
      this.logger.warn(
        { event: OUTBOX_LOST_LEASE_EVENT, outboxEventId: event.id, eventKey: event.eventKey },
        OUTBOX_LOST_LEASE_EVENT,
      );
    }
    return written;
  }
}
