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

export type ClaimOutboxBatchInput = {
  batchSize: number;
  claimedBy: string;
  /** Include only these event types. Mutually exclusive with excludeEventTypes. */
  eventTypes?: string[];
  /** Exclude reserved consumer event types from a general drain. */
  excludeEventTypes?: string[];
};
/** `claimToken` is the lease this completion holds; a stale one matches no row and is a no-op. */
export type MarkOutboxPublishedInput = {
  id: string;
  claimToken?: string | null;
  /** Optional consumer fence: an internal worker cannot complete another consumer's event. */
  expectedEventType?: string;
};
export type MarkOutboxFailedInput = {
  id: string;
  error: string;
  nextAvailableAt?: Date;
  claimToken?: string | null;
  expectedEventType?: string;
  /**
   * Whether this outcome spends one of the row's five attempts. Default true.
   *
   * `false` is for a provider that said "not now, come back at T" rather than "this failed": a
   * LINE 429 against a monthly OA quota would otherwise DEAD the row in five 2^n steps — about two
   * minutes — and throw away a message the customer is owed for a condition that resolves on its
   * own. Only ever safe together with `nextAvailableAt`, which is what bounds the retry rate.
   */
  countsTowardMax?: boolean;
};
