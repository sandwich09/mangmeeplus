/**
 * The reviewed business allocation (appendix §7, spec §6 money rules 1–13).
 *
 * Every numbered rule of §6 and every acceptance row the money touches has a test here, and the
 * A03 worked example is spelled out in full — the basis is part of the contract, not an
 * implementation detail, so the fixture states where each satang comes from.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import {
  EXPENSE_CAPTURE_ALLOCATION_POLICY,
  EXPENSE_CAPTURE_BLOCKERS,
  type CaptureAllocationInput,
  type CaptureAllocationResult,
  type ExpenseCaptureObservations,
} from '@watchdog-bms/contracts';
import { assembleCaptureFacts, type CaptureObservationRow } from './expense-capture-facts.logic';
import { captureSelectableItems, computeCaptureAllocation, readPrintedVatRate } from './expense-capture-allocation.logic';
import { expenseTotalsIdentityError } from './expense-totals.logic';

// ─── builders ─────────────────────────────────────────────────────────────────

const classification = {
  contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
  businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
  confidence: 1, evidenceSignals: [], amountSignals: [], settlementSignals: [],
  missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
} as ExpenseCaptureObservations['documents'][number]['classification'];

type Doc = Partial<ExpenseCaptureObservations['documents'][number]>;
type Item = Partial<ExpenseCaptureObservations['items'][number]>;
type Component = Partial<ExpenseCaptureObservations['components'][number]>;

const document = (over: Doc = {}) => ({
  ref: 'D1', pageIndexes: [0], kind: 'RECEIPT' as const, family: 'EXPENSE_EVIDENCE' as const,
  issuer: { name: 'ร้านเอ' }, currency: 'THB', classification, ...over,
});
const item = (over: Item = {}) => ({
  id: '1:1', documentRef: 'D1', description: 'สินค้า', event: 'sale' as const, evidenceSpan: 'x', ...over,
});
const component = (over: Component = {}) => ({
  id: 'c1', documentRef: 'D1', label: 'ส่วนลด', role: 'applied_discount' as const,
  scope: 'order' as const, appliedStatus: 'applied' as const, evidenceSpan: 'x', ...over,
});
const total = (documentRef: string, kind: ExpenseCaptureObservations['totals'][number]['kind'], amount: string) =>
  ({ documentRef, kind, amount, evidenceSpan: amount });
const paidOn = (documentRef: string, occurredAt: string) =>
  ({ documentRef, status: 'paid' as const, occurredAt, evidenceSpan: 'จ่ายแล้ว' });

const factsOf = (over: Partial<ExpenseCaptureObservations>, fileId = 'f1') => assembleCaptureFacts([{
  id: `o-${fileId}`, fileId, version: 1, source: 'AI',
  payloadJson: {
    documents: [], items: [], components: [], totals: [], payments: [], refunds: [],
    completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
    ...over,
  },
} satisfies CaptureObservationRow]);

const allocate = (over: Partial<CaptureAllocationInput> & Pick<CaptureAllocationInput, 'facts'>): CaptureAllocationResult =>
  computeCaptureAllocation({
    businessUse: 'MIXED', selection: {}, fundingRoute: 'EMPLOYEE', payerUserId: 'user-1',
    taxReview: {}, expenseDateChoice: {}, policy: EXPENSE_CAPTURE_ALLOCATION_POLICY,
    todayIso: '2026-09-18T00:00:00.000Z', ...over,
  });

const codes = (blockers: ReadonlyArray<{ code: string }>) => blockers.map((entry) => entry.code).sort();

// ─── A03: the worked example, with its basis ─────────────────────────────────

/**
 * FX-IMG-MP-A03 — one checkout image, two sellers:
 *
 *   ร้านเอ  สินค้า 2 × 500.00        = 1,000.00
 *   ร้านบี  สินค้า 1 × 500.00        =   500.00   → merchandise 1,500.00
 *   ส่วนลดร้าน (scope order, ร้านเอ)  =  −100.00
 *   คูปอง (scope checkout)           =  −140.00
 *   ค่าส่ง (scope shipping, ร้านบี)    =  +100.00
 *   ส่วนลดค่าส่ง (scope shipping)      =   −70.00   → paid 1,290.00
 *
 * BASIS (appendix §7): the checkout coupon divides by the merchandise total AFTER the store
 * discount — 900 : 500 of 1,400 — so ร้านเอ carries 90.00 of it and ร้านบี 50.00. The shipping is
 * netted once (100 − 70 = 30) and belongs to ร้านบี's parcel.
 *
 *   ร้านเอ = 1,000 − 100 − 90            =   810.00
 *   ร้านบี = 500 − 50 + 30               =   480.00
 */
