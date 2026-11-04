import Decimal from 'decimal.js';
import {
  ACCOUNTING_EXPORT_EXCLUSION_LABELS, PURCHASE_JOURNAL_COLUMNS, PURCHASE_JOURNAL_COLUMN_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS, EXPENSE_PAYMENT_STATUS_LABELS, coerceCivilDate,
  type ExpenseCategoryAccountantAccount, type ExpenseWhtInput, type PurchaseJournalRow,
  type AccountingSoftwareExportResult,
} from '@watchdog-bms/contracts';
import { buildWorkbook, type WorkbookCell } from '../../../../common/export/xlsx.logic';
import { withholdingFormFor } from '../../../tax/domain/logic/expense-payment-withholding.logic';
import { expenseWhtHeaderRate, expenseWhtIncomeBase } from './expense-wht-input.logic';
import { paidAtLabel } from './expense-export.logic';
import { EXPENSE_TOTALS_TOLERANCE } from './expense-totals.logic';

type Money = string | number | { toString(): string };
export type PurchaseJournalLine = {
  lineNumber: number; description: string; taxableAmount: Money; vatAmount: Money;
  expenseCategoryId?: string | null; categoryName?: string | null; chargeKind?: string | null;
  vatRate?: Money | null; vatTreatment?: string | null; taxTreatmentSnapshot?: string | null;
  whtAmount?: Money | null; whtRate?: Money | null; whtCategoryCode?: string | null;
  taxComponentsJson?: unknown; claimabilitySnapshot?: string | null; taxEvidenceReviewStatus?: string | null;
};
export type PurchaseJournalExpense = {
  id: string; expenseNumber: string | null; expenseDate: Date | string; currency: string;
  taxableAmount: Money; vatAmount: Money; whtAmount: Money;
  inputVatClaimStatus: string; taxEvidenceStatus: string; lines: readonly PurchaseJournalLine[];
  expenseCategoryId?: string | null; categoryName?: string | null; note?: string | null;
  sourceDocumentType?: string; vendorDocumentNumber?: string | null;
  vendorNameSnapshot?: string | null; vendorTaxIdSnapshot?: string | null; vendorBranchCodeSnapshot?: string | null;
  vendorEntityKindSnapshot?: string | null; whtInputJson?: ExpenseWhtInput | null;
  whtCategoryCode?: string | null; whtRate?: Money | null; grandTotalAmount?: Money;
  paymentStatus?: string; advancedBy?: string | null;
  payments?: readonly { status: string; paidAt: Date | string; paidAtConfirmed?: boolean }[];
};
type IncomeCategory = { nameTh: string; filingRoute?: string | null };
type Mapping = ReadonlyMap<string, ExpenseCategoryAccountantAccount>;
type InputVatRight = 'ไม่มี VAT' | 'ใช้ไม่ได้' | 'รอตรวจสอบ' | 'ใช้ได้บางส่วน' | 'ใช้ได้ตามเงื่อนไข';
const amount = (value: Money | null | undefined) => new Decimal(String(value ?? 0));
const sum = (values: readonly (Money | null | undefined)[]) => values.reduce<Decimal>((total, value) => total.plus(amount(value)), new Decimal(0));
const date = (value: Date | string) => coerceCivilDate(value, 'Asia/Bangkok');

/** Current document refusal always wins over a previously claimable line snapshot. */
export function effectiveInputVatRight(record: Pick<PurchaseJournalExpense, 'inputVatClaimStatus' | 'taxEvidenceStatus'>, line: PurchaseJournalLine): InputVatRight {
  const components = line.taxComponentsJson;
  const restricted = components != null && typeof components === 'object' && Object.keys(components).length > 0;
  if (amount(line.vatAmount).isZero() || (restricted && line.claimabilitySnapshot === 'NOT_APPLICABLE')) return 'ไม่มี VAT';
  const claim = restricted ? line.claimabilitySnapshot : null;
  const review = restricted ? line.taxEvidenceReviewStatus ?? 'REVIEW_REQUIRED' : null;
  if (record.inputVatClaimStatus === 'NON_CLAIMABLE' || ['SUPPORTING_ONLY', 'NOT_TAX_EVIDENCE'].includes(record.taxEvidenceStatus)
    || ['NONDEDUCTIBLE_EXPENSE', 'NONDEDUCTIBLE_CAPITALIZED'].includes(claim ?? '') || review === 'REJECTED') return 'ใช้ไม่ได้';
  if (record.inputVatClaimStatus !== 'CLAIMABLE' || record.taxEvidenceStatus !== 'USABLE_FOR_TAX'
    || claim === 'PENDING_EVIDENCE' || (review !== null && review !== 'VERIFIED')) return 'รอตรวจสอบ';
  return claim === 'PARTIAL' ? 'ใช้ได้บางส่วน' : 'ใช้ได้ตามเงื่อนไข';
}

