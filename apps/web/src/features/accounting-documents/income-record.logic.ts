// Pure logic for the "บันทึกรายรับ" journey (income-expense-ledger spec F-LED-1, F-LED-7 S1, §7.9)
// and the source-first credit/debit-note form (F-LED-6, F-LED-7 S5).
//
// Everything here is framework-free so the money/VAT/permission rules are testable under
// `tsx --test`. Components stay thin: they hold state and render what these functions decide.

import type {
  AccountingAdjustmentReasonCode,
  AccountingOutputTaxCode,
  AccountingPaymentMethod,
  AccountingVatMode,
  RecordSimpleIncomeInput,
  RecordSimpleIncomeLineInput,
} from '@watchdog-bms/contracts';

// Mirrors the API's accounting money DTO patterns (accounting-money-validation.logic.ts).
// Copied, not imported: the API module is not a web dependency.
export const INCOME_MONEY_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
export const INCOME_POSITIVE_MONEY_PATTERN = /^(?=.*[1-9])(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
export const INCOME_QUANTITY_PATTERN = /^(?=.*[1-9])(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
export const INCOME_RATE_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/;

export type IncomeMode = 'received' | 'invoice';

/**
 * Spec §7.9 rule 1: a line's VAT never comes from a guess — only from its revenue category's
 * default output tax code, or the user's own explicit choice. `null` = not chosen yet, which
 * blocks confirmation with a line-specific reason.
 */
export type LineVatChoice = 'VAT7' | 'EXEMPT' | 'ZERO' | null;

export const VAT_CHOICE_LABELS: Record<Exclude<LineVatChoice, null>, string> = {
  VAT7: 'มี VAT 7%',
  EXEMPT: 'ยกเว้น VAT',
  ZERO: 'VAT 0%',
};

/**
 * Company VAT-registration truth (spec V4 / Owner answer 3): NOT_REGISTERED hides every VAT
 * control and forces NO_VAT. LOADING, UNKNOWN and ERROR are fail-closed states: neither showing
 * nor hiding VAT is safe until an effective-dated fact exists and can be read.
 */
export type VatVisibility = 'LOADING' | 'UNKNOWN' | 'ERROR' | 'HIDDEN' | 'SHOWN';

export function vatVisibilityFromStatus(status: string): Exclude<VatVisibility, 'LOADING' | 'ERROR'> {
  if (status === 'REGISTERED') return 'SHOWN';
  if (status === 'NOT_REGISTERED') return 'HIDDEN';
  return 'UNKNOWN';
}

export function defaultVatChoiceForCategory(defaultOutputTaxCode: string | null | undefined): LineVatChoice {
  if (defaultOutputTaxCode === 'O7') return 'VAT7';
  if (defaultOutputTaxCode === 'OX') return 'EXEMPT';
  if (defaultOutputTaxCode === 'O0') return 'ZERO';
  return null;
}

export type IncomeLineDraft = {
  description: string;
  /** Money the user typed for this line (per the price mode when VAT applies). */
  amount: string;
  quantity: string;
  revenueCategoryId: string; // '' = none
  vatChoice: LineVatChoice;
  discountAmount: string; // '' = none (advanced)
};

export function emptyIncomeLine(previous?: IncomeLineDraft): IncomeLineDraft {
  return {
    description: '',
    amount: '',
    quantity: '1',
    // Spec F-LED-7 S1: the next line defaults its category (and therefore its VAT default)
    // from the previous line.
    revenueCategoryId: previous?.revenueCategoryId ?? '',
    vatChoice: previous ? previous.vatChoice : null,
    discountAmount: '',
  };
}

/** Lines the user actually started typing. Untouched extra lines never block or submit. */
export function activeIncomeLines(lines: IncomeLineDraft[]): Array<{ line: IncomeLineDraft; index: number }> {
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.description.trim() !== '' || line.amount.trim() !== '');
}

export type IncomeFormSnapshot = {
  mode: IncomeMode;
  visibility: VatVisibility;
  lines: IncomeLineDraft[];
  /** Only meaningful while some line is VAT7: whether typed prices already include VAT. */
  priceIncludesVat: boolean | null;
  paymentMethod: AccountingPaymentMethod | null;
  whtRate: string; // '' = none
  documentDate: string;
  dueDate: string; // '' = none (invoice mode only)
};

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type IncomeTotalsPreview = {
  taxable: number;
  vat: number;
  grand: number;
  wht: number;
  cash: number;
};

type DecimalRatio = { numerator: bigint; denominator: bigint };

function decimalRatio(value: string): DecimalRatio {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return { numerator: 0n, denominator: 1n };
  const fraction = match[2] ?? '';
  const denominator = 10n ** BigInt(fraction.length);
  return {
    numerator: BigInt(match[1]!) * denominator + BigInt(fraction || '0'),
    denominator,
  };
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return (numerator % denominator) * 2n >= denominator ? quotient + 1n : quotient;
}

function decimalToCents(value: string): bigint {
  const parsed = decimalRatio(value);
  return roundRatio(parsed.numerator * 100n, parsed.denominator);
}

function productToCents(left: string, right: string): bigint {
  const a = decimalRatio(left);
  const b = decimalRatio(right);
  return roundRatio(a.numerator * b.numerator * 100n, a.denominator * b.denominator);
}

function percentOfCents(cents: bigint, rate: string): bigint {
  const parsed = decimalRatio(rate);
  return roundRatio(cents * parsed.numerator, parsed.denominator * 100n);
}

function centsToNumber(cents: bigint): number {
  return Number(cents) / 100;
}

/**
 * Client-side preview of the server's decimal.js totals (accounting-totals.logic.ts): per-line
 * 2dp ROUND_HALF_UP, VAT_INCLUDED back-calculated per line. Preview only — the server recomputes
 * and is authoritative. Lines whose VAT is not chosen yet preview as VAT 0 while the submit
 * blocker names them.
 */
export function computeIncomeTotals(
  form: Pick<IncomeFormSnapshot, 'lines' | 'visibility' | 'priceIncludesVat' | 'whtRate'>,
): IncomeTotalsPreview {
  let taxable = 0n;
  let vat = 0n;
  let wht = 0n;
  for (const { line } of activeIncomeLines(form.lines)) {
    const subtotal = productToCents(line.quantity, line.amount);
    const discount = decimalToCents(line.discountAmount);
    const base = subtotal - (discount < subtotal ? discount : subtotal);
    let lineTaxable = base;
    let lineVat = 0n;
    if (form.visibility === 'SHOWN' && line.vatChoice === 'VAT7' && form.priceIncludesVat !== null) {
      if (form.priceIncludesVat) {
        lineTaxable = roundRatio(base * 100n, 107n);
        lineVat = base - lineTaxable;
      } else {
        lineVat = percentOfCents(base, '7');
      }
    }
    taxable += lineTaxable;
    vat += lineVat;
    wht += percentOfCents(lineTaxable, form.whtRate);
  }
  const grand = taxable + vat;
  return {
    taxable: centsToNumber(taxable),
    vat: centsToNumber(vat),
    grand: centsToNumber(grand),
    wht: centsToNumber(wht),
    cash: centsToNumber(grand - wht),
  };
}

/**
 * Document-level vatMode derived ONLY from the per-line choices (never guessed):
 * any VAT7 line → VAT_INCLUDED/VAT_EXCLUDED per the price mode; all-EXEMPT → EXEMPT;
 * otherwise NO_VAT. `null` = some line has no choice yet → cannot submit.
 * Known engine limit (LED-FIN-06): an EXEMPT line inside a VAT7 document is stored as a
 * 0-rate line, so OX-vs-O0 semantics are not separately persisted — no tax-filing claims.
 */
export function deriveVatMode(
  form: Pick<IncomeFormSnapshot, 'lines' | 'visibility' | 'priceIncludesVat'>,
): AccountingVatMode | null {
  if (form.visibility === 'HIDDEN') return 'NO_VAT';
  if (form.visibility !== 'SHOWN') return null;
  const active = activeIncomeLines(form.lines).map(({ line }) => line);
  if (active.length === 0 || active.some((line) => line.vatChoice === null)) return null;
  if (active.some((line) => line.vatChoice === 'VAT7')) {
    if (form.priceIncludesVat === null) return null;
    return form.priceIncludesVat ? 'VAT_INCLUDED' : 'VAT_EXCLUDED';
  }
  return active.every((line) => line.vatChoice === 'EXEMPT') ? 'EXEMPT' : 'NO_VAT';
}

export function moneyInputError(value: string): string | null {
  const trimmed = value.trim();
  if (!INCOME_POSITIVE_MONEY_PATTERN.test(trimmed)) return 'ต้องเป็นจำนวนเงินมากกว่า 0 ทศนิยมไม่เกิน 2 ตำแหน่ง';
  return null;
}

/**
 * Spec F-LED-7 §7.2: the primary button is disabled with a human reason under it until every
 * condition is met. Returns the FIRST reason in journey order, or null when submitting must
 * succeed (barring genuine runtime failures).
 */
export function incomeSubmitBlocker(form: IncomeFormSnapshot): string | null {
  const active = activeIncomeLines(form.lines);
  if (active.length === 0) return 'กรอกรายละเอียดและจำนวนเงินอย่างน้อย 1 รายการก่อนบันทึกได้';
  for (const { line, index } of active) {
    const n = index + 1;
    if (!line.description.trim()) return `กรอกรายละเอียดของรายการที่ ${n} ก่อนบันทึกได้`;
    if (moneyInputError(line.amount)) return `กรอกจำนวนเงินของรายการที่ ${n} ให้ถูกต้อง (มากกว่า 0 ทศนิยมไม่เกิน 2 ตำแหน่ง)`;
    if (!INCOME_QUANTITY_PATTERN.test(line.quantity.trim())) return `กรอกจำนวนของรายการที่ ${n} ให้ถูกต้อง (มากกว่า 0)`;
    if (line.discountAmount.trim() !== '') {
      if (!INCOME_MONEY_PATTERN.test(line.discountAmount.trim())) return `กรอกส่วนลดของรายการที่ ${n} ให้ถูกต้อง`;
      const subtotal = round2((Number(line.quantity) || 0) * (Number(line.amount) || 0));
      if (Number(line.discountAmount) >= subtotal) return `ส่วนลดของรายการที่ ${n} ต้องน้อยกว่ายอดรายการ`;
    }
  }
  if (form.visibility === 'LOADING') return 'กำลังตรวจสอบสถานะจดทะเบียน VAT ของกิจการ รอสักครู่...';
  if (form.visibility === 'UNKNOWN') return 'กิจการยังไม่ได้ยืนยันสถานะจดทะเบียน VAT จึงยังบันทึกรายการนี้ไม่ได้';
  if (form.visibility === 'ERROR') return 'ตรวจสอบสถานะ VAT ไม่สำเร็จ กรุณากดลองใหม่ก่อนบันทึก';
  if (form.visibility === 'SHOWN') {
    const missing = active.find(({ line }) => line.vatChoice === null);
    if (missing) return `เลือกวิธีคิด VAT ของรายการที่ ${missing.index + 1} ก่อนยืนยัน`;
    if (active.some(({ line }) => line.vatChoice === 'VAT7') && form.priceIncludesVat === null) {
      return 'เลือกราคาว่ารวม VAT แล้วหรือยังก่อนยืนยัน';
    }
  }
  if (form.whtRate.trim() !== '' && (!INCOME_RATE_PATTERN.test(form.whtRate.trim()) || Number(form.whtRate) > 100)) {
    return 'อัตราถูกหัก ณ ที่จ่ายต้องเป็นตัวเลข 0–100 (%)';
  }
  if (form.mode === 'received') {
    if (!form.paymentMethod) return 'เลือกช่องทางรับเงินก่อนบันทึกได้';
    const totals = computeIncomeTotals(form);
    if (totals.wht >= totals.grand && totals.grand > 0) return 'ยอดถูกหัก ณ ที่จ่ายต้องน้อยกว่ายอดรวม';
  }
  if (form.mode === 'invoice' && form.dueDate && form.dueDate < form.documentDate) {
    return 'วันครบกำหนดต้องไม่ก่อนวันที่เอกสาร';
  }
  return null;
}

function buildIncomeLines(form: IncomeFormSnapshot): RecordSimpleIncomeLineInput[] {
  const whtRate = Number(form.whtRate) > 0 ? form.whtRate.trim() : undefined;
  return activeIncomeLines(form.lines).map(({ line }, order) => ({
    lineNumber: order + 1,
    description: line.description.trim(),
    quantity: line.quantity.trim() || '1',
    unitPrice: line.amount.trim(),
    ...(Number(line.discountAmount) > 0 ? { discountAmount: line.discountAmount.trim() } : {}),
    ...(form.visibility === 'SHOWN' && line.vatChoice === 'VAT7' ? { vatRate: '7' } : {}),
    ...(whtRate ? { whtRate } : {}),
    ...(line.revenueCategoryId ? { revenueCategoryId: line.revenueCategoryId } : {}),
  }));
}

export type IncomeSubmitExtras = {
  counterpartyId?: string;
  branchId?: string;
  note?: string;
};

export function buildSimpleIncomeInput(
  form: IncomeFormSnapshot,
  extras: IncomeSubmitExtras & { idempotencyKey: string },
): RecordSimpleIncomeInput {
  const vatMode = deriveVatMode(form);
  if (!vatMode || !form.paymentMethod) throw new Error('income form is not ready to submit');
  return {
    idempotencyKey: extras.idempotencyKey,
    ...(extras.branchId ? { branchId: extras.branchId } : {}),
    documentDate: form.documentDate,
    ...(extras.counterpartyId ? { counterpartyId: extras.counterpartyId } : {}),
    vatMode,
    paymentMethod: form.paymentMethod,
    ...(extras.note ? { note: extras.note } : {}),
    lines: buildIncomeLines(form),
  };
}

export type InvoiceDraftBody = {
  documentType: 'INVOICE';
  idempotencyKey?: string;
  branchId?: string;
  documentDate: string;
  dueDate?: string;
  counterpartyId?: string;
  vatMode: AccountingVatMode;
  note?: string;
  lines: RecordSimpleIncomeLineInput[];
};

export function buildInvoiceDraftInput(form: IncomeFormSnapshot, extras: IncomeSubmitExtras & { idempotencyKey?: string }): InvoiceDraftBody {
  const vatMode = deriveVatMode(form);
  if (!vatMode) throw new Error('income form is not ready to submit');
  return {
    documentType: 'INVOICE',
    ...(extras.idempotencyKey ? { idempotencyKey: extras.idempotencyKey } : {}),
    ...(extras.branchId ? { branchId: extras.branchId } : {}),
    documentDate: form.documentDate,
    ...(form.dueDate ? { dueDate: form.dueDate } : {}),
    ...(extras.counterpartyId ? { counterpartyId: extras.counterpartyId } : {}),
    vatMode,
    ...(extras.note ? { note: extras.note } : {}),
    lines: buildIncomeLines(form),
  };
}

// ---- Idempotency -----------------------------------------------------------------------------

/** A page load represents one submit intent; payload edits must not silently create a new intent. */
export function simpleIncomeIdempotencyKey(
  nonce: string,
  _payload: Omit<RecordSimpleIncomeInput, 'idempotencyKey'>,
): string {
  const cleanNonce = nonce.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 56) || 'n';
  return `income-${cleanNonce}`;
}

