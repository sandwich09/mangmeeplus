/**
 * Capture observations → the legacy single-expense draft shape (appendix §3, web PDF lane).
 *
 * A PDF read through the capture pipeline that turns out to hold ONE document from ONE issuer is
 * an ordinary receipt, and the reviewer should see it on the page they already know. So this maps
 * the facts onto `ReceiptOcrFieldResult` and lets `ReceiptOcrApplyService` do the rest — the same
 * fences, the same duplicate check, the same review reasons.
 *
 * Pure, and deliberately conservative: it only ever COPIES a printed value. Where the legacy shape
 * has one slot and the document printed two (two order-level discounts), the slot stays empty and
 * the field is reported missing, because summing them would put a number on the draft that the
 * page never printed.
 */
import type {
  BusinessDocumentClassification,
  ExpenseCaptureAssembledObservations,
  ExpenseCaptureComponentObservation,
  ReceiptAdditionalChargeKind,
  ReceiptOcrFieldResult,
  ReceiptOcrLineItem,
} from '@watchdog-bms/contracts';

/** The legacy item block ceiling; past it the draft keeps the summary line (§4.3 of the OCR spec). */
const MAX_LEGACY_LINES = 40;
const MAX_LEGACY_CHARGES = 10;
const MAX_EVIDENCE_SIGNAL_CHARS = 120;

const CHARGE_KIND_BY_LABEL: ReadonlyArray<[RegExp, ReceiptAdditionalChargeKind]> = [
  [/ค่าส่ง|ค่าจัดส่ง|ค่าขนส่ง|delivery|shipping|freight/i, 'DELIVERY'],
  [/เซอร์วิส|ค่าบริการ|service charge/i, 'SERVICE_CHARGE'],
  [/ค่ากล่อง|บรรจุ|packaging|packing/i, 'PACKAGING'],
  [/ค่าธรรมเนียม.*(แพลตฟอร์ม|platform)|platform fee/i, 'PLATFORM_FEE'],
  [/ทิป|\btip\b/i, 'TIP'],
  [/ปัดเศษ|rounding/i, 'ROUNDING'],
];

export type CaptureDraftMapping = {
  fields: ReceiptOcrFieldResult;
  classification: BusinessDocumentClassification;
};

/**
 * Returns `null` when the file is not one single-issuer document — a multi-document PDF is a
 * capture GROUP question (§3.1 "แยกเป็นกลุ่มหลักฐาน"), never a single expense draft.
 */
export function captureFieldsFromObservations(
  assembled: ExpenseCaptureAssembledObservations,
): CaptureDraftMapping | null {
  if (assembled.multiDocument || assembled.documents.length !== 1) return null;
  const document = assembled.documents[0]!;
  const ref = document.ref;
  const totals = assembled.totals.filter((total) => total.documentRef === ref);
  const components = assembled.components.filter((component) => component.documentRef === ref);
  const items = assembled.items.filter((item) => item.documentRef === ref);
  const missing = new Set<string>();

  const totalOf = (kind: string): string | undefined => {
    const matches = totals.filter((total) => total.kind === kind);
    // Two DIFFERENT printed values for the same slot is a conflict, not an average.
    return matches.length === 1 ? matches[0]!.amount : undefined;
  };

  const fields: ReceiptOcrFieldResult = {};
  if (document.issuer?.name) fields.vendorName = document.issuer.name; else missing.add('vendor');
  if (document.issuer?.taxId && /^\d{13}$/.test(document.issuer.taxId.replace(/[- ]/g, ''))) {
    fields.vendorTaxId = document.issuer.taxId.replace(/[- ]/g, '');
  } else missing.add('vendorTaxId');
  if (document.issuer?.branchCode) fields.vendorBranchCode = document.issuer.branchCode;
  if (document.documentNumber) fields.documentNumber = document.documentNumber; else missing.add('documentNumber');
  if (document.documentDate) fields.expenseDate = document.documentDate; else missing.add('expenseDate');
  if (document.currency) fields.currency = document.currency;

  const grandTotal = totalOf('document_total');
  if (grandTotal) fields.grandTotalAmount = grandTotal; else missing.add('grandTotalAmount');
  const merchandise = totalOf('merchandise');
  if (merchandise) fields.subtotalAmount = merchandise;

  // ONE printed order-level discount maps; two do not, because the legacy draft has one slot and
  // adding them would record a figure the document never shows (§6 rule 9).
  const discounts = components.filter((component) =>
    component.role === 'applied_discount' && component.scope !== 'item' && component.appliedStatus !== 'pending' && component.amount);
  if (discounts.length === 1) fields.discountAmount = stripSign(discounts[0]!.amount!);
  else if (discounts.length > 1) missing.add('discountAmount');

  const tax = taxFacts(components, totalOf('tax'), document.kind);
  if (tax.vatAmount) fields.vatAmount = tax.vatAmount; else missing.add('vatAmount');
  fields.vatMode = tax.vatMode;

  const lines = legacyLines(items);
  if (lines) fields.lines = lines; else missing.add('lines');

  const charges = legacyCharges(components);
  if (charges.length > 0) fields.additionalCharges = charges;

  if (assembled.completeness.itemsTruncated) missing.add('lines');
  fields.missingFields = [...missing].slice(0, 20);
  return { fields, classification: document.classification };
}

