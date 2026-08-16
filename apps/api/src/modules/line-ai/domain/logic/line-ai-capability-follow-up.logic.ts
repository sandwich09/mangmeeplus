import type { LineAiConversationContext } from '@watchdog-bms/contracts';
import { normalizeLineText } from './line-ai-classifier.logic';

export function isDeliveredCapabilityFollowUp(
  text: string,
  context: LineAiConversationContext | undefined,
): boolean {
  const normalized = normalizeLineText(text).toLocaleLowerCase('th-TH');
  if (!/^(อย่างไร|อย่างไหร่|ยังไง|แบบไหน|เช่นอะไร|how|how so|such as what)[?？]?$/iu.test(normalized)) return false;
  const lastReply = context?.recentTurns.at(-1)?.assistantReplyPreview ?? '';
  return lastReply.startsWith('น้องมั่งมีช่วยค้นและสรุปข้อมูลงานตามสิทธิ์')
    || lastReply.startsWith('Nong Mangmee can find and summarize work data');
}

export function capabilityFollowUpReply(text: string): string {
  if (/^[a-z]/iu.test(normalizeLineText(text))) {
    return [
      'For example:',
      '• Ask “What are today\'s sales?” or “Which products are low in stock?”',
      '• Ask for an expense, tax, customer, booking, or pending-work summary',
      '• Send a receipt/slip to create a reviewable expense draft',
      'I only use data allowed by your current company permissions. Final approval, payment, issuance, and posting stay in the web app.',
    ].join('\n');
  }
  return [
    'ตัวอย่างค่ะ',
    '• ถาม “ยอดขายวันนี้เท่าไหร่” หรือ “สินค้าอะไรใกล้หมด”',
    '• ขอสรุปค่าใช้จ่าย ภาษี ลูกค้า นัดหมาย หรืองานค้าง',
    '• ส่งรูปใบเสร็จ/สลิปเพื่อสร้างร่างค่าใช้จ่ายให้ตรวจสอบ',
    'น้องมั่งมีจะใช้เฉพาะข้อมูลที่สิทธิ์ปัจจุบันของคุณเข้าถึงได้ ส่วนการอนุมัติ จ่ายเงิน ออกเอกสาร และลงบัญชีขั้นสุดท้ายยังทำในเว็บค่ะ',
  ].join('\n');
}
