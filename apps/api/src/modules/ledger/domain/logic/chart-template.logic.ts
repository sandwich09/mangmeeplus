import { createHash } from 'node:crypto';
import type {
  ChartOfAccountsReadiness,
  LedgerAccountClass,
  LedgerNormalBalance,
} from '@watchdog-bms/contracts';
import {
  REVIEWED_CONTRA_ACCOUNTS,
  TH_SME_COA_V1,
  TH_SME_COA_V1_MAPPING_MANIFEST,
  computeChartAccountsChecksum,
  type ChartTemplateAccount,
} from '../catalog/th-sme-chart-of-accounts-v1.js';

export type ExistingChartAccount = Pick<
  ChartTemplateAccount,
  'code' | 'nameTh' | 'accountClass' | 'reportGroup' | 'normalBalance' | 'isPosting' | 'isControlled'
> & {
  id: string;
  companyId: string | null;
};

export type ChartDependencyCounts = Record<string, number>;
export type ChartTemplateClassification = 'EXACT' | 'MISSING' | 'UNUSED_CONFLICT' | 'IN_USE_CONFLICT';

export type ChartTemplatePreviewRow = {
  code: string;
  existingAccountId: string | null;
  classification: ChartTemplateClassification;
  dependencyCount: number;
  dependencies: ChartDependencyCounts;
  differingFields: string[];
};

export type ChartTemplatePreview = {
  templateKey: string;
  templateVersion: number;
  templateChecksum: string;
  previewChecksum: string;
  exact: number;
  missing: number;
  unusedConflicts: number;
  inUseConflicts: number;
  rows: ChartTemplatePreviewRow[];
};

const DEFAULT_BALANCE: Record<LedgerAccountClass, LedgerNormalBalance> = {
  ASSET: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  REVENUE: 'CREDIT',
  COST: 'DEBIT',
  EXPENSE: 'DEBIT',
  TAX_EXPENSE: 'DEBIT',
  SUSPENSE: 'DEBIT',
};

export function normalizeChartText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value
    .replace(/^\uFEFF/, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Service expesnes$/, 'Service expenses');
}

export function deriveAccountClass(code: string, sourceGroup2: string): LedgerAccountClass | null {
  if (/^1/.test(code)) return 'ASSET';
  if (/^2/.test(code)) return 'LIABILITY';
  if (/^3/.test(code)) return 'EQUITY';
  if (/^4/.test(code)) return 'REVENUE';
  if (/^5/.test(code)) return normalizeChartText(sourceGroup2) === 'Cost' ? 'COST' : 'EXPENSE';
  if (/^6/.test(code)) return 'TAX_EXPENSE';
  if (/^9/.test(code)) return 'SUSPENSE';
  return null;
}

function semanticValue(account: ExistingChartAccount | ChartTemplateAccount, field: string): unknown {
  const value = account[field as keyof typeof account];
  return typeof value === 'string' ? normalizeChartText(value) : value;
}

const SEMANTIC_FIELDS = [
  'code',
  'nameTh',
  'accountClass',
  'normalBalance',
  'reportGroup',
  'isPosting',
  'isControlled',
] as const;

export function differingSemanticFields(
  existing: ExistingChartAccount,
  template: ChartTemplateAccount,
): string[] {
  return SEMANTIC_FIELDS.filter((field) => semanticValue(existing, field) !== semanticValue(template, field));
}

export function isSemanticallyEqual(
  existing: ExistingChartAccount,
  template: ChartTemplateAccount,
): boolean {
  return differingSemanticFields(existing, template).length === 0;
}