const A03 = () => factsOf({
  documents: [document({ ref: 'D1', issuer: { name: 'ร้านเอ' } }), document({ ref: 'D2', issuer: { name: 'ร้านบี' } })],
  items: [
    item({ id: '1:1', documentRef: 'D1', quantity: '2', unitPrice: '500.00', amount: '1000.00', description: 'สินค้าเอ' }),
    item({ id: '2:1', documentRef: 'D2', quantity: '1', unitPrice: '500.00', amount: '500.00', description: 'สินค้าบี' }),
  ],
  components: [
    component({ id: 'c1', documentRef: 'D1', label: 'ส่วนลดร้าน', scope: 'order', amount: '100.00' }),
    component({ id: 'c2', documentRef: 'D1', label: 'คูปองส่งฟรี', scope: 'checkout', amount: '140.00' }),
    component({ id: 'c3', documentRef: 'D2', label: 'ค่าจัดส่ง', role: 'charge', scope: 'shipping', amount: '100.00' }),
    component({ id: 'c4', documentRef: 'D2', label: 'ส่วนลดค่าส่ง', scope: 'shipping', amount: '70.00' }),
  ],
  totals: [total('D1', 'document_total', '810.00'), total('D2', 'document_total', '480.00')],
  payments: [paidOn('D1', '2026-09-01T10:00:00.000Z'), paidOn('D2', '2026-09-01T10:00:00.000Z')],
});

describe('A03 — 1,500 − 100 − 140 + 100 − 70 = 1,290', () => {
  it('reconciles both sellers against the coupon share they actually carry', () => {
    const facts = A03();
    assert.deepEqual(facts.documents.map((entry) => [entry.ref, entry.state.reconciliation, entry.state.documentTotal]), [
      ['f1:D1', 'reconciled', '810.00'],
      ['f1:D2', 'reconciled', '480.00'],
    ]);
  });

  it('A03/A04 — ร้านเอ company, ร้านบี personal: 810 and 480', () => {
    const result = allocate({ facts: A03(), selection: { 'f1:1:1': { companyQuantity: '2' }, 'f1:2:1': { companyQuantity: '0' } } });

    assert.deepEqual(result.summary, { companyAmount: '810.00', personalAmount: '480.00', paidTotal: '1290.00' });
    assert.equal(result.scopes.length, 1);
    const scope = result.scopes[0]!;
    assert.equal(scope.scopeKey, 'issuer:ร้านเอ');
    assert.equal(scope.companyAmount, '810.00');
    assert.equal(scope.personalAmount, '0.00');
    assert.equal(scope.totals.netPayable, '810.0000');
    assert.equal(scope.expenseDate, '2026-09-01');
    assert.equal(scope.expenseDateSource, 'payment');
    // The store discount rides the row it was printed on; the coupon arrives as its own share.
    assert.deepEqual(scope.lines[0]!.provenance.discountShares, [
      { componentId: 'f1:c1', share: '100.00', remainderAdjust: false },
      { componentId: 'f1:c2', share: '90.00', remainderAdjust: false },
    ]);
    assert.equal(scope.lines[0]!.quantity, '2.0000');
    assert.equal(scope.lines[0]!.unitPrice, '500.0000');
    assert.equal(result.outcome, 'READY');
    assert.equal(result.policyVersion, 'shared-discount-v1+shipping-by-eligible-item-v1');
  });

  it('the whole checkout as company money adds back to 1,290, shipping included', () => {
    const result = allocate({ facts: A03(), businessUse: 'ALL_COMPANY' });
    assert.deepEqual(result.summary, { companyAmount: '1290.00', personalAmount: '0.00', paidTotal: '1290.00' });
    const parcel = result.scopes.find((scope) => scope.scopeKey === 'issuer:ร้านบี')!;
    assert.equal(parcel.companyAmount, '480.00');
    // 100 gross − 70 discount, counted once (spec §6 rule 2).
    assert.deepEqual(parcel.charges.map((charge) => [charge.chargeKind, charge.unitPrice]), [['DELIVERY', '30.0000']]);
    assert.equal(parcel.totals.subtotal, '500.0000');
    assert.equal(parcel.totals.discount, '50.0000');
    assert.equal(parcel.totals.taxable, '480.0000');
  });

  it('A05 — the company paid for personal items: computed and shown, handoff blocked', () => {
    const result = allocate({
      facts: A03(), fundingRoute: 'COMPANY', payerUserId: null,
      selection: { 'f1:1:1': { companyQuantity: '2' } },
    });
    assert.equal(result.summary.companyAmount, '810.00');
    assert.equal(result.summary.personalAmount, '480.00');
    assert.equal(result.outcome, 'BLOCKED');
    assert.ok(codes(result.blockers).includes(EXPENSE_CAPTURE_BLOCKERS.COMPANY_PAID_PERSONAL_PORTION));
    assert.match(result.blockers.find((entry) => entry.code === EXPENSE_CAPTURE_BLOCKERS.COMPANY_PAID_PERSONAL_PORTION)!.messageTh, /480\.00/);
  });

  it('A11 — a different selection is a different allocation', () => {
    const half = allocate({ facts: A03(), selection: { 'f1:1:1': { companyQuantity: '1' } } });
    // Half the row: 1,000/2 of the base, and half of every discount that reached it.
    assert.equal(half.scopes[0]!.companyAmount, '405.00');
    assert.equal(half.scopes[0]!.personalAmount, '405.00');
  });
});

