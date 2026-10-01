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

// R2: "สั่งซื้อ" alone is ordinary shopping ("สั่งซื้อของออนไลน์"), so it only counts as the unsold
// procurement topic paired with a supplier/vendor word; "ใบสั่งซื้อ", "จัดซื้อ", and PO/purchase order
// are unambiguous procurement terms on their own and need no pairing.
const SUPPLIER_WORD_PATTERN = /ซัพพลายเออร์|ผู้ขาย|supplier/i;
const PURCHASE_ORDER_EN_PATTERN = /\bPO\b|purchase\s*order/i;

// Advisor S0 (R1 integrated G run 2026-10-01, G-09/G-16/G-24): "ของอะไรใกล้หมดบ้าง", "ร้านเรามีของเหลือเท่าไหร่" and the
// typo "สต๊อก" asked for stock without the exact word, and got a planner sentence or the dead-end line instead of the
// fixed reply. Goods words only: "เหลือ" and "ใกล้หมด" alone also describe a receipt quota, a credit or a budget
// ("ใบเสร็จเหลือกี่ใบ", "โควตาของร้านใกล้หมด"), which stay with their own tools; "เจ้าของ" and "เหลือง" are other words.
const STOCK_PATTERN = new RegExp([
  'สต[็๊้]?อ[กค]', 'stock',
  '(?:(?<!เจ้า)ของ|สินค้า(?:ที่)?)(?:คง)?เหลือ(?!ง)',
  '(?:(?<!เจ้า)ของ|สินค้า)(?:อะไร|ไหน|ตัวไหน|ชิ้นไหน|รายการไหน)?(?:ที่)?(?:ใกล้|จวน)(?:จะ)?หมด',
  'เหลือ(?:อีก|อยู่)?กี่(?:ชิ้น|กล่อง|ลัง|แพ็ค|แพ็ก|ขวด|ถุง|ตัว|อัน)',
].join('|'), 'iu');

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
    test: (text) => STOCK_PATTERN.test(text),
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
    test: (text) => text.includes('ใบสั่งซื้อ') || text.includes('จัดซื้อ') || PURCHASE_ORDER_EN_PATTERN.test(text)
      || (text.includes('สั่งซื้อ') && SUPPLIER_WORD_PATTERN.test(text)),
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

type LineActionRule = { noun: readonly string[]; verb: readonly string[]; permission: string; actionLabelTh: string; page: 'reimbursements' | 'expenses' | 'substitute-receipts';
  /** A bare imperative that opens with the verb ("อนุมัติใบรับรองนี้เลย") is a request too, with no politeness marker. */
  imperative?: boolean };

const REIMBURSEMENT_NOUN_TH = ['ใบเบิก', 'เบิกจ่าย', 'คำขอเบิก'];
const EXPENSE_NOUN_TH = ['ค่าใช้จ่าย', 'รายจ่าย'];
const SUBSTITUTE_NOUN_TH = ['ใบรับรอง', 'ใบแทนใบเสร็จ'];
// "ลงชื่อ" also means signing in (ลงชื่อเข้าใช้), so it counts only beside the document's own name.
const SIGN_VERB_TH = ['เซ็น', 'ลงนาม', 'ลงลายมือชื่อ'];

