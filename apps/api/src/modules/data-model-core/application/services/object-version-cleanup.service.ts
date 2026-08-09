import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LOGGER_TOKEN, type AppLogger } from '../../../../common/logger/logger.service';
import { PrismaOutboxRepository } from '../../infrastructure/repositories/prisma-outbox.repository';

export const OBJECT_VERSION_CLEANUP_EVENT_TYPE = 'storage.object_version_cleanup.requested';
export const OBJECT_VERSION_CLEANUP_ENQUEUE_FAILED_EVENT = 'storage.object_version_cleanup.enqueue_failed';
const CLEANUP_WORKER_ID = 'object-version-cleanup-worker';

export type ObjectVersionCleanupSource =
  | 'ATTACHMENT_FINALIZATION'
  | 'REPORT_EXPORT'
  | 'SUBSTITUTE_RECEIPT_CERTIFIED'
  | 'SUBSTITUTE_RECEIPT_ISSUED';

export type EnqueueObjectVersionCleanupInput = {
  companyId: string;
  bucket: string;
  objectPath: string;
  expectedVersion: string;
  source: ObjectVersionCleanupSource;
};

export type ClaimedObjectVersionCleanupTask = {
  id: string;
  claimToken: string;
  attempt: number;
  payload: Record<string, unknown>;
};

const SOURCE_PREFIX: Readonly<Record<ObjectVersionCleanupSource, (companyId: string) => string>> = {
  ATTACHMENT_FINALIZATION: (companyId) => `evidence/${companyId}/`,
  REPORT_EXPORT: (companyId) => `report-export/${companyId}/`,
  SUBSTITUTE_RECEIPT_CERTIFIED: (companyId) => `${companyId}/generated/expense-substitute/`,
  SUBSTITUTE_RECEIPT_ISSUED: (companyId) => `${companyId}/generated/expense-substitute/`,
};

@Injectable()
export class ObjectVersionCleanupService {
  constructor(
    private readonly outbox: PrismaOutboxRepository,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  /** Awaited by failure paths. A persistence failure is alarmed but never replaces the primary error. */
  async enqueue(input: EnqueueObjectVersionCleanupInput): Promise<boolean> {
    const cleanupDedupeId = createHash('sha256')
      .update(`${input.bucket}\0${input.objectPath}\0${input.expectedVersion}`)
      .digest('hex');
    try {
      assertCleanupProducerTarget(input);
      await this.outbox.append({
        companyId: input.companyId,
        eventType: OBJECT_VERSION_CLEANUP_EVENT_TYPE,
        aggregateType: 'ObjectVersionCleanup',
        aggregateId: cleanupDedupeId,
        eventKey: `${OBJECT_VERSION_CLEANUP_EVENT_TYPE}:${cleanupDedupeId}`,
        priority: 'HIGH',
        payloadJson: {
          schemaVersion: 1,
          companyId: input.companyId,
          bucket: input.bucket,
          path: input.objectPath,
          expectedVersion: input.expectedVersion,
          source: input.source,
          requestedAt: new Date().toISOString(),
        },
      });
      return true;
    } catch (error) {
      this.logger.error({
        event: OBJECT_VERSION_CLEANUP_ENQUEUE_FAILED_EVENT,
        riskLevel: 'CRITICAL',
        cleanupDedupeId,
        companyId: input.companyId,
        source: input.source,
        err: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
      }, OBJECT_VERSION_CLEANUP_ENQUEUE_FAILED_EVENT);
      return false;
    }
  }

  async claim(batchSize = 10): Promise<{ tasks: ClaimedObjectVersionCleanupTask[]; reclaimed: number; dead: number }> {
    const { reclaimed, dead } = await this.outbox.reclaimStalledProcessing();
    const events = await this.outbox.claimBatch({
      batchSize,
      claimedBy: CLEANUP_WORKER_ID,
      eventTypes: [OBJECT_VERSION_CLEANUP_EVENT_TYPE],
    });
    return {
      reclaimed,
      dead,
      tasks: events.map((event) => ({
        id: event.id,
        claimToken: event.claimToken ?? '',
        attempt: event.attempts + 1,
        payload: event.payloadJson,
      })),
    };
  }

  complete(id: string, claimToken: string): Promise<boolean> {
    assertClaimIdentity(id, claimToken);
    return this.outbox.markPublished({
      id,
      claimToken,
      expectedEventType: OBJECT_VERSION_CLEANUP_EVENT_TYPE,
    });
  }

  fail(id: string, claimToken: string, errorCode: string): Promise<boolean> {
    assertClaimIdentity(id, claimToken);
    if (!/^[a-z0-9_.:-]{1,160}$/.test(errorCode)) {
      throw new BadRequestException('cleanup errorCode is invalid');
    }
    return this.outbox.markFailed({
      id,
      claimToken,
      error: errorCode,
      expectedEventType: OBJECT_VERSION_CLEANUP_EVENT_TYPE,
    });
  }
}
function assertCleanupProducerTarget(input: EnqueueObjectVersionCleanupInput): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.companyId)) throw new Error('cleanup companyId is invalid');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.bucket)) throw new Error('cleanup bucket is invalid');
  if (!/^[A-Za-z0-9._/-]{1,1024}$/.test(input.objectPath)
    || input.objectPath.includes('..') || input.objectPath.includes('//')) {
    throw new Error('cleanup object path is invalid');
  }
  if (!/^[A-Za-z0-9._~+/=-]{1,1024}$/.test(input.expectedVersion)) {
    throw new Error('cleanup exact object version is invalid');
  }
  const prefix = SOURCE_PREFIX[input.source];
  if (!prefix || !input.objectPath.startsWith(prefix(input.companyId))) {
    throw new Error('cleanup source does not own the object path');
  }
}

function assertClaimIdentity(id: string, claimToken: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !/^[A-Za-z0-9-]{1,128}$/.test(claimToken)) {
    throw new BadRequestException('cleanup claim identity is invalid');
  }
}
