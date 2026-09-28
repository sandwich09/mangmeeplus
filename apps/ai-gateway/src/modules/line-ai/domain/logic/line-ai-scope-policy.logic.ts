/**
 * Pure domain logic for LINE turn scope/permission policy overrides — deterministic and
 * conservative, independent of whatever `kind` or tool the model (compact intake or per-turn
 * control round) proposes. No NestJS, HTTP, or database imports.
 *
 * Item 1 (spec §2/§3 row 17, §8 "นอกแพ็กเกจ"): real-model eval evidence (tuning-3) showed a question
 * about a module this company's package does not sell (sales, P&L, receivables, invoices, payroll,
 * banking, stock, purchasing) answered with a substituted expense or reimbursement read, or a
 * model-invented refusal with jargon/wrong reason instead of the fixed §8 copy.
 * Item 2 (spec §11 "ห้ามส่ง อนุมัติ หรือจ่ายแทนผู้ใช้เอง"): a request to approve/reject/pay a
 * reimbursement or confirm/void an expense from LINE got a generic "can't fetch this" reply
 * instead of an honest "do this on the web" or "your role can't do this" answer.
 * Item 3 (spec §8 "นอกสิทธิ์"): a read-only role (e.g. AUDITOR_READONLY) asking to record, upload,
 * or capture a receipt got a how-to card instead of an honest read-only answer.
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

// ---- Item 2: approve/reject/pay a reimbursement, or confirm/void an expense, from LINE --------

type LineActionRule = { noun: readonly string[]; verb: readonly string[]; permission: string; actionLabelTh: string; page: 'reimbursements' | 'expenses' };

const REIMBURSEMENT_NOUN_TH = ['ใบเบิก', 'เบิกจ่าย', 'คำขอเบิก'];
const EXPENSE_NOUN_TH = ['ค่าใช้จ่าย', 'รายจ่าย'];

// Spec §11: gateway never sends/approves/pays on the user's behalf. The final mutation always
// happens on the web app, never over LINE — regardless of whether this actor may do it at all.
const LINE_ACTION_RULES: readonly LineActionRule[] = [
  { noun: REIMBURSEMENT_NOUN_TH, verb: ['อนุมัติ'], permission: 'reimbursement.approve', actionLabelTh: 'อนุมัติใบเบิก', page: 'reimbursements' },
  { noun: REIMBURSEMENT_NOUN_TH, verb: ['ปฏิเสธ', 'ไม่อนุมัติ'], permission: 'reimbursement.reject', actionLabelTh: 'ปฏิเสธใบเบิก', page: 'reimbursements' },
  { noun: REIMBURSEMENT_NOUN_TH, verb: ['จ่าย', 'โอนเงิน', 'ชำระเงิน'], permission: 'reimbursement.payment.record', actionLabelTh: 'จ่ายใบเบิก', page: 'reimbursements' },
  { noun: EXPENSE_NOUN_TH, verb: ['ยืนยัน'], permission: 'expense.confirm', actionLabelTh: 'ยืนยันรายการค่าใช้จ่าย', page: 'expenses' },
  { noun: EXPENSE_NOUN_TH, verb: ['ยกเลิก'], permission: 'expense.void', actionLabelTh: 'ยกเลิกรายการค่าใช้จ่าย', page: 'expenses' },
];

// eval T-093-b root cause for this classifier: "ใบเบิกที่ฉันขอไปยังไม่จ่ายใช่ป่ะคะ" ("has my claim not
// been paid yet?") contains the noun "ใบเบิก" and the verb "จ่าย" but ASKS about status, it does not
// REQUEST the action — a status question ending in one of these markers is never a command.
const STATUS_QUESTION_MARKERS_TH = ['ใช่ป่ะ', 'ใช่ไหม', 'ใช่มั้ย', 'หรือยัง', 'รึยัง', 'หรือเปล่า', 'รึเปล่า'];

// Whole-chain acceptance regression (T-089-a-manager-pending-thismonth, "ใบเบิกรออนุมัติเดือนนี้มีกี่
// รายการครับ" — "how many claims are pending approval?"): "รออนุมัติ" contains the bare verb "อนุมัติ"
// as a substring, but names a STATE (awaiting approval), not a command. Requiring an explicit
// request marker — never a bare noun+verb co-occurrence — is the conservative fix: it recognizes
// every real "please do X" phrasing in the eval evidence without guessing at every way a status
// description might also contain the same verb.
const REQUEST_MARKERS_TH = ['ช่วย', 'กรุณา', 'หน่อย', 'ทีนะ', 'ทีค่ะ', 'ทีครับ'];

function lineActionRuleFor(text: string): LineActionRule | undefined {
  if (!includesAny(text, REQUEST_MARKERS_TH) || includesAny(text, STATUS_QUESTION_MARKERS_TH)) return undefined;
  return LINE_ACTION_RULES.find((rule) => includesAny(text, rule.noun) && includesAny(text, rule.verb));
}

/** Never "ดึงข้อมูลไม่ได้" — an honest reason: do it on the web when the actor may, or that their
 *  role may not, at all. Names the page instead of a raw path/link (matches this module's own
 *  READ_UNAVAILABLE_TEXT convention of naming the page in words, not embedding a URL). */
