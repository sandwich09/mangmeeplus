import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanyPlanTermDto } from '@watchdog-bms/contracts';
import {
  parseDaysInput,
  parseLimitInput,
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
  // Inside the fixture's own term window (2026-08-01..08-31): planTermState needs a `now` before
  // termEndsAt to read the term as running at all, whatever `derivedState`/`daysLeft` say.
  const runningNow = new Date('2026-08-20T00:00:00.000Z');

  it('shows the days left in green while the term is healthy', () => {
    assert.deepEqual(planTermStatusChip(term(), 'ACTIVE', runningNow), { label: 'เหลือ 12 วัน', tone: 'success' });
  });

  it('keeps the same wording in yellow inside the warning window', () => {
    assert.deepEqual(planTermStatusChip(term({ derivedState: 'WARNING', daysLeft: 3 }), 'ACTIVE', runningNow), {
      label: 'เหลือ 3 วัน',
      tone: 'warning',
    });
  });

  it('drops the countdown and reads "หมดอายุ" once a real term is over', () => {
    assert.deepEqual(planTermStatusChip(term({ derivedState: 'EXPIRED', daysLeft: 0 }), 'ACTIVE'), {
      label: 'หมดอายุ',
      tone: 'danger',
    });
  });

  it('reads "ยังไม่มีแพ็กเกจ" for the zero-day term the sweep disabled, never "หมดอายุ"', () => {
    assert.deepEqual(
      planTermStatusChip(
        term({ derivedState: 'EXPIRED', daysLeft: 0, termStartAt: '2026-08-31T00:00:00.000Z', termEndsAt: '2026-08-31T00:00:00.000Z', renewCount: 0, termDisabledAt: '2026-08-31T00:00:00.000Z' }),
        'DISABLED',
      ),
      { label: 'ยังไม่มีแพ็กเกจ', tone: 'danger' },
    );
  });

  it('reads "พักการใช้งาน" for a company an admin disabled by hand (no termDisabledAt)', () => {
    assert.deepEqual(planTermStatusChip(term(), 'DISABLED'), { label: 'พักการใช้งาน', tone: 'danger' });
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