export type PurchaseJournalGroup = {
  accountCode: string; accountName: string; categoryNames: string[]; categoryIds: string[];
  vatTreatment: string; vatRate: string; inputVatRight: InputVatRight;
  taxableAmount: string; vatAmount: string; lines: PurchaseJournalLine[];
  whtCategoryCode: string | null; whtRate: string | null;
  whtBaseAmount: string; whtAmount: string;
};

/** Group only facts the office can represent in one row, retaining each legacy WHT set. */
export function groupExpenseLines(record: PurchaseJournalExpense, lines: readonly PurchaseJournalLine[], mappingByCategory: Mapping = new Map()): PurchaseJournalGroup[] {
  const groups = new Map<string, PurchaseJournalGroup>();
  const splitWht = !record.whtInputJson && lines.length > 1;
  for (const line of lines) {
    const categoryId = (line.chargeKind ? record.expenseCategoryId : line.expenseCategoryId ?? record.expenseCategoryId) ?? '';
    const categoryName = (line.chargeKind ? record.categoryName : line.categoryName ?? record.categoryName) ?? '';
    const account = mappingByCategory.get(categoryId);
    const vatRate = amount(line.vatRate).toString();
    const snapshotTreatment = line.taxTreatmentSnapshot;
    const vatTreatment = line.vatTreatment ?? (snapshotTreatment === 'ZERO_RATED' || snapshotTreatment === 'EXEMPT' ? snapshotTreatment
      : snapshotTreatment === 'NON_TAXABLE' || snapshotTreatment === 'OUTSIDE_SCOPE' ? 'NON_VAT'
        : amount(line.vatRate).gt(0) ? 'STANDARD' : 'NON_VAT');
    const inputVatRight = effectiveInputVatRight(record, line);
    const withheld = splitWht && amount(line.whtAmount).gt(0);
    const whtCategoryCode = withheld ? line.whtCategoryCode ?? record.whtCategoryCode ?? null : null;
    const whtRate = withheld && line.whtRate != null ? amount(line.whtRate).mul(100).toString() : null;
    const key = JSON.stringify([account ? ['account', account.accountCode] : ['category', categoryId], vatTreatment, vatRate, inputVatRight, withheld, whtCategoryCode, whtRate]);
    let group = groups.get(key);
    if (!group) {
      group = { accountCode: account?.accountCode ?? '', accountName: account?.accountName ?? '', categoryNames: [], categoryIds: [],
        vatTreatment, vatRate, inputVatRight, taxableAmount: '0', vatAmount: '0', lines: [],
        whtCategoryCode, whtRate, whtBaseAmount: '0.00', whtAmount: '0.00' };
      groups.set(key, group);
    }
    if (!group.categoryIds.includes(categoryId)) group.categoryIds.push(categoryId);
    if (categoryName && !group.categoryNames.includes(categoryName)) group.categoryNames.push(categoryName);
    group.lines.push(line);
    group.taxableAmount = amount(group.taxableAmount).plus(amount(line.taxableAmount)).toFixed(2);
    group.vatAmount = amount(group.vatAmount).plus(amount(line.vatAmount)).toFixed(2);
  }
  return [...groups.values()];
}

