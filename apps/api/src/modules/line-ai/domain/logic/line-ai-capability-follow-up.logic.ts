import type { LineAiConversationContext } from '@watchdog-bms/contracts';
import { availableLineCapabilityGroups, canCaptureLineReceipt } from '@watchdog-bms/contracts';
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

/** Examples come from the same permission-backed groups the capability answer itself uses, so the
 *  follow-up cannot re-offer a module the previous reply already left out. */
const FOLLOW_UP_EXAMPLE_LIMIT = 3;

export function capabilityFollowUpReply(text: string, permissions: readonly string[] = []): string {
  const english = /^[a-z]/iu.test(normalizeLineText(text));
  const groups = availableLineCapabilityGroups(permissions).slice(0, FOLLOW_UP_EXAMPLE_LIMIT);
  const receipt = canCaptureLineReceipt(permissions);
  if (english) {
    return [
      'For example:',
      ...groups.map((group) => `• Ask “${group.exampleEn}”`),
      ...(receipt ? ['• Send a receipt/slip to create a reviewable expense draft'] : []),
      'I only use data allowed by your current company permissions. Final approval, payment, issuance, and posting stay in the web app.',
    ].join('\n');
  }
  return [
    'ตัวอย่างค่ะ',
    ...groups.map((group) => `• ถาม “${group.exampleTh}”`),
    ...(receipt ? ['• ส่งรูปใบเสร็จ/สลิปเพื่อสร้างร่างค่าใช้จ่ายให้ตรวจสอบ'] : []),
    'น้องมั่งมีจะใช้เฉพาะข้อมูลที่สิทธิ์ปัจจุบันของคุณเข้าถึงได้ ส่วนการอนุมัติ จ่ายเงิน ออกเอกสาร และลงบัญชีขั้นสุดท้ายยังทำในเว็บค่ะ',
  ].join('\n');
}
