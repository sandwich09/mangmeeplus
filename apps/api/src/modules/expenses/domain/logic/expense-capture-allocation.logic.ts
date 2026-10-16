/**
 * Buyer expense capture — the reviewed business allocation (W04a).
 *
 * Appendix §7 (`shared-discount-v1` / `shipping-by-eligible-item-v1`) and spec §6 money rules 1–13.
 * Pure and deterministic: the same facts, selection and policy always produce the same satang.
 *
 * TWO THINGS THIS FILE WILL NOT DO, because the whole feature exists to not do them:
 *  - invent an amount. An unknown stays unknown and blocks; it never becomes 0 (rule 9, A28/A41).
 *  - close a gap. If the lines do not reconcile, the answer is a blocker with the gap in it, never
 *    a balancing discount or a rounding row (A24/A34/A58).
 *
 * The lines are built through `calcLineTotals`/`calcDocumentTotals`, so `expenseTotalsIdentityError`
 * is null BY CONSTRUCTION — the derived source of W05 is a document the reimbursement resolver
 * already accepts (`reimbursement-source.ts`), not a total that has to be patched up later.
 */
import Decimal from 'decimal.js';
import {
  EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION,
  EXPENSE_CAPTURE_BLOCKERS,
  type CaptureAllocationCharge,
  type CaptureAllocationInput,
  type CaptureAllocationLine,
  type CaptureAllocationResult,
  type CaptureAllocationScope,
  type CaptureExpenseDateChoice,
  type CaptureExpenseDateSource,
  type CaptureFactsDocument,
  type CaptureFactsView,
  type ExpenseCaptureBlocker,
  type ExpenseCaptureBlockerCode,
  type ExpenseLineChargeKind,
  type ExpenseVatMode,
  type InputVatClaimStatus,
  type TaxEvidenceStatus,
} from '@watchdog-bms/contracts';
import {
  calcDocumentTotals,
  calcLineTotals,
  expenseTotalsIdentityError,
  type DocumentTotalsLine,
} from './expense-totals.logic';
import {
  capturePaidTotal,
  distributeCaptureAmounts,
  isCaptureNumeric,
  type CaptureItemAmounts,
} from './expense-capture-facts.logic';

const D = (value: string | number | null | undefined): Decimal => {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
};
const round2 = (value: Decimal): Decimal => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
/** A number a person reads: a summary, a share, a message. */
const money = (value: Decimal): string => round2(value).toFixed(2);
/** A number W05 writes into a `Decimal(18,4)` column, in the 4dp the rest of the module uses. */
const stored = (value: Decimal): string => round2(value).toFixed(4);
const numeric = (value: string | null | undefined): Decimal | null =>
  isCaptureNumeric(value) ? D((value as string).trim()) : null;

const blocker = (code: ExpenseCaptureBlockerCode, messageTh: string, action?: ExpenseCaptureBlocker['action']): ExpenseCaptureBlocker =>
  ({ code, messageTh, ...(action ? { action } : {}) });

/** Scope blockers that also stop the whole allocation from being accepted. */
const GROUP_LIFTED: ReadonlySet<string> = new Set<string>([
  EXPENSE_CAPTURE_BLOCKERS.ITEM_AMOUNT_UNKNOWN,
  EXPENSE_CAPTURE_BLOCKERS.DOCUMENT_MISMATCH,
  EXPENSE_CAPTURE_BLOCKERS.COMPONENT_UNCLASSIFIED,
  EXPENSE_CAPTURE_BLOCKERS.EXPENSE_DATE_REQUIRED,
  EXPENSE_CAPTURE_BLOCKERS.CURRENCY_UNSUPPORTED,
  EXPENSE_CAPTURE_BLOCKERS.TOTALS_IDENTITY_FAILED,
]);

/**
 * A rate a document PRINTED. "code 1" and "code 2" are not 1% and 2% (spec §6 rule 12), and an
 * absent legend is not 7% (A53) — both come back null and contribute no VAT.
 */
export function readPrintedVatRate(marker: string | null | undefined): string | null {
  if (!marker) return null;
  const match = /(\d{1,2}(?:\.\d{1,2})?)\s*%/.exec(marker);
  if (!match) return null;
  const percent = D(match[1]);
  if (percent.lt(0) || percent.gt(30)) return null;
  return percent.div(100).toFixed(4);
}

