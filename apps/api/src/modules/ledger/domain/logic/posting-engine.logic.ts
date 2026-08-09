import type { LedgerSourcePostingInput, LedgerJournalLineInput } from '@watchdog-bms/contracts';
import type { TransactionTaxComponentPreview } from '@watchdog-bms/contracts';
import { civilPeriodKey, coerceCivilDate } from '@watchdog-bms/contracts';
import { Decimal } from 'decimal.js';
import { resolveExpenseDebits, type ExpenseAccountBindings } from './expense-account-binding.logic';

export type { ExpenseAccountBindings };

function decimal(value: Decimal.Value | undefined | null): Decimal {
  try { return new Decimal(value ?? 0); } catch { return new Decimal(0); }
}
function d4(value: Decimal.Value): string { return decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4); }

/**
 * A resolved posting template: debit account code → credit account code.
 * In production these come from PostingRule records; for the MVP we include
 * a built-in default mapping keyed by sourceEventType so the system works
 * even before the accountant configures rules.
 */
export type PostingTemplate = {
  memo: string;
  lines: Array<{
    accountCode: string;
    side: 'DEBIT' | 'CREDIT';
    amountKey: string;       // key into posting input
    description?: string;
  }>;
};

export const REQUIRED_EXPENSE_AUTO_POST_RULES = [
  { key: 'EXPENSE_CONFIRMED', documentType: 'expense.record', ruleKey: 'expense.confirmed' },
  { key: 'EXPENSE_CLAIM_CONFIRMED', documentType: 'expense.record', ruleKey: 'expense.claim.confirmed' },
] as const;

export function selectPostingRuleCandidate<T extends { companyId: string | null; version: number }>(
  candidates: T[],
  companyId: string,
  companyOnly = false,
): T | null {
  const newest = (rows: T[]) => [...rows].sort((left, right) => right.version - left.version)[0] ?? null;
  const companyRule = newest(candidates.filter((candidate) => candidate.companyId === companyId));
  if (companyRule || companyOnly) return companyRule;
  return newest(candidates.filter((candidate) => candidate.companyId === null));
}

// ─── Built-in default account code constants ──────────────────────────────────
// These match the Thai SME chart of accounts seed; accountants can override via posting rules.
export const DEFAULT_ACCOUNT_CODES = {
  ACCOUNTS_RECEIVABLE: '1210-00',
  CASH_OR_BANK:        '1110-01',
  REVENUE:             '4100-01',
  OUTPUT_VAT:          '2210-01',
  ACCOUNTS_PAYABLE:    '2120-01',
  EMPLOYEE_PAYABLE:    '2130-01',
  EXPENSE_GENERAL:     '5310-01',
  INPUT_VAT:           '1280-00',
  WHT_PAYABLE:         '2210-02',
  WHT_RECEIVABLE:      '1270-00',
};

export function requiresReviewedPostingRules(company: {
  chartOfAccountsTemplateKey?: string | null;
  chartOfAccountsTemplateVersion?: number | null;
  chartOfAccountsTemplateChecksum?: string | null;
  chartOfAccountsTemplateAppliedAt?: Date | string | null;
}): boolean {
  // Any provenance value means bootstrap/apply started governing this company.
  // A partially stamped row also fails closed instead of falling back to legacy codes.
  return company.chartOfAccountsTemplateKey != null
    || company.chartOfAccountsTemplateVersion != null
    || company.chartOfAccountsTemplateChecksum != null
    || company.chartOfAccountsTemplateAppliedAt != null;
}

/**
 * Resolves posting lines from a LedgerSourcePostingInput using PostingRule.mappingJson
 * or built-in defaults. Returns null when the rule cannot be resolved.
 *
 * mappingJson shape (accountant-configurable):
 * { debitAccountCode: string; creditAccountCode: string; whtAccountCode?: string; memo?: string }
 */
