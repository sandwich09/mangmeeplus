import type {
  TaxAccountDeterminationRuleDto,
  TaxCodeDefinitionDto,
  TaxReportMappingRuleDto,
} from '@watchdog-bms/contracts';
import { resolveTaxEvidencePolicy } from './tax-evidence-policy.logic';

type AccountExpectation = { accountRole: TaxAccountDeterminationRuleDto['accountRole']; postingSide: 'DEBIT' | 'CREDIT' };
type ReportExpectation = Pick<TaxReportMappingRuleDto, 'formType' | 'boxKey' | 'amountSource'>;

export function validateTaxCodeDefinition(definition: Pick<TaxCodeDefinitionDto, 'taxRegime' | 'direction' | 'treatment' | 'transactionContexts' | 'rate' | 'calculationMethod' | 'claimabilityDefault' | 'effectiveFrom' | 'effectiveTo'> & { evidenceRuleKey?: string | null }): string[] {
  const errors: string[] = [];
  const rate = Number(definition.rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) errors.push('Tax rate must be between 0 and 100');
  const zeroTreatment = ['ZERO_RATED', 'EXEMPT', 'NON_TAXABLE', 'OUTSIDE_SCOPE'].includes(definition.treatment);
  if (zeroTreatment && (rate !== 0 || definition.calculationMethod !== 'NONE')) errors.push(`${definition.treatment} requires rate 0 and calculation method NONE`);
  if (['STANDARD', 'CLAIMABLE', 'REVERSE_CHARGE'].includes(definition.treatment) && (!(rate > 0) || definition.calculationMethod === 'NONE')) errors.push(`${definition.treatment} requires a positive rate and tax calculation method`);
  if (!definition.transactionContexts.length) errors.push('At least one transaction context is required');
  if (!['OUTPUT', 'INPUT', 'SELF_ASSESSED'].includes(definition.direction)) errors.push('VAT Tax Codes support only OUTPUT, INPUT, or SELF_ASSESSED direction');
  if (definition.direction === 'OUTPUT' && definition.transactionContexts.some((context) => context.includes('PURCHASE') || context.startsWith('IMPORT_'))) errors.push('OUTPUT direction is incompatible with purchase/import context');
  if (definition.direction === 'INPUT' && definition.transactionContexts.some((context) => context.includes('SALE') || context.startsWith('EXPORT_'))) errors.push('INPUT direction is incompatible with sale/export context');
  if (definition.direction === 'SELF_ASSESSED' && !definition.transactionContexts.includes('IMPORT_SERVICE')) errors.push('SELF_ASSESSED is supported only for imported services');
  if (definition.claimabilityDefault === 'PARTIAL') errors.push('Partial deductibility requires an explicit split policy and is not yet activatable');
  if (definition.evidenceRuleKey) {
    const policyErrors = definition.transactionContexts.flatMap((context) => resolveTaxEvidencePolicy(context, definition.evidenceRuleKey).errors);
    errors.push(...new Set(policyErrors));
  }
  if (new Date(definition.effectiveFrom) > new Date(definition.effectiveTo ?? '9999-12-31')) errors.push('effectiveTo must be on or after effectiveFrom');
  return errors;
}

