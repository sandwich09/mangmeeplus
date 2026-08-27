import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type {
  Pp30BoxesDto,
  ResolveTransactionTaxPreviewDto,
  TaxAccountDeterminationRuleDto,
  TaxCodeDefinitionDto,
  TaxHeaderSummary,
  TaxReportContribution,
  TaxReportMappingRuleDto,
  TaxRoundingMode,
  TransactionTaxComponentPreview,
  TransactionTaxDirection,
  TransactionTaxLineInput,
  TransactionTaxRoundingPolicy,
  TransactionTaxSnapshot,
} from '@watchdog-bms/contracts';
import { requiredReportMappings } from './tax-configuration.logic';

const ZERO = new Decimal(0);
const DEFAULT_ROUNDING_POLICY: TransactionTaxRoundingPolicy = {
  roundingMode: 'HALF_UP',
  roundingScale: 2,
  taxAmountTolerance: '0.01',
};

const DECIMAL_ROUNDING_MODE: Record<TaxRoundingMode, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  DOWN: Decimal.ROUND_DOWN,
  UP: Decimal.ROUND_UP,
};

export function normalizeTaxRoundingPolicy(policy?: Partial<TransactionTaxRoundingPolicy>): TransactionTaxRoundingPolicy {
  const resolved: TransactionTaxRoundingPolicy = {
    roundingMode: policy?.roundingMode ?? DEFAULT_ROUNDING_POLICY.roundingMode,
    roundingScale: policy?.roundingScale ?? DEFAULT_ROUNDING_POLICY.roundingScale,
    taxAmountTolerance: policy?.taxAmountTolerance ?? DEFAULT_ROUNDING_POLICY.taxAmountTolerance,
  };
  if (!(resolved.roundingMode in DECIMAL_ROUNDING_MODE)) throw new Error('invalid_tax_rounding_mode');
  if (!Number.isInteger(resolved.roundingScale) || resolved.roundingScale < 0 || resolved.roundingScale > 4) throw new Error('invalid_tax_rounding_scale');
  if (!new Decimal(resolved.taxAmountTolerance).isFinite() || new Decimal(resolved.taxAmountTolerance).isNegative()) throw new Error('invalid_tax_amount_tolerance');
  return resolved;
}

export function formatTransactionTaxAmount(value: Decimal.Value, policy?: Partial<TransactionTaxRoundingPolicy>): string {
  const resolved = normalizeTaxRoundingPolicy(policy);
  return new Decimal(value).toDecimalPlaces(resolved.roundingScale, DECIMAL_ROUNDING_MODE[resolved.roundingMode]).toFixed(resolved.roundingScale);
}

export function aggregateTaxRoundingPolicy(
  policies: Array<Partial<TransactionTaxRoundingPolicy> | null | undefined>,
): TransactionTaxRoundingPolicy {
  const resolved = policies.length ? policies.map((policy) => normalizeTaxRoundingPolicy(policy ?? undefined)) : [normalizeTaxRoundingPolicy()];
  const roundingMode = resolved.every((policy) => policy.roundingMode === resolved[0]!.roundingMode)
    ? resolved[0]!.roundingMode : DEFAULT_ROUNDING_POLICY.roundingMode;
  return {
    roundingMode,
    roundingScale: Math.max(...resolved.map((policy) => policy.roundingScale)),
    taxAmountTolerance: resolved.reduce((largest, policy) => Decimal.max(largest, policy.taxAmountTolerance), ZERO).toString(),
  };
}

function money(value: Decimal.Value, policy: TransactionTaxRoundingPolicy = DEFAULT_ROUNDING_POLICY): string {
  return formatTransactionTaxAmount(value, policy);
}

function activeAt(from: string, to: string | null, at: string): boolean {
  const day = at.slice(0, 10);
  return from.slice(0, 10) <= day && (!to || to.slice(0, 10) >= day);
}

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sourceCurrency(input: TransactionTaxLineInput): string { return input.currency.toUpperCase(); }
function taxCurrency(input: TransactionTaxLineInput): string { return (input.taxCurrency ?? input.currency).toUpperCase(); }
function sourceAmount(value: Decimal.Value, input: TransactionTaxLineInput): Decimal {
  return new Decimal(value).mul(sourceCurrency(input) === taxCurrency(input) ? 1 : input.exchangeRate ?? 0);
}