export function resolvePostingLinesFromRule(
  source: LedgerSourcePostingInput,
  mappingJson: Record<string, unknown>,
): LedgerJournalLineInput[] | null {
  const debitCode = mappingJson['debitAccountCode'] as string | undefined;
  const creditCode = mappingJson['creditAccountCode'] as string | undefined;
  if (!debitCode || !creditCode) return null;

  const gross = decimal(source.totalAmount);
  const wht = decimal(source.whtTotal);
  const ref = { currency: source.currency, sourceType: source.sourceType, sourceId: source.sourceId, branchId: source.branchId };
  if (wht.lte(0)) {
    return [
      { accountId: debitCode,  debitAmount:  d4(gross), ...ref },
      { accountId: creditCode, creditAmount: d4(gross), ...ref },
    ];
  }
  // Withholding splits one side of the entry in two, which a two-account rule cannot express. Rather
  // than post a silently wrong two-line journal, return null: the caller treats that as
  // `posting_rule_missing` and tells the accountant to name the WHT account on the rule.
  const whtCode = mappingJson['whtAccountCode'] as string | undefined;
  if (!whtCode) return null;
  // Which side the tax sits on follows the direction of the money. Receiving, we were withheld
  // FROM and hold a claim against the RD (an asset, debit); paying, we withheld and owe the RD
  // (a liability, credit). The counter-account keeps the full gross either way — the debt settled
  // is the same whether or not part of it went to the RD.
  const received = source.sourceEventType.endsWith('.received');
  return received
    ? [
      { accountId: debitCode, debitAmount: d4(gross.minus(wht)), ...ref },
      { accountId: whtCode,   debitAmount: d4(wht), description: 'ภาษีถูกหัก ณ ที่จ่าย', ...ref },
      { accountId: creditCode, creditAmount: d4(gross), ...ref },
    ]
    : [
      { accountId: debitCode,  debitAmount:  d4(gross), ...ref },
      { accountId: creditCode, creditAmount: d4(gross.minus(wht)), ...ref },
      { accountId: whtCode,    creditAmount: d4(wht), description: 'ภาษีหัก ณ ที่จ่าย', ...ref },
    ];
}

/**
 * Builds default posting lines by sourceEventType when no PostingRule exists.
 * Returns null when the event type is unrecognized.
 */
