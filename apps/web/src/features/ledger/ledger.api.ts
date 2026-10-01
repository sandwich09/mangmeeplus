import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import type {
  ApplyChartTemplateInput,
  ApplyChartTemplateResult,
  ChartOfAccountSummary,
  ChartOfAccountsReadiness,
  ChartTemplateMetadata,
  ChartTemplatePreviewResult,
  ExpenseBackfillPreview,
  ExpenseBackfillResult,
  JournalEntrySummary,
} from '@watchdog-bms/contracts';

export type {
  ApplyChartTemplateResult,
  ChartOfAccountsReadiness,
  ChartTemplateMetadata,
  ChartTemplatePreviewResult,
  JournalEntrySummary,
};

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export type LedgerAccount = ChartOfAccountSummary;
export type AccountingPeriod = { id: string; periodKey: string; startDate: string; endDate: string; status: string };
export type TrialBalance = {
  periodKey: string;
  totalDebit: string;
  totalCredit: string;
  difference: string;
  lines: Array<{ accountId: string; accountCode: string; accountNameTh: string; accountClass: string; totalDebit: string; totalCredit: string; balance: string }>;
};
export type PnlReport = { periodKey: string; revenue: string; totalCost: string; grossProfit: string; totalExpense: string; taxExpense: string; netProfit: string };
export type BalanceSheet = { periodKey: string; totalAssets: string; totalLiabilities: string; totalEquity: string };
export type GlAccountLine = { accountId: string; accountCode: string; accountNameTh: string; openingBalance: string; totalDebit: string; totalCredit: string; endingBalance: string };
export type PeriodCloseRun = { id: string; status: string; checks: Array<{ checkKey: string; status: string; severity: string; message: string; count?: number; amount?: string; breakdown?: Record<string, number> }> };
/** A recorded claim payout whose ledger settlement has not been posted yet, or failed to post. */
export type UnpostedClaimPayment = {
  paymentId: string;
  reimbursementRequestId: string;
  requestNo?: string;
  requesterDisplayNameSnapshot?: string;
  paymentNo?: string;
  paidAmount: string;
  currency: string;
  paidAt: string;
  postingStatus: string;
};

export function listLedgerAccounts(companyId: string): Promise<LedgerAccount[]> {
  return apiFetch(`/v1/companies/${companyId}/chart-of-accounts`);
}

export function listChartTemplates(companyId: string): Promise<ChartTemplateMetadata[]> {
  return apiFetch(`/v1/companies/${companyId}/chart-of-accounts/templates`);
}

export function previewChartTemplate(
  companyId: string,
  templateKey: string,
): Promise<ChartTemplatePreviewResult> {
  return apiFetch(`/v1/companies/${companyId}/chart-of-accounts/templates/${encodeURIComponent(templateKey)}/preview`);
}

export function applyChartTemplate(
  companyId: string,
  templateKey: string,
  input: ApplyChartTemplateInput,
): Promise<ApplyChartTemplateResult> {
  return apiFetch(`/v1/companies/${companyId}/chart-of-accounts/templates/${encodeURIComponent(templateKey)}/apply`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getChartReadiness(companyId: string): Promise<ChartOfAccountsReadiness> {
  return apiFetch(`/v1/companies/${companyId}/chart-of-accounts/readiness`);
}

export function listPeriods(companyId: string): Promise<AccountingPeriod[]> {
  return apiFetch(`/v1/companies/${companyId}/periods`);
}

export function listJournals(
  companyId: string,
  params?: { periodId?: string; status?: string; sourceType?: string; sourceId?: string; page?: number; pageSize?: number },
): Promise<{ data: JournalEntrySummary[]; total: number }> {
  return apiFetch(`/v1/companies/${companyId}/journal-entries${qs(params)}`);
}

export function generateSourceJournal(companyId: string, sourceType: string, sourceId: string): Promise<JournalEntrySummary> {
  return apiFetch(`/v1/companies/${companyId}/posting/generate`, {
    method: 'POST',
    body: JSON.stringify({ sourceType, sourceId }),
  });
}

/** The reimbursement half of the posting worklist. Post a row with `generateSourceJournal(…, 'reimbursement.payment', paymentId)`. */
export function listUnpostedClaimPayments(companyId: string): Promise<UnpostedClaimPayment[]> {
  return apiFetch(`/v1/companies/${companyId}/reimbursements/posting/pending`);
}

export function previewExpenseBackfill(companyId: string): Promise<ExpenseBackfillPreview> {
  return apiFetch(`/v1/companies/${companyId}/posting/expense-backfill-preview`);
}

export function runExpenseBackfill(
  companyId: string,
  input: { confirmed: true; limit?: number },
): Promise<ExpenseBackfillResult> {
  return apiFetch(`/v1/companies/${companyId}/posting/expense-backfill`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function ensurePeriod(companyId: string, periodKey: string): Promise<AccountingPeriod> {
  return apiFetch(`/v1/companies/${companyId}/periods/ensure/${periodKey}`, { method: 'POST', body: '{}' });
}

export function getTrialBalance(companyId: string, periodKey: string): Promise<TrialBalance> {
  return apiFetch(`/v1/companies/${companyId}/reports/trial-balance${qs({ periodKey })}`);
}

export function getPnl(companyId: string, periodKey: string): Promise<PnlReport> {
  return apiFetch(`/v1/companies/${companyId}/reports/profit-and-loss${qs({ periodKey })}`);
}

export function getBalanceSheet(companyId: string, periodKey: string): Promise<BalanceSheet> {
  return apiFetch(`/v1/companies/${companyId}/reports/balance-sheet${qs({ periodKey })}`);
}

export function getGeneralLedger(companyId: string, periodKey: string): Promise<GlAccountLine[]> {
  return apiFetch(`/v1/companies/${companyId}/reports/general-ledger${qs({ periodKey })}`);
}

export function runCloseChecks(companyId: string, periodId: string): Promise<PeriodCloseRun> {
  return apiFetch(`/v1/companies/${companyId}/periods/${periodId}/close-checks`, { method: 'POST', body: '{}' });
}

export function closePeriod(companyId: string, periodId: string, note?: string): Promise<AccountingPeriod> {
  return apiFetch(`/v1/companies/${companyId}/periods/${periodId}/close`, { method: 'POST', body: JSON.stringify({ note }) });
}