function currencyErrors(input: TransactionTaxLineInput): string[] {
  if (sourceCurrency(input) === taxCurrency(input)) return [];
  try {
    if (new Decimal(input.exchangeRate ?? 0).lte(0) || !input.exchangeRateSource || !input.exchangeRateDate) return ['functional_currency_fx_required'];
  } catch { return ['functional_currency_fx_required']; }
  return [];
}

export function deriveTaxHeaderSummary(snapshots: Array<Pick<TransactionTaxSnapshot, 'externalTaxCode' | 'taxCodeDefinitionId'>>): TaxHeaderSummary {
  const keys = new Set(snapshots.map((s) => s.taxCodeDefinitionId ?? s.externalTaxCode).filter(Boolean));
  return keys.size === 0 ? 'NONE' : keys.size === 1 ? 'SINGLE' : 'MIXED';
}

export function findEffectiveTaxCode(
  definitions: TaxCodeDefinitionDto[],
  input: TransactionTaxLineInput,
  profileId?: string,
  direction?: TransactionTaxDirection,
): { definition: TaxCodeDefinitionDto | null; errors: string[] } {
  const matches = definitions.filter((definition) =>
    definition.status === 'ACTIVE'
    && (!profileId || definition.profileId === profileId)
    && (!direction || definition.direction === direction || definition.direction === 'SELF_ASSESSED')
    && (!input.taxCodeDefinitionId || definition.id === input.taxCodeDefinitionId)
    && (!input.externalTaxCode || definition.externalCode.toUpperCase() === input.externalTaxCode.toUpperCase())
    && definition.transactionContexts.includes(input.transactionContext)
    && activeAt(definition.effectiveFrom, definition.effectiveTo, input.documentDate),
  );
  if (matches.length === 0) return { definition: null, errors: ['tax_code_not_active_or_not_applicable'] };
  if (matches.length > 1) return { definition: null, errors: ['tax_code_ambiguous'] };
  return { definition: matches[0]!, errors: [] };
}

export function selectTaxAccountRule(
  rules: TaxAccountDeterminationRuleDto[],
  definition: TaxCodeDefinitionDto,
  input: TransactionTaxLineInput,
  sourceModule?: string,
): { rule: TaxAccountDeterminationRuleDto | null; errors: string[] } {
  const ranked = rules
    .filter((rule) => rule.status === 'ACTIVE'
      && rule.taxRegime === definition.taxRegime
      && rule.direction === definition.direction
      && rule.treatment === definition.treatment
      && (!rule.taxCodeDefinitionId || rule.taxCodeDefinitionId === definition.id)
      && (!rule.transactionContext || rule.transactionContext === input.transactionContext)
      && (!rule.sourceModule || rule.sourceModule === sourceModule)
      && activeAt(rule.effectiveFrom, rule.effectiveTo, input.documentDate))
    .map((rule) => ({
      rule,
      specificity: (rule.taxCodeDefinitionId ? 4 : 0) + (rule.transactionContext ? 2 : 0) + (rule.sourceModule ? 1 : 0),
    }))
    .sort((a, b) => b.specificity - a.specificity || b.rule.priority - a.rule.priority || b.rule.version - a.rule.version);
  if (!ranked[0]) return { rule: null, errors: ['tax_account_rule_missing'] };
  if (ranked[1] && ranked[1].specificity === ranked[0].specificity && ranked[1].rule.priority === ranked[0].rule.priority) {
    return { rule: null, errors: ['tax_account_rule_ambiguous'] };
  }
  return { rule: ranked[0].rule, errors: [] };
}