// ─── selection ────────────────────────────────────────────────────────────────

describe('selection', () => {
  const twoRows = () => factsOf({
    documents: [document()],
    items: [
      item({ id: '1:1', quantity: '3', unitPrice: '100.00', amount: '300.00' }),
      item({ id: '1:2', amount: '50.00' }),
    ],
    totals: [total('D1', 'document_total', '350.00')],
    payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
  });

  it('ALL_COMPANY takes every row and ignores a stale selection', () => {
    const result = allocate({ facts: twoRows(), businessUse: 'ALL_COMPANY', selection: { 'f1:1:1': { companyQuantity: '0' } } });
    assert.equal(result.scopes[0]!.companyAmount, '350.00');
  });

  it('UNKNOWN takes nothing and asks the question (spec §6, A41)', () => {
    const result = allocate({ facts: twoRows(), businessUse: 'UNKNOWN' });
    assert.equal(result.outcome, 'BLOCKED');
    assert.deepEqual(codes(result.blockers), [EXPENSE_CAPTURE_BLOCKERS.BUSINESS_USE_REQUIRED]);
    assert.deepEqual(result.scopes, []);
  });

  it('divides a row by quantity, to the satang', () => {
    const result = allocate({ facts: twoRows(), selection: { 'f1:1:1': { companyQuantity: '2' } } });
    assert.equal(result.scopes[0]!.companyAmount, '200.00');
    assert.equal(result.scopes[0]!.lines[0]!.quantity, '2.0000');
    assert.equal(result.scopes[0]!.lines[0]!.unitPrice, '100.0000');
  });

  it('clamps a selection outside what the document holds', () => {
    const result = allocate({ facts: twoRows(), selection: { 'f1:1:1': { companyQuantity: '99' }, 'f1:1:2': { companyQuantity: '-4' } } });
    assert.equal(result.scopes[0]!.companyAmount, '300.00');
  });

  it('§16.2 — a row with no printed quantity is all-or-nothing, never split', () => {
    const facts = factsOf({
      documents: [document()],
      items: [item({ id: '1:1', amount: '90.00' })],
      totals: [total('D1', 'document_total', '90.00')],
      payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    });
    assert.deepEqual(captureSelectableItems(facts).map((entry) => [entry.quantity, entry.quantityKnown]), [['1.0000', false]]);
    const half = allocate({ facts, selection: { 'f1:1:1': { companyQuantity: '0.5' } } });
    assert.equal(half.scopes[0]!.companyAmount, '90.00');
    assert.equal(half.scopes[0]!.lines[0]!.provenance.quantityInferred, true);
    const none = allocate({ facts, selection: { 'f1:1:1': { companyQuantity: '0' } } });
    assert.equal(none.outcome, 'NO_COMPANY_PORTION');
  });

  it('A52 — a voided row cannot be handed to the company', () => {
    const facts = factsOf({
      documents: [document()],
      items: [
        item({ id: '1:1', amount: '59.00' }),
        item({ id: '1:2', amount: '-59.00', event: 'void', linkedItemId: '1:1' }),
        item({ id: '1:3', amount: '53.00' }),
      ],
      totals: [total('D1', 'document_total', '53.00')],
      payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    });
    assert.deepEqual(captureSelectableItems(facts).map((entry) => entry.itemId), ['f1:1:3']);
    const result = allocate({ facts, businessUse: 'ALL_COMPANY' });
    assert.equal(result.scopes[0]!.companyAmount, '53.00');
    assert.equal(result.scopes[0]!.lines.length, 1);
  });

  it('A27 — a gift is selectable and adds nothing', () => {
    const facts = factsOf({
      documents: [document()],
      items: [item({ id: '1:1', amount: '100.00' }), item({ id: '1:2', event: 'zero_price_promo', description: 'แถม 1 ชิ้น' })],
      totals: [total('D1', 'document_total', '100.00')],
      payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    });
    const result = allocate({ facts, businessUse: 'ALL_COMPANY' });
    assert.equal(result.scopes[0]!.companyAmount, '100.00');
    assert.equal(result.scopes[0]!.lines.length, 1);
  });
});

// ─── discounts and charges ────────────────────────────────────────────────────

