import type {
  TaxCodeDefinitionDto,
  TaxProfileSetupBlocker,
  UpsertTaxAccountDeterminationRuleInput,
  UpsertTaxReportMappingRuleInput,
} from '@watchdog-bms/contracts';

export type AccountingTaxSetupStep =
  | 'overview'
  | 'prerequisites'
  | 'chart'
  | 'chart-review'
  | 'profile'
  | 'mappings'
  | 'review';

export const ACCOUNTING_TAX_SETUP_STEPS = [
  { key: 'prerequisites', label: 'ตรวจความพร้อม' },
  { key: 'chart', label: 'ผังบัญชี' },
  { key: 'profile', label: 'ชุดรหัสภาษี (Tax Profile)' },
  { key: 'mappings', label: 'ผูกบัญชีและรายงาน' },
  { key: 'review', label: 'ตรวจและเปิดใช้' },
] as const;

const STEP_PATH: Record<AccountingTaxSetupStep, string> = {
  overview: '',
  prerequisites: '/prerequisites',
  chart: '/chart',
  'chart-review': '/chart/review',
  profile: '/profile',
  mappings: '/mappings',
  review: '/review',
};

export function accountingTaxSetupHref(
  companyId: string,
  step: AccountingTaxSetupStep,
  params: { profileId?: string; returnTo?: string } = {},
): string {
  const query = new URLSearchParams();
  if (params.profileId) query.set('profileId', params.profileId);
  if (params.returnTo) query.set('returnTo', params.returnTo);
  const suffix = query.toString();
  return `/companies/${companyId}/settings/accounting-tax-setup${STEP_PATH[step]}${suffix ? `?${suffix}` : ''}`;
}

export function safeAccountingReturnTo(companyId: string, value?: string): string | null {
  if (!value || !value.startsWith(`/companies/${companyId}/`) || value.startsWith('//')) return null;
  try {
    const url = new URL(value, 'https://workspace.invalid');
    return url.origin === 'https://workspace.invalid' && url.pathname.startsWith(`/companies/${companyId}/`)
      ? `${url.pathname}${url.search}${url.hash}`
      : null;
  } catch {
    return null;
  }
}

export function earliestAccountingTaxSetupStep(input: {
  prerequisitesReady: boolean;
  chartReady: boolean;
  profileId?: string;
  profileReady?: boolean;
}): AccountingTaxSetupStep {
  if (!input.prerequisitesReady) return 'prerequisites';
  if (!input.chartReady) return 'chart';
  if (!input.profileId) return 'profile';
  return input.profileReady ? 'review' : 'mappings';
}

export function guidedAccountRuleInput(
  definition: TaxCodeDefinitionDto,
  blocker: TaxProfileSetupBlocker,
  accountId: string,
): UpsertTaxAccountDeterminationRuleInput {
  if (blocker.code !== 'missing_account_rule' || blocker.taxCodeDefinitionId !== definition.id
    || !blocker.accountRole || !blocker.postingSide || !accountId) {
    throw new Error('invalid_guided_account_mapping');
  }
  return {
    taxCodeDefinitionId: definition.id,
    taxRegime: definition.taxRegime,
    direction: definition.direction,
    treatment: definition.treatment,
    transactionContext: definition.transactionContexts[0] ?? null,
    sourceModule: null,
    accountRole: blocker.accountRole,
    accountId,
    postingSide: blocker.postingSide,
    priority: 100,
    effectiveFrom: definition.effectiveFrom,
    effectiveTo: definition.effectiveTo,
  };
}

export function guidedReportRuleInput(
  definition: TaxCodeDefinitionDto,
  blocker: TaxProfileSetupBlocker,
): UpsertTaxReportMappingRuleInput {
  if (blocker.code !== 'missing_report_rule' || blocker.taxCodeDefinitionId !== definition.id
    || !blocker.formType || !blocker.boxKey || !blocker.amountSource) {
    throw new Error('invalid_guided_report_mapping');
  }
  return {
    taxCodeDefinitionId: definition.id,
    formType: blocker.formType,
    boxKey: blocker.boxKey,
    amountSource: blocker.amountSource,
    signRule: 'NORMAL',
    effectiveFrom: definition.effectiveFrom,
    effectiveTo: definition.effectiveTo,
  };
}