function accountAssignments(
  rules: TaxAccountDeterminationRuleDto[],
  definition: TaxCodeDefinitionDto,
  input: TransactionTaxLineInput,
  requiredRoles: TaxAccountDeterminationRuleDto['accountRole'][],
  sourceModule?: string,
): { assignments: TransactionTaxComponentPreview['accountAssignments']; errors: string[] } {
  const assignments: TransactionTaxComponentPreview['accountAssignments'] = [];
  const errors: string[] = [];
  for (const role of requiredRoles) {
    const selected = selectTaxAccountRule(rules.filter((rule) => rule.accountRole === role), definition, input, sourceModule);
    if (!selected.rule) errors.push(`${selected.errors[0] ?? 'tax_account_rule_missing'}:${role}`);
    else assignments.push({ accountRole: role, accountId: selected.rule.accountId, postingSide: selected.rule.postingSide, ruleVersion: selected.rule.version });
  }
  return { assignments, errors };
}

function calculateAmounts(definition: TaxCodeDefinitionDto, input: TransactionTaxLineInput, policy: TransactionTaxRoundingPolicy): { base: Decimal; tax: Decimal; errors: string[] } {
  const sign = input.correctionSign ?? 1;
  const net = sourceAmount(input.netAmount, input).abs();
  const gross = sourceAmount(input.grossAmount, input).abs();
  const rate = new Decimal(definition.rate);
  let base = net;
  let tax = ZERO;
  if (input.transactionContext === 'IMPORT_SERVICE' && definition.direction === 'SELF_ASSESSED'
    && (input.authoritativeSelfAssessedTaxBaseAmount !== undefined || input.authoritativeSelfAssessedTaxAmount !== undefined)) {
    base = new Decimal(input.authoritativeSelfAssessedTaxBaseAmount ?? net).abs();
    tax = input.authoritativeSelfAssessedTaxAmount === undefined
      ? net.mul(rate).div(100)
      : new Decimal(input.authoritativeSelfAssessedTaxAmount).abs();
  } else if (input.transactionContext === 'IMPORT_GOODS' && input.authoritativeImportVatAmount !== undefined) {
    base = new Decimal(input.authoritativeCustomsValue ?? input.netAmount).abs();
    tax = new Decimal(input.authoritativeImportVatAmount).abs();
  } else
  if (definition.calculationMethod === 'INCLUSIVE' && rate.gt(0)) {
    base = gross.mul(100).div(rate.add(100));
    tax = gross.minus(base);
  } else if (definition.calculationMethod === 'EXCLUSIVE' && rate.gt(0)) {
    tax = net.mul(rate).div(100);
  }
  base = new Decimal(money(base, policy)).mul(sign);
  tax = new Decimal(money(tax, policy)).mul(sign);
  const errors: string[] = currencyErrors(input);
  if (['ZERO_RATED', 'EXEMPT', 'NON_TAXABLE', 'OUTSIDE_SCOPE'].includes(definition.treatment) && !tax.isZero()) {
    errors.push('zero_tax_treatment_has_tax_amount');
  }
  const selfAssessedService = definition.direction === 'SELF_ASSESSED' && input.transactionContext === 'IMPORT_SERVICE';
  if (!selfAssessedService && input.enteredTaxAmount !== undefined && sourceAmount(input.enteredTaxAmount, input).minus(tax).abs().gt(policy.taxAmountTolerance)) {
    errors.push('entered_tax_amount_outside_tolerance');
  }
  return { base, tax, errors };
}

function reportAmount(source: TaxReportMappingRuleDto['amountSource'], base: Decimal, tax: Decimal, input: TransactionTaxLineInput): Decimal {
  if (source === 'TAX_BASE') return base;
  if (source === 'TAX_AMOUNT') return tax;
  if (source === 'GROSS') return sourceAmount(input.grossAmount, input).mul(input.correctionSign ?? 1);
  if (source === 'DUTY') return new Decimal(input.authoritativeDutyAmount ?? 0).mul(input.correctionSign ?? 1);
  if (source === 'OTHER') return new Decimal(input.authoritativeExciseAmount ?? 0).add(input.authoritativeOtherTaxAmount ?? 0).mul(input.correctionSign ?? 1);
  return ZERO;
}