// Spec §11: gateway never sends/approves/pays on the user's behalf. The final mutation always
// happens on the web app, never over LINE — regardless of whether this actor may do it at all.
const LINE_ACTION_RULES: readonly LineActionRule[] = [
  { noun: REIMBURSEMENT_NOUN_TH, verb: ['อนุมัติ'], permission: 'reimbursement.approve', actionLabelTh: 'อนุมัติใบเบิก', page: 'reimbursements' },
  { noun: REIMBURSEMENT_NOUN_TH, verb: ['ปฏิเสธ', 'ไม่อนุมัติ'], permission: 'reimbursement.reject', actionLabelTh: 'ปฏิเสธใบเบิก', page: 'reimbursements' },
  { noun: REIMBURSEMENT_NOUN_TH, verb: ['จ่าย', 'โอนเงิน', 'ชำระเงิน'], permission: 'reimbursement.payment.record', actionLabelTh: 'จ่ายใบเบิก', page: 'reimbursements' },
  { noun: EXPENSE_NOUN_TH, verb: ['ยืนยัน'], permission: 'expense.confirm', actionLabelTh: 'ยืนยันรายการค่าใช้จ่าย', page: 'expenses' },
  { noun: EXPENSE_NOUN_TH, verb: ['ยกเลิก'], permission: 'expense.void', actionLabelTh: 'ยกเลิกรายการค่าใช้จ่าย', page: 'expenses' },
  // Advisor S1 (spec §2.6, §4.3 S3): certifying or approving a substitute receipt stays on the web, where the
  // whole document is read before it is signed (assertWeb on certify/approve).
  { noun: SUBSTITUTE_NOUN_TH, verb: ['อนุมัติ'], permission: 'expense.confirm', actionLabelTh: 'อนุมัติใบรับรองแทนใบเสร็จ', page: 'substitute-receipts', imperative: true },
  { noun: SUBSTITUTE_NOUN_TH, verb: [...SIGN_VERB_TH, 'ลงชื่อ', 'รับรอง'], permission: 'expense.read_own', actionLabelTh: 'ลงลายมือชื่อใบรับรองแทนใบเสร็จ', page: 'substitute-receipts', imperative: true },
  // A bare "เซ็นให้หน่อย" names no document: the only thing anyone signs in this product is a substitute
  // receipt (a saved signature image says ลายเซ็น, stripped before the verb check).
  { noun: [], verb: SIGN_VERB_TH, permission: 'expense.read_own', actionLabelTh: 'ลงลายมือชื่อใบรับรองแทนใบเสร็จ', page: 'substitute-receipts', imperative: true },
];
const OTHER_DOCUMENT_NOUN_TH = [...REIMBURSEMENT_NOUN_TH, ...EXPENSE_NOUN_TH];

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

// C2 (batch 5c, T-084-b "เช็คใบเบิกที่รออนุมัติหน่อยครับ"): these phrases NAME a state, they are never
// a command, but each one contains one of the bare verbs above as a substring ("รออนุมัติ" contains
// "อนุมัติ", "จ่ายแล้ว" contains "จ่าย"...). Stripped before verb matching only — the noun check still
// runs on the full text — so a real action verb elsewhere in the same message still matches, e.g.
// "ช่วยอนุมัติใบเบิกที่รออนุมัติหน่อย" keeps the standalone "อนุมัติ" from "ช่วยอนุมัติ".
const STATE_PHRASES_TH = [
  'รออนุมัติ', 'อนุมัติแล้ว', 'ที่อนุมัติแล้ว', 'รอจ่าย', 'จ่ายแล้ว', 'ยังไม่จ่าย',
  'รอยืนยัน', 'ยืนยันแล้ว', 'ถูกปฏิเสธ', 'ปฏิเสธแล้ว', 'ถูกยกเลิก', 'ยกเลิกแล้ว',
  // Advisor S1: a substitute receipt's signing states ("มีใบรับรองรอเซ็นกี่ใบ") and the queue wording, plus two
  // nouns that carry a verb inside them (ใบรับรอง ⊃ รับรอง, ลายเซ็น ⊃ เซ็น).
  'รอเซ็น', 'เซ็นแล้ว', 'ต้องเซ็น', 'รอฉันเซ็น', 'รอคุณเซ็น', 'รอลงนาม', 'ลงนามแล้ว', 'ต้องลงนาม',
  'รอลงลายมือชื่อ', 'ต้องลงลายมือชื่อ', 'รอรับรอง', 'รอฉันอนุมัติ', 'รอคุณอนุมัติ', 'ใบรับรอง', 'ลายเซ็น',
  // Advisor S3 eval (2026-09-30, "สรุปใบเบิกที่ค้างให้หน่อย แยกตามคนอนุมัติ"): the approver, or who has not approved
  // yet, names a person or a state — a backlog question, never a request to approve or reject.
  'ผู้อนุมัติ', 'คนอนุมัติ', 'คนที่อนุมัติ', 'ยังไม่อนุมัติ',
];

