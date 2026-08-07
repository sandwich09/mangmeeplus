import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStatementRow,
  statementLineHash,
  scoreMatchCandidate,
  validateMatchAllocation,
  calculateStatementLineMatchStatus,
  calculateReconciliationBalance,
  calculateInitialReconciliationSession,
  canCompleteReconciliation,
  buildAdjustmentPostingInput,
  maskAccountNumber,
  extractLast4,
  sumDecimalAmounts,
  applyConfirmedAllocations,
  candidateAllocationKey,
  checkRunningBalanceContinuity,
  clusterPdfTextRows,
} from './banking.logic';

// ---------------------------------------------------------------------------
// normalizeStatementRow
// ---------------------------------------------------------------------------

describe('normalizeStatementRow', () => {
  it('parses debit/credit columns: deposit (credit > 0)', () => {
    const r = normalizeStatementRow({
      postedDate: '2026-06-01',
      description: 'Customer payment',
      debit: '',
      credit: '5000.00',
    });
    assert.equal(r.direction, 'DEPOSIT');
    assert.equal(r.signedAmount, '5000.00');
    assert.equal(r.errors.length, 0);
  });

  it('parses debit/credit columns: withdrawal (debit > 0)', () => {
    const r = normalizeStatementRow({
      postedDate: '2026-06-02',
      description: 'Supplier payment',
      debit: '1200.50',
      credit: '',
    });
    assert.equal(r.direction, 'WITHDRAWAL');
    assert.equal(r.signedAmount, '-1200.50');
  });

  it('parses signed amount column (positive = deposit)', () => {
    const r = normalizeStatementRow({
      postedDate: '2026-06-03',
      description: 'Interest received',
      amount: '350.75',
    });
    assert.equal(r.direction, 'DEPOSIT');
    assert.equal(r.signedAmount, '350.75');
  });

  it('parses signed amount column (negative = withdrawal)', () => {
    const r = normalizeStatementRow({
      postedDate: '2026-06-04',
      description: 'Bank fee',
      amount: '-50.00',
    });
    assert.equal(r.direction, 'WITHDRAWAL');
    assert.equal(r.signedAmount, '-50.00');
  });

  it('Thai alias: ฝาก (credit) / ถอน (debit)', () => {
    const r = normalizeStatementRow({
      'วันที่': '2026-06-05',
      'รายการ': 'โอนเงิน',
      'ฝาก': '2000.00',
      'ถอน': '',
    });
    assert.equal(r.direction, 'DEPOSIT');
    assert.equal(r.signedAmount, '2000.00');
    assert.equal(r.postedDate, '2026-06-05');
    assert.equal(r.description, 'โอนเงิน');
  });

  it('Thai alias: ถอน (withdrawal)', () => {
    const r = normalizeStatementRow({
      'วันที่ทำรายการ': '2026-06-06',
      'รายละเอียด': 'ชำระค่าสินค้า',
      'ถอน': '800.00',
      'ฝาก': '',
    });
    assert.equal(r.direction, 'WITHDRAWAL');
    assert.equal(r.signedAmount, '-800.00');
  });

  it('adds error when date is missing', () => {
    const r = normalizeStatementRow({ description: 'test', amount: '100' });
    assert.ok(r.errors.some((e) => e.includes('date')));
  });

  it('adds error and returns ZERO when amount is missing', () => {
    const r = normalizeStatementRow({ postedDate: '2026-06-01', description: 'test' });
    assert.equal(r.direction, 'ZERO');
    assert.ok(r.errors.some((e) => e.includes('amount')));
  });

  it('preserves running balance when present', () => {
    const r = normalizeStatementRow({
      postedDate: '2026-06-07',
      description: 'test',
      amount: '100',
      balance: '10000.00',
    });
    assert.equal(r.runningBalanceAmount, '10000.00');
  });

  it('defaults currency to THB', () => {
    const r = normalizeStatementRow({ postedDate: '2026-06-01', description: 'x', amount: '1' });
    assert.equal(r.currency, 'THB');
  });
});

// ---------------------------------------------------------------------------
// statementLineHash
// ---------------------------------------------------------------------------

