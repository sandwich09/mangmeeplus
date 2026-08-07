import type { ReviewIssueSeverity, ReviewIssueStatus } from '@watchdog-bms/contracts';

export type TaxReviewIssueRecord = {
  id: string;
  companyId: string;
  taxPeriodId: string;
  taxEventId: string | null;
  severity: ReviewIssueSeverity;
  status: ReviewIssueStatus;
  issueCode: string;
  description: string;
  sourceType: string | null;
  sourceId: string | null;
  resolvedAt: Date | null;
  resolvedNote: string | null;
  resolvedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateReviewIssueInput = {
  companyId: string;
  taxPeriodId: string;
  taxEventId?: string | null;
  severity: ReviewIssueSeverity;
  issueCode: string;
  description: string;
  sourceType?: string | null;
  sourceId?: string | null;
};

export interface TaxReviewIssueRepositoryPort {
  create(input: CreateReviewIssueInput): Promise<TaxReviewIssueRecord>;
  findByPeriod(companyId: string, taxPeriodId: string, filters?: { status?: ReviewIssueStatus; severity?: ReviewIssueSeverity }): Promise<TaxReviewIssueRecord[]>;
  resolve(id: string, note: string, resolvedByUserId: string): Promise<TaxReviewIssueRecord>;
  ignore(id: string, resolvedByUserId: string): Promise<TaxReviewIssueRecord>;
}
