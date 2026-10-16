import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gateBusinessDocumentClassification, parseBusinessDocumentClassification } from './business-document-classification.logic';

describe('OCR-A due-date and optional tax ID gaps', () => {
  const base = {
    contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'TAX_INVOICE',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', confidence: 0.91,
    evidenceRoles: ['EXPENSE_SUPPORT', 'TAX_EVIDENCE_CANDIDATE'], evidenceSignals: [],
    amountSignals: ['514,158.81'], settlementSignals: ['ใบเสร็จรับเงิน'],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
  };
  const text = 'ใบกำกับภาษี / ใบเสร็จรับเงิน\nTAX INVOICE / RECEIPT\nวันที่ 20/09/2026\nครบกำหนด 25/09/2026\nจำนวนเงินรวมทั้งสิ้น 514,158.81';

  it('does not escalate the exact printed due date on a combined invoice/receipt', () => {
    for (const requiresClarification of [false, true]) {
      const parsed = parseBusinessDocumentClassification({ ...base, requiresClarification, contradictionSignals: ['ครบกำหนด 25/09/2026'] }, text)!;
      assert.deepEqual(parsed.contradictionSignals, []);
      assert.deepEqual(parsed.missingRequiredSignals, []);
      assert.equal(parsed.requiresClarification, false);
      assert.equal(parsed.transactionState, 'PAID');
    }
  });

  it('keeps unknown contradictions, missing totals, unpaid invoices and multi-document gates', () => {
    for (const changes of [
      { contradictionSignals: ['ครบกำหนด 25/09/2026', 'ยังไม่ได้รับเงิน'] },
      { transactionState: 'DUE', contradictionSignals: ['ครบกำหนด 25/09/2026'] },
      { contentKind: 'MULTI_DOCUMENT', contradictionSignals: ['ครบกำหนด 25/09/2026'] },
      { missingRequiredSignals: ['MISSING_TRANSACTION_TOTAL'], requiresClarification: true, contradictionSignals: ['ครบกำหนด 25/09/2026'] },
    ]) assert.equal(parseBusinessDocumentClassification({ ...base, ...changes }, text)?.requiresClarification, true);
    assert.equal(parseBusinessDocumentClassification({ ...base, contradictionSignals: ['ครบกำหนด 25/09/2026'] }, text.replace(/ใบเสร็จรับเงิน|RECEIPT/g, 'ใบแจ้งหนี้'))?.requiresClarification, true);
  });

  it('does not report a missing tax ID for cash bills, receipts or transfer slips', () => {
    for (const documentKind of ['RECEIPT', 'HANDWRITTEN_CASH_BILL', 'TRANSFER_SLIP']) {
      const parsed = parseBusinessDocumentClassification({ ...base, documentKind, missingRequiredSignals: ['PAYMENT_EVIDENCE_ONLY', 'MISSING_VENDOR_TAX_ID'] }, text)!;
      assert.deepEqual(parsed.missingRequiredSignals, ['PAYMENT_EVIDENCE_ONLY']);
    }
    assert.deepEqual(parseBusinessDocumentClassification({ ...base, missingRequiredSignals: ['MISSING_VENDOR_TAX_ID'] }, text)?.missingRequiredSignals, ['MISSING_VENDOR_TAX_ID']);
  });
});

/** UAT 2026-08-27: Sonnet 4.6 labelled a clear receipt's evidenceRoles with document-kind
 *  synonyms ("RECEIPT", "TAX_INVOICE"); the all-or-nothing enum check voided the whole
 *  classification, which voided the whole intake plan, which stranded the media turn. The
 *  descriptive roles array now filters unknown labels; safety-bearing reason codes stay strict. */
describe('evidenceRoles tolerance', () => {
  const base = {
    contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'TAX_INVOICE',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', confidence: 0.97,
    evidenceSignals: [], amountSignals: [], settlementSignals: [],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
  };
  it('filters unknown role labels instead of rejecting the classification', () => {
    const parsed = parseBusinessDocumentClassification({ ...base, evidenceRoles: ['RECEIPT', 'TAX_INVOICE', 'PAYMENT_PROOF'] }, '');
    assert.ok(parsed, 'classification must survive out-of-vocabulary roles');
    assert.deepEqual(parsed?.evidenceRoles, ['PAYMENT_PROOF']);
  });
  it('all-unknown roles yield an empty list, still accepted', () => {
    const parsed = parseBusinessDocumentClassification({ ...base, evidenceRoles: ['RECEIPT'] }, '');
    assert.ok(parsed);
    assert.deepEqual(parsed?.evidenceRoles, []);
  });
  it('a non-array evidenceRoles is still rejected', () => {
    assert.equal(parseBusinessDocumentClassification({ ...base, evidenceRoles: 'PAYMENT_PROOF' }, ''), null);
  });
});