export function buildDefaultPostingLines(source: LedgerSourcePostingInput): LedgerJournalLineInput[] | null {
  const { sourceEventType, totalAmount, taxTotal, whtTotal, currency, sourceType, sourceId } = source;
  const net    = decimal(totalAmount);
  const vat    = decimal(taxTotal);
  const wht    = decimal(whtTotal);
  const excVat = net.minus(vat);

  const ref = { currency, sourceType, sourceId, branchId: source.branchId };

  switch (sourceEventType) {
    case 'accounting.invoice.issued':
    case 'accounting.debit_note.issued':
    case 'accounting.billing_note.issued': {
      const lines: LedgerJournalLineInput[] = [
        { accountId: DEFAULT_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debitAmount: d4(net),    description: 'ลูกหนี้การค้า', ...ref },
        { accountId: DEFAULT_ACCOUNT_CODES.REVENUE,             creditAmount: d4(excVat), description: 'รายได้จากการขาย', ...ref },
      ];
      if (vat.gt(0)) {
        lines.push({ accountId: DEFAULT_ACCOUNT_CODES.OUTPUT_VAT, creditAmount: d4(vat), description: 'ภาษีมูลค่าเพิ่มขาย', ...ref });
      }
      return lines;
    }

    case 'accounting.credit_note.issued': {
      const lines: LedgerJournalLineInput[] = [
        { accountId: DEFAULT_ACCOUNT_CODES.REVENUE, debitAmount: d4(excVat), description: 'ลดรายได้จากการขาย', ...ref },
      ];
      if (vat.gt(0)) lines.push({ accountId: DEFAULT_ACCOUNT_CODES.OUTPUT_VAT, debitAmount: d4(vat), description: 'ลดภาษีมูลค่าเพิ่มขาย', ...ref });
      lines.push({ accountId: DEFAULT_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, creditAmount: d4(net), description: 'ลดลูกหนี้การค้า', ...ref });
      return lines;
    }

    case 'accounting.payment.received': {
      // `net` is the receivable settled, so AR is relieved in full. Tax the customer withheld never
      // arrives as cash; it becomes a claim against the RD that we later credit against income
      // tax — an asset, hence the debit alongside the cash rather than a smaller AR relief.
      const lines: LedgerJournalLineInput[] = [
        { accountId: DEFAULT_ACCOUNT_CODES.CASH_OR_BANK, debitAmount: d4(net.minus(wht)), description: 'รับชำระเงิน', ...ref },
      ];
      if (wht.gt(0)) lines.push({ accountId: DEFAULT_ACCOUNT_CODES.WHT_RECEIVABLE, debitAmount: d4(wht), description: 'ภาษีถูกหัก ณ ที่จ่าย', ...ref });
      lines.push({ accountId: DEFAULT_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, creditAmount: d4(net), description: 'ตัดลูกหนี้', ...ref });
      return lines;
    }

    case 'expense.confirmed':
    case 'expense.posted':
    // GAP-02: a claim-born expense accrues to the employee payable (2130-01) instead
    // of trade AP; net/VAT/WHT handling is otherwise identical to a plain expense.
    case 'expense.claim.confirmed': {
      const isClaim = sourceEventType === 'expense.claim.confirmed';
      const payableCode = isClaim ? DEFAULT_ACCOUNT_CODES.EMPLOYEE_PAYABLE : DEFAULT_ACCOUNT_CODES.ACCOUNTS_PAYABLE;
      const payableDesc = isClaim ? 'เจ้าหนี้พนักงาน' : 'เจ้าหนี้การค้า';
      const payable = net.minus(wht);
      const lines: LedgerJournalLineInput[] = [
        { accountId: DEFAULT_ACCOUNT_CODES.EXPENSE_GENERAL, debitAmount: d4(excVat), description: 'ค่าใช้จ่าย', ...ref },
      ];
      if (vat.gt(0)) lines.push({ accountId: DEFAULT_ACCOUNT_CODES.INPUT_VAT, debitAmount: d4(vat), description: 'ภาษีซื้อ', ...ref });
      if (wht.gt(0)) lines.push({ accountId: DEFAULT_ACCOUNT_CODES.WHT_PAYABLE, creditAmount: d4(wht), description: 'ภาษีหัก ณ ที่จ่าย', ...ref });
      lines.push({ accountId: payableCode, creditAmount: d4(payable), description: payableDesc, ...ref });
      return lines;
    }

    // GAP-02: reimbursement settlement — pay the employee and clear the payable.
    // A voided payment backs this journal out via a true reversal inside
    // voidPaymentTrueReversal (mirroring the expense void), which mirrors these
    // lines, so there is deliberately no separate void case here.
    case 'reimbursement.payment': {
      return [
        { accountId: DEFAULT_ACCOUNT_CODES.EMPLOYEE_PAYABLE, debitAmount:  d4(net), description: 'จ่ายคืนเงินทดรองพนักงาน', ...ref },
        { accountId: DEFAULT_ACCOUNT_CODES.CASH_OR_BANK,     creditAmount: d4(net), description: 'จ่ายเงิน', ...ref },
      ];
    }

    case 'procurement.vendor_bill.approved': {
      const payable = net.minus(wht);
      const lines: LedgerJournalLineInput[] = [
        { accountId: DEFAULT_ACCOUNT_CODES.EXPENSE_GENERAL, debitAmount: d4(excVat), description: 'ต้นทุนหรือค่าใช้จ่ายจากใบแจ้งหนี้ผู้ขาย', ...ref },
      ];
      if (vat.gt(0)) lines.push({ accountId: DEFAULT_ACCOUNT_CODES.INPUT_VAT, debitAmount: d4(vat), description: 'ภาษีซื้อ', ...ref });
      if (wht.gt(0)) lines.push({ accountId: DEFAULT_ACCOUNT_CODES.WHT_PAYABLE, creditAmount: d4(wht), description: 'ภาษีหัก ณ ที่จ่าย', ...ref });
      lines.push({ accountId: DEFAULT_ACCOUNT_CODES.ACCOUNTS_PAYABLE, creditAmount: d4(payable), description: 'เจ้าหนี้การค้า', ...ref });
      return lines;
    }

    case 'procurement.vendor_bill.pp36_payment':
    case 'procurement.supplier_payment.pp36_payment':
      // The commercial/AP entry is posted separately at bill date. This source
      // contains only the balanced PP36 output/input components at payment date.
      return [];

    case 'tax.pp36_input_claim.released':
      return [];

    case 'expense.payment':
    case 'accounting.payment.made': {
      // `net` is the debt cleared, so AP is always relieved in full. Tax withheld at payment never
      // reaches the vendor's bank — it becomes our liability to the RD until it is remitted — so it
      // comes off the cash side, not off AP. Expense settlements carry no whtTotal and take the
      // two-line shape unchanged.
      const lines: LedgerJournalLineInput[] = [
        { accountId: DEFAULT_ACCOUNT_CODES.ACCOUNTS_PAYABLE, debitAmount:  d4(net), description: 'จ่ายชำระเจ้าหนี้', ...ref },
        { accountId: DEFAULT_ACCOUNT_CODES.CASH_OR_BANK,     creditAmount: d4(net.minus(wht)), description: 'จ่ายเงิน', ...ref },
      ];
      if (wht.gt(0)) lines.push({ accountId: DEFAULT_ACCOUNT_CODES.WHT_PAYABLE, creditAmount: d4(wht), description: 'ภาษีหัก ณ ที่จ่าย', ...ref });
      return lines;
    }

    default:
      return null;
  }
}

