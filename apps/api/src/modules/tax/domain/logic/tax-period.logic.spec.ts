import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eWhtRateKind, eWhtReducedRateOn, eWhtPaymentMethodAllowed, E_WHT_WORDS } from '@watchdog-bms/contracts';
import {
  monthlyPeriodKey,
  annualPeriodKey,
  halfYearPeriodKey,
  formPeriodKey,
  isPeriodLocked,
  assertPeriodUnlocked,
  evaluateDueDate,
  makeReviewIssue,
  PND3_FILING_REVIEW_MESSAGES,
  withholdingIssueDescription,
} from './tax-period.logic';

describe('e-WHT rules (R2)', () => {
  it('classifies every income code in section 5.2 without guessing other income', () => {
    for (const code of ['WHT_SERVICE_3', 'WHT_SERVICE_5', 'WHT_RENT_IND', 'WHT_RENT_JUR',
      'WHT_PROFESSIONAL_IND', 'WHT_PROFESSIONAL_JUR', 'WHT_ADVERTISING_IND', 'WHT_ADVERTISING_JUR', 'WHT_PRIZE', 'WHT_PRIZE_JUR']) {
      assert.equal(eWhtRateKind(code), 'REDUCED', code);
    }
    for (const code of ['WHT_TRANSPORT_IND', 'WHT_TRANSPORT_JUR', 'WHT_INTEREST', 'WHT_INTEREST_JUR', 'WHT_DIVIDEND', 'WHT_DIVIDEND_IND']) {
      assert.equal(eWhtRateKind(code), 'NOT_REDUCED', code);
      assert.equal(eWhtReducedRateOn(code, '2026-11-04'), null);
    }
    for (const code of ['WHT_OTHER_IND', 'WHT_OTHER_JUR', '', null, undefined]) {
      assert.equal(eWhtRateKind(code), 'UNKNOWN', String(code));
      assert.equal(eWhtReducedRateOn(code, '2026-11-04'), null);
    }
  });
  it('covers all six date edges of the two legal windows', () => {
    for (const [date, rate] of [['2022-12-31', null], ['2023-01-01', '1'], ['2025-12-31', '1'],
      ['2026-01-01', '1'], ['2027-12-31', '1'], ['2028-01-01', null]] as const) {
      assert.equal(eWhtReducedRateOn('WHT_SERVICE_3', date), rate, date);
    }
  });
  it('refuses only cash and card as payment methods', () => {
    for (const method of ['BANK_TRANSFER', 'CHEQUE', 'OTHER', null, undefined, '']) assert.equal(eWhtPaymentMethodAllowed(method), true);
    for (const method of ['CASH', 'CARD']) assert.equal(eWhtPaymentMethodAllowed(method), false);
  });
  it('uses conditional Thai warnings and scopes the bank-only sentence to form and branch', () => {
    const warning = makeReviewIssue('WHT_RATE_MISMATCH', { context: 'ร้านทดสอบ' });
    assert.equal(warning.severity, 'WARNING');
    assert.equal(warning.description, E_WHT_WORDS['W-T4']('ร้านทดสอบ'));
    assert.equal(makeReviewIssue('WHT_RATE_MISMATCH', {}).description, E_WHT_WORDS['W-T4']('ผู้รับเงิน'));
    assert.equal(PND3_FILING_REVIEW_MESSAGES.bank_remitted_only, E_WHT_WORDS['W-T3']('ภ.ง.ด.3'));
    assert.match(E_WHT_WORDS['W-T3']('ภ.ง.ด.53', 'สาขาทดสอบ'), /ภ\.ง\.ด\.53ของสาขา สาขาทดสอบ/);
    assert.equal(E_WHT_WORDS['W-T3']('ภ.ง.ด.3').includes('ของสาขา'), false);
    assert.equal(withholdingIssueDescription('PND53_FILING_BANK_REMITTED_ONLY', '', null, false, 'สาขาทดสอบ'),
      E_WHT_WORDS['W-T3']('ภ.ง.ด.53', 'สาขาทดสอบ'));
    assert.equal(withholdingIssueDescription('PND3_FILING_BANK_REMITTED_ONLY', ''), E_WHT_WORDS['W-T3']('ภ.ง.ด.3'));
    for (const sentence of [warning.description, E_WHT_WORDS['W-T3']('ภ.ง.ด.3')]) {
      assert.equal(/[a-z]/i.test(sentence.replaceAll('e-WHT', '')), false, sentence);
    }
  });
  it('keeps approved sentences together and customer Thai free of English diagnostics', () => {
    const keys = ['W-F1', 'W-F2', 'W-F3', 'W-F4', 'W-F5', 'W-F6', 'W-F7', 'W-F8', 'W-F9', 'W-F10', 'W-F11', 'W-F10o', "W-F10o'",
      'W-D1', 'W-D1u', 'W-P1', 'W-P2', 'W-PD1', 'W-PD2', 'W-C1', 'W-V1', 'W-V1u', 'W-T1', 'W-T2', 'W-T2b', 'W-T3', 'W-T4', 'W-T5', 'W-T6',
      'W-X1', 'W-X2', 'W-X3', 'W-R1', 'W-R2', 'W-R3', 'N-1', 'L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-7', 'L-8', 'L-9', 'L-10', 'L-11', 'L-14', 'H-1', 'H-2'];
    for (const key of keys) assert.ok(key in E_WHT_WORDS, key);
    assert.equal(E_WHT_WORDS['L-14'], E_WHT_WORDS['L-7']);
    for (const key of ['L-12', 'L-12en', 'L-13', 'L-13en']) assert.equal(key in E_WHT_WORDS, false, key);
    const sentences = Object.entries(E_WHT_WORDS).filter(([key, value]) => !key.endsWith('en') && typeof value === 'string').map(([, value]) => value as string);
    sentences.push(E_WHT_WORDS['L-4']('3.00', true), E_WHT_WORDS['L-5']('3.00'), E_WHT_WORDS['L-11'](1, '3.00 บาท'),
      E_WHT_WORDS['W-T6']('ผู้รับเงิน'));
    for (const text of sentences) assert.equal(/[a-z]/i.test(text.replaceAll('e-WHT', '').replaceAll('VAT', '')), false, text);
  });
});

describe('monthlyPeriodKey', () => {
  it('returns YYYY-MM for January', () => {
    assert.equal(monthlyPeriodKey(new Date(2026, 0, 15)), '2026-01');
  });
  it('returns YYYY-MM for December', () => {
    assert.equal(monthlyPeriodKey(new Date(2026, 11, 1)), '2026-12');
  });
  it('uses the Bangkok civil month at the UTC boundary', () => {
    assert.equal(monthlyPeriodKey(new Date('2026-08-31T19:00:00.000Z')), '2026-09');
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
  it('returns the Bangkok monthly key for PND2', () => {
    assert.equal(formPeriodKey('PND2', new Date('2026-08-31T19:00:00.000Z')), '2026-09');
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
  it('uses the Bangkok half-year at the UTC boundary', () => {
    assert.equal(formPeriodKey('PND51', new Date('2026-06-30T19:00:00.000Z')), '2026-H2');
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