describe('statementLineHash', () => {
  const base = {
    companyId: 'co-1',
    bankAccountId: 'ba-1',
    postedDate: '2026-06-01',
    signedAmount: '1000.00',
    currency: 'THB',
  };

  it('same params produce the same hash', () => {
    assert.equal(statementLineHash(base), statementLineHash(base));
  });

  it('different amount produces a different hash', () => {
    assert.notEqual(statementLineHash(base), statementLineHash({ ...base, signedAmount: '999.00' }));
  });

  it('different bankAccountId produces a different hash', () => {
    assert.notEqual(statementLineHash(base), statementLineHash({ ...base, bankAccountId: 'ba-2' }));
  });

  it('different bankReference produces a different hash', () => {
    const withRef = statementLineHash({ ...base, bankReference: 'REF-001' });
    const withoutRef = statementLineHash(base);
    assert.notEqual(withRef, withoutRef);
  });

  it('normalizes amount format (1000 == 1000.00)', () => {
    assert.equal(
      statementLineHash({ ...base, signedAmount: '1000' }),
      statementLineHash({ ...base, signedAmount: '1000.00' }),
    );
  });
});

// ---------------------------------------------------------------------------
// scoreMatchCandidate
// ---------------------------------------------------------------------------

describe('scoreMatchCandidate', () => {
  it('returns 0 for currency mismatch', () => {
    const score = scoreMatchCandidate(
      { postedDate: '2026-06-01', signedAmount: '1000.00', currency: 'THB' },
      { paymentDate: '2026-06-01', amount: '1000.00', currency: 'USD' },
    );
    assert.equal(score, 0);
  });

  it('returns 0 for amount mismatch', () => {
    const score = scoreMatchCandidate(
      { postedDate: '2026-06-01', signedAmount: '1000.00', currency: 'THB' },
      { paymentDate: '2026-06-01', amount: '999.00', currency: 'THB' },
    );
    assert.equal(score, 0);
  });

  it('returns high score for exact amount, currency, and same-day date', () => {
    const score = scoreMatchCandidate(
      { postedDate: '2026-06-01', signedAmount: '5000.00', currency: 'THB' },
      { paymentDate: '2026-06-01', amount: '5000.00', currency: 'THB' },
    );
    assert.ok(score >= 80, `Expected score >= 80, got ${score}`);
  });

  it('extra bonus for matching reference', () => {
    const withRef = scoreMatchCandidate(
      { postedDate: '2026-06-01', signedAmount: '1000.00', currency: 'THB', bankReference: 'INV-001' },
      { paymentDate: '2026-06-01', amount: '1000.00', currency: 'THB', reference: 'INV-001' },
    );
    const withoutRef = scoreMatchCandidate(
      { postedDate: '2026-06-01', signedAmount: '1000.00', currency: 'THB' },
      { paymentDate: '2026-06-01', amount: '1000.00', currency: 'THB' },
    );
    assert.ok(withRef > withoutRef, 'Reference match should increase score');
  });

  it('score does not exceed 100', () => {
    const score = scoreMatchCandidate(
      { postedDate: '2026-06-01', signedAmount: '999.00', currency: 'THB', bankReference: 'REF', normalizedDescription: 'ACME Corp' },
      { paymentDate: '2026-06-01', amount: '999.00', currency: 'THB', reference: 'REF', counterpartyName: 'ACME Corp' },
    );
    assert.ok(score <= 100);
  });
});

// ---------------------------------------------------------------------------
// validateMatchAllocation
// ---------------------------------------------------------------------------