export function invoiceDraftIdempotencyKey(nonce: string): string {
  const cleanNonce = nonce.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 55) || 'n';
  return `invoice-${cleanNonce}`;
}

// ---- Permission gating (spec F-LED-7 §7.2 row 1: hide what cannot be finished) ----------------

function hasDocPermission(permissions: string[], documentType: string, action: string): boolean {
  return permissions.includes(`accounting.document.${action}`)
    || permissions.includes(`accounting.${documentType}.${action}`);
}

/** "รับเงินแล้ว" calls the atomic simple-income endpoint, whose use-case requires all four. */
export function canRecordReceivedIncome(permissions: string[]): boolean {
  return hasDocPermission(permissions, 'invoice', 'create')
    && hasDocPermission(permissions, 'invoice', 'issue')
    && permissions.includes('accounting.payment.create')
    && hasDocPermission(permissions, 'receipt', 'issue');
}

export function canCreateIncomeInvoice(permissions: string[]): boolean {
  return hasDocPermission(permissions, 'invoice', 'create');
}

export function canIssueIncomeInvoice(permissions: string[]): boolean {
  return hasDocPermission(permissions, 'invoice', 'issue');
}

// ---- Credit/debit notes (spec F-LED-6, F-LED-7 S5) --------------------------------------------

