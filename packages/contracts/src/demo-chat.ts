/** Reserved virtual transport coordinates. This routes delivery, never grants tenant access. */
export function isVirtualDemoTarget(target?: string, channelId?: string): boolean {
  return channelId === 'demo-web' || !!target && (target.startsWith('Vdemo') || target.startsWith('vreply:'));
}

export const DEMO_CREDIT_EXHAUSTED_TEXT = 'เครดิตทดลองของลิงก์นี้หมดแล้วค่ะ เปิดร้านจริงฟรีเพื่อคุยกับน้องมั่งมีต่อได้เลยนะคะ';
export const DEMO_CREDIT_INSUFFICIENT_TEXT = 'เครดิตทดลองของลิงก์นี้เหลือไม่พอสำหรับคำถามนี้ค่ะ เปิดร้านจริงฟรีเพื่อคุยกับน้องมั่งมีต่อได้เลยนะคะ';
export const DEMO_READ_LIMIT_TEXT = 'ลิงก์ทดลองนี้อ่านเอกสารครบจำนวนแล้วค่ะ เปิดร้านจริงฟรีเพื่อส่งต่อได้เลยนะคะ';

/** Sales demo-link management (owner 2026-11-09). A link URL is never shown again: only its hash is stored. */
export type SalesDemoLinkStatus = 'WAITING' | 'OPENED' | 'EXPIRED';
export type SalesDemoLinkItem = {
  id: string; status: SalesDemoLinkStatus; createdAt: string; expiresAt: string; openedAt: string | null;
  createdByName: string; aiCredit: number; creditUsed: number | null; readLimit: number; readsUsed: number | null;
};
export type SalesDemoLinkUpdate = { aiCredit?: number; readLimit?: number; expiresAt?: string };
export const DEMO_LINK_LIMITS = { aiCredit: [1, 300], readLimit: [1, 50], minExpiryMinutes: 10, maxExpiryDays: 30 } as const;