/** Event types whose posting a reviewed expense binding can express. */
export const BOUND_EXPENSE_ACCRUAL_EVENTS = ['expense.confirmed', 'expense.posted', 'expense.claim.confirmed'] as const;

/**
 * Expense accrual for a company on a governed chart template (audit CR-2, bootstrap spec §9.2).
 *
 * The expense debit is split across the REVIEWED account of each line's category instead of the
 * single hard-coded `5310-01` (which is เงินเดือน in `TH_SME_COA_V1`), and the payable comes from the
 * company's bindings rather than `DEFAULT_ACCOUNT_CODES`.
 *
 * Amounts are GROSS on both sides, like {@link resolvePostingLinesFromRule} and unlike
 * {@link buildDefaultPostingLines}: input VAT is carved back out of the debit side by
 * {@link buildTransactionTaxPostingLines}, which sources the VAT account from the company's reviewed
 * tax account determination. Emitting a VAT line here as well would book it twice.
 *
 * Withholding is not expressible yet: the template splits WHT payable by statutory form
 * (`2132-03` ภ.ง.ด.3 for individuals, `2132-04` ภ.ง.ด.53 for juristic payees), so the account
 * depends on the payee and cannot be a single bound code. Such an expense is reported rather than
 * posted to a guessed form.
 */
export function buildBoundExpenseAccrualLines(
  source: LedgerSourcePostingInput,
  bindings: ExpenseAccountBindings,
): { lines: LedgerJournalLineInput[] } | { error: string } {
  const gross = decimal(source.totalAmount);
  if (decimal(source.whtTotal).gt(0)) return { error: 'wht_account_unmapped' };

  const resolved = resolveExpenseDebits({
    totalToAllocate: gross,
    lines: source.lines.map((line) => ({ expenseCategoryId: line.expenseCategoryId, netAmount: line.netAmount })),
    bindings,
  });
  if (!resolved.ok) return { error: resolved.error };

  const ref = { currency: source.currency, sourceType: source.sourceType, sourceId: source.sourceId, branchId: source.branchId };
  const isClaim = source.sourceEventType === 'expense.claim.confirmed';
  return {
    lines: [
      ...resolved.debits.map((debit) => ({
        accountId: debit.accountCode, debitAmount: debit.amount, description: 'ค่าใช้จ่าย', ...ref,
      })),
      {
        accountId: isClaim ? bindings.employeePayableCode : bindings.accountsPayableCode,
        creditAmount: d4(gross),
        description: isClaim ? 'เจ้าหนี้พนักงาน' : 'เจ้าหนี้การค้า',
        ...ref,
      },
    ],
  };
}

