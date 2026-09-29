import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SalesEventReportFigures } from '@watchdog-bms/contracts';
import { salesEventCountLines, salesEventMoneyLines } from './sales-event-report.logic';

const FIGURES: SalesEventReportFigures = {
  issued: 1250, available: 700, inPayment: 3, usedAsDiscount: 40, usedAsCredit: 0, expired: 500, revoked: 7,
  openDiscountSatang: 7_000_000, appliedDiscountSatang: 400_000, paidSatang: 1_596_000, refundedSatang: 39_900,
};

describe('sales-event report figures on screen', () => {
  it('names every count in Thai, shows a reservation as กำลังชำระ, and leaves credit to SD-F', () => {
    assert.deepEqual(salesEventCountLines(FIGURES), [
      { label: 'แจกแล้ว', value: '1,250' },
      { label: 'ใช้เป็นส่วนลดแล้ว', value: '40' },
      { label: 'กำลังชำระ', value: '3' },
      { label: 'ยังใช้ได้', value: '700' },
      { label: 'หมดอายุ', value: '500' },
      { label: 'เพิกถอน', value: '7' },
    ]);
  });

  it('prints baht, and net is received minus refunded', () => {
    const money = Object.fromEntries(salesEventMoneyLines(FIGURES).map((line) => [line.label, line.value]));
    assert.equal(money['ส่วนลดที่ให้แล้ว'], '฿4,000.00');
    assert.equal(money['สุทธิ'], '฿15,561.00');
    assert.equal(money['ส่วนลดที่ยังใช้ได้ (สูงสุด)'], '฿70,000.00');
  });

  it('never shows a state key or an English word', () => {
    for (const line of [...salesEventCountLines(FIGURES), ...salesEventMoneyLines(FIGURES)]) {
      assert.doesNotMatch(line.label, /[A-Za-z_]/);
    }
  });
});
