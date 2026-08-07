import type {
  OutboxEventRecord,
  AppendOutboxEventInput,
  ClaimOutboxBatchInput,
  MarkOutboxPublishedInput,
  MarkOutboxFailedInput,
} from '../models/outbox.model';

export interface OutboxRepositoryPort {
  append(input: AppendOutboxEventInput): Promise<OutboxEventRecord>;
  claimBatch(input: ClaimOutboxBatchInput): Promise<OutboxEventRecord[]>;
  /** `false` = the claim lease was lost (reclaimed/re-claimed elsewhere); the row was NOT written. */
  markPublished(input: MarkOutboxPublishedInput): Promise<boolean>;
  markFailed(input: MarkOutboxFailedInput): Promise<boolean>;
}