export type CorrectionMode = 'CREDIT_NOTE' | 'DEBIT_NOTE';

/**
 * Thai labels for the legal reason allow-lists (Revenue Code sections 82/9–82/10 and RD VAT
 * Director-General Notification No. 82 — same sources as the backend's code lists). Wording is
 * ours, not copied from any competitor product.
 */
export const CREDIT_NOTE_REASON_OPTIONS: ReadonlyArray<{ code: AccountingAdjustmentReasonCode; label: string }> = [
  { code: 'GOODS_RETURNED', label: 'รับคืนสินค้า (สินค้าผิดข้อกำหนดที่ตกลงกัน)' },
  { code: 'GOODS_NOT_AS_AGREED', label: 'สินค้าไม่เป็นไปตามข้อกำหนดที่ตกลงกัน' },
  { code: 'GOODS_DAMAGED', label: 'สินค้าชำรุดเสียหาย' },
  { code: 'GOODS_QUANTITY_SHORT', label: 'สินค้าขาดจำนวนจากที่ตกลงซื้อขาย' },
  { code: 'GOODS_PRICE_OVERSTATED', label: 'คำนวณราคาสินค้าผิดพลาดสูงกว่าที่เป็นจริง' },
  { code: 'GOODS_RETURN_OR_EXCHANGE_TRADE_AGREEMENT', label: 'รับคืน/แลกเปลี่ยนสินค้าตามข้อตกลงทางการค้า' },
  { code: 'SERVICES_NOT_AS_AGREED', label: 'บริการไม่เป็นไปตามข้อกำหนดที่ตกลงกัน' },
  { code: 'SERVICES_QUANTITY_SHORT', label: 'บริการขาดจำนวนจากที่ตกลงกัน' },
  { code: 'SERVICES_PRICE_OVERSTATED', label: 'คำนวณราคาค่าบริการผิดพลาดสูงกว่าที่เป็นจริง' },
  { code: 'SERVICE_DEFECT', label: 'บริการบกพร่องหรือผิดสัญญา' },
  { code: 'SERVICE_CANCELLED', label: 'บอกเลิกการให้บริการ' },
  { code: 'SERVICE_NOT_PROVIDED', label: 'ไม่มีการให้บริการตามที่ตกลง' },
  { code: 'ADVANCE_OR_DEPOSIT_REFUND', label: 'คืนเงินจ่ายล่วงหน้า เงินประกัน หรือเงินมัดจำ' },
  { code: 'LEGAL_COMPENSATION', label: 'จ่ายเงินชดเชยหรือค่าเสียหายตามกฎหมาย' },
  { code: 'OTHER_PRESCRIBED', label: 'เหตุอื่นตามที่กฎหมายกำหนด (ต้องระบุรายละเอียด)' },
];