describe('shared-discount-v1', () => {
  const threeWay = (discount: string) => factsOf({
    documents: [document()],
    items: [
      item({ id: '1:1', amount: '10.00' }), item({ id: '1:2', amount: '10.00' }), item({ id: '1:3', amount: '10.00' }),
    ],
    components: [component({ id: 'c1', scope: 'order', amount: discount })],
    totals: [total('D1', 'document_total', new Decimal('30.00').minus(discount).toFixed(2))],
    payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
  });

  it('three items and 100.00: the shares add back to the discount', () => {
    const result = allocate({ facts: threeWay('9.99'), businessUse: 'ALL_COMPANY' });
    const shares = result.scopes[0]!.lines.flatMap((line) => line.provenance.discountShares.map((share) => share.share));
    assert.deepEqual(shares, ['3.33', '3.33', '3.33']);
    assert.equal(result.scopes[0]!.totals.discount, '9.9900');
  });

  it('three items and one satang: exactly one row gets it, the lowest id', () => {
    const result = allocate({ facts: threeWay('0.01'), businessUse: 'ALL_COMPANY' });
    // A row that got nothing carries no share; the one satang is on the first row and is marked
    // as the remainder it is.
    assert.deepEqual(
      result.scopes[0]!.lines.map((line) => line.provenance.discountShares.map((share) => share.share)),
      [['0.01'], [], []],
    );
    assert.equal(result.scopes[0]!.lines[0]!.provenance.discountShares[0]!.remainderAdjust, true);
    assert.equal(result.scopes[0]!.companyAmount, '29.99');
  });

  it('spec §6 rule 5 — a personal item keeps its share; it is dropped, not moved to the company', () => {
    const result = allocate({ facts: threeWay('9.00'), selection: { 'f1:1:1': { companyQuantity: '1' } } });
    // 10 − 3 = 7, not 10 − 9 and not 10 − 0.
    assert.equal(result.scopes[0]!.companyAmount, '7.00');
    assert.equal(result.scopes[0]!.personalAmount, '14.00');
  });

  it('an item-scope discount stays on its own row', () => {
    const facts = factsOf({
      documents: [document()],
      items: [item({ id: '1:1', amount: '100.00' }), item({ id: '1:2', amount: '100.00' })],
      components: [component({ id: 'c1', scope: 'item', parentId: '1:1', amount: '20.00' })],
      totals: [total('D1', 'document_total', '180.00')],
      payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    });
    const result = allocate({ facts, selection: { 'f1:1:2': { companyQuantity: '1' } } });
    assert.equal(result.scopes[0]!.companyAmount, '100.00');
    assert.equal(result.scopes[0]!.personalAmount, '80.00');
  });

  it('a pending discount changes nothing until the document says it applied', () => {
    const facts = factsOf({
      documents: [document()],
      items: [item({ amount: '100.00' })],
      components: [component({ id: 'c1', scope: 'order', amount: '30.00', appliedStatus: 'pending' })],
      totals: [total('D1', 'document_total', '100.00')],
      payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    });
    const result = allocate({ facts, businessUse: 'ALL_COMPANY' });
    assert.equal(result.scopes[0]!.companyAmount, '100.00');
  });
});

describe('shipping-by-eligible-item-v1', () => {
  const parcel = () => factsOf({
    documents: [document()],
    items: [item({ id: '1:1', amount: '300.00' }), item({ id: '1:2', amount: '100.00' })],
    components: [
      component({ id: 'c1', label: 'ค่าส่ง', role: 'charge', scope: 'shipping', amount: '40.00' }),
      component({ id: 'c2', label: 'ส่วนลดค่าส่ง', scope: 'shipping', amount: '20.00' }),
    ],
    totals: [total('D1', 'document_total', '420.00')],
    payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
  });

  it('splits the NET shipping by the items in the parcel and never counts the gross twice', () => {
    const result = allocate({ facts: parcel(), businessUse: 'ALL_COMPANY' });
    assert.equal(result.scopes[0]!.companyAmount, '420.00');
    assert.deepEqual(result.scopes[0]!.charges.map((charge) => charge.unitPrice), ['20.0000']);
  });

  it('carries only the company share of the parcel', () => {
    const result = allocate({ facts: parcel(), selection: { 'f1:1:1': { companyQuantity: '1' } } });
    // 300 of 400 → 15.00 of the 20.00 net shipping.
    assert.equal(result.scopes[0]!.charges[0]!.unitPrice, '15.0000');
    assert.equal(result.scopes[0]!.companyAmount, '315.00');
    assert.equal(result.scopes[0]!.lines[0]!.provenance.shippingShare, '15.00');
  });
});

// ─── tax ──────────────────────────────────────────────────────────────────────

