import type { AccountingOutputTaxCode, TaxEventStatus, TaxEventType, TaxFormType, TaxReportContribution, TransactionTaxComponentPreview, TransactionTaxSnapshot } from '@watchdog-bms/contracts';
import type { PayeeSnapshot } from '@watchdog-bms/contracts';

export type TaxEventRecord = {
  id: string;
  companyId: string;
  taxPeriodId: string;
  idempotencyKey: string;
  eventType: TaxEventType;
  status: TaxEventStatus;
  sourceType: string;
  sourceId: string;
  branchId?: string | null;
  sourceLineId?: string | null;
  sourceLineKey?: string;
  componentKey?: TransactionTaxComponentPreview['componentKey'] | null;
  taxSnapshot?: TransactionTaxSnapshot | null;
  reportContributions?: TaxReportContribution[];
  accountAssignments?: TransactionTaxComponentPreview['accountAssignments'];
  sourceEventType: string | null;
  sourceHash: string | null;
  periodKey: string;
  eventDate: Date;
  taxableBase: string;
  taxAmount: string;
  currency: string;
  vatMode: string | null;
  outputTaxCode: AccountingOutputTaxCode | null;
  whtFormType: TaxFormType | null;
  payeeSnapshot: PayeeSnapshot | null;
  incomeCategoryCode: string | null;
  whtRate: string | null;
  grossAmount: string | null;
  withheldAmount: string | null;
  netPaidAmount: string | null;
  taxInvoiceNumber: string | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertTaxEventInput = Omit<TaxEventRecord, 'id' | 'createdAt' | 'updatedAt'>;

export interface TaxEventRepositoryPort {
  findByIdempotencyKey(key: string): Promise<TaxEventRecord | null>;
  findByPeriod(companyId: string, taxPeriodId: string, status?: TaxEventStatus): Promise<TaxEventRecord[]>;
  upsert(input: UpsertTaxEventInput): Promise<TaxEventRecord>;
  supersede(id: string): Promise<void>;
}