export const DEBIT_NOTE_REASON_OPTIONS: ReadonlyArray<{ code: AccountingAdjustmentReasonCode; label: string }> = [
  { code: 'GOODS_QUANTITY_EXCESS', label: 'ส่งมอบสินค้าเกินจำนวนที่ตกลงซื้อขาย' },
  { code: 'GOODS_PRICE_UNDERSTATED', label: 'คำนวณราคาสินค้าผิดพลาดต่ำกว่าที่เป็นจริง' },
  { code: 'SERVICES_EXCEED_AGREEMENT', label: 'ให้บริการเกินข้อกำหนดที่ตกลงกัน' },
  { code: 'SERVICES_PRICE_UNDERSTATED', label: 'คำนวณราคาค่าบริการผิดพลาดต่ำกว่าที่เป็นจริง' },
  { code: 'OTHER_PRESCRIBED', label: 'เหตุอื่นตามที่กฎหมายกำหนด (ต้องระบุรายละเอียด)' },
];

export function correctionReasonOptions(mode: CorrectionMode) {
  return mode === 'CREDIT_NOTE' ? CREDIT_NOTE_REASON_OPTIONS : DEBIT_NOTE_REASON_OPTIONS;
}

export type CorrectionSourceLine = {
  lineNumber: number;
  description: string;
  lineTotalAmount: string;
  vatAmount: string;
  vatRate?: string;
  whtRate?: string;
  correctionBasisAmount?: string;
  taxSnapshot?: { externalTaxCode?: string | null; taxCodeDefinitionId?: string | null };
};