describe('tax mode from the facts, and the identity it has to keep', () => {
  const REGISTERED = '0105543000191';

  const taxed = (role: 'tax_included' | 'tax_additional', label: string, itemAmount: string, documentTotal: string, taxMarker?: string) => factsOf({
    documents: [document({ issuer: { name: 'ร้านเอ', taxId: REGISTERED } })],
    items: [item({ amount: itemAmount, ...(taxMarker ? { taxMarker } : {}) })],
    components: [component({ id: 'c1', label, role, scope: 'document', amount: '7.00' })],
    totals: [total('D1', 'document_total', documentTotal)],
    payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
  });

  it('VAT_INCLUDED when a VAT-registered issuer printed an inclusive tax line', () => {
    const result = allocate({ facts: taxed('tax_included', 'ภาษีมูลค่าเพิ่ม 7%', '107.00', '107.00'), businessUse: 'ALL_COMPANY' });
    const scope = result.scopes[0]!;
    assert.equal(scope.vatMode, 'VAT_INCLUDED');
    assert.equal(scope.taxSource, 'facts');
    assert.deepEqual([scope.totals.taxable, scope.totals.vat, scope.totals.grandTotal], ['100.0000', '7.0000', '107.0000']);
  });

  it('VAT_EXCLUDED when the tax was added on top', () => {
    const result = allocate({ facts: taxed('tax_additional', 'VAT 7%', '100.00', '107.00'), businessUse: 'ALL_COMPANY' });
    const scope = result.scopes[0]!;
    assert.equal(scope.vatMode, 'VAT_EXCLUDED');
    assert.deepEqual([scope.totals.taxable, scope.totals.vat, scope.totals.grandTotal], ['100.0000', '7.0000', '107.0000']);
  });

  it('NO_VAT when the document shows none', () => {
    const facts = factsOf({
      documents: [document()], items: [item({ amount: '100.00' })],
      totals: [total('D1', 'document_total', '100.00')], payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    });
    const scope = allocate({ facts, businessUse: 'ALL_COMPANY' }).scopes[0]!;
    assert.equal(scope.vatMode, 'NO_VAT');
    assert.equal(scope.inputVatClaimStatus, 'NON_CLAIMABLE');
  });

  it('A53 — a tax CODE never becomes a rate, and an unreadable legend means review', () => {
    assert.equal(readPrintedVatRate('code 1'), null);
    assert.equal(readPrintedVatRate('V'), null);
    assert.equal(readPrintedVatRate('VAT 7%'), '0.0700');
    assert.equal(readPrintedVatRate('ภาษี 7.5 %'), '0.0750');
    assert.equal(readPrintedVatRate('99%'), null);
    const scope = allocate({
      facts: taxed('tax_included', 'ภาษีมูลค่าเพิ่ม', '107.00', '107.00', 'code 1'),
      businessUse: 'ALL_COMPANY',
    }).scopes[0]!;
    assert.equal(scope.vatMode, 'NEEDS_REVIEW');
    assert.equal(scope.claimReady, false);
    // No rate was printed, so no VAT is recorded — 7% is never the default.
    assert.equal(scope.totals.vat, '0.0000');
  });

  it('a printed tax line from an issuer we cannot identify waits for review, it is not zeroed (A08)', () => {
    const facts = factsOf({
      documents: [document({ issuer: { name: 'ร้านเอ' } })],
      items: [item({ amount: '107.00' })],
      components: [component({ id: 'c1', label: 'VAT 7%', role: 'tax_included', scope: 'document', amount: '7.00' })],
      totals: [total('D1', 'document_total', '107.00')],
      payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    });
    assert.equal(allocate({ facts, businessUse: 'ALL_COMPANY' }).scopes[0]!.vatMode, 'NEEDS_REVIEW');
  });

  it('a reviewer decides, and the scope says so', () => {
    const result = allocate({
      facts: taxed('tax_included', 'ภาษีมูลค่าเพิ่ม 7%', '107.00', '107.00'),
      businessUse: 'ALL_COMPANY',
      taxReview: { 'issuer:0105543000191': { vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'SUPPORTING_ONLY' } },
    });
    const scope = result.scopes[0]!;
    assert.equal(scope.taxSource, 'review');
    assert.equal(scope.claimReady, true);
    assert.deepEqual(codes(scope.blockers), []);
    assert.equal(result.outcome, 'READY');
  });

  it('A04/A08/A17 — an undecided tax stops the claim, not the source', () => {
    const result = allocate({ facts: taxed('tax_included', 'ภาษีมูลค่าเพิ่ม 7%', '107.00', '107.00'), businessUse: 'ALL_COMPANY' });
    assert.equal(result.scopes[0]!.claimReady, false);
    assert.deepEqual(codes(result.scopes[0]!.blockers), [EXPENSE_CAPTURE_BLOCKERS.TAX_REVIEW_PENDING]);
    // Scope-level only: the derived source is still created, it simply is not claimable yet.
    assert.deepEqual(result.blockers, []);
    assert.equal(result.outcome, 'READY');
  });

  for (const vatMode of ['NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED', 'NEEDS_REVIEW'] as const) {
    it(`the lines satisfy expenseTotalsIdentityError under ${vatMode}`, () => {
      const facts = factsOf({
        documents: [document({ issuer: { name: 'ร้านเอ', taxId: REGISTERED } })],
        items: [
          item({ id: '1:1', quantity: '3', unitPrice: '107.00', amount: '321.00', taxMarker: 'VAT 7%' }),
          item({ id: '1:2', amount: '55.55', taxMarker: 'VAT 7%' }),
        ],
        components: [
          component({ id: 'c1', scope: 'order', amount: '13.33' }),
          component({ id: 'c2', label: 'ค่าส่ง', role: 'charge', scope: 'shipping', amount: '25.00' }),
        ],
        totals: [total('D1', 'document_total', '388.22')],
        payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
      });
      const scope = allocate({
        facts, businessUse: 'MIXED', selection: { 'f1:1:1': { companyQuantity: '2' }, 'f1:1:2': { companyQuantity: '1' } },
        taxReview: { [`issuer:${REGISTERED}`]: { vatMode, inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'SUPPORTING_ONLY' } },
      }).scopes[0]!;

      const lines = [
        ...scope.lines.map((line) => ({ ...line.totals, chargeKind: null })),
        ...scope.charges.map((charge) => ({ ...charge.totals, chargeKind: charge.chargeKind })),
      ];
      assert.equal(expenseTotalsIdentityError({
        vatMode, lines,
        totals: {
          subtotalAmount: scope.totals.subtotal, discountAmount: scope.totals.discount,
          taxableAmount: scope.totals.taxable, vatAmount: scope.totals.vat, grandTotalAmount: scope.totals.grandTotal,
        },
      }), null);
      // The resolver also demands that the lines add up to what it is asked to pay.
      const lineTotal = lines.reduce((sum, line) => sum.plus(line.lineTotalAmount), new Decimal(0));
      assert.equal(lineTotal.toFixed(2), new Decimal(scope.totals.netPayable).toFixed(2));
      assert.deepEqual(codes(scope.blockers).filter((code) => code === EXPENSE_CAPTURE_BLOCKERS.TOTALS_IDENTITY_FAILED), []);
    });
  }
});

