import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  addDays,
  branchLimitMessageTh,
  derivePlanTermState,
  employeeLimitMessageTh,
  expiredMessageTh,
  formatThaiDateTime,
  isExpired,
  isPlanTierKey,
  toPlanTermDto,
  warningLadderPoint,
  warningMessageTh,
  type PlanTermRow,
} from './plan-term.logic';

const END = new Date('2026-09-29T07:00:00.000Z'); // 14:00 Bangkok

describe('plan-term derived state', () => {
  it('is ACTIVE outside the warning window', () => {
    const now = new Date(END.getTime() - 10 * DAY_MS);
    assert.deepEqual(derivePlanTermState(END, 7, now), { derivedState: 'ACTIVE', daysLeft: 10 });
  });

  it('turns WARNING exactly at termEndsAt - warningDays', () => {
    const boundary = new Date(END.getTime() - 7 * DAY_MS);
    assert.equal(derivePlanTermState(END, 7, new Date(boundary.getTime() - 1)).derivedState, 'ACTIVE');
    assert.equal(derivePlanTermState(END, 7, boundary).derivedState, 'WARNING');
  });

  it('turns EXPIRED on the exact hour, not the next day', () => {
    assert.deepEqual(derivePlanTermState(END, 7, new Date(END.getTime() - 1)), { derivedState: 'WARNING', daysLeft: 1 });
    assert.deepEqual(derivePlanTermState(END, 7, END), { derivedState: 'EXPIRED', daysLeft: 0 });
    assert.deepEqual(derivePlanTermState(END, 7, new Date(END.getTime() + 1)), { derivedState: 'EXPIRED', daysLeft: 0 });
  });

  it('daysLeft rounds up and never goes below zero', () => {
    assert.equal(derivePlanTermState(END, 7, new Date(END.getTime() - 1)).daysLeft, 1);
    assert.equal(derivePlanTermState(END, 7, new Date(END.getTime() - DAY_MS)).daysLeft, 1);
    assert.equal(derivePlanTermState(END, 7, new Date(END.getTime() - DAY_MS - 1)).daysLeft, 2);
    assert.equal(derivePlanTermState(END, 7, new Date(END.getTime() + 30 * DAY_MS)).daysLeft, 0);
  });

  it('isExpired agrees with the derived state at the boundary', () => {
    assert.equal(isExpired(END, new Date(END.getTime() - 1)), false);
    assert.equal(isExpired(END, END), true);
  });

  it('addDays is exact 24h arithmetic, hour preserved', () => {
    assert.equal(addDays(END, 30).toISOString(), '2026-10-29T07:00:00.000Z');
  });
});

describe('warning ladder', () => {
  it('reports the deepest point entered, never a burst of the ones slept through', () => {
    assert.equal(warningLadderPoint(END, new Date(END.getTime() - 8 * DAY_MS)), null);
    assert.equal(warningLadderPoint(END, new Date(END.getTime() - 7 * DAY_MS)), 7);
    assert.equal(warningLadderPoint(END, new Date(END.getTime() - 4 * DAY_MS)), 7);
    assert.equal(warningLadderPoint(END, new Date(END.getTime() - 3 * DAY_MS)), 3);
    assert.equal(warningLadderPoint(END, new Date(END.getTime() - DAY_MS)), 1);
    assert.equal(warningLadderPoint(END, new Date(END.getTime() - 1)), 1);
  });

  it('stops at expiry — an expired term is the expiry notice’s business, not the ladder’s', () => {
    assert.equal(warningLadderPoint(END, END), null);
    assert.equal(warningLadderPoint(END, new Date(END.getTime() + DAY_MS)), null);
  });
});

describe('plan tier keys', () => {
  it('accepts catalog keys and rejects anything else', () => {
    assert.equal(isPlanTierKey('STARTER_249'), true);
    assert.equal(isPlanTierKey('ENTERPRISE_1999'), true);
    assert.equal(isPlanTierKey('FREE'), false);
    assert.equal(isPlanTierKey('toString'), false); // hasOwn, not `in`
    assert.equal(isPlanTierKey(undefined), false);
  });
});

describe('DTO projection', () => {
  const row: PlanTermRow = {
    companyId: 'co-1',
    tierKey: 'BASIC_499',
    branchLimit: 2,
    employeeLimit: 5,
    monthlySlipLimit: 50,
    termStartAt: new Date('2026-08-30T07:00:00.000Z'),
    termEndsAt: END,
    warningDays: 7,
    renewCount: 0,
    lastRenewedAt: null,
    termDisabledAt: null,
  };

  it('omits optional timestamps when unset and carries the derived state', () => {
    const dto = toPlanTermDto(row, new Date(END.getTime() - 2 * DAY_MS));
    assert.equal(dto.derivedState, 'WARNING');
    assert.equal(dto.daysLeft, 2);
    assert.equal(dto.termEndsAt, END.toISOString());
    assert.equal('lastRenewedAt' in dto, false);
    assert.equal('termDisabledAt' in dto, false);
  });

  it('surfaces termDisabledAt so the console can tell a term-disable from an admin-disable', () => {
    const dto = toPlanTermDto({ ...row, termDisabledAt: END, lastRenewedAt: END }, END);
    assert.equal(dto.termDisabledAt, END.toISOString());
    assert.equal(dto.lastRenewedAt, END.toISOString());
    assert.equal(dto.derivedState, 'EXPIRED');
  });
});

describe('Thai copy', () => {
  it('renders the deadline in Bangkok time with a Buddhist year', () => {
    const formatted = formatThaiDateTime(END);
    assert.match(formatted, /2569/);
    assert.match(formatted, /14:00 น\./);
  });

  it('warning copy names the shop, the deadline and the days left', () => {
    const message = warningMessageTh('ร้านทดสอบ', END, 3);
    assert.match(message, /^ร้าน ร้านทดสอบ จะครบกำหนดใช้งานวันที่ /);
    assert.match(message, /\(อีก 3 วัน\)/);
    assert.match(message, /ติดต่อ 098-256-5628 หรืออีเมล contact@mangmeeplus\.com$/);
  });

  it('expired copy promises the data is still there', () => {
    const message = expiredMessageTh('ร้านทดสอบ');
    assert.match(message, /ข้อมูลทั้งหมดยังอยู่ครบ/);
    assert.match(message, /ติดต่อ 098-256-5628 หรืออีเมล contact@mangmeeplus\.com$/);
  });

  it('limit copy states the cap and where to go', () => {
    assert.equal(branchLimitMessageTh(1), 'แพ็กเกจปัจจุบันสร้างได้สูงสุด 1 สาขา — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ');
    assert.equal(employeeLimitMessageTh(2), 'แพ็กเกจปัจจุบันเพิ่มพนักงานได้สูงสุด 2 คน — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ');
  });
});
