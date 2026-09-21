import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { staffMenuCommand } from '../../../line-ai/domain/logic/line-staff-menu.logic';
import {
  DAY_MS,
  PACKAGE_CHANGE_HINT_TH,
  addDays,
  branchLimitMessageTh,
  derivePlanTermState,
  employeeLimitMessageTh,
  expiredLineOwnerMessageTh,
  expiredMessageTh,
  formatThaiDateTime,
  isExpired,
  isPlanTierKey,
  planTermLockReason,
  toPlanTermDto,
  warningLadderPoint,
  warningMessageTh,
  type PlanTermRow,
} from './plan-term.logic';

const END = new Date('2026-09-29T07:00:00.000Z'); // 14:00 Bangkok

/**
 * R2. The one rule three readers share (plan-term notice, billing status, the LINE lock card), so
 * "ยังไม่มีแพ็กเกจ" and "ครบกำหนด" can never mean two different things in two places.
 */
describe('planTermLockReason', () => {
  const at = new Date('2026-09-20T03:00:00.000Z');

  it('is no_package for the zero-day term provisioning writes', () => {
    assert.equal(planTermLockReason({ termStartAt: at, termEndsAt: at, renewCount: 0 }), 'no_package');
  });

  it('is trial_ended for any term that actually ran', () => {
    assert.equal(planTermLockReason({ termStartAt: at, termEndsAt: addDays(at, 30), renewCount: 0 }), 'trial_ended');
    // One millisecond of term is still a term somebody was given.
    assert.equal(planTermLockReason({ termStartAt: at, termEndsAt: new Date(at.getTime() + 1), renewCount: 0 }), 'trial_ended');
  });

  it('is trial_ended once the shop has been renewed, whatever the dates say', () => {
    assert.equal(planTermLockReason({ termStartAt: at, termEndsAt: at, renewCount: 1 }), 'trial_ended');
  });

  it('never calls a backdated term no_package just because it ends before it starts', () => {
    // An admin who moved `termEndsAt` backwards left a shop that DID have a package; calling that
    // "never bought anything" would send it the wrong card.
    assert.equal(planTermLockReason({ termStartAt: at, termEndsAt: addDays(at, -5), renewCount: 2 }), 'trial_ended');
  });
});

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
    assert.match(message, /^แพ็กเกจของร้านทดสอบจะหมดอายุวันที่ /);
    assert.match(message, /\(อีก 3 วัน\)/);
    assert.match(message, /ติดต่อ 098-256-5628 หรืออีเมล contact@mangmeeplus\.com/);
    // P10-L §3.7: the LINE route is offered only to someone who has LINE. Default is OFF, so a
    // caller that forgets the flag cannot tell a web-only customer to type into a chat.
    assert.equal(message.includes(PACKAGE_CHANGE_HINT_TH), false, 'no hint by default');
    assert.ok(warningMessageTh('ร้านทดสอบ', END, 3, true).endsWith(PACKAGE_CHANGE_HINT_TH));
  });

  it('expired copy promises the data is still there', () => {
    const message = expiredMessageTh('ร้านทดสอบ');
    assert.match(message, /^แพ็กเกจของร้านทดสอบหมดอายุแล้ว/);
    assert.match(message, /ข้อมูลทั้งหมดยังอยู่ครบ/);
    assert.match(message, /ติดต่อ 098-256-5628 หรืออีเมล contact@mangmeeplus\.com/);
    assert.equal(message.includes(PACKAGE_CHANGE_HINT_TH), false, 'no hint by default');
    assert.ok(expiredMessageTh('ร้านทดสอบ', true).endsWith(PACKAGE_CHANGE_HINT_TH));
    // The hint has to be the command the matcher answers, or it is a sentence that goes nowhere.
    assert.equal(staffMenuCommand('ขอเปลี่ยนแพ็กเกจ'), 'package_change');
  });

  // The inbound LINE reply carries a real quick-reply button, so repeating the typed instruction
  // there would be telling someone to type what they can tap.
  it('leaves the typed-command hint out of the reply that already has a button', () => {
    assert.equal(expiredLineOwnerMessageTh().includes(PACKAGE_CHANGE_HINT_TH), false);
    assert.match(expiredLineOwnerMessageTh(), /ข้อมูลทั้งหมดยังอยู่ครบ/);
  });

  it('limit copy states the cap and where to go', () => {
    assert.equal(branchLimitMessageTh(1), 'แพ็กเกจปัจจุบันรองรับ 1 สาขา และใช้งานครบแล้ว หากต้องการเพิ่มสาขา กรุณาเปลี่ยนแพ็กเกจ');
    assert.equal(employeeLimitMessageTh(2), 'แพ็กเกจปัจจุบันเพิ่มพนักงานได้สูงสุด 2 คน — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ');
  });
});