export function requiredAccountAssignments(definition: TaxCodeDefinitionDto): AccountExpectation[] {
  if (definition.transactionContexts.includes('IMPORT_SERVICE') && definition.direction === 'SELF_ASSESSED') {
    return [
      { accountRole: 'PP36_OUTPUT_VAT_PAYABLE', postingSide: 'CREDIT' },
      { accountRole: 'INPUT_VAT_PENDING', postingSide: 'DEBIT' },
      { accountRole: 'PP36_INPUT_VAT_CLAIMABLE', postingSide: 'DEBIT' },
    ];
  }
  if (definition.transactionContexts.includes('IMPORT_GOODS')) return [
    { accountRole: definition.claimabilityDefault === 'PENDING_EVIDENCE' ? 'IMPORT_VAT_PENDING' : 'IMPORT_VAT_CLAIMABLE', postingSide: 'DEBIT' },
    { accountRole: 'IMPORT_TAX_SETTLEMENT_PAYABLE', postingSide: 'CREDIT' },
  ];
  if (definition.direction === 'OUTPUT') return Number(definition.rate) === 0 ? [] : [{
    accountRole: definition.treatment === 'DEFERRED' ? 'OUTPUT_VAT_DEFERRED' : 'OUTPUT_VAT_PAYABLE', postingSide: 'CREDIT',
  }];
  if (definition.direction === 'INPUT') {
    const role = definition.claimabilityDefault === 'CLAIMABLE' ? 'INPUT_VAT_CLAIMABLE'
      : definition.claimabilityDefault === 'PENDING_EVIDENCE' ? 'INPUT_VAT_PENDING'
        : definition.claimabilityDefault === 'NONDEDUCTIBLE_CAPITALIZED' ? 'NONDEDUCTIBLE_VAT_CAPITALIZED'
          : definition.claimabilityDefault === 'NONDEDUCTIBLE_EXPENSE' ? 'NONDEDUCTIBLE_VAT_EXPENSE'
            : definition.treatment === 'DEFERRED' ? 'INPUT_VAT_DEFERRED' : null;
    if (!role) return [];
    return Number(definition.rate) === 0 ? [] : [{ accountRole: role, postingSide: 'DEBIT' }];
  }
  return [];
}

