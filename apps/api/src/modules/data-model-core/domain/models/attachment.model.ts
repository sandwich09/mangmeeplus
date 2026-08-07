export type AttachmentStatus = 'PENDING_UPLOAD' | 'ACTIVE' | 'QUARANTINED' | 'DELETED';
export type AttachmentVisibility = 'INTERNAL' | 'ACCOUNTING' | 'AUDIT' | 'CUSTOMER_VISIBLE';

export type AttachmentRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  storageProvider: string;
  bucket: string;
  objectKey: string;
  objectVersionId?: string;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256?: string;
  perceptualHash?: string;
  visibility: AttachmentVisibility;
  status: AttachmentStatus;
  uploadedByUserId: string;
  uploadedAt?: Date;
  deletedAt?: Date;
  metadataJson?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type AttachmentLinkRecord = {
  id: string;
  companyId: string;
  attachmentId: string;
  targetType: string;
  targetId: string;
  purpose: string;
  linkedByUserId: string;
  createdAt: Date;
};

export type CreatePendingAttachmentInput = {
  companyId: string;
  branchId?: string;
  storageProvider: string;
  bucket: string;
  objectKey: string;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  visibility: AttachmentVisibility;
  uploadedByUserId: string;
  metadataJson?: Record<string, unknown>;
  pendingQuotaBytes: number;
  pendingCreatedAfter: Date;
};

export type MarkAttachmentActiveInput = {
  id: string;
  companyId: string;
  objectKey: string;
  objectVersionId: string;
  checksumSha256: string;
  perceptualHash?: string;
  byteSize: number;
};

export type MarkAttachmentQuarantinedInput = { id: string; companyId: string };

export type MarkAttachmentDeletedInput = { id: string; companyId: string };

export type LinkAttachmentInput = {
  companyId: string;
  attachmentId: string;
  targetType: string;
  targetId: string;
  purpose: string;
  linkedByUserId: string;
  targetOwnerUserId?: string;
};

export type FindAttachmentInput = { id: string; companyId: string };

export type SumPendingAttachmentBytesInput = { companyId: string; createdAfter: Date };
