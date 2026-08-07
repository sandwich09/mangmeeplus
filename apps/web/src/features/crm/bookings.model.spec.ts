import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CRM_BOOKING_BUFFER_MINUTE_OPTIONS } from '@watchdog-bms/contracts';
import { BK_DURATION_OPTIONS, bookingAmountText, bookingOutstandingText, bookingStaffDisplay, customerOriginFromBookingSource, initialBookingWeekOffset } from './bookings.model';

describe('initialBookingWeekOffset', () => {
  it('opens next week after the final Saturday slot has passed', () => {
    assert.equal(initialBookingWeekOffset(new Date(2026, 6, 11, 23)), 1);
    assert.equal(initialBookingWeekOffset(new Date(2026, 6, 11, 18)), 0);
    assert.equal(initialBookingWeekOffset(new Date(2026, 6, 10, 23)), 0);
  });
});

describe('booking time options', () => {
  it('keeps half-hour duration increments from one to three hours', () => {
    assert.deepEqual(BK_DURATION_OPTIONS, [1, 1.5, 2, 2.5, 3]);
  });

  it('offers the supported company buffer values', () => {
    assert.deepEqual(CRM_BOOKING_BUFFER_MINUTE_OPTIONS, [0, 30, 60, 90, 120]);
  });

  it('maps staff booking sources to customer origins without claiming trusted adapters', () => {
    assert.equal(customerOriginFromBookingSource('STAFF'), 'MANUAL');
    assert.equal(customerOriginFromBookingSource('WALK_IN'), 'WALK_IN');
    assert.equal(customerOriginFromBookingSource('PHONE'), 'PHONE');
    assert.equal(customerOriginFromBookingSource('WEB'), 'WEB');
    assert.equal(customerOriginFromBookingSource('FACEBOOK'), 'OTHER');
    assert.equal(customerOriginFromBookingSource('OTHER'), 'OTHER');
  });
});

describe('bookingStaffDisplay', () => {
  const label = (id?: string) => (id === 'u-1' ? 'มีน' : 'ไม่ระบุ');

  it('shows Auto Book for LINE (AI auto-booking) regardless of assigned staff', () => {
    assert.equal(bookingStaffDisplay({ source: 'LINE', staffUserId: 'u-1' }, label), 'Auto Book');
    assert.equal(bookingStaffDisplay({ source: 'LINE' }, label), 'Auto Book');
  });

  it('shows the staff label for staff-entered bookings', () => {
    assert.equal(bookingStaffDisplay({ source: 'STAFF', staffUserId: 'u-1' }, label), 'มีน');
    assert.equal(bookingStaffDisplay({ source: undefined, staffUserId: undefined }, label), 'ไม่ระบุ');
  });
});

describe('booking amount texts', () => {
  it('formats recorded amounts in baht and dashes when absent', () => {
    assert.equal(bookingAmountText('1500'), '1,500.00 บาท');
    assert.equal(bookingAmountText(undefined), '—');
    assert.equal(bookingAmountText(''), '—');
  });

  it('computes outstanding = total - deposit, deposit defaulting to zero', () => {
    assert.equal(bookingOutstandingText('500', '1500'), '1,000.00 บาท');
    assert.equal(bookingOutstandingText(undefined, '1500'), '1,500.00 บาท');
    assert.equal(bookingOutstandingText('500', undefined), '—');
    assert.equal(bookingOutstandingText('2000', '1500'), '0.00 บาท');
  });
});
