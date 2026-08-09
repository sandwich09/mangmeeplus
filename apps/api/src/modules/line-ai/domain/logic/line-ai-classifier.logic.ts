/**
 * Pure domain logic for LINE AI message classification.
 * No NestJS, Prisma, HTTP, LINE SDK, AI provider, or storage imports.
 */
import { mapThaiDigits, type LineAiIntent, type LineAiAgent } from '@watchdog-bms/contracts';
import { createHash } from 'node:crypto';

// Thai and English mutation keywords that LINE must block
const MUTATION_KEYWORDS_TH = [
  'สั่งซื้อ', 'สั่งขาย', 'ชำระ', 'โอนเงิน', 'จ่ายเงิน', 'ลบ', 'แก้ไข',
  'อัปเดต', 'เพิ่ม', 'ตัดสต็อก', 'รับสินค้า', 'จัดส่ง', 'ยืนยัน',
  'อนุมัติ', 'ปฏิเสธ', 'ยกเลิก', 'บันทึก', 'ส่งออก', 'นำเข้า',
];
const MUTATION_KEYWORDS_EN = [
  'create', 'add', 'delete', 'remove', 'update', 'edit', 'approve',
  'reject', 'cancel', 'post', 'transfer', 'pay', 'purchase', 'sell',
  'order', 'dispatch', 'receive', 'adjust stock', 'export', 'import',
];

// Unsupported module keywords (roadmap items not yet implemented)
const UNSUPPORTED_KEYWORDS_TH = ['บัญชี', 'ภาษี', 'เงินเดือน', 'เจ้าหนี้', 'ลูกหนี้', 'ธนาคาร', 'งบดุล', 'กำไรขาดทุน'];
const UNSUPPORTED_KEYWORDS_EN = ['payroll', 'tax filing', 'crm', 'bank reconciliation'];
const LEDGER_KEYWORDS_EN = ['accounting', 'ledger', 'trial balance', 'balance sheet', 'profit and loss', 'p&l', 'financial'];

// Inventory-related keywords
const INVENTORY_KEYWORDS_TH = ['สินค้า', 'สต็อก', 'คลัง', 'ของคงเหลือ', 'เคลื่อนไหว', 'สต็อกต่ำ'];
const INVENTORY_KEYWORDS_EN = ['product', 'stock', 'inventory', 'warehouse', 'low stock', 'movement', 'balance'];

// Notification/alert keywords
const NOTIFICATION_KEYWORDS_TH = ['แจ้งเตือน', 'การแจ้งเตือน', 'เตือน', 'สรุปประจำวัน', 'รายงาน'];
const NOTIFICATION_KEYWORDS_EN = ['alert', 'notification', 'notify', 'daily summary', 'summary'];

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/** Returns sha256 hex prefix (16 chars) of message text for safe storage. */
export function hashMessagePreview(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

export type LineCompanyCommand =
  | { kind: 'list' }
  | { kind: 'select'; value: string };

/** Parse explicit company-context commands. Shared by the webhook use case and
 *  the message buffer: a command must never be glued into a fragment batch,
 *  because `parseLineCompanyCommand` only matches at the start of a message. */
export function parseLineCompanyCommand(text: string): LineCompanyCommand | null {
  const trimmed = text.trim();
  const normalized = trimmed.replace(/\s+/g, ' ').toLowerCase();
  if (normalized === '/companies' || normalized === '/company' || normalized === 'เปลี่ยนบริษัท') return { kind: 'list' };
  const match = trimmed.match(/^\/company\s+(.+)$/i);
  return match?.[1] ? { kind: 'select', value: match[1].trim() } : null;
}

/** A bare number is only a selection candidate. The webhook state machine decides whether
 * the immediately preceding turn actually asked the user to choose a company. */
export function parseBareCompanySelection(text: string): LineCompanyCommand | null {
  const value = mapThaiDigits(text.trim());
  return /^\d+$/.test(value) ? { kind: 'select', value } : null;
}

/** Normalize LINE text message: trim, collapse whitespace, lowercase. */
export function normalizeLineText(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Classify LINE message intent without accepting user-provided authorization. */
export function classifyIntent(normalizedText: string): LineAiIntent {
  if (matchesAny(normalizedText, [...MUTATION_KEYWORDS_TH, ...MUTATION_KEYWORDS_EN])) {
    return 'mutation_request';
  }
  if (matchesAny(normalizedText, LEDGER_KEYWORDS_EN)) {
    return 'read_summary';
  }
  if (matchesAny(normalizedText, [...UNSUPPORTED_KEYWORDS_TH, ...UNSUPPORTED_KEYWORDS_EN])) {
    return 'unsupported_module';
  }
  if (matchesAny(normalizedText, [...INVENTORY_KEYWORDS_TH, ...INVENTORY_KEYWORDS_EN])) {
    return 'read_detail';
  }
  if (matchesAny(normalizedText, [...NOTIFICATION_KEYWORDS_TH, ...NOTIFICATION_KEYWORDS_EN])) {
    return 'read_summary';
  }
  return 'read_summary';
}

/** Choose agent based on intent and text. */
export function chooseAgent(intent: LineAiIntent, normalizedText: string): LineAiAgent {
  if (intent === 'unsupported_module') return 'general';
  if (matchesAny(normalizedText, LEDGER_KEYWORDS_EN)) return 'cfo';
  if (matchesAny(normalizedText, [...INVENTORY_KEYWORDS_TH, ...INVENTORY_KEYWORDS_EN])) return 'inventory';
  if (matchesAny(normalizedText, [...NOTIFICATION_KEYWORDS_TH, ...NOTIFICATION_KEYWORDS_EN])) return 'notifications';
  return 'general';
}