export type CorrectionSourceDocument = {
  id: string;
  documentType: string;
  status: string;
  vatMode: AccountingVatMode;
  vatAmount: string;
  outputTaxCode?: AccountingOutputTaxCode;
  counterpartyId?: string;
  lines: CorrectionSourceLine[];
};

export type CorrectionEligibility = {
  /** Render the CN/DN entry at all (right type + issued). */
  visible: boolean;
  /** Enabled; when false with visible true, show `reason` next to the disabled control. */
  enabled: boolean;
  reason: string | null;
};

/**
 * Backend source rule (accounting-status.logic validateOutputTaxDocument): CN/DN may reference an
 * issued TAX_INVOICE (with immutable per-line tax snapshots), or an issued INVOICE only when both
 * documents are VAT-free.
 */
export function correctionEligibility(doc: CorrectionSourceDocument): CorrectionEligibility {
  const issued = ['ISSUED', 'CREDITED', 'DEBITED'].includes(doc.status);
  if (!issued || !['TAX_INVOICE', 'INVOICE'].includes(doc.documentType)) {
    return { visible: false, enabled: false, reason: null };
  }
  if (doc.documentType === 'TAX_INVOICE') {
    const missingSnapshot = doc.lines.some(
      (line) => !line.taxSnapshot?.externalTaxCode && !line.taxSnapshot?.taxCodeDefinitionId,
    );
    if (missingSnapshot) {
      return { visible: true, enabled: false, reason: 'ข้อมูลภาษีของบางรายการไม่ครบ จึงออกใบลดหนี้/เพิ่มหนี้ไม่ได้ กรุณาติดต่อผู้ดูแลบัญชี' };
    }
    return { visible: true, enabled: true, reason: null };
  }
  const hasVat = Number(doc.vatAmount) > 0
    || Boolean(doc.outputTaxCode)
    || !['NO_VAT', 'EXEMPT'].includes(doc.vatMode)
    || doc.lines.some((line) => Number(line.vatAmount) > 0);
  if (hasVat) {
    return { visible: true, enabled: false, reason: 'ใบแจ้งหนี้นี้มี VAT — ต้องออกใบกำกับภาษีก่อน แล้วออกใบลดหนี้/เพิ่มหนี้โดยอ้างใบกำกับภาษี' };
  }
  return { visible: true, enabled: true, reason: null };
}