function withoutStatePhrases(text: string): string {
  return STATE_PHRASES_TH.reduce((withoutPhrase, phrase) => withoutPhrase.split(phrase).join(''), text);
}

function lineActionRuleFor(text: string): LineActionRule | undefined {
  if (includesAny(text, STATUS_QUESTION_MARKERS_TH)) return undefined;
  const requested = includesAny(text, REQUEST_MARKERS_TH);
  const verbCheckText = withoutStatePhrases(text);
  return LINE_ACTION_RULES.find((rule) => (requested || rule.imperative && rule.verb.some((verb) => text.trim().startsWith(verb)))
    && (rule.noun.length ? includesAny(text, rule.noun) : !includesAny(text, OTHER_DOCUMENT_NOUN_TH))
    && includesAny(verbCheckText, rule.verb));
}

/** Never "ดึงข้อมูลไม่ได้" — an honest reason: do it on the web when the actor may, or that their
 *  role may not, at all. Names the page instead of a raw path/link (matches this module's own
 *  READ_UNAVAILABLE_TEXT convention of naming the page in words, not embedding a URL). */
export function lineActionBoundaryReplyText(text: string, permissions: readonly string[], language: ScopePolicyLanguage): string | undefined {
  const rule = lineActionRuleFor(text);
  if (!rule) return undefined;
  const pageLabelTh = { reimbursements: 'ใบเบิก', expenses: 'รายจ่าย', 'substitute-receipts': 'ใบรับรองแทนใบเสร็จ' }[rule.page];
  const substitute = rule.page === 'substitute-receipts';
  if (permissions.includes(rule.permission)) {
    return language === 'en'
      ? `This action can't be completed on LINE. Please go to the ${substitute ? 'substitute receipts' : rule.page} page on the web to do it.`
      : `การ${rule.actionLabelTh}ทำผ่าน LINE ไม่ได้ค่ะ ${substitute ? 'ต้องเปิดอ่านเอกสารฉบับเต็มบนเว็บก่อนเซ็น ' : ''}ไปที่หน้า${pageLabelTh}บนเว็บได้เลยค่ะ`;
  }
  return language === 'en'
    ? 'Your role does not have permission to do this yet.'
    : `บทบาทของคุณยังไม่มีสิทธิ์${rule.actionLabelTh}ค่ะ`;
}

// ---- Item 3: a read-only role asking to record, upload, or capture -----------------------------

// "สร้างร่าง" (create a draft) was dropped: it is ambiguous with creating a REIMBURSEMENT draft
// (whole-chain acceptance regression, "สร้างร่างเบิกค่าเดินทาง" — gated on reimbursement.create, a
// different permission this check does not know about), and it never appears in the eval evidence
// this item fixes (T-146 uses ถ่ายรูป/ส่งเข้าระบบ). Every remaining verb here is expense/receipt-only.
const CAPTURE_VERB_TH = ['ถ่ายรูป', 'ถ่ายภาพ', 'ส่งเข้าระบบ', 'บันทึกรายจ่าย', 'บันทึกค่าใช้จ่าย', 'บันทึกใบเสร็จ', 'อัปโหลด', 'อัพโหลด', 'สแกนใบเสร็จ'];
const EXPENSE_CREATE_PERMISSIONS = ['expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload'];

/** Base it on the permissions the request actually carries, never the role name: AUDITOR_READONLY
 *  keeps its own reimbursement self-service create permission, so only the EXPENSE-capture
 *  permissions gate this — a role that has any of them is not read-only for this action.
 *  F4 (tuning-6b, T-145-a): the old copy ("ดูข้อมูลได้อย่างเดียว... ไม่สามารถ...") had no next step and
 *  never said "ไม่มีสิทธิ์"/"อ่านอย่างเดียว" — the words customers and the eval look for — so it read as
 *  a dead end instead of an honest permission boundary. */
