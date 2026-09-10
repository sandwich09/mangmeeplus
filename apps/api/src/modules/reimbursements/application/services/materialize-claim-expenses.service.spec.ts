import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MaterializeClaimExpensesService } from './materialize-claim-expenses.service';
import { expenseTotalsIdentityError } from '../../../expenses/domain/logic/expense-totals.logic';

function lineRecord(overrides: Partial<any> = {}): any {
  return {
    id: 'rbl-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', lineNo: 1,
    incurredDate: new Date('2026-01-01T00:00:00.000Z'), description: 'Taxi to customer',
    categoryKey: 'travel', amount: '500.0000', ...overrides,
  };
}

function request(overrides: Partial<any> = {}): any {
  return {
    id: 'rb-1', companyId: 'co-1', branchId: 'br-1', requesterUserId: 'staff-1',
    requesterDisplayNameSnapshot: 'Somchai', currency: 'THB',
    lines: [lineRecord()], ...overrides,
  };
}

describe('MaterializeClaimExpensesService', () => {
  it('creates one expense per unlinked line with the exact defaults + marker', async () => {
    const svc = new MaterializeClaimExpensesService();
    const req = request({
      lines: [
        lineRecord({ id: 'rbl-1', amount: '500.0000' }),
        lineRecord({ id: 'rbl-2', lineNo: 2, amount: '250.0000', description: 'Hotel', purpose: 'Client visit', attachmentId: 'att-9' }),
      ],
    });
    const items = svc.buildItems(req);

    assert.equal(items.length, 2);
    const [first, second] = items;

    // Exact mapped defaults.
    assert.equal(first.status, 'READY_FOR_CONFIRMATION');
    assert.equal(first.captureSource, 'API_INTERNAL');
    // Born review-complete (owner decision 2026-08-10): the projection is confirmed and
    // frozen in the same saga, so nothing may be left NEEDS_REVIEW. Gross amount, no VAT
    // split, input VAT non-claimable; the signed claim form is the reference document.
    assert.equal(first.vatMode, 'NO_VAT');
    assert.equal(first.inputVatClaimStatus, 'NON_CLAIMABLE');
    assert.equal(first.sourceDocumentType, 'OTHER_EXPENSE_DOCUMENT');
    assert.equal(first.taxEvidenceStatus, 'SUPPORTING_ONLY');
    assert.deepEqual(first.sourceChannelMetadataJson, { cc2VatClaimClassification: 'EXTERNAL_OR_UNRESOLVED' });
    assert.equal(first.currency, 'THB');
    assert.equal(first.branchId, 'br-1');
    assert.deepEqual(first.expenseDate, new Date('2026-01-01T00:00:00.000Z'));
    assert.equal(first.vendorNameSnapshot, 'เบิกคืนพนักงาน: Somchai');
    assert.equal(first.description, 'Taxi to customer');

    // Single line, qty 1, unitPrice = line amount; the gross stays commercial (no VAT split
    // is invented before review).
    assert.equal(first.line.quantity, '1');
    assert.equal(first.line.unitPrice, '500.0000');
    assert.equal(first.line.taxableAmount, '500.0000');
    assert.equal(first.line.vatAmount, '0.0000');
    assert.equal(first.line.lineTotalAmount, '500.0000');
    assert.equal(first.grandTotalAmount, '500.0000');
    assert.equal(first.netPayableAmount, '500.0000');
    assert.equal(first.outstandingAmount, '500.0000');

    // purpose folds into the description; the receipt is carried for relink.
    assert.equal(second.description, 'Hotel (Client visit)');
    assert.equal(second.attachmentId, 'att-9');
    assert.equal(second.line.unitPrice, '250.0000');
  });

  it('references the claim-form number, line-suffixed only when the claim has several lines', async () => {
    const svc = new MaterializeClaimExpensesService();
    const multi = svc.buildItems(request({
      requestNo: 'RB-202608-00001',
      lines: [lineRecord({ id: 'rbl-1' }), lineRecord({ id: 'rbl-2', lineNo: 2 })],
    }));
    // Sibling projections must never share a vendor document number — the duplicate
    // scorer scores an exact vendor+number match at +30, well past its threshold.
    assert.deepEqual(multi.map((item) => item.vendorDocumentNumber), ['RB-202608-00001-1', 'RB-202608-00001-2']);

    const single = svc.buildItems(request({ requestNo: 'RB-202608-00002' }));
    assert.equal(single[0].vendorDocumentNumber, 'RB-202608-00002');

    const unsubmitted = svc.buildItems(request({ requestNo: null }));
    assert.equal(unsubmitted[0].vendorDocumentNumber, null);
  });

  it('copies the request missing-receipt reason onto attachment-less lines, null for receipt-backed', async () => {
    const svc = new MaterializeClaimExpensesService();
    const req = request({
      missingReceiptReason: 'ใบเสร็จหาย',
      lines: [
        lineRecord({ id: 'rbl-1', amount: '500.0000' }),
        lineRecord({ id: 'rbl-2', lineNo: 2, amount: '250.0000', attachmentId: 'att-9' }),
      ],
    });
    const [noReceipt, withReceipt] = svc.buildItems(req);
    assert.equal(noReceipt.missingReceiptReason, 'ใบเสร็จหาย');
    assert.equal(withReceipt.missingReceiptReason, null);
  });

  it('leaves missing-receipt reason null on attachment-less lines when the request has none', async () => {
    const svc = new MaterializeClaimExpensesService();
    const req = request({ lines: [lineRecord({ id: 'rbl-1' })] });
    assert.equal(svc.buildItems(req)[0]?.missingReceiptReason, null);
  });

  // Since CC2 every line owns exactly one projection: `createClaimProjectionsAtomic` refuses a
  // set that does not cover every line, and payment/settlement readiness is proven per line.
  it('projects every line, including one already linked to a company expense', async () => {
    const svc = new MaterializeClaimExpensesService();
    const req = request({
      lines: [
        lineRecord({ id: 'rbl-1', linkedExpenseId: 'exp-existing' }),
        lineRecord({ id: 'rbl-2', lineNo: 2, amount: '250.0000' }),
      ],
    });
    const items = svc.buildItems(req);
    assert.deepEqual(items.map((item) => item.reimbursementLineId), ['rbl-1', 'rbl-2']);
    // The pre-linked expense stays evidence only — reusing it would silently change its
    // accounting identity, so nothing in the projection points back at it.
    assert.equal(JSON.stringify(items).includes('exp-existing'), false);
  });

  it('maps satang and maximum storage values with Decimal-safe exact totals', () => {
    const svc = new MaterializeClaimExpensesService();
    const [satang, maximum] = svc.buildItems(request({
      lines: [
        lineRecord({ id: 'rbl-1', amount: '0.0050' }),
        lineRecord({ id: 'rbl-2', lineNo: 2, amount: '99999999999999.9900' }),
      ],
    }));
    assert.equal(satang.line.unitPrice, '0.0100');
    assert.equal(satang.grandTotalAmount, '0.0100');
    assert.equal(maximum.line.unitPrice, '99999999999999.9900');
    assert.equal(maximum.grandTotalAmount, '99999999999999.9900');
  });

  /**
   * Expense spec §5.1. This builder is one of the few writers that fills the expense HEADER totals
   * from its own figure instead of deriving them from the line it also writes, and the file already
   * depends on the two staying byte-equivalent through satang normalization. The guard inside the
   * builder cannot be tripped from out here — both sides come from the same `amount` — so what this
   * asserts is the invariant itself, across the amounts most likely to drift.
   */
  it('projects a header that adds up to its own line at every satang boundary', () => {
    const svc = new MaterializeClaimExpensesService();
    for (const amount of ['500.0000', '0.0100', '0.005', '1234.565', '99999999999999.9900']) {
      const [item] = svc.buildItems(request({ lines: [lineRecord({ amount })] }));
      assert.equal(
        expenseTotalsIdentityError({ vatMode: 'NO_VAT', totals: item, lines: [{ ...item.line, chargeKind: null }] }),
        null,
        amount,
      );
      assert.equal(item.grandTotalAmount, item.line.lineTotalAmount);
      assert.equal(item.subtotalAmount, item.line.lineSubtotalAmount);
    }
  });

  it('is a pure mapping: a second run over the now-linked lines repeats the same items', async () => {
    // Idempotency belongs to the repository, which looks an existing projection up by
    // sourceReimbursementLineId and reports created:false rather than making a second one.
    const req = request({ lines: [lineRecord({ id: 'rbl-1' })] });
    const svc = new MaterializeClaimExpensesService();
    const first = svc.buildItems(req);
    assert.equal(first.length, 1);
    req.lines[0].linkedExpenseId = 'exp-created';
    assert.deepEqual(svc.buildItems(req), first);
  });
  it('retains source charges and negative rounding without counting them twice in the goods subtotal', () => {
    const source = { classification: { expenseCategoryId: null, accountHintKey: null, taxCategory: null }, lines: [
      { description: 'goods including nonclaimable VAT', lineTotalAmount: '107.0000', chargeKind: null, accountHintKey: 'goods' },
      { description: 'service charge', lineTotalAmount: '10.0000', chargeKind: 'SERVICE_CHARGE', accountHintKey: 'service' },
      { description: 'rounding', lineTotalAmount: '-0.5000', chargeKind: 'ROUNDING', accountHintKey: 'rounding' },
    ] };
    const [item] = new MaterializeClaimExpensesService().buildItems(request({ missingReceiptReason: 'reason for a different manual line', lines: [lineRecord({ amount: '116.50', sourceExpenseSnapshot: source })] }));
    assert.equal(item.missingReceiptReason, null);
    assert.equal(item.subtotalAmount, '107.0000');
    assert.equal(item.taxableAmount, '116.5000');
    assert.equal(item.netPayableAmount, '116.5000');
    assert.equal(item.vatAmount, '0.0000');
    assert.deepEqual(item.sourceCostLines?.map(row => [row.chargeKind, row.amount, row.accountHintKey]), [[null, '107.0000', 'goods'], ['SERVICE_CHARGE', '10.0000', 'service'], ['ROUNDING', '-0.5000', 'rounding']]);
  });

});