// ─── blockers ─────────────────────────────────────────────────────────────────

describe('what stops an allocation', () => {
  const simple = (over: Partial<ExpenseCaptureObservations> = {}) => factsOf({
    documents: [document()],
    items: [item({ amount: '100.00' })],
    totals: [total('D1', 'document_total', '100.00')],
    payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    ...over,
  });

  it('A28/A41 — a selected row with no amount blocks; it never becomes 0', () => {
    const facts = factsOf({
      documents: [document()],
      items: [item({ id: '1:1' })],
      totals: [total('D1', 'document_total', '100.00')],
      payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    });
    const result = allocate({ facts, businessUse: 'ALL_COMPANY' });
    assert.equal(result.outcome, 'BLOCKED');
    assert.ok(codes(result.blockers).includes(EXPENSE_CAPTURE_BLOCKERS.ITEM_AMOUNT_UNKNOWN));
    // The scope is still emitted: a 0 that means "we do not know" must stay visible.
    assert.equal(result.scopes.length, 1);
    assert.equal(result.scopes[0]!.companyAmount, '0.00');
  });

  it('A24/A34/A58 — a document that does not add up blocks instead of being balanced', () => {
    const facts = factsOf({
      documents: [document()],
      items: [item({ amount: '45900.00' })],
      totals: [total('D1', 'document_total', '47900.00')],
      payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    });
    const result = allocate({ facts, businessUse: 'ALL_COMPANY' });
    assert.ok(codes(result.blockers).includes(EXPENSE_CAPTURE_BLOCKERS.DOCUMENT_MISMATCH));
    assert.equal(result.outcome, 'BLOCKED');
    // No balancing row of 2,000 anywhere.
    assert.equal(result.scopes[0]!.lines.length, 1);
    assert.equal(result.scopes[0]!.companyAmount, '45900.00');
  });

  it('an unclassified row blocks only when the document needs it to add up (rule 4)', () => {
    const reconciled = allocate({
      facts: simple({ components: [component({ id: 'c1', label: 'CPN', role: 'unclassified', scope: 'document', amount: '5.00' })] }),
      businessUse: 'ALL_COMPANY',
    });
    assert.equal(codes(reconciled.blockers).includes(EXPENSE_CAPTURE_BLOCKERS.COMPONENT_UNCLASSIFIED), false);

    const needed = allocate({
      facts: factsOf({
        documents: [document()],
        items: [item({ amount: '100.00' })],
        components: [component({ id: 'c1', label: 'CPN', role: 'unclassified', scope: 'document', amount: '5.00' })],
        totals: [total('D1', 'document_total', '95.00')],
        payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
      }),
      businessUse: 'ALL_COMPANY',
    });
    assert.ok(codes(needed.blockers).includes(EXPENSE_CAPTURE_BLOCKERS.COMPONENT_UNCLASSIFIED));
  });

  it('A31 — a foreign-currency document keeps its facts and is not converted', () => {
    const facts = factsOf({
      documents: [document({ currency: 'MYR' })],
      items: [item({ amount: '100.00' })],
      totals: [total('D1', 'document_total', '100.00')],
      payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    });
    const result = allocate({ facts, businessUse: 'ALL_COMPANY' });
    assert.equal(result.scopes[0]!.currency, 'MYR');
    assert.equal(result.scopes[0]!.companyAmount, '100.00');
    assert.ok(codes(result.blockers).includes(EXPENSE_CAPTURE_BLOCKERS.CURRENCY_UNSUPPORTED));
    assert.equal(result.outcome, 'BLOCKED');
  });

  it('A41 — everything personal ends as evidence with no money to hand on', () => {
    const result = allocate({ facts: simple(), selection: {} });
    assert.equal(result.outcome, 'NO_COMPANY_PORTION');
    assert.deepEqual(result.scopes, []);
    assert.deepEqual(result.summary, { companyAmount: '0.00', personalAmount: '100.00', paidTotal: '100.00' });
  });

  it('the employee route needs a payer', () => {
    const result = allocate({ facts: simple(), businessUse: 'ALL_COMPANY', payerUserId: null });
    assert.ok(codes(result.blockers).includes(EXPENSE_CAPTURE_BLOCKERS.PAYER_REQUIRED));
  });

  it('an unanswered funding route blocks', () => {
    const result = allocate({ facts: simple(), businessUse: 'ALL_COMPANY', fundingRoute: 'UNKNOWN' });
    assert.ok(codes(result.blockers).includes(EXPENSE_CAPTURE_BLOCKERS.FUNDING_ROUTE_REQUIRED));
  });
});

