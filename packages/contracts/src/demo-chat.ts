/** Reserved virtual transport coordinates. This routes delivery, never grants tenant access. */
export function isVirtualDemoTarget(target?: string, channelId?: string): boolean {
  return channelId === 'demo-web' || !!target && (target.startsWith('Vdemo') || target.startsWith('vreply:'));
}

export const DEMO_CREDIT_EXHAUSTED_TEXT = 'เครดิตทดลองของลิงก์นี้หมดแล้วค่ะ เปิดร้านจริงฟรีเพื่อคุยกับน้องมั่งมีต่อได้เลยนะคะ';
export const DEMO_CREDIT_INSUFFICIENT_TEXT = 'เครดิตทดลองของลิงก์นี้เหลือไม่พอสำหรับคำถามนี้ค่ะ เปิดร้านจริงฟรีเพื่อคุยกับน้องมั่งมีต่อได้เลยนะคะ';
export const DEMO_READ_LIMIT_TEXT = 'ลิงก์ทดลองนี้อ่านเอกสารครบ 3 ใบแล้วค่ะ เปิดร้านจริงฟรีเพื่อส่งต่อได้เลยนะคะ';
