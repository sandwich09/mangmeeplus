// What a refund does to a promotion purchase, in Thai, for the two refund screens (promotion spec Q6, plan R14 / R17).
// The rules live in apps/api billing-refunds.service.ts (`refundEnd`, `refundBlock`, `endRefundedPackage`) and
// billing-end-package.ts; this only words them. Every sentence must stay true in each case the spec table lists.
import type { BillingRefundPromotion } from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';

/** `amountSatang` NaN = nothing valid typed yet. `packageEnded`: the saved request's result (null/absent = not decided yet). */
export type RefundPromotionCase = { paidSatang: number; refundedSatang: number; amountSatang: number; endPackage: boolean; packageEnded?: boolean | null };

export const REFUND_PROMOTION_RIGHT = 'สิทธิ์โปรโมชันของร้านนับว่าใช้แล้วทุกกรณี คืนเงินแล้วก็ไม่ได้สิทธิ์กลับมา ร้านใช้โปรโมชันนี้ซ้ำไม่ได้';
const PARTIAL = 'เวลาใช้งาน (รวมช่วงแถมฟรี) และใบเสร็จ (รวมใบเสร็จเพิ่ม) ของร้านคงเดิม';
const PARTIAL_END = 'ยุติแพ็กเกจไม่ได้เมื่อคืนไม่ครบยอดที่จ่าย';
const SETTLED = 'ถ้าเปิดสิทธิ์ไปแล้วและไม่เหลือสิทธิ์ของการซื้อนี้ให้ยุติ ถือว่าปรับสิทธิ์แล้ว กรณีอื่น (เช่น ยังไม่เริ่มใช้ หรือมีการซื้อใหม่มาแทน) ระบบเปิดเคสให้เจ้าหน้าที่ตรวจและปรับสิทธิ์เอง';
const FULL = 'เมื่อ Stripe คืนเงินสำเร็จ ระบบจะยุติสิทธิ์ที่ยังไม่ได้ใช้ของการซื้อนี้เอง แม้เลือกคงแพ็กเกจไว้'
  + ' · ถ้าการซื้อนี้คือแพ็กเกจที่ร้านใช้อยู่ตอนนั้น ร้านจะหมดแพ็กเกจทันที ช่วงแถมฟรีและใบเสร็จของแพ็กเกจที่ยังเหลือ (รวมใบเสร็จเพิ่ม) ใช้ต่อไม่ได้'
  + ' · ถ้าไม่ใช่แล้ว ระบบตัดสินตอนนั้น: ' + SETTLED
  + ' · ถ้าร้านยังเปิดต่ออายุอัตโนมัติหรือมีรายการชำระเงินค้างอยู่ ระบบอาจไม่รับคำขอจนกว่าจะจัดการเรื่องนั้นก่อน';

/** The lines of the promotion block: what was bought, what THIS refund does, and the right that never comes back. Empty = no promotion. */
export function refundPromotionLines(promotion: BillingRefundPromotion | null | undefined, c: RefundPromotionCase): string[] {
  if (!promotion) return [];
  const bonus = [promotion.bonusMonths > 0 && `แถมฟรี ${promotion.bonusMonths} เดือน`, promotion.bonusReceiptUnits > 0 && `ใบเสร็จเพิ่ม ${promotion.bonusReceiptUnits} ใบ`,
    promotion.benefitEnd ? `ใช้ได้ถึง ${formatThaiDateTime(promotion.benefitEnd)} (รวมช่วงแถมฟรี)` : 'ยังไม่ได้เปิดสิทธิ์ที่แถม'].filter(Boolean).join(' · ');
  const full = c.refundedSatang + c.amountSatang >= c.paidSatang;
  const effect = Number.isNaN(c.amountSatang) ? `ถ้าคืนไม่ครบยอดที่จ่าย: ${PARTIAL} และ${PARTIAL_END} · ถ้าคืนครบยอดที่จ่าย: ${FULL}`
    : !full ? (c.endPackage ? `คำขอนี้คืนไม่ครบยอดที่จ่าย: ${PARTIAL_END} ระบบจะไม่รับคำขอนี้ เลือกคงแพ็กเกจไว้หรือคืนให้ครบยอด` : `คำขอนี้คืนไม่ครบยอดที่จ่าย: ${PARTIAL}`)
    : c.packageEnded === true ? 'คืนครบยอดที่จ่ายแล้ว: ระบบยุติแพ็กเกจของการซื้อนี้แล้ว ช่วงแถมฟรีและใบเสร็จของแพ็กเกจที่ยังเหลือ (รวมใบเสร็จเพิ่ม) ใช้ต่อไม่ได้'
    : c.packageEnded === false ? 'คืนครบยอดที่จ่ายแล้ว: การซื้อนี้ไม่ใช่แพ็กเกจที่ร้านใช้อยู่ตอนคืนเงินสำเร็จ ระบบจึงไม่ได้ยุติแพ็กเกจ ' + SETTLED + ' ดูผลได้ในรายงานแคมเปญ'
    : `คำขอนี้ทำให้คืนครบยอดที่จ่าย: ${FULL}`;
  return [`ซื้อด้วยโปรโมชัน${promotion.displayName ? ` ${promotion.displayName}` : ''} · ${bonus}`, effect, REFUND_PROMOTION_RIGHT];
}