export function resolveTransactionTaxPreview(args: {
  definitions: TaxCodeDefinitionDto[];
  accountRules: TaxAccountDeterminationRuleDto[];
  reportRules: TaxReportMappingRuleDto[];
  input: TransactionTaxLineInput;
  profileId?: string;
  direction?: TransactionTaxDirection;
  sourceModule?: string;
  profileKey?: string;
  profileVersion?: number;
  roundingPolicy?: Partial<TransactionTaxRoundingPolicy>;
  /** Internal ERP input, deliberately absent from the public TransactionTaxLineInput. */
  acceptedExpenseVatRate?: string;
}): ResolveTransactionTaxPreviewDto {
  const roundingPolicy = normalizeTaxRoundingPolicy(args.roundingPolicy);
  const found = findEffectiveTaxCode(args.definitions, args.input, args.profileId, args.direction);
  const empty: TransactionTaxSnapshot = {
    taxCodeDefinitionId: null, externalTaxCode: args.input.externalTaxCode ?? null,
    taxProfileKey: args.profileKey ?? null, taxProfileVersion: args.profileVersion ?? null, ...roundingPolicy,
    taxRegime: null, taxDirection: null, taxTreatment: 'NEEDS_REVIEW', taxContext: args.input.transactionContext,
    taxRate: '0', sourceCurrency: sourceCurrency(args.input), taxCurrency: taxCurrency(args.input),
    exchangeRate: args.input.exchangeRate ?? (sourceCurrency(args.input) === taxCurrency(args.input) ? '1' : '0'),
    exchangeRateSource: args.input.exchangeRateSource ?? (sourceCurrency(args.input) === taxCurrency(args.input) ? 'FUNCTIONAL_CURRENCY' : ''),
    exchangeRateDate: args.input.exchangeRateDate ?? args.input.documentDate,
    taxBaseAmount: money(sourceAmount(args.input.netAmount, args.input), roundingPolicy), taxAmount: money(0, roundingPolicy), claimability: 'PENDING_EVIDENCE',
    evidenceStatus: 'REVIEW_REQUIRED', accountRuleVersion: null, reportRuleVersion: null,
    recognitionDate: null, evidenceRefs: [],
  };
  if (!found.definition) return {
    components: [], snapshot: empty, accountRole: null, accountId: null, reportContributions: [], warnings: [], errors: found.errors,
    sourceChecksum: checksum(args.input), configurationChecksum: checksum({ roundingPolicy }),
  };

  const definition = found.definition;
  const calculated = calculateAmounts(definition, args.input, roundingPolicy);
  if (args.acceptedExpenseVatRate !== undefined) {
    const entered = new Decimal(args.input.enteredTaxAmount ?? -1);
    const acceptedBase = new Decimal(args.input.netAmount);
    const acceptedGross = new Decimal(args.input.grossAmount);
    if (args.input.sourceType !== 'expense.record' || args.sourceModule !== 'expense'
      || args.input.transactionContext !== 'DOMESTIC_PURCHASE' || definition.direction !== 'INPUT'
      || definition.taxRegime !== 'VAT' || sourceCurrency(args.input) !== taxCurrency(args.input)
      || (args.input.correctionSign ?? 1) !== 1 || !entered.isFinite() || entered.lt(0)
      || !acceptedBase.isFinite() || acceptedBase.lt(0) || !acceptedBase.plus(entered).eq(acceptedGross)
      || !new Decimal(money(entered, roundingPolicy)).eq(entered)
      || !new Decimal(money(acceptedBase, roundingPolicy)).eq(acceptedBase)) {
      calculated.errors.push('accepted_expense_vat_amount_invalid');
    } else if (!new Decimal(args.acceptedExpenseVatRate).mul(100).eq(definition.rate)) {
      calculated.errors.push('accepted_expense_vat_rate_conflict');
    } else if (!calculated.errors.length) {
      // The profile's entered-tax tolerance was checked above. Preserve the accepted source
      // base/VAT for snapshots, report contributions and posting, not another calculated total.
      calculated.base = acceptedBase;
      calculated.tax = entered;
    }
  }
  const evidenceRequired = Boolean(definition.evidenceRuleKey)
    || (definition.treatment === 'ZERO_RATED' && args.input.transactionContext.startsWith('EXPORT_'))
    || ['IMPORT_GOODS', 'IMPORT_SERVICE'].includes(args.input.transactionContext);
  const evidenceOk = !evidenceRequired || (args.input.evidenceRefs?.length ?? 0) > 0;
  const isPp36 = args.input.transactionContext === 'IMPORT_SERVICE' && definition.direction === 'SELF_ASSESSED';
  const claimEvidenceOk = isPp36 ? args.input.pp36InputClaimEvidenceVerified === true : evidenceOk;
  const claimability = !claimEvidenceOk && ['INPUT', 'SELF_ASSESSED'].includes(definition.direction)
    ? 'PENDING_EVIDENCE'
    : definition.claimabilityDefault;
  const isImportGoods = args.input.transactionContext === 'IMPORT_GOODS';
  const expectedRole = definition.direction === 'OUTPUT'
    ? definition.treatment === 'DEFERRED' ? 'OUTPUT_VAT_DEFERRED' : 'OUTPUT_VAT_PAYABLE'
    : claimability === 'PENDING_EVIDENCE' ? 'INPUT_VAT_PENDING'
      : claimability === 'NONDEDUCTIBLE_EXPENSE' ? 'NONDEDUCTIBLE_VAT_EXPENSE'
        : claimability === 'NONDEDUCTIBLE_CAPITALIZED' ? 'NONDEDUCTIBLE_VAT_CAPITALIZED'
          : definition.treatment === 'DEFERRED' ? 'INPUT_VAT_DEFERRED' : 'INPUT_VAT_CLAIMABLE';
  const account = calculated.tax.isZero() || isPp36 || isImportGoods
    ? { rule: null, errors: [] }
    : selectTaxAccountRule(args.accountRules.filter((rule) => rule.accountRole === expectedRole), definition, args.input, args.sourceModule);
  const matchingReportRules = args.reportRules.filter((rule) => rule.status === 'ACTIVE'
    && rule.taxCodeDefinitionId === definition.id
    && activeAt(rule.effectiveFrom, rule.effectiveTo, args.input.documentDate));
  const reportContributions: TaxReportContribution[] = matchingReportRules.map((rule) => {
    const value = reportAmount(rule.amountSource, calculated.base, calculated.tax, args.input);
    return { formType: rule.formType, boxKey: rule.boxKey, amountSource: rule.amountSource, amount: money(rule.signRule === 'INVERT' ? value.negated() : value, roundingPolicy) };
  });
  const errors = [...calculated.errors, ...account.errors];
  if (!evidenceOk) errors.push('tax_evidence_required');
  const requiredReports = requiredReportMappings({ ...definition, claimabilityDefault: claimability });
  if (requiredReports.some((expected) => !matchingReportRules.some((rule) => rule.formType === expected.formType && rule.boxKey === expected.boxKey && rule.amountSource === expected.amountSource))) errors.push('tax_report_rule_missing');
  if (claimability === 'PARTIAL') errors.push('partial_deductibility_split_policy_required');
  const snapshot: TransactionTaxSnapshot = {
    taxCodeDefinitionId: definition.id,
    externalTaxCode: definition.externalCode,
    taxProfileKey: args.profileKey ?? definition.profileId,
    taxProfileVersion: args.profileVersion ?? 1,
    ...roundingPolicy,
    taxRegime: definition.taxRegime,
    taxDirection: definition.direction,
    taxTreatment: definition.treatment,
    taxContext: args.input.transactionContext,
    taxRate: definition.rate,
    sourceCurrency: sourceCurrency(args.input),
    taxCurrency: taxCurrency(args.input),
    exchangeRate: args.input.exchangeRate ?? (sourceCurrency(args.input) === taxCurrency(args.input) ? '1' : '0'),
    exchangeRateSource: args.input.exchangeRateSource ?? (sourceCurrency(args.input) === taxCurrency(args.input) ? 'FUNCTIONAL_CURRENCY' : ''),
    exchangeRateDate: args.input.exchangeRateDate ?? args.input.documentDate,
    taxBaseAmount: money(calculated.base, roundingPolicy),
    taxAmount: money(calculated.tax, roundingPolicy),
    claimability,
    evidenceStatus: evidenceOk && claimability !== 'PENDING_EVIDENCE' ? 'VERIFIED' : 'REVIEW_REQUIRED',
    accountRuleVersion: account.rule?.version ?? null,
    reportRuleVersion: matchingReportRules.length ? Math.max(...matchingReportRules.map((rule) => rule.version)) : null,
    recognitionDate: isPp36 ? args.input.paymentDate ?? null : args.input.documentDate,
    evidenceRefs: args.input.evidenceRefs ?? [],
  };
  const components: TransactionTaxComponentPreview[] = [];
  if (isPp36) {
    const output = selectTaxAccountRule(args.accountRules.filter((rule) => rule.accountRole === 'PP36_OUTPUT_VAT_PAYABLE'), definition, args.input, args.sourceModule);
    const inputRole = claimability === 'PENDING_EVIDENCE' ? 'INPUT_VAT_PENDING' : 'PP36_INPUT_VAT_CLAIMABLE';
    const inputAccount = selectTaxAccountRule(args.accountRules.filter((rule) => rule.accountRole === inputRole), definition, args.input, args.sourceModule);
    errors.push(...output.errors, ...inputAccount.errors);
    const outputSnapshot = { ...snapshot, taxDirection: 'SELF_ASSESSED' as const, claimability: 'NOT_APPLICABLE' as const,
      evidenceStatus: evidenceOk ? 'VERIFIED' as const : 'REVIEW_REQUIRED' as const, accountRuleVersion: output.rule?.version ?? null };
    const inputSnapshot = { ...snapshot, taxDirection: 'SELF_ASSESSED' as const, claimability,
      evidenceStatus: claimEvidenceOk && claimability !== 'PENDING_EVIDENCE' ? 'VERIFIED' as const : 'REVIEW_REQUIRED' as const,
      accountRuleVersion: inputAccount.rule?.version ?? null };
    const outputAssignments = output.rule ? [{ accountRole: output.rule.accountRole, accountId: output.rule.accountId, postingSide: output.rule.postingSide, ruleVersion: output.rule.version }] : [];
    const inputAssignments = inputAccount.rule ? [{ accountRole: inputAccount.rule.accountRole, accountId: inputAccount.rule.accountId, postingSide: inputAccount.rule.postingSide, ruleVersion: inputAccount.rule.version }] : [];
    components.push(
      { componentKey: 'PP36_OUTPUT', snapshot: outputSnapshot, accountRole: output.rule?.accountRole ?? null, accountId: output.rule?.accountId ?? null, accountAssignments: outputAssignments, reportContributions: matchingReportRules.filter((rule) => rule.formType === 'PP36').map((rule) => { const value = reportAmount(rule.amountSource, calculated.base, calculated.tax, args.input); return { formType: rule.formType, boxKey: rule.boxKey, amountSource: rule.amountSource, amount: money(rule.signRule === 'INVERT' ? value.negated() : value, roundingPolicy) }; }) },
      { componentKey: 'PP36_INPUT', snapshot: inputSnapshot, accountRole: inputAccount.rule?.accountRole ?? null, accountId: inputAccount.rule?.accountId ?? null, accountAssignments: inputAssignments, reportContributions: claimEvidenceOk ? reportContributions.filter((entry) => entry.formType === 'PP30') : [] },
    );
  } else if (isImportGoods) {
    const inputRole = claimability === 'PENDING_EVIDENCE' ? 'IMPORT_VAT_PENDING' : 'IMPORT_VAT_CLAIMABLE';
    const resolved = accountAssignments(args.accountRules, definition, args.input, [inputRole, 'IMPORT_TAX_SETTLEMENT_PAYABLE'], args.sourceModule);
    errors.push(...resolved.errors);
    components.push({ componentKey: 'IMPORT_VAT', snapshot: { ...snapshot, accountRuleVersion: resolved.assignments[0]?.ruleVersion ?? null }, accountRole: resolved.assignments[0]?.accountRole ?? null, accountId: resolved.assignments[0]?.accountId ?? null, accountAssignments: resolved.assignments, reportContributions: reportContributions.filter((entry) => entry.formType !== 'CUSTOMS_SUPPORT') });
  } else {
    const assignments = account.rule ? [{ accountRole: account.rule.accountRole, accountId: account.rule.accountId, postingSide: account.rule.postingSide, ruleVersion: account.rule.version }] : [];
    components.push({ componentKey: 'VAT', snapshot, accountRole: account.rule?.accountRole ?? null, accountId: account.rule?.accountId ?? null, accountAssignments: assignments, reportContributions });
  }

  if (args.input.transactionContext === 'IMPORT_GOODS') {
    const destinationRole = args.input.accountHint?.toUpperCase().includes('EXPENSE') ? 'CUSTOMS_DUTY_EXPENSE'
      : args.input.accountHint?.toUpperCase().includes('CAPITAL') ? 'CUSTOMS_DUTY_CAPITALIZED' : null;
    if (!destinationRole && [args.input.authoritativeDutyAmount, args.input.authoritativeOtherTaxAmount].some((amount) => amount && !new Decimal(amount).isZero())) errors.push('import_tax_destination_required');
    const assessed = [
      { componentKey: 'CUSTOMS_DUTY' as const, regime: 'CUSTOMS_DUTY' as const, amount: args.input.authoritativeDutyAmount, roles: [...(destinationRole ? [destinationRole] : []), 'CUSTOMS_DUTY_PAYABLE'] as TaxAccountDeterminationRuleDto['accountRole'][] },
      { componentKey: 'EXCISE_TAX' as const, regime: 'EXCISE_TAX' as const, amount: args.input.authoritativeExciseAmount, roles: ['EXCISE_TAX_EXPENSE_OR_COST', 'EXCISE_TAX_PAYABLE'] as TaxAccountDeterminationRuleDto['accountRole'][] },
      { componentKey: 'OTHER_IMPORT_TAX' as const, regime: 'MUNICIPAL_OR_OTHER_IMPORT_TAX' as const, amount: args.input.authoritativeOtherTaxAmount, roles: [...(destinationRole ? [destinationRole] : []), 'IMPORT_TAX_SETTLEMENT_PAYABLE'] as TaxAccountDeterminationRuleDto['accountRole'][] },
    ];
    for (const item of assessed) {
      if (!item.amount || new Decimal(item.amount).isZero()) continue;
      const synthetic = { ...definition, taxRegime: item.regime, direction: 'INPUT' as const, treatment: 'NONDEDUCTIBLE_CAPITALIZED' as const };
      const resolved = accountAssignments(args.accountRules, synthetic, args.input, item.roles, args.sourceModule);
      errors.push(...resolved.errors);
      const assessedSnapshot: TransactionTaxSnapshot = {
        ...snapshot, taxRegime: item.regime, taxDirection: 'INPUT', taxTreatment: 'NONDEDUCTIBLE_CAPITALIZED', taxRate: '0',
        taxBaseAmount: money(args.input.authoritativeCustomsValue ?? args.input.netAmount, roundingPolicy), taxAmount: money(new Decimal(item.amount).mul(args.input.correctionSign ?? 1), roundingPolicy),
        claimability: 'NONDEDUCTIBLE_CAPITALIZED', accountRuleVersion: resolved.assignments[0]?.ruleVersion ?? null,
      };
      const boxKey = item.componentKey === 'CUSTOMS_DUTY' ? 'customs_duty' : item.componentKey === 'EXCISE_TAX' ? 'excise_tax' : 'other_import_tax';
      const assessedContributions = matchingReportRules.filter((rule) => rule.formType === 'CUSTOMS_SUPPORT' && rule.boxKey === boxKey)
        .map((rule) => ({ formType: rule.formType, boxKey: rule.boxKey, amountSource: rule.amountSource, amount: money(new Decimal(item.amount ?? 0).mul(args.input.correctionSign ?? 1).mul(rule.signRule === 'INVERT' ? -1 : 1), roundingPolicy) }));
      components.push({ componentKey: item.componentKey, snapshot: assessedSnapshot, accountRole: resolved.assignments[0]?.accountRole ?? null, accountId: resolved.assignments[0]?.accountId ?? null, accountAssignments: resolved.assignments, reportContributions: assessedContributions });
    }
  }

  const config = { definition, roundingPolicy, components: components.map((component) => ({ role: component.accountRole, ruleVersion: component.snapshot.accountRuleVersion })), reportRules: matchingReportRules };
  return {
    components,
    snapshot,
    accountRole: account.rule?.accountRole ?? null,
    accountId: account.rule?.accountId ?? null,
    reportContributions,
    warnings: [],
    errors,
    sourceChecksum: checksum(args.input),
    configurationChecksum: checksum(config),
  };
}