export function validateChartTemplate(): string[] {
  const errors: string[] = [];
  const accounts = TH_SME_COA_V1.accounts;
  const codes = new Set<string>();
  const names = new Set<string>();

  if (accounts.length !== 175) errors.push(`account_count:${accounts.length}`);

  for (const account of accounts) {
    if (!/^\d{4}-\d{2}$/.test(account.code)) errors.push(`invalid_code:${account.code}`);
    if (codes.has(account.code)) errors.push(`duplicate_code:${account.code}`);
    codes.add(account.code);

    const name = normalizeChartText(account.nameTh);
    if (!name) errors.push(`blank_name:${account.code}`);
    if (name && names.has(name)) errors.push(`duplicate_name:${name}`);
    if (name) names.add(name);

    if (normalizeChartText(account.nameTh) !== account.nameTh) errors.push(`unnormalized_name:${account.code}`);
    if (normalizeChartText(account.sourceGroup1) !== account.sourceGroup1) errors.push(`unnormalized_group1:${account.code}`);
    if (normalizeChartText(account.sourceGroup2) !== account.sourceGroup2) errors.push(`unnormalized_group2:${account.code}`);
    if (normalizeChartText(account.reportGroup) !== account.reportGroup) errors.push(`unnormalized_report_group:${account.code}`);
    if (/999-9-99999-\d|นาย…/.test(account.nameTh)) errors.push(`placeholder_name:${account.code}`);

    const derivedClass = deriveAccountClass(account.code, account.sourceGroup2);
    if (derivedClass !== account.accountClass) errors.push(`account_class:${account.code}`);
    const reviewedBalance = REVIEWED_CONTRA_ACCOUNTS.get(account.code) ?? DEFAULT_BALANCE[account.accountClass];
    if (reviewedBalance !== account.normalBalance) errors.push(`normal_balance:${account.code}`);
    if (account.parentCode && !accounts.some((candidate) => candidate.code === account.parentCode)) {
      errors.push(`missing_parent:${account.code}:${account.parentCode}`);
    }
  }

  const actualContra = accounts
    .filter((account) => account.normalBalance !== DEFAULT_BALANCE[account.accountClass])
    .map((account) => account.code)
    .sort();
  const reviewedContra = [...REVIEWED_CONTRA_ACCOUNTS.keys()].sort();
  if (JSON.stringify(actualContra) !== JSON.stringify(reviewedContra)) errors.push('contra_account_set');

  const suspense = accounts.find((account) => account.code === '9999-99');
  if (!suspense?.isControlled || suspense.accountClass !== 'SUSPENSE') errors.push('suspense_control');

  for (const suggestion of TH_SME_COA_V1_MAPPING_MANIFEST.suggestions) {
    if (!codes.has(suggestion.accountCode)) errors.push(`mapping_account_missing:${suggestion.key}:${suggestion.accountCode}`);
    if (suggestion.reviewStatus !== 'REVIEW_REQUIRED') errors.push(`mapping_not_review_required:${suggestion.key}`);
  }

  if (computeChartAccountsChecksum(accounts) !== TH_SME_COA_V1.accountsChecksum) errors.push('accounts_checksum');
  return errors;
}

function dependencyTotal(dependencies: ChartDependencyCounts): number {
  return Object.values(dependencies).reduce((sum, count) => sum + count, 0);
}