describe('validateMatchAllocation', () => {
  it('returns valid for correct allocation', () => {
    const r = validateMatchAllocation({
      statementLineAmount: '1000.00',
      alreadyAllocated: '0.00',
      newAllocation: '1000.00',
      direction: 'DEPOSIT',
      candidateDirection: 'DEPOSIT',
    });
    assert.equal(r.valid, true);
  });

  it('blocks over-allocation', () => {
    const r = validateMatchAllocation({
      statementLineAmount: '1000.00',
      alreadyAllocated: '800.00',
      newAllocation: '300.00',
      direction: 'DEPOSIT',
      candidateDirection: 'DEPOSIT',
    });
    assert.equal(r.valid, false);
    assert.ok(r.error?.includes('Over-allocation'));
  });

  it('blocks wrong-sign direction mismatch', () => {
    const r = validateMatchAllocation({
      statementLineAmount: '1000.00',
      alreadyAllocated: '0.00',
      newAllocation: '500.00',
      direction: 'DEPOSIT',
      candidateDirection: 'WITHDRAWAL',
    });
    assert.equal(r.valid, false);
    assert.ok(r.error?.includes('Direction mismatch'));
  });

  it('blocks ZERO-direction lines', () => {
    const r = validateMatchAllocation({
      statementLineAmount: '0.00',
      alreadyAllocated: '0.00',
      newAllocation: '0.00',
      direction: 'ZERO',
      candidateDirection: 'DEPOSIT',
    });
    assert.equal(r.valid, false);
  });

  it('blocks zero or negative allocation', () => {
    const r = validateMatchAllocation({
      statementLineAmount: '1000.00',
      alreadyAllocated: '0.00',
      newAllocation: '0.00',
      direction: 'DEPOSIT',
      candidateDirection: 'DEPOSIT',
    });
    assert.equal(r.valid, false);
  });
});

// ---------------------------------------------------------------------------
// allocation math helpers
// ---------------------------------------------------------------------------

describe('banking money helpers', () => {
  it('sums decimal strings with cent arithmetic', () => {
    assert.equal(sumDecimalAmounts(['0.10', '0.20', '1,000.05']), '1000.35');
  });

  it('derives statement line match status without floating-point drift', () => {
    assert.equal(
      calculateStatementLineMatchStatus({ statementLineAmount: '0.30', confirmedAllocations: ['0.10', '0.20'] }),
      'MATCHED',
    );
  });

  it('keeps partial status when allocations do not cover the absolute line amount', () => {
    assert.equal(
      calculateStatementLineMatchStatus({ statementLineAmount: '-100.00', confirmedAllocations: ['99.99'] }),
      'PARTIALLY_MATCHED',
    );
  });
});

// ---------------------------------------------------------------------------
// calculateReconciliationBalance
// ---------------------------------------------------------------------------

describe('calculateReconciliationBalance', () => {
  it('computes closing statement balance and book balance correctly', () => {
    const r = calculateReconciliationBalance({
      openingStatementBalance: '10000.00',
      statementMovements: ['5000.00', '-2000.00', '500.00'],
      openingBookBalance: '10000.00',
      reconciledMovements: ['5000.00', '-2000.00', '500.00'],
    });
    assert.equal(r.closingStatementBalance, '13500.00');
    assert.equal(r.calculatedBookBalance, '13500.00');
    assert.equal(r.difference, '0.00');
  });

  it('shows non-zero difference when book and statement diverge', () => {
    const r = calculateReconciliationBalance({
      openingStatementBalance: '10000.00',
      statementMovements: ['1000.00'],
      openingBookBalance: '10000.00',
      reconciledMovements: ['800.00'],
    });
    assert.equal(r.closingStatementBalance, '11000.00');
    assert.equal(r.calculatedBookBalance, '10800.00');
    assert.equal(r.difference, '200.00');
  });

  it('returns zeros for empty movements', () => {
    const r = calculateReconciliationBalance({
      openingStatementBalance: '0.00',
      statementMovements: [],
      openingBookBalance: '0.00',
      reconciledMovements: [],
    });
    assert.equal(r.difference, '0.00');
  });
});

describe('calculateInitialReconciliationSession', () => {
  it('calculates opening-to-closing movement with cent arithmetic', () => {
    const r = calculateInitialReconciliationSession({
      openingStatementBalance: '90071992547409.91',
      closingStatementBalance: '90071992547410.01',
    });
    assert.equal(r.calculatedStatementMovementAmount, '0.10');
    assert.equal(r.calculatedBookMovementAmount, '0.00');
    assert.equal(r.calculatedBookBalanceAmount, '90071992547409.91');
    assert.equal(r.differenceAmount, '0.10');
  });
});