export function aggregatePp30Boxes(
  contributions: TaxReportContribution[],
  policy?: Partial<TransactionTaxRoundingPolicy>,
): Pp30BoxesDto {
  const roundingPolicy = normalizeTaxRoundingPolicy(policy);
  const sum = (boxKey: string) => contributions
    .filter((entry) => entry.formType === 'PP30' && entry.boxKey === boxKey)
    .reduce((total, entry) => total.add(entry.amount), ZERO);
  const box1 = sum('box_1_total_sales');
  const box2 = sum('box_2_zero_rated_sales');
  const box3 = sum('box_3_exempt_sales');
  const box5 = sum('box_5_output_tax');
  const box6 = sum('box_6_eligible_purchases');
  const box7 = sum('box_7_input_tax');
  return {
    box1TotalSales: money(box1, roundingPolicy), box2ZeroRatedSales: money(box2, roundingPolicy), box3ExemptSales: money(box3, roundingPolicy),
    box4TaxableSales: money(box1.minus(box2).minus(box3), roundingPolicy), box5OutputTax: money(box5, roundingPolicy),
    box6EligiblePurchases: money(box6, roundingPolicy), box7InputTax: money(box7, roundingPolicy),
    box8TaxPayable: money(Decimal.max(box5.minus(box7), ZERO), roundingPolicy),
    box9TaxOverpaid: money(Decimal.max(box7.minus(box5), ZERO), roundingPolicy),
  };
}