/** UAT 2026-08-27 (evening): a PTT fuel card slip the model read perfectly was thrown away because
 *  it wrote a free sentence into the code-only `missingRequiredSignals`. An undecodable reason must
 *  reach a human, not delete the turn. */
describe('reason-code tolerance', () => {
  const base = {
    contentKind: 'DOCUMENT', documentFamily: 'PAYMENT_EVIDENCE', documentKind: 'RECEIPT',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', confidence: 0.93,
    evidenceSignals: [], amountSignals: [], settlementSignals: [], evidenceRoles: ['PAYMENT_PROOF'],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
  };

  it('keeps the classification and escalates to a person when a reason code cannot be decoded', () => {
    const parsed = parseBusinessDocumentClassification(
      { ...base, missingRequiredSignals: ['itemised fuel quantity/litres not shown on this slip'] },
      '',
    );
    assert.ok(parsed, 'the read survives — the slip is not discarded over one field');
    assert.equal(parsed?.documentKind, 'RECEIPT');
    assert.deepEqual(parsed?.missingRequiredSignals, ['HUMAN_REVIEW_REQUIRED']);
    assert.equal(parsed?.requiresClarification, true);
  });

  it('keeps the codes it does understand alongside the escalation', () => {
    const parsed = parseBusinessDocumentClassification(
      { ...base, missingRequiredSignals: ['PAYMENT_EVIDENCE_ONLY', 'something the model made up'] },
      '',
    );
    assert.deepEqual(parsed?.missingRequiredSignals, ['PAYMENT_EVIDENCE_ONLY', 'HUMAN_REVIEW_REQUIRED']);
    assert.equal(parsed?.requiresClarification, true);
  });

  it('an all-known reason array is untouched — no spurious review flag', () => {
    const parsed = parseBusinessDocumentClassification({ ...base, missingRequiredSignals: ['PAYMENT_EVIDENCE_ONLY'] }, '');
    assert.deepEqual(parsed?.missingRequiredSignals, ['PAYMENT_EVIDENCE_ONLY']);
    assert.equal(parsed?.requiresClarification, false);
  });

  it('an undecodable CONTRADICTION also escalates instead of voiding', () => {
    const parsed = parseBusinessDocumentClassification({ ...base, contradictionSignals: ['dates disagree somehow'] }, '');
    assert.ok(parsed);
    assert.deepEqual(parsed?.contradictionSignals, []);
    assert.ok(parsed?.missingRequiredSignals.includes('HUMAN_REVIEW_REQUIRED'));
    assert.equal(parsed?.requiresClarification, true);
  });

  it('a non-array reason field is still invalid SHAPE and still voids the classification', () => {
    assert.equal(parseBusinessDocumentClassification({ ...base, missingRequiredSignals: 'PAYMENT_EVIDENCE_ONLY' }, ''), null);
  });
});

/**
 * Capture appendix §10.2: a courier parcel label and a drop-off slip both read as `DELIVERY_NOTE`,
 * and the API needs to tell them apart to pick §18.4's NR01 vs NR02 sentence. They are SIGNALS on
 * purpose — a new documentKind per courier is what §18.4 "ของเดิมและช่องว่าง" forbids.
 */
describe('courier label / deposit-slip signals (§10.2)', () => {
  const base = {
    contentKind: 'DOCUMENT', documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'DELIVERY_NOTE',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'ORDERED', confidence: 0.9,
    evidenceSignals: [], amountSignals: [], settlementSignals: [], evidenceRoles: [],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
  };

  for (const code of ['PARCEL_LABEL_SIGNAL', 'DEPOSIT_SLIP_SIGNAL']) {
    it(`${code} is a known reason code, so it survives the parser without escalating`, () => {
      const parsed = parseBusinessDocumentClassification({ ...base, missingRequiredSignals: [code] }, '');
      assert.ok(parsed, 'the classification survives');
      assert.deepEqual(parsed?.missingRequiredSignals, [code]);
      // Before this code existed the parser dropped it as unknown, added HUMAN_REVIEW_REQUIRED and
      // forced `requiresClarification` — which is how a parcel label became "ไม่แน่ใจ" instead of NR01.
      assert.equal(parsed?.requiresClarification, false);
      assert.equal(parsed?.documentKind, 'DELIVERY_NOTE', 'the kind stays; only the signal is new');
    });
  }

  it('the signal does not disturb the receipt-only downgrade gate', () => {
    const parsed = parseBusinessDocumentClassification({ ...base, missingRequiredSignals: ['PARCEL_LABEL_SIGNAL'] }, '');
    assert.ok(parsed);
    assert.deepEqual(gateBusinessDocumentClassification(parsed!, undefined, ''), parsed, 'a DELIVERY_NOTE passes the gate untouched');
  });
});