export function requiredReportMappings(definition: TaxCodeDefinitionDto): ReportExpectation[] {
  if (definition.transactionContexts.includes('IMPORT_SERVICE') && definition.direction === 'SELF_ASSESSED') return [
    { formType: 'PP36', boxKey: 'tax_due', amountSource: 'TAX_AMOUNT' },
    ...(definition.claimabilityDefault === 'CLAIMABLE' ? [
      { formType: 'PP30' as const, boxKey: 'box_6_eligible_purchases', amountSource: 'TAX_BASE' as const },
      { formType: 'PP30' as const, boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT' as const },
    ] : []),
  ];
  if (definition.direction === 'OUTPUT' && definition.treatment === 'STANDARD') return [
    { formType: 'PP30', boxKey: 'box_1_total_sales', amountSource: 'TAX_BASE' },
    { formType: 'PP30', boxKey: 'box_5_output_tax', amountSource: 'TAX_AMOUNT' },
  ];
  if (definition.direction === 'OUTPUT' && definition.treatment === 'ZERO_RATED') return [
    { formType: 'PP30', boxKey: 'box_1_total_sales', amountSource: 'TAX_BASE' },
    { formType: 'PP30', boxKey: 'box_2_zero_rated_sales', amountSource: 'TAX_BASE' },
  ];
  if (definition.direction === 'OUTPUT' && definition.treatment === 'EXEMPT') return [
    { formType: 'PP30', boxKey: 'box_1_total_sales', amountSource: 'TAX_BASE' },
    { formType: 'PP30', boxKey: 'box_3_exempt_sales', amountSource: 'TAX_BASE' },
  ];
  if (definition.direction === 'INPUT' && definition.claimabilityDefault === 'CLAIMABLE') return [
    { formType: 'PP30', boxKey: 'box_6_eligible_purchases', amountSource: 'TAX_BASE' },
    { formType: 'PP30', boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT' },
  ];
  return [];
}

export function validateAccountRuleSemantic(definition: TaxCodeDefinitionDto, rule: Pick<TaxAccountDeterminationRuleDto, 'accountRole' | 'postingSide'>): string | null {
  const fullRule = rule as TaxAccountDeterminationRuleDto;
  if (fullRule.transactionContext && !definition.transactionContexts.includes(fullRule.transactionContext)) return 'Account-rule transaction context is not supported by the definition';
  const importComponentExpectations: Record<string, AccountExpectation[]> = definition.transactionContexts.includes('IMPORT_GOODS') ? {
    CUSTOMS_DUTY: [{ accountRole: 'CUSTOMS_DUTY_CAPITALIZED', postingSide: 'DEBIT' }, { accountRole: 'CUSTOMS_DUTY_EXPENSE', postingSide: 'DEBIT' }, { accountRole: 'CUSTOMS_DUTY_PAYABLE', postingSide: 'CREDIT' }],
    EXCISE_TAX: [{ accountRole: 'EXCISE_TAX_EXPENSE_OR_COST', postingSide: 'DEBIT' }, { accountRole: 'EXCISE_TAX_PAYABLE', postingSide: 'CREDIT' }],
    MUNICIPAL_OR_OTHER_IMPORT_TAX: [{ accountRole: 'CUSTOMS_DUTY_CAPITALIZED', postingSide: 'DEBIT' }, { accountRole: 'CUSTOMS_DUTY_EXPENSE', postingSide: 'DEBIT' }, { accountRole: 'IMPORT_TAX_SETTLEMENT_PAYABLE', postingSide: 'CREDIT' }],
  } : {};
  const synthetic = importComponentExpectations[fullRule.taxRegime];
  if (synthetic) {
    if (fullRule.direction !== 'INPUT' || fullRule.treatment !== 'NONDEDUCTIBLE_CAPITALIZED') return 'Import statutory component rules require INPUT/NONDEDUCTIBLE_CAPITALIZED';
    return synthetic.some((item) => item.accountRole === rule.accountRole && item.postingSide === rule.postingSide) ? null : `Account role ${rule.accountRole}/${rule.postingSide} is not valid for ${fullRule.taxRegime}`;
  }
  if (fullRule.taxRegime && fullRule.taxRegime !== definition.taxRegime) return 'Account-rule regime must match its Tax Code definition';
  if (fullRule.direction && fullRule.direction !== definition.direction) return 'Account-rule direction must match its Tax Code definition';
  if (fullRule.treatment && fullRule.treatment !== definition.treatment) return 'Account-rule treatment must match its Tax Code definition';
  const expected = requiredAccountAssignments(definition);
  return expected.some((item) => item.accountRole === rule.accountRole && item.postingSide === rule.postingSide)
    ? null : `Account role ${rule.accountRole}/${rule.postingSide} is not valid for ${definition.direction}/${definition.treatment}`;
}

export function validateReportRuleSemantic(definition: TaxCodeDefinitionDto, rule: ReportExpectation): string | null {
  if (definition.transactionContexts.includes('IMPORT_GOODS') && rule.formType === 'CUSTOMS_SUPPORT') {
    const allowed = [
      ['customs_duty', 'DUTY'], ['excise_tax', 'OTHER'], ['other_import_tax', 'OTHER'],
    ];
    return allowed.some(([boxKey, amountSource]) => rule.boxKey === boxKey && rule.amountSource === amountSource)
      ? null : 'Customs-support mapping must use customs_duty/DUTY, excise_tax/OTHER, or other_import_tax/OTHER';
  }
  const expected = requiredReportMappings(definition);
  return expected.some((item) => item.formType === rule.formType && item.boxKey === rule.boxKey && item.amountSource === rule.amountSource)
    ? null : `Report mapping ${rule.formType}/${rule.boxKey}/${rule.amountSource} is not valid for ${definition.direction}/${definition.treatment}`;
}

export function ruleCoversDefinition(definition: TaxCodeDefinitionDto, rule: { effectiveFrom: string; effectiveTo: string | null }): boolean {
  return new Date(rule.effectiveFrom) <= new Date(definition.effectiveFrom)
    && (!definition.effectiveTo || !rule.effectiveTo || new Date(rule.effectiveTo) >= new Date(definition.effectiveTo));
}

export function missingConfiguration(
  definition: TaxCodeDefinitionDto,
  accountRules: TaxAccountDeterminationRuleDto[],
  reportRules: TaxReportMappingRuleDto[],
): string[] {
  const missingAccounts = requiredAccountAssignments(definition).filter((expected) => !accountRules.some((rule) => rule.accountRole === expected.accountRole && rule.postingSide === expected.postingSide));
  const missingReports = requiredReportMappings(definition).filter((expected) => !reportRules.some((rule) => rule.formType === expected.formType && rule.boxKey === expected.boxKey && rule.amountSource === expected.amountSource));
  return [
    ...missingAccounts.map((item) => `account:${item.accountRole}/${item.postingSide}`),
    ...missingReports.map((item) => `report:${item.formType}/${item.boxKey}/${item.amountSource}`),
  ];
}