export function legacyOutputTaxCodeSnapshot(
  code: 'O7' | 'O0' | 'OX' | null,
  base: string,
  tax: string,
  classification?: { taxContext: TransactionTaxSnapshot['taxContext']; evidenceStatus: TransactionTaxSnapshot['evidenceStatus'] },
): TransactionTaxSnapshot | null {
  if (!code) return null;
  const o0Verified = code !== 'O0' || (classification?.taxContext != null && classification.evidenceStatus === 'VERIFIED');
  const treatment = code === 'O7' ? 'STANDARD' : code === 'O0' ? o0Verified ? 'ZERO_RATED' : 'NEEDS_REVIEW' : 'EXEMPT';
  return {
    taxCodeDefinitionId: null, externalTaxCode: code, taxProfileKey: 'SAP_ERP_TH_LEGACY', taxProfileVersion: 1, ...DEFAULT_ROUNDING_POLICY,
    taxRegime: 'VAT', taxDirection: 'OUTPUT', taxTreatment: treatment, taxContext: classification?.taxContext ?? (code === 'O0' ? null : 'DOMESTIC_SALE'),
    taxRate: code === 'O7' ? '7' : '0', sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1',
    exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: '', taxBaseAmount: money(base), taxAmount: money(tax),
    claimability: 'NOT_APPLICABLE', evidenceStatus: classification?.evidenceStatus ?? (code === 'O0' ? 'REVIEW_REQUIRED' : 'VERIFIED'), accountRuleVersion: null, reportRuleVersion: null,
    recognitionDate: null, evidenceRefs: [],
  };
}
