import type {
  AttachmentRecord,
  AttachmentLinkRecord,
  CreatePendingAttachmentInput,
  MarkAttachmentActiveInput,
  MarkAttachmentQuarantinedInput,
  MarkAttachmentDeletedInput,
  LinkAttachmentInput,
  FindAttachmentInput,
  SumPendingAttachmentBytesInput,
} from '../models/attachment.model';

export interface AttachmentRepositoryPort {
  createPending(input: CreatePendingAttachmentInput): Promise<AttachmentRecord>;
  markActive(input: MarkAttachmentActiveInput): Promise<AttachmentRecord>;
  markQuarantined(input: MarkAttachmentQuarantinedInput): Promise<void>;
  markDeleted(input: MarkAttachmentDeletedInput): Promise<AttachmentRecord>;
  linkToTarget(input: LinkAttachmentInput): Promise<AttachmentLinkRecord>;
  findById(input: FindAttachmentInput): Promise<AttachmentRecord | null>;
  sumPendingBytes(input: SumPendingAttachmentBytesInput): Promise<number>;
}
