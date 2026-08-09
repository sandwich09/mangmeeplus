import { civilDate, civilPeriodKey } from '@watchdog-bms/contracts';

const VALID_PLACEHOLDERS = new Set(['{YYYY}', '{YY}', '{MM}', '{BRANCH}', '{DOC}', '{SEQ}']);
const PLACEHOLDER_PATTERN = /\{[^}]+\}/g;

export type DefaultDocumentSequenceConfig = {
  prefixTemplate: string;
  padding: number;
  resetPolicy: 'NONE' | 'MONTHLY' | 'YEARLY';
};

const DEFAULT_DOCUMENT_SEQUENCE_CONFIGS: Readonly<Record<string, DefaultDocumentSequenceConfig>> = {
  'accounting.quotation': { prefixTemplate: 'QT-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'accounting.invoice': { prefixTemplate: 'INV-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'accounting.billing_note': { prefixTemplate: 'BN-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'accounting.receipt': { prefixTemplate: 'REC-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'accounting.payment': { prefixTemplate: 'PAY-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'accounting.credit_note': { prefixTemplate: 'CN-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'accounting.debit_note': { prefixTemplate: 'DN-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'tax.invoice': { prefixTemplate: 'TAX-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'tax.wht_certificate': { prefixTemplate: 'WHT-{YYYY}-{SEQ}', padding: 5, resetPolicy: 'YEARLY' },
  'tax.filing_export': { prefixTemplate: 'TAXEXP-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'inventory.movement': { prefixTemplate: 'MOV-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'expense.claim': { prefixTemplate: 'EXP-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'expense.record': { prefixTemplate: 'EXP-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'expense.substitute_receipt': { prefixTemplate: 'SRC-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'ledger.journal': { prefixTemplate: 'JRN-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'procurement.purchase_request': { prefixTemplate: 'PR-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'procurement.purchase_order': { prefixTemplate: 'PO-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'procurement.goods_receipt': { prefixTemplate: 'GR-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'accounts_payable.vendor_bill': { prefixTemplate: 'VB-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'accounts_payable.payment': { prefixTemplate: 'PAY-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'reimbursement.request': { prefixTemplate: 'RB-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
  'reimbursement.payment': { prefixTemplate: 'RBPAY-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' },
};

export function getDefaultDocumentSequenceConfig(documentType: string): DefaultDocumentSequenceConfig | undefined {
  return DEFAULT_DOCUMENT_SEQUENCE_CONFIGS[documentType];
}

/**
 * Whether the numbers this template renders can say which branch issued them, and therefore
 * whether the counter behind it may be split per branch (audit CR-7).
 *
 * DocumentNumber is unique on `(companyId, documentType, documentNumber)` — company-wide. A
 * per-branch counter under a template with no `{BRANCH}` renders the identical string from two
 * counters, and the second branch's insert is rejected. Not once: the rejection rolls the whole
 * reservation transaction back, including the `nextNumber` increment, so that branch retries the
 * same number forever. None of the default templates above carry `{BRANCH}`, which is why the
 * counter has to stay company-wide unless the template opts in.
 */
export function templateNumbersAreBranchDistinct(template: string): boolean {
  return template.includes('{BRANCH}');
}

export function validatePrefixTemplate(template: string): string | null {
  const found: string[] = template.match(PLACEHOLDER_PATTERN) ?? [];
  for (const ph of found) {
    if (!VALID_PLACEHOLDERS.has(ph)) {
      return `Invalid placeholder "${ph}". Allowed: {YYYY},{YY},{MM},{BRANCH},{DOC},{SEQ}.`;
    }
  }
  if (!found.includes('{SEQ}')) {
    return 'Prefix template must contain {SEQ} placeholder.';
  }
  return null;
}

export type FormatContext = {
  year: number;
  month: number;
  branchCode?: string;
  documentType?: string;
  sequenceNumber: number;
  padding: number;
};

export function formatDocumentNumber(template: string, ctx: FormatContext): string {
  const yyyy = String(ctx.year);
  const yy = yyyy.slice(2);
  const mm = String(ctx.month).padStart(2, '0');
  const seq = String(ctx.sequenceNumber).padStart(ctx.padding, '0');
  const branch = ctx.branchCode ?? 'GLOBAL';
  const doc = ctx.documentType?.replace('.', '-') ?? 'DOC';

  return template
    .replace('{YYYY}', yyyy)
    .replace('{YY}', yy)
    .replace('{MM}', mm)
    .replace('{BRANCH}', branch)
    .replace('{DOC}', doc)
    .replace('{SEQ}', seq);
}

export function buildPeriodKey(policy: 'NONE' | 'MONTHLY' | 'YEARLY', date: Date): string {
  const civil = civilDate(date);
  switch (policy) {
    case 'NONE':    return 'ALL';
    case 'YEARLY':  return civil.slice(0, 4);
    case 'MONTHLY': return civilPeriodKey(civil);
  }
}
