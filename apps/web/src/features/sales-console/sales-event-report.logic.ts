import type { SalesEventReportFigures } from '@watchdog-bms/contracts';
import { formatBaht } from './sales-console.logic';

/**
 * The event report's figures as the screen says them (sales-event spec §10). Thai labels only, no
 * state keys. ponytail: discount path only — "ใช้เป็นเครดิต" and the credit units join with SD-F.
 */
export type SalesEventFigureLine = { label: string; value: string };

const count = (value: number) => value.toLocaleString('th-TH');

export function salesEventCountLines(figures: SalesEventReportFigures): SalesEventFigureLine[] {
  return [
    { label: 'แจกแล้ว', value: count(figures.issued) },
    { label: 'ใช้เป็นส่วนลดแล้ว', value: count(figures.usedAsDiscount) },
    // RESERVED: the bill is not paid yet, so it is neither a use nor a sale.
    { label: 'กำลังชำระ', value: count(figures.inPayment) },
    { label: 'ยังใช้ได้', value: count(figures.available) },
    { label: 'หมดอายุ', value: count(figures.expired) },
    { label: 'เพิกถอน', value: count(figures.revoked) },
  ];
}

export function salesEventMoneyLines(figures: SalesEventReportFigures): SalesEventFigureLine[] {
  return [
    { label: 'ส่วนลดที่ให้แล้ว', value: formatBaht(figures.appliedDiscountSatang) },
    { label: 'ยอดรับจริงของบิลที่ใช้ส่วนลด', value: formatBaht(figures.paidSatang) },
    { label: 'คืนเงินแล้ว', value: formatBaht(figures.refundedSatang) },
    { label: 'สุทธิ', value: formatBaht(figures.paidSatang - figures.refundedSatang) },
    { label: 'ส่วนลดที่ยังใช้ได้ (สูงสุด)', value: formatBaht(figures.openDiscountSatang) },
  ];
}
