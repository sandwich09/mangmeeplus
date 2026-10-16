import type { LineAiConversationContext, LineCapabilityGroupId } from '@watchdog-bms/contracts';
import { LINE_CAPABILITY_NO_ACCESS_TH, canAdvertiseReceiptCapture, LINE_CAPABILITY_GROUPS, LINE_CAPABILITY_REPLY_PREFIXES, usableCapabilityGroupIds } from '@watchdog-bms/contracts';
import { normalizeLineText } from './line-ai-classifier.logic';

/** A routing hint only; every capability example is rebuilt from current access. */
export const CAPABILITY_HISTORY_INTENT = 'CAPABILITY_OVERVIEW';

export function capabilityHistoryIntent(reply: string | null | undefined): string | undefined {
  return reply && LINE_CAPABILITY_REPLY_PREFIXES.some(prefix => reply.startsWith(prefix))
    ? CAPABILITY_HISTORY_INTENT : undefined;
}

export function isDeliveredCapabilityFollowUp(
  text: string,
  context: LineAiConversationContext | undefined,
): boolean {
  const normalized = normalizeLineText(text).toLocaleLowerCase('th-TH');
  if (!/^(อย่างไร|อย่างไหร่|ยังไง|แบบไหน|เช่นอะไร|how|how so|such as what)[?？]?$/iu.test(normalized)) return false;
  const lastTurn = context?.recentTurns.at(-1);
  if (lastTurn?.intent === CAPABILITY_HISTORY_INTENT) return true;
  const lastReply = lastTurn?.assistantReplyPreview ?? '';
  // The card and the teaching walkthrough (spec §8.1) both count: the openings are a shared contract.
  return LINE_CAPABILITY_REPLY_PREFIXES.some((prefix) => lastReply.startsWith(prefix));
}

/** “What do I do next?”, in the phrasings people actually send.
 *
 *  A WHOLE message only, with question marks, spaces, polite particles and a trailing ดี stripped
 *  first — a sentence that merely CONTAINS one of these is doing something else. The list is
 *  deliberately small and literal: the AI owns this intent whenever the gateway is reachable, and
 *  this only has to catch the dead end left behind when a tool comes back unavailable and the
 *  composer answers “ส่วนนี้ยังไม่พร้อมใช้งานผ่าน LINE” about work the sender is in the middle of.
 *
 *  NFC for the same reason as the substitute vocabulary: NFKC decomposes ำ and no ทำ… literal here
 *  would ever match again. */
const NEXT_STEP_QUESTIONS = new Set([
  'ต้องทำยังไงต่อ', 'ต้องทำอย่างไรต่อ', 'ต้องทำไงต่อ',
  'ทำยังไงต่อ', 'ทำอย่างไรต่อ', 'ทำไงต่อ',
  'ยังไงต่อ', 'ไงต่อ',
  'ต่อไปทำอะไร', 'ต่อไปต้องทำอะไร',
  'ขั้นตอนต่อไป', 'ขั้นตอนต่อไปคืออะไร', 'ขั้นตอนต่อไปทำอะไร',
  'ต้องทำอะไร', 'ต้องทำอะไรต่อ', 'ทำอะไรต่อ',
]);

export function isNextStepQuestionText(text: string): boolean {
  const stripped = normalizeLineText(text).normalize('NFC').toLocaleLowerCase('th-TH')
    .replace(/[?？\s]/gu, '')
    .replace(/(?:ครับผม|ครับ|ค่ะ|คะ|นะคะ|นะครับ|จ๊ะ|จ้า|ดี)+$/u, '')
    .replace(/^(?:แล้ว|และ|ตอนนี้|ทีนี้|งั้น)+/u, '');
  return NEXT_STEP_QUESTIONS.has(stripped);
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
    counterparties: '• ขอดูข้อมูลคู่ค้าหรือผู้รับเงิน',
    company_management: '• ขอจัดการทีมงานหรือสาขาตามสิทธิ์ผ่านการ์ดยืนยันค่ะ',
    team: '• ถามจำนวนทีมงาน',
    tax_documents: '• ขอดูใบสำคัญจ่ายหรือ 50 ทวิที่มีสิทธิ์ดู',
    package: '• ถาม “แพ็กเกจนี้พอไหม” หรือขอซื้อแพ็กเกจ',
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
    counterparties: '• Ask for counterparty or payee details',
    company_management: '• Ask to manage team members or branches within your permissions through a confirmation card',
    team: '• Ask how many team members there are',
    tax_documents: '• Ask for payment vouchers or withholding certificates you can access',
    package: '• Ask “Is my package enough?” or to buy a package',
  },
};

const COPY = {
  th: {
    intro: 'ตัวอย่างค่ะ',
    receipt: '• ส่งรูปใบเสร็จ/สลิปเพื่อสร้างร่างค่าใช้จ่ายให้ตรวจสอบ',
    closing: 'อนุมัติใบเบิกหรือบันทึกจ่าย น้องจะเตรียมการ์ดให้กดยืนยันเองค่ะ',
    none: LINE_CAPABILITY_NO_ACCESS_TH,
  },
  en: {
    intro: 'For example:',
    receipt: '• Send a receipt/slip to create a reviewable expense draft',
    closing: 'For claim approval or recording payment, I prepare a card for you to confirm.',
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
    : LINE_CAPABILITY_GROUPS.filter((group) => !('requiredPermissions' in group) && !('toolNames' in group)).map((group) => group.id);
  const receipt = permissions ? canAdvertiseReceiptCapture(permissions, entitled) : true;
  const lines = [...groups.map((id) => EXAMPLES[language][id]), ...(receipt ? [copy.receipt] : [])];
  if (lines.length === 0) return copy.none;
  return [copy.intro, ...lines, copy.closing].join('\n');
}
