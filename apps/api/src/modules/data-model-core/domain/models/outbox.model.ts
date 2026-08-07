export type OutboxEventStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'DEAD';
export type OutboxEventPriority = 'LOW' | 'NORMAL' | 'HIGH';

export type OutboxEventRecord = {
  id: string;
  companyId?: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  eventKey: string;
  payloadJson: Record<string, unknown>;
  headersJson?: Record<string, unknown>;
  status: OutboxEventStatus;
  priority: OutboxEventPriority;
  attempts: number;
  availableAt: Date;
  lockedAt?: Date;
  lockedBy?: string;
  /** P0-4 fencing token minted by the claim. Thread it back into markPublished/markFailed. */
  claimToken?: string;
  publishedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AppendOutboxEventInput = {
  companyId?: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  eventKey: string;
  payloadJson: Record<string, unknown>;
  headersJson?: Record<string, unknown>;
  priority?: OutboxEventPriority;
  availableAt?: Date;
};

export type ClaimOutboxBatchInput = { batchSize: number; claimedBy: string };
/** `claimToken` is the lease this completion holds; a stale one matches no row and is a no-op. */
export type MarkOutboxPublishedInput = { id: string; claimToken?: string | null };
export type MarkOutboxFailedInput = { id: string; error: string; nextAvailableAt?: Date; claimToken?: string | null };