// ---------------------------------------------------------------------------
// canCompleteReconciliation
// ---------------------------------------------------------------------------

describe('canCompleteReconciliation', () => {
  const happy = {
    unmatchedRequiredLinesCount: 0,
    ignoredWithoutReviewCount: 0,
    differenceAmount: '0.00',
    hasLedgerLink: true,
    isPeriodClosed: false,
  };

  it('returns canComplete true when all conditions met', () => {
    const r = canCompleteReconciliation(happy);
    assert.equal(r.canComplete, true);
    assert.equal(r.blockers.length, 0);
  });

  it('blocked when difference is non-zero', () => {
    const r = canCompleteReconciliation({ ...happy, differenceAmount: '100.00' });
    assert.equal(r.canComplete, false);
    assert.ok(r.blockers.some((b) => b.includes('difference')));
  });

  it('blocked when unmatched lines exist', () => {
    const r = canCompleteReconciliation({ ...happy, unmatchedRequiredLinesCount: 3 });
    assert.equal(r.canComplete, false);
    assert.ok(r.blockers.some((b) => b.includes('unmatched')));
  });

  it('blocked when ignored lines need review', () => {
    const r = canCompleteReconciliation({ ...happy, ignoredWithoutReviewCount: 1 });
    assert.equal(r.canComplete, false);
    assert.ok(r.blockers.some((b) => b.includes('ignored')));
  });

  it('blocked when no ledger link', () => {
    const r = canCompleteReconciliation({ ...happy, hasLedgerLink: false });
    assert.equal(r.canComplete, false);
    assert.ok(r.blockers.some((b) => b.includes('ledger')));
  });

  it('blocked when period is closed', () => {
    const r = canCompleteReconciliation({ ...happy, isPeriodClosed: true });
    assert.equal(r.canComplete, false);
    assert.ok(r.blockers.some((b) => b.includes('closed')));
  });

  it('accumulates multiple blockers', () => {
    const r = canCompleteReconciliation({
      unmatchedRequiredLinesCount: 2,
      ignoredWithoutReviewCount: 1,
      differenceAmount: '500.00',
      hasLedgerLink: false,
      isPeriodClosed: true,
    });
    assert.equal(r.canComplete, false);
    assert.equal(r.blockers.length, 5);
  });
});

// ---------------------------------------------------------------------------
// buildAdjustmentPostingInput
// ---------------------------------------------------------------------------

describe('buildAdjustmentPostingInput', () => {
  const bankFeeAdj = {
    id: 'adj-1',
    companyId: 'co-1',
    adjustmentNumber: 'ADJ-0001',
    category: 'BANK_FEE',
    adjustmentDate: '2026-06-01',
    description: 'Monthly bank fee',
    signedAmount: '-150.00',
    currency: 'THB',
    ledgerDebitAccountId: 'acc-bank-fee-expense',
    ledgerCreditAccountId: 'acc-bank-checking',
  };

  it('BANK_FEE with debit/credit accounts produces two lines', () => {
    const r = buildAdjustmentPostingInput(bankFeeAdj);
    assert.equal(r.error, undefined);
    assert.equal(r.lines.length, 2);
    const debitLine = r.lines[0];
    const creditLine = r.lines[1];
    assert.equal(debitLine.ledgerAccountId, 'acc-bank-fee-expense');
    assert.equal(debitLine.debitAmount, '150.00');
    assert.equal(debitLine.creditAmount, '0.00');
    assert.equal(creditLine.ledgerAccountId, 'acc-bank-checking');
    assert.equal(creditLine.debitAmount, '0.00');
    assert.equal(creditLine.creditAmount, '150.00');
  });

  it('uses absolute amount regardless of sign', () => {
    const r = buildAdjustmentPostingInput({ ...bankFeeAdj, signedAmount: '150.00' });
    assert.equal(r.lines[0].debitAmount, '150.00');
    assert.equal(r.lines[1].creditAmount, '150.00');
  });

  it('returns error when ledger accounts are missing', () => {
    const r = buildAdjustmentPostingInput({
      ...bankFeeAdj,
      ledgerDebitAccountId: undefined,
      ledgerCreditAccountId: undefined,
    });
    assert.ok(r.error);
    assert.equal(r.lines.length, 0);
  });
});

