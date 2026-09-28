/**
 * Pure domain logic for LINE turn scope/permission policy overrides — deterministic and
 * conservative, independent of whatever `kind` or tool the model (compact intake or per-turn
 * control round) proposes. No NestJS, HTTP, or database imports.
 *
 * Item 1 (spec §2/§3 row 17, §8 "นอกแพ็กเกจ"): real-model eval evidence (tuning-3) showed a question
 * about a module this company's package does not sell (sales, P&L, receivables, invoices, payroll,
 * banking, stock, purchasing) answered with a substituted expense or reimbursement read, or a
 * model-invented refusal with jargon/wrong reason instead of the fixed §8 copy.
 *
 * `scopePolicyOverride` is the single entry point both OrchestratorAgent (the sole fast-lane-
 * eligible subrequest) and runSemanticTurnV2 (every subrequest, so a mixed message still answers
 * its allowed part) apply BEFORE any tool is offered or called.
 */
import { hasToolFeature } from '@watchdog-bms/contracts';
import type { LineAiSemanticSubrequestV2 } from '@watchdog-bms/contracts';

export type ScopePolicyLanguage = 'th' | 'en';

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

// ---- Item 1: a module this company's package does not sell -----------------------------------

export type UnsoldModuleTopic = { featureKey: string | null; topicLabelTh: string; topicLabelEn: string };

/** "ใบกำกับ" alone also names an expense's OWN tax invoice evidence (e.g. "ใบกำกับภาษีค่าน้ำมัน"),
 *  so it only counts as the unsold "issue an invoice" topic paired with an issuing verb. */
const ISSUE_VERB_TH = ['ออก', 'ทำ', 'สร้าง', 'จัดทำ'];

const UNSOLD_MODULE_TOPICS: ReadonlyArray<UnsoldModuleTopic & { test: (text: string) => boolean }> = [
  {
    featureKey: 'sales_documents', topicLabelTh: 'ยอดขายและรายได้', topicLabelEn: 'sales and revenue',
    test: (text) => includesAny(text, ['ยอดขาย', 'รายได้']),
  },
  {
    featureKey: 'reports', topicLabelTh: 'รายงานกำไรขาดทุน', topicLabelEn: 'profit and loss reports',
    test: (text) => includesAny(text, ['กำไรขาดทุน', 'กำไร', 'ขาดทุน', 'งบดุล', 'งบกำไรขาดทุน', 'งบการเงิน']),
  },
  {
    featureKey: 'sales_documents', topicLabelTh: 'ลูกหนี้และลูกค้าค้างชำระ', topicLabelEn: 'accounts receivable',
    // "ลูกค้าที่ค้างชำระ" (eval T-138) inserts ที่/ซึ่ง between the two words — check them separately.
    test: (text) => (text.includes('ลูกค้า') && text.includes('ค้างชำระ')) || text.includes('ลูกหนี้'),
  },
  {
    featureKey: 'sales_documents', topicLabelTh: 'ใบแจ้งหนี้และใบเสนอราคา', topicLabelEn: 'invoices and quotations',
    test: (text) => includesAny(text, ['ใบแจ้งหนี้', 'ใบเสนอราคา']) || (text.includes('ใบกำกับ') && includesAny(text, ISSUE_VERB_TH)),
  },
  {
    featureKey: 'inventory', topicLabelTh: 'สต็อกสินค้าคงเหลือ', topicLabelEn: 'inventory stock',
    test: (text) => includesAny(text, ['สต็อก', 'สินค้าคงเหลือ', 'stock']),
  },
  {
    // No `payroll` feature exists anywhere in the product's own feature catalog (packages/contracts
    // feature-entitlements.ts) — never a company entitlement gap, always genuinely unsupported.
    featureKey: null, topicLabelTh: 'การคำนวณเงินเดือน', topicLabelEn: 'payroll',
    test: (text) => text.includes('เงินเดือน'),
  },
  {
    featureKey: 'bank_reconciliation', topicLabelTh: 'บัญชีธนาคารและการกระทบยอด', topicLabelEn: 'bank accounts and reconciliation',
    test: (text) => includesAny(text, ['บัญชีธนาคาร', 'กระทบยอด']),
  },
  {
    featureKey: 'procurement', topicLabelTh: 'ใบสั่งซื้อ', topicLabelEn: 'purchase orders',
    test: (text) => text.includes('ใบสั่งซื้อ'),
  },
];

export function unsoldModuleTopicFor(text: string): UnsoldModuleTopic | undefined {
  return UNSOLD_MODULE_TOPICS.find((topic) => topic.test(text));
}

/** Same fail-open convention as `toolAccessOutcome`/`hasToolFeature` project-wide: entitlement data
 *  absent from the request (`undefined`) means the legacy "every feature entitled" company or an
 *  older caller, never a block; `null` is the same fail-open signal already resolved into a set. A
 *  `null` featureKey (payroll) means no such feature exists at all, so it is never enabled. */
export function moduleFeatureEnabled(featureKey: string | null, entitledFeatureKeys: readonly string[] | null | undefined): boolean {
  if (featureKey === null) return false;
  if (entitledFeatureKeys === undefined) return true;
  return hasToolFeature({ featureKeys: [featureKey], sourceModule: 'expenses' }, entitledFeatureKeys === null ? null : new Set(entitledFeatureKeys));
}

/** Spec §8 "นอกแพ็กเกจ" exact copy: names the topic, states the current scope, and gives two
 *  example questions the customer can actually ask. */
export function unsoldModuleReplyText(topic: UnsoldModuleTopic, language: ScopePolicyLanguage): string {
  return language === 'en'
    ? `Your current package does not include ${topic.topicLabelEn} yet. Right now Nong Mangmee can help with expenses and reimbursement claims — try asking "What are this month's expenses?" or "How many reimbursement claims are pending approval?"`
    : `แพ็กเกจที่ใช้อยู่ยังไม่มีเรื่อง${topic.topicLabelTh}ค่ะ ตอนนี้น้องมั่งมีช่วยเรื่องรายจ่ายและใบเบิกได้ค่ะ เช่น ลองถามว่า "ค่าใช้จ่ายเดือนนี้เท่าไหร่" หรือ "ใบเบิกที่รออนุมัติมีกี่รายการ" ได้เลยค่ะ`;
}

// ---- Combined entry point ----------------------------------------------------------------------

export type ScopePolicyOverride = {
  reasonCode: 'PACKAGE_FEATURE_NOT_ENABLED';
  text: string;
};

/**
 * Checked BEFORE any tool is offered or called, per subrequest. `kind` exempts the unsold-module
 * check for 'help': a genuine product how-to question about an unsold topic still gets the honest
 * "no reviewed guide" answer from its own kind=='help' handling, not this generic package-limit
 * copy — but an explicit business read/write/general clause is intercepted.
 */
export function scopePolicyOverride(
  text: string,
  kind: LineAiSemanticSubrequestV2['kind'],
  permissions: readonly string[],
  entitledFeatureKeys: readonly string[] | null | undefined,
  language: ScopePolicyLanguage,
): ScopePolicyOverride | undefined {
  if (kind !== 'help') {
    const topic = unsoldModuleTopicFor(text);
    if (topic && !moduleFeatureEnabled(topic.featureKey, entitledFeatureKeys)) {
      return { reasonCode: 'PACKAGE_FEATURE_NOT_ENABLED', text: unsoldModuleReplyText(topic, language) };
    }
  }
  return undefined;
}