// ─── dates ────────────────────────────────────────────────────────────────────

describe('A42 — every event keeps its own date and none of them is today', () => {
  const dated = (over: Partial<ExpenseCaptureObservations>) => factsOf({
    documents: [document({ ref: 'D1', kind: 'MARKETPLACE_ORDER', documentDate: '2026-08-31' })],
    items: [item({ amount: '100.00' })],
    totals: [total('D1', 'document_total', '100.00')],
    ...over,
  });

  for (const [choice, expected, source] of [
    ['payment', '2026-09-01', 'payment'],
    ['document', '2026-08-31', 'document'],
    ['order', '2026-08-31', 'order'],
  ] as const) {
    it(`uses the ${choice} date when the reviewer picks it`, () => {
      const facts = dated({ payments: [paidOn('D1', '2026-09-01T03:00:00.000Z')] });
      const scope = allocate({ facts, businessUse: 'ALL_COMPANY', expenseDateChoice: { 'issuer:ร้านเอ': choice } }).scopes[0]!;
      assert.equal(scope.expenseDate, expected);
      assert.equal(scope.expenseDateSource, source);
    });
  }

  it('takes an explicit reviewed date', () => {
    const facts = dated({ payments: [paidOn('D1', '2026-09-01T03:00:00.000Z')] });
    const scope = allocate({ facts, businessUse: 'ALL_COMPANY', expenseDateChoice: { 'issuer:ร้านเอ': { date: '2026-09-03' } } }).scopes[0]!;
    assert.equal(scope.expenseDate, '2026-09-03');
    assert.equal(scope.expenseDateSource, 'explicit');
  });

  it('refuses a date the purchase could not have happened on', () => {
    const facts = dated({ payments: [paidOn('D1', '2026-09-01T03:00:00.000Z')] });
    const result = allocate({ facts, businessUse: 'ALL_COMPANY', expenseDateChoice: { 'issuer:ร้านเอ': { date: '2027-01-01' } } });
    assert.ok(codes(result.blockers).includes(EXPENSE_CAPTURE_BLOCKERS.EXPENSE_DATE_REQUIRED));
  });

  it('blocks rather than dating the expense today when nothing printed a date', () => {
    const facts = factsOf({
      documents: [document()], items: [item({ amount: '100.00' })], totals: [total('D1', 'document_total', '100.00')],
    });
    const result = allocate({ facts, businessUse: 'ALL_COMPANY' });
    assert.equal(result.scopes[0]!.expenseDate, null);
    assert.ok(codes(result.blockers).includes(EXPENSE_CAPTURE_BLOCKERS.EXPENSE_DATE_REQUIRED));
  });

  it('A49 — the paid total is the purchase, not the cash handed over', () => {
    const facts = factsOf({
      documents: [document()],
      items: [item({ amount: '68.00' })],
      components: [
        component({ id: 'c1', label: 'เงินสด', role: 'tender', scope: 'document', amount: '500.00' }),
        component({ id: 'c2', label: 'เงินทอน', role: 'change', scope: 'document', amount: '432.00' }),
      ],
      totals: [total('D1', 'document_total', '68.00'), total('D1', 'reported_paid', '68.00')],
      payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
    });
    const result = allocate({ facts, businessUse: 'ALL_COMPANY' });
    assert.equal(result.summary.paidTotal, '68.00');
    assert.equal(result.scopes[0]!.companyAmount, '68.00');
  });
});