// ---------------------------------------------------------------------------
// maskAccountNumber and extractLast4
// ---------------------------------------------------------------------------

describe('maskAccountNumber', () => {
  it('masks all but last 4 digits', () => {
    assert.equal(maskAccountNumber('0123456789'), '******6789');
  });

  it('handles account with dashes', () => {
    const masked = maskAccountNumber('012-3-45678-9');
    // digits: 0123456789 → ******6789
    assert.equal(masked, '******6789');
  });

  it('handles short account number (<= 4 digits)', () => {
    assert.equal(maskAccountNumber('1234'), '****');
  });
});

describe('extractLast4', () => {
  it('returns last 4 digits only', () => {
    assert.equal(extractLast4('0123456789'), '6789');
  });

  it('strips non-digit characters first', () => {
    assert.equal(extractLast4('012-3-45678-9'), '6789');
  });

  it('returns all digits when 4 or fewer', () => {
    assert.equal(extractLast4('123'), '123');
  });
});

describe('checkRunningBalanceContinuity', () => {
  it('accepts a consistent chain', () => {
    const breaks = checkRunningBalanceContinuity([
      { signedAmount: '1500.00', runningBalanceAmount: '11500.00' },
      { signedAmount: '-350.25', runningBalanceAmount: '11149.75' },
      { signedAmount: '-2000.00', runningBalanceAmount: '9149.75' },
    ]);
    assert.deepEqual(breaks, []);
  });

  it('flags the 1-based row where the chain breaks (misread figure)', () => {
    const breaks = checkRunningBalanceContinuity([
      { signedAmount: '1500.00', runningBalanceAmount: '11500.00' },
      { signedAmount: '-350.25', runningBalanceAmount: '11149.75' },
      { signedAmount: '-2000.00', runningBalanceAmount: '9199.75' }, // off by 50
    ]);
    assert.deepEqual(breaks, [3]);
  });

  it('resets the chain across rows without a balance instead of flagging them', () => {
    const breaks = checkRunningBalanceContinuity([
      { signedAmount: '100.00', runningBalanceAmount: '1000.00' },
      { signedAmount: '50.00' },
      { signedAmount: '25.00', runningBalanceAmount: '9999.00' },
      { signedAmount: '-9.00', runningBalanceAmount: '9990.00' },
    ]);
    assert.deepEqual(breaks, []);
  });

  it('handles comma-formatted balances', () => {
    const breaks = checkRunningBalanceContinuity([
      { signedAmount: '1,500.00', runningBalanceAmount: '11,500.00' },
      { signedAmount: '-500.00', runningBalanceAmount: '11,000.00' },
    ]);
    assert.deepEqual(breaks, []);
  });
});

