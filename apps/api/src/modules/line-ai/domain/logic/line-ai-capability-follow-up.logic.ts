import type { LineAiConversationContext, LineCapabilityGroupId } from '@watchdog-bms/contracts';
import { canAdvertiseReceiptCapture, LINE_CAPABILITY_GROUPS, usableCapabilityGroupIds } from '@watchdog-bms/contracts';
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

/** The caller's own access. Undefined = legacy fail-open: answer as before entitlement awareness. */
export type CapabilityFollowUpAccess = {
  permissions?: readonly string[];
  /** Absent = company has no entitlement rows at all; treat every feature as entitled. */
  entitledFeatureKeys?: readonly string[];
};

/**
 * Example questions, keyed by the shared capability-group ids so this reply can never name a
 * capability the first reply omitted (spec R6). Copy differs from the gateway's capability card on
 * purpose — that one lists WHAT, this one shows HOW TO ASK — but both render the same group set.
 */
const EXAMPLES: Record<'th' | 'en', Record<LineCapabilityGroupId, string>> = {
  th: {
    sales: '• ถาม “ยอดขายวันนี้เท่าไหร่”',
    expenses: '• ขอสรุปค่าใช้จ่ายเดือนนี้',
    finance: '• ขอสรุปการเงินหรือรายงานบัญชี',
    tax: '• ถามภาษีที่ต้องยื่นเดือนนี้',
    inventory: '• ถาม “ของอะไรใกล้หมด”',
    customers: '• ขอรายชื่อลูกค้าที่ต้องติดตาม',
    bookings: '• ถามคิวหรือนัดหมายวันนี้',
    procurement: '• ถามใบสั่งซื้อที่ยังค้างอยู่',
    alerts: '• ถามงานค้างและการแจ้งเตือนของคุณ',
  },
  en: {
    sales: '• Ask “What are today’s sales?”',
    expenses: '• Ask for this month’s expense summary',
    finance: '• Ask for a finance or accounting report summary',
    tax: '• Ask which tax filings are due this month',
    inventory: '• Ask “Which products are low in stock?”',
    customers: '• Ask which customers need a follow-up',
    bookings: '• Ask about today’s bookings or queue',
    procurement: '• Ask which purchase orders are still open',
    alerts: '• Ask what pending work and alerts you have',
  },
};

const COPY = {
  th: {
    intro: 'ตัวอย่างค่ะ',
    receipt: '• ส่งรูปใบเสร็จ/สลิปเพื่อสร้างร่างค่าใช้จ่ายให้ตรวจสอบ',
    closing: 'น้องมั่งมีจะใช้เฉพาะข้อมูลที่สิทธิ์ปัจจุบันของคุณเข้าถึงได้ ส่วนการอนุมัติ จ่ายเงิน ออกเอกสาร และลงบัญชีขั้นสุดท้ายยังทำในเว็บค่ะ',
    none: 'ตอนนี้บัญชีของคุณยังไม่มีข้อมูลที่น้องมั่งมีดึงให้ผ่าน LINE ได้เลยค่ะ กรุณาติดต่อผู้ดูแลระบบของบริษัทเพื่อตรวจสอบสิทธิ์การใช้งานนะคะ',
  },
  en: {
    intro: 'For example:',
    receipt: '• Send a receipt/slip to create a reviewable expense draft',
    closing: 'I only use data allowed by your current company permissions. Final approval, payment, issuance, and posting stay in the web app.',
    none: 'Right now there is no data Nong Mangmee can pull for your account through LINE. Please ask your company admin to check your access.',
  },
} as const;

export function capabilityFollowUpReply(text: string, access?: CapabilityFollowUpAccess): string {
  const language = /^[a-z]/iu.test(normalizeLineText(text)) ? 'en' : 'th';
  const copy = COPY[language];
  const entitled = access?.entitledFeatureKeys ? new Set(access.entitledFeatureKeys) : null;
  // Only a completely absent `access` means "no caller context". A partial one must NOT fall back
  // to advertising everything — under-describing is a smaller error than promising a refusal.
  const permissions = access ? access.permissions ?? [] : undefined;
  const groups = permissions
    ? usableCapabilityGroupIds(permissions, entitled)
    : [...LINE_CAPABILITY_GROUPS].map((group) => group.id);
  const receipt = permissions ? canAdvertiseReceiptCapture(permissions, entitled) : true;
  const lines = [...groups.map((id) => EXAMPLES[language][id]), ...(receipt ? [copy.receipt] : [])];
  if (lines.length === 0) return copy.none;
  return [copy.intro, ...lines, copy.closing].join('\n');
}