export function previewChartTemplate(input: {
  existingAccounts: ExistingChartAccount[];
  dependenciesByCode?: Record<string, ChartDependencyCounts>;
}): ChartTemplatePreview {
  const companyAccounts = new Map(
    input.existingAccounts.filter((account) => account.companyId !== null).map((account) => [account.code, account]),
  );
  const globalCodes = new Set(
    input.existingAccounts.filter((account) => account.companyId === null).map((account) => account.code),
  );

  const rows = TH_SME_COA_V1.accounts.map((template): ChartTemplatePreviewRow => {
    const existing = companyAccounts.get(template.code);
    const dependencies = { ...(input.dependenciesByCode?.[template.code] ?? {}) };
    if (globalCodes.has(template.code)) dependencies.GLOBAL_ACCOUNT = 1;
    const total = dependencyTotal(dependencies);

    if (!existing) {
      return {
        code: template.code,
        existingAccountId: null,
        classification: globalCodes.has(template.code) ? 'IN_USE_CONFLICT' : 'MISSING',
        dependencyCount: total,
        dependencies,
        differingFields: globalCodes.has(template.code) ? ['globalAccount'] : [],
      };
    }

    const differingFields = differingSemanticFields(existing, template);
    const classification = globalCodes.has(template.code)
      ? 'IN_USE_CONFLICT'
      : differingFields.length === 0
        ? 'EXACT'
        : total > 0
          ? 'IN_USE_CONFLICT'
          : 'UNUSED_CONFLICT';
    return {
      code: template.code,
      existingAccountId: existing.id,
      classification,
      dependencyCount: total,
      dependencies,
      differingFields: globalCodes.has(template.code)
        ? [...new Set([...differingFields, 'globalAccount'])]
        : differingFields,
    };
  });

  const previewFacts = rows.map((row) => ({
    code: row.code,
    existingAccountId: row.existingAccountId,
    classification: row.classification,
    dependencies: Object.entries(row.dependencies).sort(([left], [right]) => left.localeCompare(right)),
    differingFields: [...row.differingFields].sort(),
  }));
  const previewChecksum = createHash('sha256')
    .update(JSON.stringify({ templateChecksum: TH_SME_COA_V1.accountsChecksum, rows: previewFacts }))
    .digest('hex');

  return {
    templateKey: TH_SME_COA_V1.key,
    templateVersion: TH_SME_COA_V1.version,
    templateChecksum: TH_SME_COA_V1.accountsChecksum,
    previewChecksum,
    exact: rows.filter((row) => row.classification === 'EXACT').length,
    missing: rows.filter((row) => row.classification === 'MISSING').length,
    unusedConflicts: rows.filter((row) => row.classification === 'UNUSED_CONFLICT').length,
    inUseConflicts: rows.filter((row) => row.classification === 'IN_USE_CONFLICT').length,
    rows,
  };
}

export function computeChartReadiness(input: {
  chartTemplateApplied: boolean;
  chartTemplateKey: string | null;
  chartTemplateVersion: number | null;
  chartTemplateChecksum: string | null;
  chartTemplateAppliedAt: string | null;
  chartAccountCount: number;
  chartCoverageComplete: boolean;
  globalShadowConflict: boolean;
  chartConflicts: number;
  requiredPostingRolesMissing: string[];
  requiredTaxAccountRolesMissing: string[];
  taxProfilesNeedingReview: number;
  taxConfigurationRequired: boolean;
  bankLedgerLinksInvalid: number;
  legacyTaxHeaderMismatches: number;
  sourcePostingErrors: number;
}): ChartOfAccountsReadiness {
  const readyForManualLedger = input.chartTemplateApplied
    && input.chartAccountCount > 0
    && input.chartCoverageComplete
    && !input.globalShadowConflict;
  const taxReady = !input.taxConfigurationRequired
    || (
      input.requiredTaxAccountRolesMissing.length === 0
      && input.taxProfilesNeedingReview === 0
      && input.legacyTaxHeaderMismatches === 0
    );

  return {
    chartTemplateApplied: input.chartTemplateApplied,
    chartTemplateKey: input.chartTemplateKey,
    chartTemplateVersion: input.chartTemplateVersion,
    chartTemplateChecksum: input.chartTemplateChecksum,
    chartTemplateAppliedAt: input.chartTemplateAppliedAt,
    chartAccountCount: input.chartAccountCount,
    chartConflicts: input.chartConflicts,
    requiredPostingRolesMissing: [...input.requiredPostingRolesMissing].sort(),
    requiredTaxAccountRolesMissing: [...input.requiredTaxAccountRolesMissing].sort(),
    taxProfilesNeedingReview: input.taxProfilesNeedingReview,
    bankLedgerLinksInvalid: input.bankLedgerLinksInvalid,
    legacyTaxHeaderMismatches: input.legacyTaxHeaderMismatches,
    sourcePostingErrors: input.sourcePostingErrors,
    taxConfigurationRequired: input.taxConfigurationRequired,
    readyForManualLedger,
    readyForAutomaticPosting: readyForManualLedger
      && input.requiredPostingRolesMissing.length === 0
      && taxReady
      && input.bankLedgerLinksInvalid === 0
      && input.sourcePostingErrors === 0,
  };
}