describe('clusterPdfTextRows', () => {
  const headerItems = [
    { str: 'วันที่', x: 40, y: 100 },
    { str: 'รายการ', x: 120, y: 100 },
    { str: 'ถอน', x: 300, y: 100 },
    { str: 'ฝาก', x: 380, y: 100 },
    { str: 'ยอดคงเหลือ', x: 460, y: 100 },
  ];

  it('maps positioned cells to canonical column keys via the header aliases', () => {
    const { headerFound, rows } = clusterPdfTextRows([
      ...headerItems,
      { str: '01/07/2026', x: 40, y: 120 },
      { str: 'รับโอนจากลูกค้า', x: 120, y: 120.8 },
      { str: '1,500.00', x: 382, y: 120 },
      { str: '11,500.00', x: 458, y: 120 },
      { str: '02/07/2026', x: 40, y: 140 },
      { str: 'ค่าธรรมเนียม', x: 120, y: 140 },
      { str: '350.25', x: 301, y: 140 },
      { str: '11,149.75', x: 460, y: 140 },
    ]);
    assert.equal(headerFound, true);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].postedDate, '01/07/2026');
    assert.equal(rows[0].credit, '1,500.00');
    assert.equal(rows[0].balance, '11,500.00');
    assert.equal(rows[0].debit, undefined);
    assert.equal(rows[1].debit, '350.25');
    assert.equal(rows[1].description, 'ค่าธรรมเนียม');
  });

  it('merges split header items and joins multi-item descriptions', () => {
    const { headerFound, rows } = clusterPdfTextRows([
      { str: 'Transaction', x: 40, y: 50, width: 48 },
      { str: ' Date', x: 88, y: 50, width: 22 },
      { str: 'Details', x: 200, y: 50 },
      { str: 'Amount', x: 400, y: 50 },
      { str: 'Transfer', x: 200, y: 70, width: 35 },
      { str: 'from A', x: 260, y: 70 },
      { str: '2026-07-01', x: 40, y: 70 },
      { str: '99.00', x: 401, y: 70 },
    ]);
    assert.equal(headerFound, true);
    assert.equal(rows[0].postedDate, '2026-07-01');
    assert.equal(rows[0].description, 'Transfer from A');
    assert.equal(rows[0].amount, '99.00');
  });

  it('skips repeated header lines on later pages', () => {
    const page2Header = headerItems.map((h) => ({ ...h, y: 100_300 }));
    const { rows } = clusterPdfTextRows([
      ...headerItems,
      { str: '01/07/2026', x: 40, y: 130 },
      { str: 'A', x: 120, y: 130 },
      { str: '10.00', x: 380, y: 130 },
      ...page2Header,
      { str: '02/07/2026', x: 40, y: 100_330 },
      { str: 'B', x: 120, y: 100_330 },
      { str: '20.00', x: 380, y: 100_330 },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].credit, '20.00');
  });

  it('reports headerFound=false when no statement header exists (scan or wrong document)', () => {
    const { headerFound, rows } = clusterPdfTextRows([
      { str: 'ใบเสร็จรับเงิน', x: 100, y: 50 },
      { str: 'รวมทั้งสิ้น 500.00', x: 100, y: 80 },
    ]);
    assert.equal(headerFound, false);
    assert.deepEqual(rows, []);
  });
});

describe('applyConfirmedAllocations', () => {
  const candidate = (over: Partial<{ sourceType: string; sourceId: string; amount: string }> = {}) => ({
    sourceType: 'CUSTOMER_PAYMENT',
    sourceId: 'pay-1',
    amount: '100.00',
    ...over,
  });

  it('returns full amount as remaining when nothing is matched', () => {
    const out = applyConfirmedAllocations([candidate()], {});
    assert.equal(out.length, 1);
    assert.equal(out[0].remainingUnmatchedAmount, '100.00');
  });

  it('subtracts confirmed allocations keyed by sourceType:sourceId', () => {
    const totals = { [candidateAllocationKey('CUSTOMER_PAYMENT', 'pay-1')]: '30.50' };
    const out = applyConfirmedAllocations([candidate()], totals);
    assert.equal(out[0].remainingUnmatchedAmount, '69.50');
  });

  it('drops fully matched candidates', () => {
    const totals = { [candidateAllocationKey('CUSTOMER_PAYMENT', 'pay-1')]: '100.00' };
    assert.equal(applyConfirmedAllocations([candidate()], totals).length, 0);
  });

  it('uses absolute value for negative amounts (withdrawal-style adjustments)', () => {
    const out = applyConfirmedAllocations(
      [candidate({ sourceType: 'BANK_ADJUSTMENT', sourceId: 'adj-1', amount: '-45.25' })],
      { [candidateAllocationKey('BANK_ADJUSTMENT', 'adj-1')]: '5.25' },
    );
    assert.equal(out[0].remainingUnmatchedAmount, '40.00');
  });

  it('does not mix allocations across different source types with the same id', () => {
    const totals = { [candidateAllocationKey('SUPPLIER_PAYMENT', 'pay-1')]: '100.00' };
    const out = applyConfirmedAllocations([candidate()], totals);
    assert.equal(out[0].remainingUnmatchedAmount, '100.00');
  });
});