// ─── property ─────────────────────────────────────────────────────────────────

/** Deterministic PRNG: a failing seed is reproducible, which a random one would not be. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property: 200 random purchases', () => {
  it('company + personal is always the document total, and the identity always holds', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = mulberry32(seed);
      const pick = (max: number) => Math.floor(random() * max);
      const amount = () => new Decimal(pick(50_000) + 1).div(100).toFixed(2);

      const itemCount = 1 + pick(6);
      const items = Array.from({ length: itemCount }, (_, index) => item({
        id: `1:${index + 1}`, documentRef: 'D1', description: `row ${index}`,
        quantity: String(1 + pick(4)), amount: amount(),
      }));
      const merchandise = items.reduce((sum, row) => sum.plus(row.amount!), new Decimal(0));
      const discount = new Decimal(pick(Math.max(1, merchandise.times(100).toNumber()))).div(100).toDecimalPlaces(2);
      const shippingGross = new Decimal(pick(20_000)).div(100).toDecimalPlaces(2);
      const shippingDiscount = shippingGross.times(pick(101)).div(100).toDecimalPlaces(2);
      const documentTotal = merchandise.minus(discount).plus(shippingGross).minus(shippingDiscount);

      const facts = factsOf({
        documents: [document()],
        items,
        components: [
          component({ id: 'c1', scope: 'order', amount: discount.toFixed(2) }),
          component({ id: 'c2', label: 'ค่าส่ง', role: 'charge', scope: 'shipping', amount: shippingGross.toFixed(2) }),
          component({ id: 'c3', label: 'ส่วนลดค่าส่ง', scope: 'shipping', amount: shippingDiscount.toFixed(2) }),
        ],
        totals: [total('D1', 'document_total', documentTotal.toFixed(2))],
        payments: [paidOn('D1', '2026-09-02T00:00:00.000Z')],
      });
      assert.equal(facts.documents[0]!.state.reconciliation, 'reconciled', `seed ${seed}: fixture does not reconcile`);

      const everything = allocate({ facts, businessUse: 'ALL_COMPANY' });
      assert.equal(everything.summary.companyAmount, documentTotal.toFixed(2), `seed ${seed}: whole purchase`);
      assert.equal(everything.summary.personalAmount, '0.00', `seed ${seed}: nothing personal`);

      const selection = Object.fromEntries(items.map((row) => [`f1:${row.id}`, { companyQuantity: String(pick(Number(row.quantity) + 1)) }]));
      const split = allocate({ facts, selection });
      const company = new Decimal(split.summary.companyAmount);
      const personal = new Decimal(split.summary.personalAmount);
      assert.equal(company.plus(personal).toFixed(2), documentTotal.toFixed(2), `seed ${seed}: company + personal`);
      assert.ok(company.gte(0) && personal.gte(0), `seed ${seed}: no negative side`);
      assert.ok(company.lte(new Decimal(everything.summary.companyAmount)), `seed ${seed}: a split never exceeds the whole`);

      for (const scope of [...everything.scopes, ...split.scopes]) {
        assert.deepEqual(
          codes(scope.blockers).filter((code) => code === EXPENSE_CAPTURE_BLOCKERS.TOTALS_IDENTITY_FAILED),
          [], `seed ${seed}: identity`,
        );
        const lines = [
          ...scope.lines.map((line) => ({ ...line.totals, chargeKind: null })),
          ...scope.charges.map((charge) => ({ ...charge.totals, chargeKind: charge.chargeKind })),
        ];
        assert.equal(expenseTotalsIdentityError({
          vatMode: scope.vatMode, lines,
          totals: {
            subtotalAmount: scope.totals.subtotal, discountAmount: scope.totals.discount,
            taxableAmount: scope.totals.taxable, vatAmount: scope.totals.vat, grandTotalAmount: scope.totals.grandTotal,
          },
        }), null, `seed ${seed}: identity error`);
      }
    }
  });
});