export function readOnlyCaptureReplyText(text: string, permissions: readonly string[], language: ScopePolicyLanguage): string | undefined {
  if (!includesAny(text, CAPTURE_VERB_TH)) return undefined;
  if (EXPENSE_CREATE_PERMISSIONS.some((permission) => permissions.includes(permission))) return undefined;
  return language === 'en'
    ? "Your account has read-only access, so you can't record or submit a receipt yet. Ask your company admin to grant that permission first."
    : 'บัญชีของคุณเป็นสิทธิ์แบบอ่านอย่างเดียวค่ะ จึงยังไม่มีสิทธิ์บันทึกหรือส่งใบเสร็จเข้าระบบ ถ้าต้องการบันทึก ให้ผู้ดูแลบริษัทเพิ่มสิทธิ์ให้ก่อนนะคะ';
}

// ---- Combined entry point ----------------------------------------------------------------------

export type ScopePolicyOverride = {
  reasonCode: 'LINE_ACTION_NOT_SUPPORTED' | 'READONLY_ROLE_CANNOT_CREATE' | 'PACKAGE_FEATURE_NOT_ENABLED';
  text: string;
  /** The web page the reply sends a permitted user to, for the caller to link. */
  webPage?: 'substitute-receipts';
};

/**
 * Checked BEFORE any tool is offered or called, per subrequest. `kind` only exempts the unsold-
 * module check (item 1): a genuine product how-to question about an unsold topic still gets the
 * honest "no reviewed guide" answer from its own kind=='help' handling, not this generic package-
 * limit copy — but an approve/pay/confirm/void request or a read-only capture request is
 * intercepted regardless of kind, since the eval evidence showed the model classify both of those
 * inconsistently (sometimes 'general', sometimes 'write', sometimes 'help').
 * Owner 2026-09-29 ("ต้องคุยได้ เป็นความรู้ทั่วไป"): a package limits THIS company's records, never a
 * topic, so a 'general' clause ("รายได้เท่าไหร่ต้องจด VAT", "กำไรขั้นต้นคืออะไร", "เงินเดือนหัก
 * ประกันสังคมกี่เปอร์เซ็นต์") is exempt too — the composer answers it from general knowledge. The
 * intake router files a question about the company's own figures in an unsold module as 'read' (an
 * issuing request as 'write'), which this check still blocks.
 */
/** Advisor S2a (owner 2026-09-30 ~16:00): a clause routed to a package read that names a package or
 *  MangmeePlus asks about MangmeePlus's own packages — "กำไรต่อแพ็กเกจ" is not this shop's P&L — so the
 *  unsold-module reply must not answer it. Billing reads carry no shop-module data. */
const PACKAGE_TOOL_HINTS: ReadonlySet<string> = new Set(['billing.get_package_catalog', 'billing.get_package_usage']);
const PACKAGE_WORD = /แพ็?[กค]เกจ|มั่งมี/u;

export function scopePolicyOverride(
  text: string,
  kind: LineAiSemanticSubrequestV2['kind'],
  permissions: readonly string[],
  entitledFeatureKeys: readonly string[] | null | undefined,
  language: ScopePolicyLanguage,
  toolHint?: string,
): ScopePolicyOverride | undefined {
  const lineAction = lineActionBoundaryReplyText(text, permissions, language);
  if (lineAction) {
    const rule = lineActionRuleFor(text);
    return { reasonCode: 'LINE_ACTION_NOT_SUPPORTED', text: lineAction,
      ...(rule?.page === 'substitute-receipts' && permissions.includes(rule.permission) ? { webPage: rule.page } : {}) };
  }
  const readOnly = readOnlyCaptureReplyText(text, permissions, language);
  if (readOnly) return { reasonCode: 'READONLY_ROLE_CANNOT_CREATE', text: readOnly };
  const packageQuestion = toolHint !== undefined && PACKAGE_TOOL_HINTS.has(toolHint) && PACKAGE_WORD.test(text);
  if (kind !== 'help' && kind !== 'general' && !packageQuestion) {
    const topic = unsoldModuleTopicFor(text);
    if (topic && !moduleFeatureEnabled(topic.featureKey, entitledFeatureKeys)) {
      return { reasonCode: 'PACKAGE_FEATURE_NOT_ENABLED', text: unsoldModuleReplyText(topic, language) };
    }
  }
  return undefined;
}