/** A Thai tax id is 13 digits; anything shorter cannot make an issuer VAT-registered. */
const vatRegistered = (taxId: string | undefined): boolean => (taxId ?? '').replace(/\D/g, '').length === 13;

/** The date a document printed, taken verbatim — no timezone maths on a transcribed string. */
const datePart = (value: string | undefined): string | null =>
  (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

export function computeCaptureAllocation(input: CaptureAllocationInput): CaptureAllocationResult {
  const { facts, businessUse, fundingRoute } = input;
  const distribution = distributeCaptureAmounts(facts);

  // ── selection → company quantity per row ───────────────────────────────────
  const companyQuantity = new Map<string, Decimal>();
  for (const item of distribution.items.values()) {
    const available = Decimal.max(item.quantity.minus(item.cancelledQuantity), 0);
    if (!item.selectable || available.lte(0) || businessUse === 'UNKNOWN') {
      companyQuantity.set(item.itemId, new Decimal(0));
      continue;
    }
    if (businessUse === 'ALL_COMPANY') { companyQuantity.set(item.itemId, available); continue; }
    const asked = numeric(input.selection?.[item.itemId]?.companyQuantity ?? null) ?? new Decimal(0);
    // A row whose quantity the document never printed is all-or-nothing: splitting a count nobody
    // read would be the parser default §16.2 forbids.
    const chosen = item.quantityKnown
      ? Decimal.min(Decimal.max(asked, 0), available)
      : (asked.gt(0) ? available : new Decimal(0));
    companyQuantity.set(item.itemId, chosen);
  }

  // ── group by issuer scope ──────────────────────────────────────────────────
  const scopeKeys = [...new Set(facts.documents.map((document) => document.scopeKey))].sort();
  const scopes = scopeKeys.map((scopeKey) => buildScope(scopeKey, input, distribution, companyQuantity));

  // A scope with no company money and nothing to resolve is simply not part of this allocation;
  // one whose company money is 0 only BECAUSE an amount could not be read is (A41).
  const emitted = scopes.filter((scope) => !D(scope.companyAmount).isZero() || scope.blockers.length > 0);

  const groupBlockers: ExpenseCaptureBlocker[] = [];
  if (businessUse === 'UNKNOWN') {
    groupBlockers.push(blocker(EXPENSE_CAPTURE_BLOCKERS.BUSINESS_USE_REQUIRED, 'ยังไม่ได้ระบุว่ารายการนี้ใช้สำหรับบริษัททั้งหมดหรือมีของส่วนตัวด้วย', 'review'));
  }
  if (fundingRoute === 'UNKNOWN') {
    groupBlockers.push(blocker(EXPENSE_CAPTURE_BLOCKERS.FUNDING_ROUTE_REQUIRED, 'ยังไม่ได้ระบุว่าบริษัทจ่ายเองหรือพนักงานสำรองจ่าย', 'review'));
  }
  if (fundingRoute === 'EMPLOYEE' && !input.payerUserId) {
    groupBlockers.push(blocker(EXPENSE_CAPTURE_BLOCKERS.PAYER_REQUIRED, 'ยังไม่ได้ระบุผู้จ่ายที่เป็นสมาชิกบริษัท', 'review'));
  }
  for (const scope of emitted) {
    for (const scopeBlocker of scope.blockers) {
      if (!GROUP_LIFTED.has(scopeBlocker.code)) continue;
      if (!groupBlockers.some((existing) => existing.code === scopeBlocker.code)) groupBlockers.push(scopeBlocker);
    }
  }

  const companyAmount = emitted.reduce((sum, scope) => sum.plus(D(scope.companyAmount)), new Decimal(0));
  const personalAmount = scopes.reduce((sum, scope) => sum.plus(D(scope.personalAmount)), new Decimal(0));
  const paidTotal = scopes.reduce((sum, scope) => sum.plus(D(scope.paidTotal)), new Decimal(0));

  // A05: the allocation is computed and shown, and the handoff is what stops — the company money
  // that went to a personal item does not disappear because only the business part is displayed.
  if (fundingRoute === 'COMPANY' && personalAmount.gt(0)) {
    groupBlockers.push(blocker(
      EXPENSE_CAPTURE_BLOCKERS.COMPANY_PAID_PERSONAL_PORTION,
      `บริษัทจ่ายเต็มจำนวนแต่มีของส่วนตัวรวมอยู่ ${money(personalAmount)} บาท ยังไม่รองรับการเรียกคืนส่วนตัวจากบริษัท`,
    ));
  }

  const outcome = groupBlockers.length > 0 ? 'BLOCKED'
    : companyAmount.isZero() ? 'NO_COMPANY_PORTION'
      : 'READY';

  return {
    policyVersion: EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION,
    outcome,
    scopes: emitted,
    blockers: groupBlockers,
    summary: { companyAmount: money(companyAmount), personalAmount: money(personalAmount), paidTotal: money(paidTotal) },
  };
}

function buildScope(
  scopeKey: string,
  input: CaptureAllocationInput,
  distribution: ReturnType<typeof distributeCaptureAmounts>,
  companyQuantity: Map<string, Decimal>,
): CaptureAllocationScope {
  const { facts } = input;
  const documents = facts.documents.filter((document) => document.scopeKey === scopeKey);
  const documentRefs = documents.map((document) => document.ref);
  const items = facts.items.filter((item) => documentRefs.includes(item.documentRef));
  const components = facts.components.filter((component) => documentRefs.includes(component.documentRef));
  const blockers: ExpenseCaptureBlocker[] = [];

  const currency = documents.map((document) => document.currency).find((value) => !!value) ?? 'THB';
  const issuer = documents.find((document) => document.issuer?.taxId || document.issuer?.name)?.issuer ?? documents[0]?.issuer ?? {};

  // ── tax: the reviewer's decision, or what the document itself shows ────────
  const reviewed = input.taxReview?.[scopeKey];
  const perRowMarkers = items.some((item) => readPrintedVatRate(item.taxMarker) !== null);
  const documentRate = perRowMarkers ? null : components
    .map((component) => readPrintedVatRate(component.label))
    .find((rate) => rate !== null) ?? null;
  const taxComponents = components.filter((component) => component.role === 'tax_included' || component.role === 'tax_additional' || component.role === 'tax_unknown');
  const rateReadable = perRowMarkers || documentRate !== null;

  let vatMode: ExpenseVatMode;
  if (taxComponents.length === 0) vatMode = 'NO_VAT';
  else if (!rateReadable) vatMode = 'NEEDS_REVIEW';
  else if (!vatRegistered(issuer.taxId)) vatMode = 'NEEDS_REVIEW';
  else if (taxComponents.some((component) => component.role === 'tax_included')) vatMode = 'VAT_INCLUDED';
  else if (taxComponents.some((component) => component.role === 'tax_additional')) vatMode = 'VAT_EXCLUDED';
  else vatMode = 'NEEDS_REVIEW';

  let inputVatClaimStatus: InputVatClaimStatus = vatMode === 'NO_VAT' ? 'NON_CLAIMABLE' : 'NEEDS_REVIEW';
  // §7: a value is never forced to make the resolver accept the source. Until somebody with
  // `expense.review` decides, the evidence class is undecided and the claim waits.
  let taxEvidenceStatus: TaxEvidenceStatus = 'NEEDS_REVIEW';
  if (reviewed) {
    vatMode = reviewed.vatMode;
    inputVatClaimStatus = reviewed.inputVatClaimStatus;
    taxEvidenceStatus = reviewed.taxEvidenceStatus;
  }

  // ── lines ─────────────────────────────────────────────────────────────────
  const lines: CaptureAllocationLine[] = [];
  const shippingByComponent = new Map<string, Decimal>();
  const chargeByComponent = new Map<string, Decimal>();
  const shippingShares: Array<{ itemId: string; share: string }> = [];
  const chargeShares: Array<{ itemId: string; share: string }> = [];
  let companyShipping = new Decimal(0);
  let companyCharges = new Decimal(0);
  let unknownSelected = false;

  for (const item of items) {
    const amounts = distribution.items.get(item.id);
    if (!amounts) continue;
    const chosen = companyQuantity.get(item.id) ?? new Decimal(0);
    if (chosen.lte(0)) continue;
    if (amounts.base === null) { unknownSelected = true; continue; }

    const available = Decimal.max(amounts.quantity.minus(amounts.cancelledQuantity), 0);
    const factor = available.gt(0) ? chosen.div(available) : new Decimal(0);
    const gross = round2(amounts.base.mul(factor));
    const discount = amounts.discountShares.reduce((sum, share) => sum.plus(round2(share.share.mul(factor))), new Decimal(0));

    const shipping = round2(amounts.shipping.mul(factor));
    if (shipping.gt(0) || amounts.shipping.gt(0)) {
      companyShipping = companyShipping.plus(shipping);
      shippingShares.push({ itemId: item.id, share: money(shipping) });
      for (const share of amounts.shippingShares) {
        shippingByComponent.set(share.componentId, (shippingByComponent.get(share.componentId) ?? new Decimal(0)).plus(round2(share.share.mul(factor))));
      }
    }
    for (const [componentId, share] of amounts.charges) {
      const company = round2(share.mul(factor));
      companyCharges = companyCharges.plus(company);
      chargeByComponent.set(componentId, (chargeByComponent.get(componentId) ?? new Decimal(0)).plus(company));
      chargeShares.push({ itemId: item.id, share: money(company) });
    }

    if (gross.isZero() && discount.isZero()) continue; // a gift adds nothing to the bill (A27)

    // Keep the printed quantity only when it divides the company share EXACTLY at the 4dp the
    // money columns store; otherwise one row for the share, with the real counts in provenance.
    const perUnit = chosen.gt(0) ? gross.div(chosen) : gross;
    const exact = chosen.gt(0) && perUnit.decimalPlaces() <= 4 && perUnit.mul(chosen).eq(gross);
    const quantity = exact ? chosen : new Decimal(1);
    const unitPrice = exact ? perUnit : gross;
    const vatRate = perRowMarkers ? readPrintedVatRate(item.taxMarker) : documentRate;

    const totals = calcLineTotals({
      quantity: quantity.toFixed(4), unitPrice: unitPrice.toFixed(4),
      discountAmount: money(discount), vatMode,
      ...(vatRate ? { vatRate } : {}),
    });
    lines.push({
      itemId: item.id,
      description: item.description,
      quantity: quantity.toFixed(4),
      unitPrice: unitPrice.toFixed(4),
      discountAmount: stored(discount),
      vatRate,
      totals,
      provenance: {
        itemId: item.id,
        companyQuantity: chosen.toFixed(4),
        quantity: amounts.quantity.toFixed(4),
        quantityInferred: !amounts.quantityKnown,
        unitPrice: unitPrice.toFixed(4),
        baseAmount: money(amounts.base),
        discountShares: amounts.discountShares.map((share) => ({
          componentId: share.componentId,
          share: money(round2(share.share.mul(factor))),
          remainderAdjust: share.remainderAdjust,
        })),
        ...(shipping.gt(0) ? { shippingShare: money(shipping) } : {}),
      },
    });
  }

  // ── charges ───────────────────────────────────────────────────────────────
  const charges: CaptureAllocationCharge[] = [];
  const chargeLine = (
    chargeKind: ExpenseLineChargeKind,
    description: string,
    amount: Decimal,
    componentIds: string[],
    itemShares: Array<{ itemId: string; share: string }>,
  ): void => {
    if (amount.isZero()) return;
    const totals = calcLineTotals({ quantity: '1', unitPrice: stored(amount), discountAmount: '0', vatMode });
    charges.push({
      chargeKind, description, quantity: '1.0000', unitPrice: stored(amount), discountAmount: '0.0000', vatRate: null, totals,
      provenance: {
        componentIds,
        grossAmount: money(componentIds.reduce((sum, id) => sum.plus(numeric(components.find((component) => component.id === id)?.amount ?? null) ?? new Decimal(0)), new Decimal(0))),
        discountAmount: '0.00',
        companyShare: money(amount),
        itemShares,
      },
    });
  };
  chargeLine('DELIVERY', 'ค่าส่ง (ส่วนของบริษัท)', companyShipping, [...shippingByComponent.keys()], shippingShares);
  chargeLine('OTHER', 'ค่าใช้จ่ายอื่นในเอกสาร (ส่วนของบริษัท)', companyCharges, [...chargeByComponent.keys()], chargeShares);

  // ── totals, and the identity that must already hold ───────────────────────
  const totalsLines: DocumentTotalsLine[] = [
    ...lines.map((line) => ({ ...line.totals, chargeKind: null })),
    ...charges.map((charge) => ({ ...charge.totals, chargeKind: charge.chargeKind })),
  ];
  const documentTotals = calcDocumentTotals({ lines: totalsLines });
  const identity = expenseTotalsIdentityError({ vatMode, lines: totalsLines, totals: documentTotals });
  if (identity) {
    blockers.push(blocker(EXPENSE_CAPTURE_BLOCKERS.TOTALS_IDENTITY_FAILED, `ยอดที่แบ่งได้ยังไม่ตรงกับยอดรวมของเอกสาร (${identity})`));
  }

  const companyAmount = D(documentTotals.grandTotalAmount);
  const scopeDocumentTotal = documents.reduce((sum, document) => sum.plus(documentTotalOf(document, distribution)), new Decimal(0));
  const paid = documents.reduce((sum, document) => sum.plus(D(capturePaidTotal(facts, document.ref) ?? '0')), new Decimal(0));

  // ── the rest of what stops this scope ─────────────────────────────────────
  if (unknownSelected) {
    blockers.push(blocker(EXPENSE_CAPTURE_BLOCKERS.ITEM_AMOUNT_UNKNOWN, 'มีสินค้าที่เลือกเป็นของบริษัทแต่ยังอ่านยอดไม่ได้ กรุณากรอกยอดจากหลักฐาน'));
  }
  if (documents.some((document) => document.state.reconciliation === 'mismatch')) {
    blockers.push(blocker(EXPENSE_CAPTURE_BLOCKERS.DOCUMENT_MISMATCH, 'ยอดในเอกสารยังไม่ตรงกัน กรุณาตรวจจุดที่ไม่ตรงก่อนทำต่อ'));
  }
  // Rule 4: an unclassified row never moves an amount by itself. It only blocks when the document
  // does not add up without knowing what it was.
  if (documents.some((document) => document.state.reconciliation !== 'reconciled' && (distribution.documents.get(document.ref)?.hasUnclassified ?? false))) {
    blockers.push(blocker(EXPENSE_CAPTURE_BLOCKERS.COMPONENT_UNCLASSIFIED, 'มีรายการเงินในเอกสารที่ยังไม่ทราบความหมาย กรุณาระบุว่าเป็นค่าอะไร'));
  }
  if (currency !== 'THB') {
    blockers.push(blocker(EXPENSE_CAPTURE_BLOCKERS.CURRENCY_UNSUPPORTED, `เอกสารนี้เป็นสกุลเงิน ${currency} ระบบยังไม่รองรับการแปลงค่าเงิน เก็บข้อมูลไว้ได้แต่ยังสร้างรายการค่าใช้จ่ายไม่ได้`));
  }

  const { expenseDate, expenseDateSource } = resolveExpenseDate(scopeKey, input, documents);
  if (!expenseDate) {
    blockers.push(blocker(EXPENSE_CAPTURE_BLOCKERS.EXPENSE_DATE_REQUIRED, 'ยังไม่มีวันที่ของรายการนี้ กรุณาเลือกวันที่จ่ายหรือวันที่บนเอกสาร', 'review'));
  }

  const claimReady = input.fundingRoute === 'EMPLOYEE'
    && vatMode !== 'NEEDS_REVIEW' && taxEvidenceStatus !== 'NEEDS_REVIEW';
  if (input.fundingRoute === 'EMPLOYEE' && !claimReady) {
    blockers.push(blocker(EXPENSE_CAPTURE_BLOCKERS.TAX_REVIEW_PENDING, 'รอตรวจภาษีก่อน จึงจะนำไปทำใบเบิกได้'));
  }

  // Nobody is claiming anything out of this seller, so there is nothing here to resolve — its
  // facts stay visible on the group page either way (A34/A41). A row whose amount could not be
  // read is the exception: its 0 is ignorance, not a decision, and it must still say so (A28/A41).
  if (companyAmount.isZero() && !unknownSelected) blockers.length = 0;

  return {
    scopeKey,
    fileIds: [...new Set(documents.map((document) => document.fileId))],
    documentRefs,
    issuer,
    currency,
    vatMode,
    inputVatClaimStatus,
    taxEvidenceStatus,
    taxSource: reviewed ? 'review' : 'facts',
    expenseDate,
    expenseDateSource,
    lines,
    charges,
    totals: {
      subtotal: documentTotals.subtotalAmount,
      discount: documentTotals.discountAmount,
      taxable: documentTotals.taxableAmount,
      vat: documentTotals.vatAmount,
      grandTotal: documentTotals.grandTotalAmount,
      // WHT is never applied to an allocation: the capture path does not withhold (§4/§9).
      netPayable: documentTotals.grandTotalAmount,
    },
    companyAmount: money(companyAmount),
    personalAmount: money(scopeDocumentTotal.minus(companyAmount)),
    paidTotal: money(paid),
    claimReady,
    blockers,
  };
}

/** What the document says it came to; the derived sum only when it printed no total at all. */
function documentTotalOf(
  document: CaptureFactsDocument,
  distribution: ReturnType<typeof distributeCaptureAmounts>,
): Decimal {
  if (document.state.documentTotal !== undefined) return D(document.state.documentTotal);
  const amounts = distribution.documents.get(document.ref);
  if (!amounts) return new Decimal(0);
  return round2(amounts.itemsBase.minus(amounts.discount).plus(amounts.charge).plus(amounts.taxAdditional));
}

/**
 * A42: every event keeps its own date and the reviewer picks which one the expense uses. The
 * upload date is not one of the options and today is never a fallback — no date is a blocker.
 */
function resolveExpenseDate(
  scopeKey: string,
  input: CaptureAllocationInput,
  documents: readonly CaptureFactsDocument[],
): { expenseDate: string | null; expenseDateSource: CaptureExpenseDateSource | null } {
  const refs = documents.map((document) => document.ref);
  const paymentDate = input.facts.payments
    .filter((payment) => refs.includes(payment.documentRef) && payment.status === 'paid')
    .map((payment) => datePart(payment.occurredAt))
    .find((value) => value !== null) ?? null;
  const documentDate = documents.map((document) => datePart(document.documentDate)).find((value) => value !== null) ?? null;
  const orderDate = documents
    .filter((document) => document.kind === 'MARKETPLACE_ORDER' || document.kind === 'PURCHASE_ORDER')
    .map((document) => datePart(document.documentDate))
    .find((value) => value !== null) ?? null;

  const choice: CaptureExpenseDateChoice | undefined = input.expenseDateChoice?.[scopeKey];
  if (choice && typeof choice === 'object' && typeof choice.date === 'string') {
    const explicit = datePart(choice.date);
    // A reviewed date the buyer could not yet have incurred is not a date, it is a typo.
    const today = datePart(input.todayIso);
    return explicit && (!today || explicit <= today)
      ? { expenseDate: explicit, expenseDateSource: 'explicit' }
      : { expenseDate: null, expenseDateSource: null };
  }
  if (choice === 'payment') return { expenseDate: paymentDate, expenseDateSource: paymentDate ? 'payment' : null };
  if (choice === 'document') return { expenseDate: documentDate, expenseDateSource: documentDate ? 'document' : null };
  if (choice === 'order') return { expenseDate: orderDate, expenseDateSource: orderDate ? 'order' : null };

  // §7 default: the reviewed payment date, and the document date when there is none.
  if (paymentDate) return { expenseDate: paymentDate, expenseDateSource: 'payment' };
  if (documentDate) return { expenseDate: documentDate, expenseDateSource: 'document' };
  if (orderDate) return { expenseDate: orderDate, expenseDateSource: 'order' };
  return { expenseDate: null, expenseDateSource: null };
}

/** What a caller needs to know about one item before it renders a stepper (W04b). */
export function captureSelectableItems(facts: CaptureFactsView): Array<{
  itemId: string; documentRef: string; scopeKey: string; description: string;
  quantity: string; quantityKnown: boolean; baseAmount: string | null;
}> {
  const distribution = distributeCaptureAmounts(facts);
  return facts.items.flatMap((item) => {
    const amounts: CaptureItemAmounts | undefined = distribution.items.get(item.id);
    if (!amounts || !amounts.selectable) return [];
    return [{
      itemId: item.id, documentRef: item.documentRef, scopeKey: item.scopeKey, description: item.description,
      quantity: Decimal.max(amounts.quantity.minus(amounts.cancelledQuantity), 0).toFixed(4),
      quantityKnown: amounts.quantityKnown,
      baseAmount: amounts.base === null ? null : money(amounts.base),
    }];
  });
}