const stripSign = (amount: string): string => amount.replace(/^-/, '');

/**
 * VAT is read, never derived. A printed VAT_INCLUDED marker and a printed amount both come from
 * components the model had to quote a span for; with no tax fact at all a plain receipt is
 * `NO_VAT`, while a TAX_INVOICE that printed no readable VAT goes to the reviewer rather than
 * being recorded as untaxed.
 */
function taxFacts(
  components: readonly ExpenseCaptureComponentObservation[],
  taxTotal: string | undefined,
  documentKind: string,
): { vatAmount?: string; vatMode: NonNullable<ReceiptOcrFieldResult['vatMode']> } {
  const included = components.filter((component) => component.role === 'tax_included' && component.amount);
  const additional = components.filter((component) => component.role === 'tax_additional' && component.amount);
  const unknown = components.filter((component) => component.role === 'tax_unknown');
  const amount = included.length === 1 ? included[0]!.amount
    : additional.length === 1 ? additional[0]!.amount
      : taxTotal;
  if (included.length > 0) return { ...(amount ? { vatAmount: amount } : {}), vatMode: 'VAT_INCLUDED' };
  if (additional.length > 0) return { ...(amount ? { vatAmount: amount } : {}), vatMode: 'VAT_EXCLUDED' };
  if (unknown.length > 0 || taxTotal) return { ...(amount ? { vatAmount: amount } : {}), vatMode: 'NEEDS_REVIEW' };
  const taxDocument = documentKind === 'TAX_INVOICE' || documentKind === 'ABBREVIATED_TAX_INVOICE';
  return { vatMode: taxDocument ? 'NEEDS_REVIEW' : 'NO_VAT' };
}

/**
 * The printed item block, or nothing.
 *
 * All-or-nothing on purpose, exactly like the single-receipt path: a block where one row's money
 * column could not be read no longer represents the document, and the draft keeps its summary
 * line instead of a breakdown that silently omits a purchase.
 */
function legacyLines(items: ExpenseCaptureAssembledObservations['items']): ReceiptOcrLineItem[] | null {
  const sales = items.filter((item) => item.event === 'sale');
  if (sales.length < 2 || sales.length > MAX_LEGACY_LINES) return null;
  const lines: ReceiptOcrLineItem[] = [];
  for (const item of sales) {
    if (!item.amount) return null;
    lines.push({
      description: item.description.slice(0, 200),
      // The legacy row contract defines an unprinted quantity as "1"; the capture observation
      // keeps the truth (no quantity), so nothing is lost by filling the legacy slot here.
      quantity: item.quantity ?? '1',
      amount: item.amount,
      ...(item.unitPrice ? { unitPrice: item.unitPrice } : {}),
      evidenceSignal: item.evidenceSpan.slice(0, MAX_EVIDENCE_SIGNAL_CHARS),
    });
  }
  return lines;
}

/** Printed charges only, positive only, at most the legacy ceiling. */
function legacyCharges(
  components: readonly ExpenseCaptureComponentObservation[],
): NonNullable<ReceiptOcrFieldResult['additionalCharges']> {
  const out: NonNullable<ReceiptOcrFieldResult['additionalCharges']> = [];
  for (const component of components) {
    if (out.length >= MAX_LEGACY_CHARGES) break;
    if (component.role !== 'charge' || component.scope === 'item' || !component.amount) continue;
    const amount = Number.parseFloat(component.amount.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    out.push({
      kind: CHARGE_KIND_BY_LABEL.find(([pattern]) => pattern.test(component.label))?.[1] ?? 'OTHER',
      description: component.label.slice(0, 120),
      amount: component.amount,
      evidenceSignal: component.evidenceSpan.slice(0, MAX_EVIDENCE_SIGNAL_CHARS),
    });
  }
  return out;
}
