import type { TaxFormType, TaxPeriodStatus, TaxType } from '@watchdog-bms/contracts';

export type TaxPeriodRecord = {
  id: string;
  companyId: string;
  taxType: TaxType;
  formType: TaxFormType;
  periodKey: string;
  status: TaxPeriodStatus;
  dueDate: Date | null;
  filedAt: Date | null;
  paidAt: Date | null;
  reviewNote: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateTaxPeriodInput = {
  companyId: string;
  taxType: TaxType;
  formType: TaxFormType;
  periodKey: string;
  status?: TaxPeriodStatus;
  dueDate?: Date | null;
};

export interface TaxPeriodRepositoryPort {
  findByCompanyFormPeriod(companyId: string, formType: TaxFormType, periodKey: string): Promise<TaxPeriodRecord | null>;
  findMany(companyId: string, filters?: { taxType?: TaxType; status?: TaxPeriodStatus; page?: number; pageSize?: number }): Promise<{ items: TaxPeriodRecord[]; total: number }>;
  upsert(input: CreateTaxPeriodInput): Promise<TaxPeriodRecord>;
  updateStatus(id: string, status: TaxPeriodStatus, meta?: { filedAt?: Date; paidAt?: Date; closedAt?: Date; reviewNote?: string }): Promise<TaxPeriodRecord>;
}