/** Preserve the printed VAT; a VAT remainder must never land in an exempt/zero group. */
export function allocateToHeader(groups: readonly PurchaseJournalGroup[], header: Pick<PurchaseJournalExpense, 'taxableAmount' | 'vatAmount'>): PurchaseJournalGroup[] {
  const allocated = groups.map(group => ({ ...group }));
  const largest = (candidates: PurchaseJournalGroup[]) => candidates.reduce<PurchaseJournalGroup | undefined>((best, group) => !best || amount(group.taxableAmount).gt(best.taxableAmount) ? group : best, undefined);
  const baseDifference = amount(header.taxableAmount).minus(sum(groups.map(group => group.taxableAmount)));
  const vatDifference = amount(header.vatAmount).minus(sum(groups.map(group => group.vatAmount)));
  if (baseDifference.abs().gt(EXPENSE_TOTALS_TOLERANCE) || vatDifference.abs().gt(EXPENSE_TOTALS_TOLERANCE)) {
    throw new Error('Purchase journal totals differ from recorded lines beyond the identity tolerance');
  }
  const vatTarget = largest(allocated.filter(group => amount(group.vatRate).gt(0) || !amount(group.vatAmount).isZero()));
  const baseTarget = amount(header.vatAmount).gt(0) ? vatTarget : largest(allocated);
  if (!baseDifference.isZero()) {
    if (!baseTarget) throw new Error('Purchase journal has no expense lines');
    baseTarget.taxableAmount = amount(baseTarget.taxableAmount).plus(baseDifference).toFixed(2);
  }
  if (!vatDifference.isZero()) {
    if (!vatTarget) throw new Error('Purchase journal has no VAT group for recorded VAT');
    vatTarget.vatAmount = amount(vatTarget.vatAmount).plus(vatDifference).toFixed(2);
  }
  return allocated;
}

export function withholdingForGroups(record: PurchaseJournalExpense, lines: readonly PurchaseJournalLine[], groups: readonly PurchaseJournalGroup[]): PurchaseJournalGroup[] {
  const result = groups.map(group => ({ ...group, whtBaseAmount: '0.00', whtAmount: '0.00' }));
  if (!amount(record.whtAmount).gt(0)) return result;
  if (!record.whtInputJson && lines.length > 1) {
    for (const group of result) {
      const withheld = group.lines.filter(line => amount(line.whtAmount).gt(0));
      group.whtBaseAmount = sum(withheld.map(line => line.taxableAmount)).toFixed(2);
      group.whtAmount = sum(withheld.map(line => line.whtAmount)).toFixed(2);
    }
  } else {
    const target = result.reduce<PurchaseJournalGroup | undefined>((best, group) => !best || amount(group.taxableAmount).gt(best.taxableAmount) ? group : best, undefined);
    if (!target) throw new Error('Purchase journal has no group for recorded withholding');
    target.whtBaseAmount = amount(expenseWhtIncomeBase({ ...record, lines })).toFixed(2);
    target.whtRate = expenseWhtHeaderRate(record.whtInputJson, lines, record.whtRate);
    target.whtAmount = amount(record.whtAmount).toFixed(2);
    target.whtCategoryCode = lines.find(line => amount(line.whtAmount).gt(0))?.whtCategoryCode ?? record.whtCategoryCode ?? null;
  }
  return result;
}

