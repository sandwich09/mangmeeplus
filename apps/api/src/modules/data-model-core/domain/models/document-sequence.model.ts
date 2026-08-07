export type DocumentSequenceStatus = 'ACTIVE' | 'DISABLED';
export type DocumentResetPolicy = 'NONE' | 'MONTHLY' | 'YEARLY';
export type DocumentNumberStatus = 'RESERVED' | 'COMMITTED' | 'CANCELLED' | 'VOIDED';

export type DocumentSequenceRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  branchScopeKey: string;
  documentType: string;
  periodKey: string;
  prefixTemplate: string;
  nextNumber: number;
  padding: number;
  resetPolicy: DocumentResetPolicy;
  status: DocumentSequenceStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type ReservedDocumentNumberRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  sequenceId: string;
  documentType: string;
  documentNumber: string;
  status: DocumentNumberStatus;
  ownerType?: string;
  ownerId?: string;
  idempotencyKey: string;
  reservedByUserId: string;
  reservedAt: Date;
  committedAt?: Date;
  cancelledAt?: Date;
  voidedAt?: Date;
};

export type UpsertDocumentSequenceInput = {
  companyId: string;
  branchId?: string;
  documentType: string;
  periodKey: string;
  prefixTemplate: string;
  padding?: number;
  resetPolicy?: DocumentResetPolicy;
  updatedByUserId?: string;
};

export type ReserveDocumentNumberInput = {
  companyId: string;
  branchId?: string;
  documentType: string;
  periodKey: string;
  idempotencyKey: string;
  reservedByUserId: string;
};

export type CommitDocumentNumberInput = {
  id: string;
  companyId: string;
  ownerType?: string;
  ownerId?: string;
};

export type CancelDocumentNumberInput = { id: string; companyId: string };
export type VoidDocumentNumberInput = { id: string; companyId: string };
