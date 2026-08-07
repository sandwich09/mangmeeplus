import type {
  DocumentSequenceRecord,
  ReservedDocumentNumberRecord,
  UpsertDocumentSequenceInput,
  ReserveDocumentNumberInput,
  CommitDocumentNumberInput,
  CancelDocumentNumberInput,
  VoidDocumentNumberInput,
} from '../models/document-sequence.model';

export type ListDocumentSequencesInput = {
  companyId: string;
  documentType?: string;
  branchId?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedDocumentSequences = {
  items: DocumentSequenceRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export interface DocumentSequenceRepositoryPort {
  upsertConfig(input: UpsertDocumentSequenceInput): Promise<DocumentSequenceRecord>;
  list(input: ListDocumentSequencesInput): Promise<PaginatedDocumentSequences>;
  reserveNumber(input: ReserveDocumentNumberInput): Promise<ReservedDocumentNumberRecord>;
  commitNumber(input: CommitDocumentNumberInput): Promise<ReservedDocumentNumberRecord>;
  cancelReservation(input: CancelDocumentNumberInput): Promise<ReservedDocumentNumberRecord>;
  voidNumber(input: VoidDocumentNumberInput): Promise<ReservedDocumentNumberRecord>;
}