export type TransactionTaxPostingResult = { lines?: LedgerJournalLineInput[]; error?: string; handled: boolean };

/** Builds tax lines only from immutable server snapshots; never from caller-supplied account ids. */
export function buildTransactionTaxPostingLines(source: LedgerSourcePostingInput, baseLines?: LedgerJournalLineInput[] | null): TransactionTaxPostingResult {
  const lineComponents = source.lines.flatMap((line) => (line.taxComponents ?? []).map((component) => ({ line, component })));
  const snapshots = lineComponents.length
    ? lineComponents.map(({ component }) => component.snapshot)
    : source.lines.map((line) => line.taxSnapshot).filter(Boolean) as NonNullable<LedgerSourcePostingInput['lines'][number]['taxSnapshot']>[];
  if (snapshots.length === 0) return { handled: false };
  const currencies = new Set(snapshots.map((snapshot) => (snapshot.taxCurrency ?? source.currency).toUpperCase()));
  const sourceCurrencies = new Set(snapshots.map((snapshot) => (snapshot.sourceCurrency ?? source.currency).toUpperCase()));
  const rates = new Set(snapshots.map((snapshot) => snapshot.exchangeRate ?? '1'));
  if (currencies.size !== 1 || sourceCurrencies.size !== 1 || rates.size !== 1) return { handled: true, error: 'mixed_currency_tax_snapshot' };
  const functionalCurrency = [...currencies][0]!;
  const documentCurrency = [...sourceCurrencies][0]!;
  const exchangeRate = decimal([...rates][0]);
  const foreign = functionalCurrency !== documentCurrency;
  if (foreign && (exchangeRate.lte(0) || snapshots.some((snapshot) => !snapshot.exchangeRateSource || !snapshot.exchangeRateDate))) {
    return { handled: true, error: 'functional_currency_fx_required' };
  }
  const taxOnlyFunctionalSource = source.currency.toUpperCase() === functionalCurrency
    && ['procurement.vendor_bill.pp36_payment', 'procurement.supplier_payment.pp36_payment', 'tax.pp36_input_claim.released'].includes(source.sourceEventType);
  if (source.currency.toUpperCase() !== documentCurrency && !taxOnlyFunctionalSource) return { handled: true, error: 'tax_source_currency_mismatch' };
  if (lineComponents.length === 0) {
    if (!baseLines) return { handled: true, error: 'posting_rule_missing' };
    const commercialRate = taxOnlyFunctionalSource ? new Decimal(1) : exchangeRate;
    return { handled: true, lines: baseLines.map((line) => ({
      ...line,
      debitAmount: line.debitAmount == null ? undefined : decimal(line.debitAmount).mul(commercialRate).toFixed(4),
      creditAmount: line.creditAmount == null ? undefined : decimal(line.creditAmount).mul(commercialRate).toFixed(4),
      currency: functionalCurrency,
    })) };
  }
  const isAllowedPp36Pending = (component: TransactionTaxComponentPreview) => component.componentKey === 'PP36_INPUT'
    && component.snapshot.claimability === 'PENDING_EVIDENCE'
    && component.snapshot.evidenceStatus === 'REVIEW_REQUIRED'
    && Boolean(component.snapshot.recognitionDate)
    && component.accountAssignments.length === 1
    && component.accountAssignments[0]?.accountRole === 'INPUT_VAT_PENDING'
    && component.accountAssignments[0]?.postingSide === 'DEBIT'
    && component.reportContributions.every((entry) => entry.formType !== 'PP30');
  if (lineComponents.some(({ component }) => (!isAllowedPp36Pending(component) && component.snapshot.evidenceStatus !== 'VERIFIED')
    || component.snapshot.taxTreatment === 'NEEDS_REVIEW')) {
    return { handled: true, error: 'tax_snapshot_needs_review' };
  }
  if (source.lines.some((line) => new Decimal(line.vatAmount ?? 0).abs().gt('0.0001') && !(line.taxComponents?.length))) {
    return { handled: true, error: 'tax_snapshot_missing' };
  }
  if (!baseLines) return { handled: true, error: 'posting_rule_missing' };
  const taxAccounts = new Set([DEFAULT_ACCOUNT_CODES.INPUT_VAT, DEFAULT_ACCOUNT_CODES.OUTPUT_VAT]);
  const commercialRate = taxOnlyFunctionalSource ? new Decimal(1) : exchangeRate;
  const lines: LedgerJournalLineInput[] = baseLines.filter((line) => !taxAccounts.has(line.accountId)).map((line) => ({
    ...line,
    debitAmount: line.debitAmount == null ? undefined : decimal(line.debitAmount).mul(commercialRate).toFixed(4),
    creditAmount: line.creditAmount == null ? undefined : decimal(line.creditAmount).mul(commercialRate).toFixed(4),
    currency: functionalCurrency,
  }));
  const adjustment = { DEBIT: new Decimal(0), CREDIT: new Decimal(0) };
  for (const { component } of lineComponents.filter(({ component }) => component.componentKey === 'VAT')) {
    const amount = new Decimal(component.snapshot.taxAmount).abs();
    for (const assignment of component.accountAssignments) adjustment[assignment.postingSide] = adjustment[assignment.postingSide].add(amount);
  }
  for (const side of ['DEBIT', 'CREDIT'] as const) {
    if (adjustment[side].isZero()) continue;
    const amountKey = side === 'DEBIT' ? 'debitAmount' : 'creditAmount';
    const base = lines.find((line) => new Decimal(line[amountKey] ?? 0).gte(adjustment[side]));
    if (!base) return { handled: true, error: `tax_base_assignment_missing:${side}` };
    base[amountKey] = new Decimal(base[amountKey] ?? 0).minus(adjustment[side]).toFixed(4);
    if (new Decimal(base[amountKey] ?? 0).isZero()) lines.splice(lines.indexOf(base), 1);
  }
  for (const { line, component } of lineComponents) {
    const amount = new Decimal(component.snapshot.taxAmount).abs();
    if (amount.lte('0.0001')) continue;
    if (!component.accountAssignments.length) return { handled: true, error: `tax_account_mapping_missing:${component.componentKey}` };
    for (const assignment of component.accountAssignments) {
      lines.push({
        accountId: assignment.accountId,
        ...(assignment.postingSide === 'DEBIT' ? { debitAmount: amount.toFixed(4) } : { creditAmount: amount.toFixed(4) }),
        branchId: source.branchId,
        description: taxComponentDescription(component),
        currency: component.snapshot.taxCurrency ?? functionalCurrency,
        sourceType: source.sourceType,
        sourceId: line.sourceLineId,
        taxCode: component.snapshot.externalTaxCode ?? undefined,
        taxSnapshot: component.snapshot,
        taxComponentKey: component.componentKey,
        reportContributions: component.reportContributions,
      } as unknown as LedgerJournalLineInput);
    }
  }
  return { handled: true, lines };
}

function taxComponentDescription(component: TransactionTaxComponentPreview): string {
  return `Tax ${component.componentKey}${component.snapshot.externalTaxCode ? ` (${component.snapshot.externalTaxCode})` : ''}`;
}

/** Derive a monthly period key from a civil date or an instant in the Thai company timezone. */
export function derivePeriodKey(value: string | Date): string {
  return civilPeriodKey(coerceCivilDate(value));
}
