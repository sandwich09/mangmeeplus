import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupWhtEvents, computeWhtTotals, validateCertificateTotals, deriveWhtIncomeBase } from './wht-report.logic';

const baseEvent = {
  id: 'e1',
  whtFormType: 'PND53' as const,
  payeeSnapshot: { name: 'Vendor A', taxId: '0105512345678', address: null, branchCode: null },
  incomeCategoryCode: 'WHT_SERVICE',
  whtRate: '3.0000',
  grossAmount: '10000.0000',
  withheldAmount: '300.0000',
  netPaidAmount: '9700.0000',
  certificateNumber: 'WHT-001',
  sourceType: 'accounting.payment',
  sourceId: 'pay1',
  sourceEventType: null,
};

describe('groupWhtEvents', () => {
  it('preserves an unknown rate for amount-only WHT without changing accepted money', () => {
    const [group] = groupWhtEvents([{ ...baseEvent, whtRate: null, grossAmount: '1234.56', withheldAmount: '30.01' }]);
    assert.equal(group!.whtRate, null);
    assert.equal(group!.totalGross, '1234.5600');
    assert.equal(group!.totalWithheld, '30.0100');
  });
  it('groups two events from same payee+category+rate into one group', () => {
    const e2 = { ...baseEvent, id: 'e2', grossAmount: '5000.0000', withheldAmount: '150.0000', netPaidAmount: '4850.0000' };
    const groups = groupWhtEvents([baseEvent, e2]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.totalGross, '15000.0000');
    assert.equal(groups[0]!.totalWithheld, '450.0000');
    assert.ok(groups[0]!.certificateNumbers.includes('WHT-001'));
  });

  it('creates separate groups for different payees', () => {
    const e2 = { ...baseEvent, id: 'e2', payeeSnapshot: { name: 'Vendor B', taxId: '0125512345678', address: null, branchCode: null } };
    const groups = groupWhtEvents([baseEvent, e2]);
    assert.equal(groups.length, 2);
  });

  it('creates separate groups for different income categories', () => {
    const e2 = { ...baseEvent, id: 'e2', incomeCategoryCode: 'WHT_RENT' };
    const groups = groupWhtEvents([baseEvent, e2]);
    assert.equal(groups.length, 2);
  });
});

describe('computeWhtTotals', () => {
  it('sums gross and withheld across groups', () => {
    const groups = groupWhtEvents([baseEvent]);
    const totals = computeWhtTotals(groups, 0);
    assert.equal(totals.totalGross, '10000.0000');
    assert.equal(totals.totalWithheld, '300.0000');
    assert.equal(totals.payeeGroupCount, 1);
    assert.equal(totals.reviewIssueCount, 0);
  });
});

describe('validateCertificateTotals', () => {
  it('returns empty array when totals match', () => {
    const errors = validateCertificateTotals('10000.0000', '300.0000', '10000.0000', '300.0000');
    assert.equal(errors.length, 0);
  });
  it('returns error when gross mismatches', () => {
    const errors = validateCertificateTotals('9999.0000', '300.0000', '10000.0000', '300.0000');
    assert.ok(errors.length > 0);
    assert.ok(errors[0]!.includes('gross'));
  });
  it('returns error when withheld mismatches', () => {
    const errors = validateCertificateTotals('10000.0000', '299.0000', '10000.0000', '300.0000');
    assert.ok(errors.length > 0);
    assert.ok(errors[0]!.includes('withheld'));
  });
});

describe('deriveWhtIncomeBase', () => {
  it('recovers the income the tax was taken on', () => {
    assert.equal(deriveWhtIncomeBase('30', '3'), '1000.0000');
    assert.equal(deriveWhtIncomeBase('50.00', '5'), '1000.0000');
  });

  it('rounds to satang so base x rate matches the tax actually withheld', () => {
    // 3% of 333.33 is 9.9999 -> 10.00 withheld; the base must read back as the satang figure the
    // document shows, not 333.3333.
    assert.equal(deriveWhtIncomeBase('10', '3'), '333.3300');
  });

  it('returns null rather than a fabricated base when the rate is unusable', () => {
    // A zero or missing rate makes the base genuinely unknown. Null leaves it for review; any
    // number here would be invented, and it would be printed on a legal document.
    assert.equal(deriveWhtIncomeBase('30', null), null);
    assert.equal(deriveWhtIncomeBase('30', undefined), null);
    assert.equal(deriveWhtIncomeBase('30', '0'), null);
    assert.equal(deriveWhtIncomeBase('30', 'abc'), null);
  });
});
