import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanyPlanTermDto } from '@watchdog-bms/contracts';
import {
  parseDaysInput,
  parseLimitInput,
  planTermDisabledChip,
  planTermLimitsText,
  planTermStatusChip,
  renewedEndsAt,
} from './plan-term.logic';

function term(overrides: Partial<CompanyPlanTermDto> = {}): CompanyPlanTermDto {
  return {
    companyId: 'c1',
    tierKey: 'STARTER_249',
    branchLimit: 1,
    employeeLimit: 2,
    monthlySlipLimit: 30,
    termStartAt: '2026-08-01T00:00:00.000Z',
    termEndsAt: '2026-08-31T00:00:00.000Z',
    warningDays: 7,
    renewCount: 0,
    derivedState: 'ACTIVE',
    daysLeft: 12,
    ...overrides,
  };
}

describe('planTermStatusChip', () => {
  it('shows the days left in green while the term is healthy', () => {
    assert.deepEqual(planTermStatusChip(term()), { label: 'เหลือ 12 วัน', tone: 'success' });
  });

  it('keeps the same wording in yellow inside the warning window', () => {
    assert.deepEqual(planTermStatusChip(term({ derivedState: 'WARNING', daysLeft: 3 })), {
      label: 'เหลือ 3 วัน',
      tone: 'warning',
    });
  });

  it('drops the countdown once the term is over', () => {
    assert.deepEqual(planTermStatusChip(term({ derivedState: 'EXPIRED', daysLeft: 0 })), {
      label: 'หมดอายุแล้ว',
      tone: 'danger',
    });
  });
});

describe('planTermDisabledChip', () => {
  it('appears only for a company the expiry sweep paused', () => {
    assert.equal(planTermDisabledChip(term()), null);
    assert.deepEqual(planTermDisabledChip(term({ termDisabledAt: '2026-08-31T00:00:00.000Z' })), {
      label: 'พักการใช้งานแล้ว',
      tone: 'danger',
    });
  });
});

describe('planTermLimitsText', () => {
  it('reads as one line of plan limits', () => {
    assert.equal(planTermLimitsText(term()), 'สาขา 1 · พนักงาน 2 · สลิป 30 ใบ/เดือน');
  });
});

describe('renewedEndsAt', () => {
  const now = new Date('2026-08-20T10:00:00.000Z');

  it('extends from the current end while the term is still running', () => {
    assert.equal(
      renewedEndsAt('2026-08-31T00:00:00.000Z', 30, now).toISOString(),
      '2026-09-30T00:00:00.000Z',
    );
  });

  it('counts from now once the term has already expired', () => {
    assert.equal(
      renewedEndsAt('2026-08-01T00:00:00.000Z', 30, now).toISOString(),
      '2026-09-19T10:00:00.000Z',
    );
  });

  it('keeps the exact hour rather than rounding to a date', () => {
    assert.equal(
      renewedEndsAt('2026-08-31T14:30:00.000Z', 1, now).toISOString(),
      '2026-09-01T14:30:00.000Z',
    );
  });
});

describe('input parsing', () => {
  it('accepts whole positive days only', () => {
    assert.equal(parseDaysInput(' 30 '), 30);
    assert.equal(parseDaysInput('0'), null);
    assert.equal(parseDaysInput('7.5'), null);
    assert.equal(parseDaysInput(''), null);
    assert.equal(parseDaysInput('abc'), null);
  });

  it('rejects zero, negative and blank limits like the API', () => {
    assert.equal(parseLimitInput('0'), null);
    assert.equal(parseLimitInput('10'), 10);
    assert.equal(parseLimitInput('-1'), null);
    assert.equal(parseLimitInput(''), null);
    assert.equal(parseLimitInput('2.5'), null);
  });
});
