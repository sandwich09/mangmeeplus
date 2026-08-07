import type { ChartOfAccountsReadiness } from '@watchdog-bms/contracts';
import type { ChartTemplatePreview } from '../modules/ledger/domain/logic/chart-template.logic.js';

export const DEFAULT_CONFLICT_SAMPLE_LIMIT = 20;
export const MAX_CONFLICT_SAMPLE_LIMIT = 100;

export type ChartAuditCompanySuccess = {
  companyId: string;
  status: 'OK';
  coverage: {
    chartAccountCount: number;
    exact: number;
    missing: number;
    unusedConflicts: number;
    inUseConflicts: number;
  };
  dependencies: {
    total: number;
    bySource: Record<string, number>;
  };
  conflictSamples: Array<{
    code: string;
    classification: 'UNUSED_CONFLICT' | 'IN_USE_CONFLICT';
    dependencyCount: number;
    dependencies: Record<string, number>;
    differingFields: string[];
  }>;
  conflictSamplesTruncated: boolean;
  readiness: ChartOfAccountsReadiness;
};

export type ChartAuditCompanyFailure = {
  companyId: string;
  status: 'ERROR';
  errorCode: string;
};

export type ChartAuditCompany = ChartAuditCompanySuccess | ChartAuditCompanyFailure;

export type ChartAuditReport = {
  schemaVersion: 1;
  generatedAt: string;
  readOnly: true;
  conflictSampleLimit: number;
  template: {
    key: string;
    version: number;
    accountsChecksum: string;
    mappingManifestVersion: number;
    mappingManifestChecksum: string;
  };
  summary: {
    companyCount: number;
    scannedCompanyCount: number;
    failedCompanyCount: number;
    templateAppliedCount: number;
    companiesWithConflicts: number;
    companiesWithMissingAccounts: number;
    manualLedgerReadyCount: number;
    automaticPostingReadyCount: number;
  };
  companies: ChartAuditCompany[];
};

function sortedCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function summarizeChartAuditCompany(input: {
  companyId: string;
  preview: ChartTemplatePreview;
  readiness: ChartOfAccountsReadiness;
  conflictSampleLimit?: number;
}): ChartAuditCompanySuccess {
  const conflictSampleLimit = input.conflictSampleLimit ?? DEFAULT_CONFLICT_SAMPLE_LIMIT;
  const conflicts = input.preview.rows.filter(
    (row): row is typeof row & { classification: 'UNUSED_CONFLICT' | 'IN_USE_CONFLICT' } =>
      row.classification === 'UNUSED_CONFLICT' || row.classification === 'IN_USE_CONFLICT',
  );
  const dependencyCounts: Record<string, number> = {};
  for (const row of input.preview.rows) {
    for (const [source, count] of Object.entries(row.dependencies)) {
      dependencyCounts[source] = (dependencyCounts[source] ?? 0) + count;
    }
  }

  return {
    companyId: input.companyId,
    status: 'OK',
    coverage: {
      chartAccountCount: input.readiness.chartAccountCount,
      exact: input.preview.exact,
      missing: input.preview.missing,
      unusedConflicts: input.preview.unusedConflicts,
      inUseConflicts: input.preview.inUseConflicts,
    },
    dependencies: {
      total: Object.values(dependencyCounts).reduce((sum, count) => sum + count, 0),
      bySource: sortedCounts(dependencyCounts),
    },
    conflictSamples: conflicts.slice(0, conflictSampleLimit).map((row) => ({
      code: row.code,
      classification: row.classification,
      dependencyCount: row.dependencyCount,
      dependencies: sortedCounts(row.dependencies),
      differingFields: [...row.differingFields].sort(),
    })),
    conflictSamplesTruncated: conflicts.length > conflictSampleLimit,
    readiness: input.readiness,
  };
}

export function safeChartAuditErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Za-z0-9_]+$/.test(code)) return code.slice(0, 80);
  }
  if (error instanceof Error && /^[A-Za-z0-9_]+$/.test(error.name)) {
    return `coa_audit_${error.name.toLowerCase()}`.slice(0, 80);
  }
  return 'coa_audit_unknown_error';
}

export function buildChartAuditReport(input: {
  generatedAt: string;
  conflictSampleLimit: number;
  template: ChartAuditReport['template'];
  companies: ChartAuditCompany[];
}): ChartAuditReport {
  const scanned = input.companies.filter(
    (company): company is ChartAuditCompanySuccess => company.status === 'OK',
  );
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    readOnly: true,
    conflictSampleLimit: input.conflictSampleLimit,
    template: input.template,
    summary: {
      companyCount: input.companies.length,
      scannedCompanyCount: scanned.length,
      failedCompanyCount: input.companies.length - scanned.length,
      templateAppliedCount: scanned.filter((company) => company.readiness.chartTemplateApplied).length,
      companiesWithConflicts: scanned.filter((company) =>
        company.coverage.unusedConflicts + company.coverage.inUseConflicts > 0).length,
      companiesWithMissingAccounts: scanned.filter((company) => company.coverage.missing > 0).length,
      manualLedgerReadyCount: scanned.filter((company) => company.readiness.readyForManualLedger).length,
      automaticPostingReadyCount: scanned.filter((company) =>
        company.readiness.readyForAutomaticPosting).length,
    },
    companies: input.companies,
  };
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function chartAuditReportToCsv(report: ChartAuditReport): string {
  const headers = [
    'companyId',
    'scanStatus',
    'errorCode',
    'chartTemplateApplied',
    'chartTemplateKey',
    'chartTemplateVersion',
    'chartTemplateChecksum',
    'chartAccountCount',
    'exact',
    'missing',
    'unusedConflicts',
    'inUseConflicts',
    'dependencyCount',
    'dependencySources',
    'conflictSampleCodes',
    'requiredPostingRolesMissing',
    'taxConfigurationRequired',
    'requiredTaxAccountRolesMissing',
    'taxProfilesNeedingReview',
    'bankLedgerLinksInvalid',
    'legacyTaxHeaderMismatches',
    'sourcePostingErrors',
    'readyForManualLedger',
    'readyForAutomaticPosting',
  ];
  const rows = report.companies.map((company): unknown[] => {
    if (company.status === 'ERROR') {
      return [company.companyId, company.status, company.errorCode, ...Array(headers.length - 3).fill('')];
    }
    const readiness = company.readiness;
    return [
      company.companyId,
      company.status,
      '',
      readiness.chartTemplateApplied,
      readiness.chartTemplateKey,
      readiness.chartTemplateVersion,
      readiness.chartTemplateChecksum,
      company.coverage.chartAccountCount,
      company.coverage.exact,
      company.coverage.missing,
      company.coverage.unusedConflicts,
      company.coverage.inUseConflicts,
      company.dependencies.total,
      Object.entries(company.dependencies.bySource).map(([source, count]) => `${source}=${count}`).join('|'),
      company.conflictSamples.map((conflict) => conflict.code).join('|'),
      readiness.requiredPostingRolesMissing.join('|'),
      readiness.taxConfigurationRequired,
      readiness.requiredTaxAccountRolesMissing.join('|'),
      readiness.taxProfilesNeedingReview,
      readiness.bankLedgerLinksInvalid,
      readiness.legacyTaxHeaderMismatches,
      readiness.sourcePostingErrors,
      readiness.readyForManualLedger,
      readiness.readyForAutomaticPosting,
    ];
  });
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}
