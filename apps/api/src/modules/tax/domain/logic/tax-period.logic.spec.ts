import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthlyPeriodKey,
  annualPeriodKey,
  halfYearPeriodKey,
  formPeriodKey,
  isPeriodLocked,
  assertPeriodUnlocked,
  evaluateDueDate,
  makeReviewIssue,
} from './tax-period.logic';

describe('monthlyPeriodKey', () => {
  it('returns YYYY-MM for January', () => {
    assert.equal(monthlyPeriodKey(new Date(2026, 0, 15)), '2026-01');
  });
  it('returns YYYY-MM for December', () => {
    assert.equal(monthlyPeriodKey(new Date(2026, 11, 1)), '2026-12');
  });
});

describe('annualPeriodKey', () => {
  it('returns YYYY', () => {
    assert.equal(annualPeriodKey(2026), '2026');
  });
});

describe('halfYearPeriodKey', () => {
  it('returns YYYY-H1', () => {
    assert.equal(halfYearPeriodKey(2026, 1), '2026-H1');
  });
  it('returns YYYY-H2', () => {
    assert.equal(halfYearPeriodKey(2026, 2), '2026-H2');
  });
});

describe('formPeriodKey', () => {
  it('returns monthly key for PP30', () => {
    assert.equal(formPeriodKey('PP30', new Date(2026, 2, 10)), '2026-03');
  });
  it('returns monthly key for PP36', () => {
    assert.equal(formPeriodKey('PP36', new Date(2026, 2, 10)), '2026-03');
  });
  it('returns monthly key for PND3', () => {
    assert.equal(formPeriodKey('PND3', new Date(2026, 2, 10)), '2026-03');
  });
  it('returns monthly key for PND53', () => {
    assert.equal(formPeriodKey('PND53', new Date(2026, 2, 10)), '2026-03');
  });
  it('returns annual key for PND50', () => {
    assert.equal(formPeriodKey('PND50', new Date(2026, 5, 1)), '2026');
  });
  it('returns H1 for PND51 in first half', () => {
    assert.equal(formPeriodKey('PND51', new Date(2026, 4, 1)), '2026-H1');
  });
  it('returns H2 for PND51 in second half', () => {
    assert.equal(formPeriodKey('PND51', new Date(2026, 8, 1)), '2026-H2');
  });
});

describe('isPeriodLocked', () => {
  it('returns true for FILED', () => {
    assert.equal(isPeriodLocked('FILED'), true);
  });
  it('returns true for PAID', () => {
    assert.equal(isPeriodLocked('PAID'), true);
  });
  it('returns true for CLOSED', () => {
    assert.equal(isPeriodLocked('CLOSED'), true);
  });
  it('returns false for OPEN', () => {
    assert.equal(isPeriodLocked('OPEN'), false);
  });
  it('returns false for NEEDS_REVIEW', () => {
    assert.equal(isPeriodLocked('NEEDS_REVIEW'), false);
  });
  it('returns false for AMENDED', () => {
    assert.equal(isPeriodLocked('AMENDED'), false);
  });
});

describe('assertPeriodUnlocked', () => {
  it('throws for FILED status', () => {
    assert.throws(() => assertPeriodUnlocked('FILED', 'PP30', '2026-01'), /locked/);
  });
  it('throws for CLOSED status', () => {
    assert.throws(() => assertPeriodUnlocked('CLOSED', 'PP30', '2026-01'), /locked/);
  });
  it('does not throw for OPEN', () => {
    assert.doesNotThrow(() => assertPeriodUnlocked('OPEN', 'PP30', '2026-01'));
  });
  it('does not throw for NEEDS_REVIEW', () => {
    assert.doesNotThrow(() => assertPeriodUnlocked('NEEDS_REVIEW', 'PP30', '2026-01'));
  });
});

describe('evaluateDueDate', () => {
  const rule = { type: 'day_of_next_month' as const, day: 15 };

  it('evaluates day_of_next_month for January', () => {
    const result = evaluateDueDate('2026-01', rule);
    assert.notEqual(result, null);
    assert.equal(result!.getMonth(), 1);
    assert.equal(result!.getDate(), 15);
    assert.equal(result!.getFullYear(), 2026);
  });

  it('handles December rollover to next year', () => {
    const result = evaluateDueDate('2026-12', rule);
    assert.equal(result!.getMonth(), 0);
    assert.equal(result!.getFullYear(), 2027);
  });

  it('returns null for non-monthly period key', () => {
    assert.equal(evaluateDueDate('2026', rule), null);
  });
});

describe('makeReviewIssue', () => {
  it('creates BLOCKING issue for MISSING_TAX_ID', () => {
    const issue = makeReviewIssue('MISSING_TAX_ID', { context: 'payee X' });
    assert.equal(issue.severity, 'BLOCKING');
    assert.equal(issue.code, 'MISSING_TAX_ID');
    assert.ok(issue.description.includes('payee X'));
  });
  it('creates INFO issue for INPUT_VAT_NOT_CLAIMABLE', () => {
    const issue = makeReviewIssue('INPUT_VAT_NOT_CLAIMABLE', {});
    assert.equal(issue.severity, 'INFO');
  });
  it('creates WARNING for MISSING_BRANCH_CODE', () => {
    const issue = makeReviewIssue('MISSING_BRANCH_CODE', {});
    assert.equal(issue.severity, 'WARNING');
  });
});
