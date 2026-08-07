import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBookingWindow, bookingsOverlap, bookingWeekRange, formatBookingWhen, bookingReminderText, looksLikeRescheduleRequest } from './crm-booking.logic';

// 2026-07-09 is a Thursday; times below are UTC instants for Asia/Bangkok = UTC+7.
const NOW = new Date('2026-07-09T00:00:00.000Z'); // 07:00 Bangkok

function bangkok(hour: number, minute = 0) {
  // Asia/Bangkok has no DST; UTC+7 year-round.
  return new Date(Date.UTC(2026, 6, 9, hour - 7, minute));
}

describe('validateBookingWindow', () => {
  it('accepts a 1.5h slot within business hours', () => {
    assert.equal(validateBookingWindow(bangkok(10, 0), bangkok(11, 30), NOW), null);
  });

  it('rejects a slot starting before 09:00 Bangkok', () => {
    assert.equal(validateBookingWindow(bangkok(8, 30), bangkok(9, 30), NOW), 'outside_business_hours');
  });

  it('rejects a slot ending after 20:00 Bangkok', () => {
    assert.equal(validateBookingWindow(bangkok(19, 0), bangkok(20, 30), NOW), 'outside_business_hours');
  });

  it('rejects a slot starting at exactly 20:00 Bangkok (window is [09:00, 20:00))', () => {
    assert.equal(validateBookingWindow(bangkok(20, 0), bangkok(21, 0), NOW), 'outside_business_hours');
  });

  it('rejects duration shorter than 1h', () => {
    assert.equal(validateBookingWindow(bangkok(10, 0), bangkok(10, 30), NOW), 'duration_out_of_range');
  });

  it('rejects duration longer than 3h', () => {
    assert.equal(validateBookingWindow(bangkok(10, 0), bangkok(13, 30), NOW), 'duration_out_of_range');
  });

  it('rejects a duration not aligned to 0.5h steps', () => {
    assert.equal(validateBookingWindow(bangkok(10, 0), bangkok(11, 15), NOW), 'duration_not_aligned');
  });

  it('rejects a start time in the past', () => {
    assert.equal(validateBookingWindow(bangkok(6, 0), bangkok(7, 0), NOW), 'start_in_past');
  });

  it('rejects end at or before start', () => {
    assert.equal(validateBookingWindow(bangkok(10, 0), bangkok(10, 0), NOW), 'end_before_start');
  });
});

describe('bookingsOverlap', () => {
  it('detects overlapping windows', () => {
    assert.equal(bookingsOverlap(bangkok(10, 0), bangkok(11, 0), bangkok(10, 30), bangkok(11, 30)), true);
  });

  it('treats back-to-back slots as non-overlapping', () => {
    assert.equal(bookingsOverlap(bangkok(10, 0), bangkok(11, 0), bangkok(11, 0), bangkok(12, 0)), false);
  });

  it('detects no overlap for disjoint windows', () => {
    assert.equal(bookingsOverlap(bangkok(10, 0), bangkok(11, 0), bangkok(13, 0), bangkok(14, 0)), false);
  });
});

describe('bookingWeekRange', () => {
  it('returns the Sunday-to-Sunday Bangkok week containing a mid-week date', () => {
    // 2026-07-09 is a Thursday; the week's Sunday is 2026-07-05.
    const { rangeStart, rangeEnd } = bookingWeekRange('2026-07-09');
    assert.equal(rangeStart.toISOString(), '2026-07-04T17:00:00.000Z'); // 2026-07-05T00:00 Bangkok
    assert.equal(rangeEnd.toISOString(), '2026-07-11T17:00:00.000Z'); // 2026-07-12T00:00 Bangkok
  });

  it('is idempotent when given the Sunday itself', () => {
    const { rangeStart } = bookingWeekRange('2026-07-05');
    assert.equal(rangeStart.toISOString(), '2026-07-04T17:00:00.000Z');
  });

  it('spans exactly 7 days', () => {
    const { rangeStart, rangeEnd } = bookingWeekRange('2026-07-09');
    assert.equal(rangeEnd.getTime() - rangeStart.getTime(), 7 * 24 * 60 * 60 * 1000);
  });
});

describe('booking reminder formatting (A7)', () => {
  it('formats the Bangkok date-time', () => {
    // 2026-07-09T07:30:00Z = 14:30 Bangkok
    const when = formatBookingWhen(new Date('2026-07-09T07:30:00.000Z'));
    assert.match(when, /14:30/);
  });
  it('builds a customer reminder with service + time', () => {
    const text = bookingReminderText('ตัดผม', new Date('2026-07-09T07:30:00.000Z'));
    assert.match(text, /แจ้งเตือนนัดหมาย/);
    assert.match(text, /ตัดผม/);
    assert.match(text, /14:30/);
  });
});

describe('reschedule request detection (CUST-12 containment)', () => {
  it('recognises the wording that would otherwise create a second booking', () => {
    for (const text of ['ขอเลื่อนนัดหน่อยครับ', 'ขอเปลี่ยนเวลาเป็นบ่ายได้ไหม', 'ยกเลิกนัดพรุ่งนี้', 'can I reschedule?', 'please cancel my booking']) {
      assert.equal(looksLikeRescheduleRequest(text), true, text);
    }
  });

  it('leaves ordinary booking traffic alone', () => {
    for (const text of ['ขอจองวันเสาร์', 'ว่างกี่โมงบ้าง', 'ยืนยันครับ', '', null]) {
      assert.equal(looksLikeRescheduleRequest(text), false, String(text));
    }
  });
});