export function buildPurchaseJournalRows(records: readonly PurchaseJournalExpense[], mappingByCategory: Mapping = new Map(), incomeCategories: ReadonlyMap<string, IncomeCategory> = new Map()): {
  rows: PurchaseJournalRow[]; excluded: AccountingSoftwareExportResult['excluded']; unmappedCategories: AccountingSoftwareExportResult['unmappedCategories'];
} {
  const rows: PurchaseJournalRow[] = [], excluded: AccountingSoftwareExportResult['excluded'] = [];
  const unmapped = new Map<string, string>();
  for (const record of [...records].sort((a, b) => date(a.expenseDate).localeCompare(date(b.expenseDate)) || (a.expenseNumber ?? '').localeCompare(b.expenseNumber ?? ''))) {
    if (record.currency !== 'THB') {
      excluded.push({ expenseNumber: record.expenseNumber ?? 'ยังไม่มีเลขที่', reason: 'foreign_currency', detail: ACCOUNTING_EXPORT_EXCLUSION_LABELS.foreign_currency });
      continue;
    }
    const groups = withholdingForGroups(record, record.lines, allocateToHeader(groupExpenseLines(record, record.lines, mappingByCategory), record));
    groups.sort((a, b) => a.accountCode.localeCompare(b.accountCode) || amount(a.vatRate).cmp(b.vatRate) || (a.whtCategoryCode ?? '').localeCompare(b.whtCategoryCode ?? ''));
    const payments = record.payments?.filter(payment => payment.status === 'RECORDED').slice().sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
    const lastPaid = payments?.[0];
    for (const group of groups) {
      for (const id of group.categoryIds) if (id && !mappingByCategory.has(id)) {
        const name = record.lines.find(line => line.expenseCategoryId === id && !line.chargeKind)?.categoryName ?? record.categoryName ?? '';
        unmapped.set(id, name);
      }
      const income = incomeCategories.get(group.whtCategoryCode ?? '');
      const form = withholdingFormFor(record.vendorEntityKindSnapshot ?? null, income?.filingRoute);
      const hasWht = amount(group.whtAmount).gt(0);
      const total = amount(group.taxableAmount).plus(group.vatAmount);
      const vatLabel = ({ ZERO_RATED: 'VAT 0%', EXEMPT: 'ยกเว้น VAT', NON_VAT: 'ไม่มี VAT' } as Record<string, string>)[group.vatTreatment]
        ?? `VAT ${amount(group.vatRate).mul(100).toString()}%`;
      rows.push({
        document_date: date(record.expenseDate), vendor_document_number: record.vendorDocumentNumber ?? '', expense_number: record.expenseNumber ?? 'ยังไม่มีเลขที่',
        source_document_type: SOURCE_DOCUMENT_TYPE_LABELS[record.sourceDocumentType as keyof typeof SOURCE_DOCUMENT_TYPE_LABELS] ?? 'ยังไม่ระบุ',
        vendor_name: record.vendorNameSnapshot ?? '', vendor_tax_id: record.vendorTaxIdSnapshot ?? '', vendor_branch: record.vendorBranchCodeSnapshot?.padStart(5, '0') ?? '',
        account_code: group.accountCode, account_name: group.accountName, category_name: group.categoryNames.join(', '),
        description: [record.note, groups.length > 1 ? group.lines[0]?.description : ''].filter(Boolean).join(' · '),
        vat_treatment: vatLabel, taxable_amount: group.taxableAmount, vat_amount: group.vatAmount, grand_total_amount: total.toFixed(2), input_vat_right: group.inputVatRight,
        wht_form: hasWht ? ({ PND2: 'ภ.ง.ด.2', PND3: 'ภ.ง.ด.3', PND53: 'ภ.ง.ด.53' } as Record<string, string>)[form ?? ''] ?? 'ยังไม่ระบุ' : '',
        wht_income_type: hasWht ? income?.nameTh ?? 'ยังไม่ระบุ' : '', wht_base_amount: group.whtBaseAmount,
        wht_rate: hasWht ? group.whtRate ?? 'ยังไม่ระบุ' : '', wht_amount: group.whtAmount, net_payable_amount: total.minus(group.whtAmount).toFixed(2),
        payment_status: EXPENSE_PAYMENT_STATUS_LABELS[record.paymentStatus as keyof typeof EXPENSE_PAYMENT_STATUS_LABELS] ?? 'ยังไม่ระบุ',
        last_paid_at: lastPaid ? lastPaid.paidAtConfirmed === false ? paidAtLabel(lastPaid.paidAt, false) : date(lastPaid.paidAt) : '', advanced_by: record.advancedBy ?? '',
      });
    }
  }
  return { rows, excluded, unmappedCategories: [...unmapped].map(([id, name]) => ({ id, name })) };
}

export function buildPurchaseJournalWorkbook(rows: readonly PurchaseJournalRow[], excluded: AccountingSoftwareExportResult['excluded'], about: Record<string, string | number>): Buffer {
  const money = new Set(['taxable_amount', 'vat_amount', 'grand_total_amount', 'wht_base_amount', 'wht_amount', 'net_payable_amount']);
  const cell = (column: string, value: string | number): WorkbookCell => {
    if ((column === 'document_date' || column === 'last_paid_at') && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      return { value: Date.parse(`${value}T00:00:00Z`) / 86_400_000 + 25_569, style: 4 };
    }
    if (money.has(column)) return { value: Number(value), style: 3 };
    if (column === 'wht_rate' && value !== '' && Number.isFinite(Number(value))) return Number(value);
    return value;
  };
  return buildWorkbook([
    { name: 'สมุดรายวันซื้อ', freezeRows: 1, rows: [PURCHASE_JOURNAL_COLUMNS.map(column => PURCHASE_JOURNAL_COLUMN_LABELS[column]), ...rows.map(row => PURCHASE_JOURNAL_COLUMNS.map(column => cell(column, row[column])))] },
    { name: 'เกี่ยวกับไฟล์นี้', freezeRows: 1, rows: [['หัวข้อ', 'ค่า'], ...Object.entries(about), ['จำนวนแถว', rows.length],
      ['สกุลเงิน', 'บาท'], ['ช่องว่าง', 'ไม่มีข้อมูลนี้ในมั่งมี หรือไม่เกี่ยวกับรายการนี้'], ['รายการที่ไม่ได้ใส่', excluded.length],
      ...excluded.map(entry => [entry.expenseNumber, entry.detail])] },
  ]);
}