/** Source already carries at least one issued correction → the server re-checks the remaining cap at issue. */
export function hadPriorCorrections(status: string): boolean {
  return status === 'CREDITED' || status === 'DEBITED';
}

/**
 * The editable per-line basis, in the source's own price mode: ex-VAT for VAT_EXCLUDED,
 * the line total otherwise (VAT_INCLUDED totals already carry their VAT).
 */
export function correctionLineBasis(line: Pick<CorrectionSourceLine, 'lineTotalAmount' | 'vatAmount' | 'correctionBasisAmount'>, vatMode: AccountingVatMode): string {
  if (line.correctionBasisAmount !== undefined) return round2(Number(line.correctionBasisAmount) || 0).toFixed(2);
  const total = Number(line.lineTotalAmount) || 0;
  if (vatMode === 'VAT_EXCLUDED') return round2(total - (Number(line.vatAmount) || 0)).toFixed(2);
  return round2(total).toFixed(2);
}

export type CorrectionCreateBody = {
  documentType: CorrectionMode;
  documentDate: string;
  counterpartyId?: string;
  sourceDocumentId: string;
  sourceDocumentType: string;
  vatMode: AccountingVatMode;
  outputTaxCode?: AccountingOutputTaxCode;
  adjustmentReasonCode: AccountingAdjustmentReasonCode;
  adjustmentReasonText?: string;
  lines: Array<{
    lineNumber: number;
    description: string;
    quantity: string;
    unitPrice: string;
    vatRate?: string;
    whtRate?: string;
    externalTaxCode?: string;
  }>;
};

export type BuildCorrectionArgs = {
  mode: CorrectionMode;
  source: CorrectionSourceDocument;
  /** มูลค่าที่ถูกต้อง per source lineNumber; missing = unchanged. */
  corrected: Record<number, string>;
  reasonCode: string;
  reasonText: string;
  documentDate: string;
};

export type BuildCorrectionResult =
  | { error: string }
  | { body: CorrectionCreateBody; diffTotal: number };

