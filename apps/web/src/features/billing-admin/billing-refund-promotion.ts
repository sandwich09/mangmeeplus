// What a refund does to a promotion purchase, in Thai, for the two refund screens (promotion spec Q6, plan R14 / R17).
// The rules live in apps/api billing-refunds.service.ts (`refundEnd`, `refundBlock`, `endRefundedPackage`) and
// billing-end-package.ts; this only words them. Every sentence must stay true in each case the spec table lists.
import type { BillingRefundPromotion } from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';

/** `amountSatang` NaN = nothing valid typed yet. `packageEnded`: the saved request's result (null/absent = not decided yet). */
export type RefundPromotionCase = { paidSatang: number; refundedSatang: number; amountSatang: number; endPackage: boolean; packageEnded?: boolean | null };

export const REFUND_PROMOTION_RIGHT = 'สิทธิ์โปรโมชั่นของร้านนับว่าใช้แล้วในทุกกรณี คืนเงินแล้วก็ใช้โปรโมชั่นนี้ซ้ำไม่ได้';
const PARTIAL = 'เวลาใช้งานและใบเสร็จของร้านคงเดิม รวมเดือนแถมและใบเสร็จแถม';
const PARTIAL_END = 'ยุติแพ็กเกจไม่ได้เมื่อคืนไม่ครบยอดที่จ่าย';
const REVIEW = 'ถ้ามีสิทธิ์ของการซื้อนี้ที่ระบบยุติเองไม่ได้ (เช่น ยังไม่เริ่มใช้ หรือมีการซื้อใหม่มาแทน) ระบบจะเปิดเรื่องให้เจ้าหน้าที่ตรวจ';
const FULL = 'เมื่อ Stripe คืนเงินสำเร็จ ระบบจะยุติสิทธิ์ที่ยังไม่ได้ใช้ของการซื้อนี้เอง แม้เลือกคงแพ็กเกจไว้ เดือนแถมและใบเสร็จแถมที่ยังเหลือจะใช้ต่อไม่ได้'
  + ' · ' + REVIEW
  + ' · ถ้าร้านยังเปิดต่ออายุอัตโนมัติหรือมีรายการค้างจ่าย ระบบอาจให้จัดการเรื่องนั้นก่อน';

/** The lines of the promotion block: what was bought, what THIS refund does, and the right that never comes back. Empty = no promotion. */
export function refundPromotionLines(promotion: BillingRefundPromotion | null | undefined, c: RefundPromotionCase): string[] {
  if (!promotion) return [];
  const bonus = [promotion.bonusMonths > 0 && `แถมฟรี ${promotion.bonusMonths} เดือน`, promotion.bonusReceiptUnits > 0 && `ใบเสร็จแถม ${promotion.bonusReceiptUnits} ใบ`,
    promotion.benefitEnd ? `ใช้ได้ถึง ${formatThaiDateTime(promotion.benefitEnd)} (รวมเดือนแถม)` : 'ยังไม่ได้เปิดสิทธิ์ที่แถม'].filter(Boolean).join(' · ');
  const full = c.refundedSatang + c.amountSatang >= c.paidSatang;
  const effect = Number.isNaN(c.amountSatang) ? `ถ้าคืนไม่ครบยอดที่จ่าย: ${PARTIAL} และ${PARTIAL_END} · ถ้าคืนครบยอดที่จ่าย: ${FULL}`
    : !full ? (c.endPackage ? `คำขอนี้คืนไม่ครบยอดที่จ่าย: ${PARTIAL_END} ระบบจะไม่รับคำขอนี้ เลือกคงแพ็กเกจไว้หรือคืนให้ครบยอด` : `คำขอนี้คืนไม่ครบยอดที่จ่าย: ${PARTIAL}`)
    : c.packageEnded === true ? 'คืนครบยอดที่จ่ายแล้ว: ระบบยุติแพ็กเกจของการซื้อนี้แล้ว เดือนแถมและใบเสร็จแถมที่ยังเหลือใช้ต่อไม่ได้'
    : c.packageEnded === false ? 'คืนครบยอดที่จ่ายแล้ว: ระบบไม่ได้ยุติแพ็กเกจ เพราะการซื้อนี้ไม่ใช่แพ็กเกจที่ร้านใช้อยู่ตอนคืนเงินสำเร็จ ' + REVIEW + ' ดูผลได้ในรายงานแคมเปญ'
    : `คำขอนี้ทำให้คืนครบยอดที่จ่าย: ${FULL}`;
  return [`ซื้อด้วยโปรโมชั่น${promotion.displayName ? ` ${promotion.displayName}` : ''} · ${bonus}`, effect, REFUND_PROMOTION_RIGHT];
}