export function lineActionBoundaryReplyText(text: string, permissions: readonly string[], language: ScopePolicyLanguage): string | undefined {
  const rule = lineActionRuleFor(text);
  if (!rule) return undefined;
  const pageLabelTh = rule.page === 'reimbursements' ? 'ใบเบิก' : 'รายจ่าย';
  if (permissions.includes(rule.permission)) {
    return language === 'en'
      ? `This action can't be completed on LINE. Please go to the ${rule.page} page on the web to do it.`
      : `การ${rule.actionLabelTh}ทำผ่าน LINE ไม่ได้ค่ะ ไปที่หน้า${pageLabelTh}บนเว็บได้เลยค่ะ`;
  }
  return language === 'en'
    ? 'Your role does not have permission to do this yet.'
    : `บทบาทของคุณยังไม่มีสิทธิ์${rule.actionLabelTh}ค่ะ`;
}

// ---- Item 3: a read-only role asking to record, upload, or capture -----------------------------

const CAPTURE_VERB_TH = ['ถ่ายรูป', 'ถ่ายภาพ', 'ส่งเข้าระบบ', 'บันทึกรายจ่าย', 'บันทึกค่าใช้จ่าย', 'บันทึกใบเสร็จ', 'อัปโหลด', 'อัพโหลด', 'สร้างร่าง', 'สแกนใบเสร็จ'];
const EXPENSE_CREATE_PERMISSIONS = ['expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload'];

/** Base it on the permissions the request actually carries, never the role name: AUDITOR_READONLY
 *  keeps its own reimbursement self-service create permission, so only the EXPENSE-capture
 *  permissions gate this — a role that has any of them is not read-only for this action. */
export function readOnlyCaptureReplyText(text: string, permissions: readonly string[], language: ScopePolicyLanguage): string | undefined {
  if (!includesAny(text, CAPTURE_VERB_TH)) return undefined;
  if (EXPENSE_CREATE_PERMISSIONS.some((permission) => permissions.includes(permission))) return undefined;
  return language === 'en'
    ? 'Your role can only view records here — it cannot record or upload one.'
    : 'บทบาทของคุณดูข้อมูลได้อย่างเดียวค่ะ ไม่สามารถบันทึกหรือถ่ายรูปส่งรายการได้ค่ะ';
}

// ---- Combined entry point ----------------------------------------------------------------------

export type ScopePolicyOverride = {
  reasonCode: 'LINE_ACTION_NOT_SUPPORTED' | 'READONLY_ROLE_CANNOT_CREATE' | 'PACKAGE_FEATURE_NOT_ENABLED';
  text: string;
};

/**
 * Checked BEFORE any tool is offered or called, per subrequest. `kind` only exempts the unsold-
 * module check (item 1): a genuine product how-to question about an unsold topic still gets the
 * honest "no reviewed guide" answer from its own kind=='help' handling, not this generic package-
 * limit copy — but an approve/pay/confirm/void request or a read-only capture request is
 * intercepted regardless of kind, since the eval evidence showed the model classify both of those
 * inconsistently (sometimes 'general', sometimes 'write', sometimes 'help').
 */
export function scopePolicyOverride(
  text: string,
  kind: LineAiSemanticSubrequestV2['kind'],
  permissions: readonly string[],
  entitledFeatureKeys: readonly string[] | null | undefined,
  language: ScopePolicyLanguage,
): ScopePolicyOverride | undefined {
  const lineAction = lineActionBoundaryReplyText(text, permissions, language);
  if (lineAction) return { reasonCode: 'LINE_ACTION_NOT_SUPPORTED', text: lineAction };
  const readOnly = readOnlyCaptureReplyText(text, permissions, language);
  if (readOnly) return { reasonCode: 'READONLY_ROLE_CANNOT_CREATE', text: readOnly };
  if (kind !== 'help') {
    const topic = unsoldModuleTopicFor(text);
    if (topic && !moduleFeatureEnabled(topic.featureKey, entitledFeatureKeys)) {
      return { reasonCode: 'PACKAGE_FEATURE_NOT_ENABLED', text: unsoldModuleReplyText(topic, language) };
    }
  }
  return undefined;
}