/**
 * FlowAccount-style model (spec F-LED-6): original value → corrected value → difference. Each
 * correction line's amount is the per-line difference, keyed by the ORIGINAL line number so the
 * backend can inherit tax snapshots and enforce the cumulative credit cap per line.
 * Client-side cap = the original line amount; earlier issued corrections are re-checked
 * server-side at issue (no read API exposes them yet).
 */
export function buildCorrectionInput(args: BuildCorrectionArgs): BuildCorrectionResult {
  const { mode, source } = args;
  const isCredit = mode === 'CREDIT_NOTE';
  const allowed = correctionReasonOptions(mode).map((option) => option.code);
  if (!args.reasonCode) return { error: isCredit ? 'เลือกสาเหตุการลดหนี้ก่อน' : 'เลือกสาเหตุการเพิ่มหนี้ก่อน' };
  if (!(allowed as string[]).includes(args.reasonCode)) return { error: 'สาเหตุที่เลือกใช้กับเอกสารชนิดนี้ไม่ได้' };
  if (args.reasonCode === 'OTHER_PRESCRIBED' && args.reasonText.trim().length < 3) {
    return { error: 'ระบุรายละเอียดของเหตุอื่นตามกฎหมาย (อย่างน้อย 3 ตัวอักษร)' };
  }
  const lines: CorrectionCreateBody['lines'] = [];
  let diffTotal = 0;
  for (const line of source.lines) {
    const original = Number(correctionLineBasis(line, source.vatMode));
    const raw = args.corrected[line.lineNumber];
    const correctedText = raw === undefined || raw.trim() === '' ? original.toFixed(2) : raw.trim();
    if (!INCOME_MONEY_PATTERN.test(correctedText)) {
      return { error: `กรอกมูลค่าที่ถูกต้องของรายการที่ ${line.lineNumber} เป็นตัวเลข (ทศนิยมไม่เกิน 2 ตำแหน่ง)` };
    }
    const corrected = Number(correctedText);
    if (isCredit && corrected > original) {
      return { error: `มูลค่าที่ถูกต้องของรายการที่ ${line.lineNumber} ต้องไม่เกินยอดเดิม ${original.toFixed(2)} บาท` };
    }
    if (!isCredit && corrected < original) {
      return { error: `มูลค่าที่ถูกต้องของรายการที่ ${line.lineNumber} ต้องไม่ต่ำกว่ายอดเดิม ${original.toFixed(2)} บาท (ใบเพิ่มหนี้ใช้เมื่อยอดจริงสูงกว่าเอกสารเดิม)` };
    }
    const diff = round2(isCredit ? original - corrected : corrected - original);
    if (diff < 0.01) continue;
    diffTotal = round2(diffTotal + diff);
    const fromTaxInvoice = source.documentType === 'TAX_INVOICE';
    lines.push({
      lineNumber: line.lineNumber,
      description: line.description,
      quantity: '1',
      unitPrice: diff.toFixed(2),
      ...(fromTaxInvoice && line.vatRate !== undefined ? { vatRate: line.vatRate } : {}),
      ...(line.whtRate !== undefined ? { whtRate: line.whtRate } : {}),
      ...(fromTaxInvoice && line.taxSnapshot?.externalTaxCode ? { externalTaxCode: line.taxSnapshot.externalTaxCode } : {}),
    });
  }
  if (lines.length === 0) {
    return { error: 'ยังไม่มียอดที่เปลี่ยนแปลง — แก้ "มูลค่าที่ถูกต้อง" อย่างน้อย 1 รายการ' };
  }
  return {
    diffTotal,
    body: {
      documentType: mode,
      documentDate: args.documentDate,
      ...(source.counterpartyId ? { counterpartyId: source.counterpartyId } : {}),
      sourceDocumentId: source.id,
      sourceDocumentType: source.documentType,
      vatMode: source.vatMode,
      ...(source.documentType === 'TAX_INVOICE' && source.outputTaxCode ? { outputTaxCode: source.outputTaxCode } : {}),
      adjustmentReasonCode: args.reasonCode as AccountingAdjustmentReasonCode,
      ...(args.reasonText.trim() ? { adjustmentReasonText: args.reasonText.trim() } : {}),
      lines,
    },
  };
}
