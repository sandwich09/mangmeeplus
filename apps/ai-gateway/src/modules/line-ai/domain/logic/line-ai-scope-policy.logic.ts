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
import { BILLING_PAID_TIERS, TIER_FEATURE_PRESETS, canUseLineChatAction, customerPackageName, type BillingOffer, THAI_SYSTEM_ROLE_NAMES, LINE_CHAT_ACTIONS, LINE_TOOL_REGISTRY, hasToolFeature, hasToolPermissions } from '@watchdog-bms/contracts';
import type { LineAiSemanticSubrequestV2, LineAiWebLink } from '@watchdog-bms/contracts';

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
    test: (text) => includesAny(text, ['ยอดขาย', 'รายได้']) || /\bsales\b|\brevenue\b/iu.test(text),
  },
  {
    featureKey: 'reports', topicLabelTh: 'รายงานกำไรขาดทุน', topicLabelEn: 'profit and loss reports',
    test: (text) => includesAny(text, ['กำไรขาดทุน', 'กำไร', 'ขาดทุน', 'งบดุล', 'งบกำไรขาดทุน', 'งบการเงิน', 'รายงานการเงิน']) || /profit\s*(?:and|&)\s*loss|balance\s*sheet|financial\s*reports?/iu.test(text),
  },
  {
    featureKey: 'double_entry_ledger', topicLabelTh: 'สมุดบัญชีแยกประเภท', topicLabelEn: 'general ledger',
    test: (text) => /บัญชีแยกประเภท|สมุดบัญชี|\bGL\b|\bledger\b/iu.test(text),
  },
  {
    featureKey: 'crm', topicLabelTh: 'ระบบติดตามลูกค้า', topicLabelEn: 'customer relationship management',
    test: (text) => /\bCRM\b|ติดตามลูกค้า|บริหารลูกค้า|customer\s*(?:relationship|tracking)/iu.test(text),
  },
  {
    featureKey: 'sales_documents', topicLabelTh: 'ลูกหนี้และลูกค้าค้างชำระ', topicLabelEn: 'accounts receivable',
    // "ลูกค้าที่ค้างชำระ" (eval T-138) inserts ที่/ซึ่ง between the two words — check them separately.
    test: (text) => (text.includes('ลูกค้า') && text.includes('ค้างชำระ')) || text.includes('ลูกหนี้'),
  },
  {
    featureKey: 'sales_documents', topicLabelTh: 'ใบแจ้งหนี้และใบเสนอราคา', topicLabelEn: 'invoices and quotations',
    test: (text) => includesAny(text, ['ใบแจ้งหนี้', 'ใบเสนอราคา']) || /\binvoices?\b|\bquotations?\b/iu.test(text) || (text.includes('ใบกำกับ') && includesAny(text, ISSUE_VERB_TH)),
  },
  {
    featureKey: 'inventory', topicLabelTh: 'สต็อกสินค้าคงเหลือ', topicLabelEn: 'inventory stock',
    test: (text) => STOCK_PATTERN.test(text) || /\binventory\b/iu.test(text),
  },
  {
    // No `payroll` feature exists anywhere in the product's own feature catalog (packages/contracts
    // feature-entitlements.ts) — never a company entitlement gap, always genuinely unsupported.
    featureKey: null, topicLabelTh: 'การคำนวณเงินเดือน', topicLabelEn: 'payroll',
    test: (text) => text.includes('เงินเดือน') || /\bpayroll\b/iu.test(text),
  },
  {
    featureKey: 'bank_reconciliation', topicLabelTh: 'บัญชีธนาคารและการกระทบยอด', topicLabelEn: 'bank accounts and reconciliation',
    test: (text) => includesAny(text, ['บัญชีธนาคาร', 'กระทบยอด']) || /bank\s*(?:balance|reconciliation)|reconcile/iu.test(text),
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

/** Offer only a package the billing catalog actually sells; otherwise state current product scope. */
export function unsoldModuleReplyText(topic: UnsoldModuleTopic, language: ScopePolicyLanguage, offers?: readonly BillingOffer[]): string {
  if (topic.featureKey && featurePackageOffer(topic.featureKey, offers)) return featureLimitReplyText(topic.featureKey, language, undefined, offers);
  return language === 'en'
    ? 'This task is unavailable here, type ‘เมนูหลัก’ to see the work you can use.'
    : 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ';
}

/** The same catalog builder and tier features used by billing; never invent a tier for an unsold module. */
export function featurePackageOffer(featureKey: string, offers?: readonly BillingOffer[]) {
  if (offers) return offers.find(offer => offer.interval === 'month' && offer.featureKeys.includes(featureKey));
  // Older producers can identify the required tier, but cannot supply a current selling price.
  const tier = BILLING_PAID_TIERS.find(tier => TIER_FEATURE_PRESETS[tier].includes(featureKey));
  return tier ? { offerKey: tier, featureKeys: [...TIER_FEATURE_PRESETS[tier]] } : undefined;
}

export function featureLimitReplyText(featureKey: string, language: ScopePolicyLanguage, label?: string, offers?: readonly BillingOffer[], features?: readonly string[] | null, permissions: readonly string[] = []): string {
  const offer = featurePackageOffer(featureKey, offers);
  const expenseAccess = moduleFeatureEnabled('expenses', features);
  const canRecordExternal = expenseAccess && permissions.includes('wht.external_certificate.link')
    && ['expense.read', 'expense.read_own', 'expense.read_related'].some(key => permissions.includes(key));
  const canRecordExpense = expenseAccess && ['expense.create', 'expense.update'].some(key => permissions.includes(key));
  const alternative = featureKey === 'wht_50bis' && canRecordExternal
    ? language === 'en' ? 'You can note the number of a 50 Tawi certificate made outside the system on the expense page' : 'จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบได้ที่หน้ารายจ่ายบนเว็บ'
    : featureKey === 'wht_pnd53' && canRecordExpense
      ? language === 'en' ? 'You can keep the supporting expense records on the web' : 'เก็บข้อมูลรายจ่ายและหลักฐานบนเว็บได้'
      : permissions.includes('company.plan.manage') ? language === 'en' ? 'Open Packages to check the work available to your shop' : 'ดูงานที่ร้านใช้ได้ที่หน้าแพ็กเกจ'
        : language === 'en' ? 'Ask the shop owner to check your package' : 'ให้เจ้าของกิจการตรวจแพ็กเกจ';
  const addition = featureKey === 'wht_50bis' ? language === 'en' ? 'issuing certificates in the system' : 'ออกหนังสือรับรองในระบบ'
    : featureKey === 'wht_pnd53' ? language === 'en' ? 'preparing PND3 and PND53 periods' : 'จัดทำงวด ภ.ง.ด.3 และ ภ.ง.ด.53'
      : label ?? (language === 'en' ? 'this feature' : 'ฟีเจอร์นี้');
  if (!offer) return unsoldModuleReplyText(UNSOLD_MODULE_TOPICS.find(topic => topic.featureKey === featureKey)
    ?? { featureKey, topicLabelTh: label ?? 'ฟีเจอร์นี้', topicLabelEn: label ?? 'this feature' }, language, offers);
  return language === 'en'
    ? `${alternative}; ${addition} requires the ${customerPackageName(offer, language)}${'priceSatang' in offer ? ' monthly package' : ' package; check Packages for the current price'}.`
    : `${alternative} ส่วน${addition}ต้องใช้แพ็กเกจ${customerPackageName(offer, language)}${'priceSatang' in offer ? 'ต่อเดือน' : ' ตรวจราคาปัจจุบันได้ที่หน้าแพ็กเกจ'}ค่ะ`;
}

export function permissionAlternative(permissions: readonly string[], language: ScopePolicyLanguage): { page: 'expenses' | 'reimbursements' | 'packages'; label: string; text: string } {
  if (['expense.read', 'expense.read_related', 'expense.read_own'].some(key => permissions.includes(key))) return {
    page: 'expenses', label: language === 'en' ? 'My expenses' : 'ดูค่าใช้จ่ายของฉัน', text: language === 'en' ? 'you can view your own expenses' : 'คุณดูค่าใช้จ่ายของตัวเองได้',
  };
  if (['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'].some(key => permissions.includes(key))) return {
    page: 'reimbursements', label: language === 'en' ? 'My claims' : 'ดูใบเบิกของฉัน', text: language === 'en' ? 'you can view your own claims' : 'คุณดูใบเบิกของตัวเองได้',
  };
  return { page: 'packages', label: language === 'en' ? 'Compare packages' : 'เปรียบเทียบแพ็กเกจ', text: language === 'en' ? 'you can compare packages' : 'คุณเปรียบเทียบแพ็กเกจได้' };
}

export function permissionLimitReplyText(language: ScopePolicyLanguage, action: string, permissions: readonly string[] = []): string {
  return language === 'en'
    ? `Your role cannot ${action}; ask the shop owner, while ${permissionAlternative(permissions, language).text}.`
    : `คุณไม่มีสิทธิ์${action} ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}ดำเนินการ ส่วน${permissionAlternative(permissions, language).text}ค่ะ`;
}

// ---- Item 2: approve/reject/pay a reimbursement, or confirm/void an expense, from LINE --------

type LineActionRule = { noun: readonly string[]; verb: readonly string[]; permission: string; permissionAnyOf?: readonly string[]; actionLabelTh: string; page: 'reimbursements' | 'expenses' | 'substitute-receipts';
  /** A bare imperative that opens with the verb ("อนุมัติใบรับรองนี้เลย") is a request too, with no politeness marker. */
  imperative?: boolean };

const REIMBURSEMENT_NOUN_TH = ['ใบเบิก', 'เบิกจ่าย', 'คำขอเบิก', 'claim', 'reimbursement'];
const EXPENSE_NOUN_TH = ['ค่าใช้จ่าย', 'รายจ่าย', 'expense', 'draft'];
const SUBSTITUTE_NOUN_TH = ['ใบรับรอง', 'ใบแทนใบเสร็จ'];
// "ลงชื่อ" also means signing in (ลงชื่อเข้าใช้), so it counts only beside the document's own name.
const SIGN_VERB_TH = ['เซ็น', 'ลงนาม', 'ลงลายมือชื่อ'];

// Owner 2026-10-16: supported actions prepare signed cards; existing use-cases authorize the final button.
// Substitute receipt signatures and approvals still require the complete web document.
export const LINE_ACTION_RULES: readonly LineActionRule[] = [
  { noun: REIMBURSEMENT_NOUN_TH, verb: ['ส่งอนุมัติ', 'ยื่น', 'submit'], permission: 'reimbursement.submit', actionLabelTh: 'ส่งอนุมัติใบเบิก', page: 'reimbursements', imperative: true },
  { noun: REIMBURSEMENT_NOUN_TH, verb: ['ปฏิเสธ', 'ไม่อนุมัติ', 'reject'], permission: 'reimbursement.reject', actionLabelTh: 'ปฏิเสธใบเบิก', page: 'reimbursements' },
  { noun: REIMBURSEMENT_NOUN_TH, verb: ['อนุมัติ', 'approve'], permission: 'reimbursement.approve', actionLabelTh: 'อนุมัติใบเบิก', page: 'reimbursements' },
  { noun: REIMBURSEMENT_NOUN_TH, verb: ['จ่าย', 'โอนเงิน', 'ชำระเงิน', 'pay'], permission: 'reimbursement.payment.record', actionLabelTh: 'จ่ายใบเบิก', page: 'reimbursements' },
  { noun: EXPENSE_NOUN_TH, verb: ['ยืนยัน', 'confirm'], permission: 'expense.confirm', actionLabelTh: 'ยืนยันรายการค่าใช้จ่าย', page: 'expenses' },
  { noun: EXPENSE_NOUN_TH, verb: ['ยกเลิก', 'void'], permission: 'expense.void', actionLabelTh: 'ยกเลิกรายการค่าใช้จ่าย', page: 'expenses' },
  // Own-draft editing/deletion is allowed by the existing use-case; this guard must not deny staff.
  { noun: EXPENSE_NOUN_TH, verb: ['ลบ', 'delete', 'remove'], permission: 'expense.delete', permissionAnyOf: ['expense.delete', 'expense.update'], actionLabelTh: 'ลบร่างค่าใช้จ่าย', page: 'expenses' },
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
  'รออนุมัติ', 'ค้างอนุมัติ', 'รอการอนุมัติ', 'ยังไม่ได้อนุมัติ', 'ยังไม่ถูกอนุมัติ', 'อนุมัติแล้ว', 'ที่อนุมัติแล้ว', 'รอจ่าย', 'จ่ายแล้ว', 'ยังไม่จ่าย',
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
  return STATE_PHRASES_TH.reduce((withoutPhrase, phrase) => withoutPhrase.split(phrase).join(''), text)
    .replace(/ส่ง[^?？\n]*?อนุมัติ|ค่าใช้จ่าย|เบิกจ่าย/gu, '');
}

export function isApprovalSettingsRequest(text: string): boolean {
  return /ใบเบิก|เบิกจ่าย|คำขอเบิก/u.test(text)
    && (/ตั้งค่า|ตั้ง.*ให้|ให้ผู้จัดการอนุมัติ.*ได้|(?:แก้(?:ไข)?|เปลี่ยน|กำหนด|เพิ่ม|เลือก).*ผู้อนุมัติ/u.test(text)
      || /ผู้อนุมัติ|ใครอนุมัติ/u.test(text) && !/รอ(?:การ|ผู้|คุณ|ฉัน)?อนุมัติ|ค้าง|แยกตาม|อยู่ที่|ยังไม่/u.test(text));
}

export function lineActionRuleFor(text: string): LineActionRule | undefined {
  text = text.toLowerCase();
  if (isApprovalSettingsRequest(text) || includesAny(text, STATUS_QUESTION_MARKERS_TH)) return undefined;
  if (includesAny(text, REIMBURSEMENT_NOUN_TH) && /^(?:(?:ขอ|ช่วย)\s*)?(?:ส่ง(?:อนุมัติ|ใบเบิก|คำขอเบิก)|ยื่น(?:ใบเบิก|คำขอเบิก)|(?:please\s+)?submit\b)/u.test(text.trim())) return LINE_ACTION_RULES.find(rule => rule.permission === 'reimbursement.submit');
  const requested = includesAny(text, REQUEST_MARKERS_TH) || /^(?:อนุมัติ|ปฏิเสธ|ไม่อนุมัติ|ยืนยัน|ยกเลิก|ลบ|(?:please\s+)?(?:approve|reject|pay|confirm|void|delete|remove)\b)/u.test(text.trim());
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
  if ((rule.permissionAnyOf ?? [rule.permission]).some(key => permissions.includes(key))) {
    if (!substitute) return undefined;
    return language === 'en'
      ? `This action can't be completed on LINE. Please go to the ${substitute ? 'substitute receipts' : rule.page} page on the web to do it.`
      : `การ${rule.actionLabelTh}ทำผ่าน LINE ไม่ได้ค่ะ ${substitute ? 'ต้องเปิดอ่านเอกสารฉบับเต็มบนเว็บก่อนเซ็น ' : ''}ไปที่หน้า${pageLabelTh}บนเว็บได้เลยค่ะ`;
  }
  return permissionLimitReplyText(language, language === 'en' ? 'perform this action' : rule.actionLabelTh, permissions);
}

export function toolPermissionReplyText(language: ScopePolicyLanguage, permissions: readonly string[] = []): string {
  return permissionLimitReplyText(language, language === 'en' ? 'view this information' : 'ดูข้อมูลนี้', permissions);
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
  return permissionLimitReplyText(language, language === 'en' ? 'record or submit receipts' : 'บันทึกหรือส่งใบเสร็จเข้าระบบ', permissions);
}

// ---- Combined entry point ----------------------------------------------------------------------

export type ScopePolicyOverride = {
  reasonCode: 'APPROVAL_SETTINGS_WEB' | 'LINE_ACTION_NOT_SUPPORTED' | 'READONLY_ROLE_CANNOT_CREATE' | 'PACKAGE_FEATURE_NOT_ENABLED' | 'ROLE_PERMISSION_REQUIRED';
  text: string;
  /** The web page the reply sends a permitted user to, for the caller to link. */
  webPage?: 'substitute-receipts' | 'approval-settings' | 'packages' | 'expenses' | 'reimbursements';
};

export function scopePolicyStatus(override: ScopePolicyOverride): 'denied' | 'unsupported' {
  return override.reasonCode === 'ROLE_PERMISSION_REQUIRED' || override.reasonCode === 'READONLY_ROLE_CANNOT_CREATE'
    || override.reasonCode === 'LINE_ACTION_NOT_SUPPORTED' && override.webPage !== 'substitute-receipts'
    || override.reasonCode === 'APPROVAL_SETTINGS_WEB' && override.webPage !== 'approval-settings' ? 'denied' : 'unsupported';
}

/** Shared by the single-item and semantic paths so every limit has the same permitted way forward. */
export function scopePolicyWebLinks(override: ScopePolicyOverride, permissions: readonly string[], companyId: string, language: ScopePolicyLanguage): LineAiWebLink[] {
  if (!override.webPage) return [];
  const alternative = permissionAlternative(permissions, language);
  const destination = {
    'substitute-receipts': { label: language === 'en' ? 'Substitute receipts' : 'ใบรับรองแทนใบเสร็จ', path: 'expenses/substitute-receipts' },
    'approval-settings': { label: language === 'en' ? 'Approval settings' : 'ตั้งค่าการอนุมัติ', path: 'reimbursements?tab=policy' },
    packages: { label: language === 'en' ? 'Compare packages' : 'เปรียบเทียบแพ็กเกจ', path: 'billing?channel=line' },
    expenses: { label: alternative.label, path: 'expenses' },
    reimbursements: { label: alternative.label, path: 'reimbursements' },
  }[override.webPage];
  return [{ label: destination.label, path: `/companies/${companyId}/${destination.path}` }];
}

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

// Creation permissions only: editing a counterparty/draft can also be allowed to its creator.
const NAMED_WRITE_ACTIONS = [
  { id: 'counterparty', test: /เพิ่ม.*(?:คู่ค้า|ผู้ขาย|ผู้รับเงิน|ซัพพลายเออร์)|\b(?:add|create|register)\b.*\b(?:supplier|vendor|payee|counterparty)\b/iu },
  { id: 'team_member', test: /เพิ่ม.*(?:พนักงาน|ผู้ใช้|ทีมงาน)|\b(?:add|create|invite)\b.*\b(?:employee|staff|member|user)\b/iu },
  { id: 'branch', test: /(?:เพิ่ม|สร้าง|แก้ไข).*สาขา|\b(?:add|create|update|edit)\b.*\bbranch\b/iu },
] as const;

/** Definitions use the existing general-knowledge composer, never a shop document read. */
export function documentExplanationTopic(text: string): { featureKey: string; label: string } | undefined {
  text = text.trim().replace(/^(?:แล้ว|งั้น|และ|so\s+|and\s+)/iu, '').replace(/ทวิ\s*50/gu, '50 ทวิ');
  // Definitions/comparisons never require permission to the shop's records or an action button.
  const explanationRequest = /อธิบาย|\bexplain\b/iu.test(text);
  const conceptual = explanationRequest || /คือ(?:อะไร|ไร)|หมายถึง|ใช้(?:ทำอะไร|ตอนไหน)|แตกต่าง|ต่าง(?:กัน|จาก)|\bwhat\s+(?:is|are|does)\b|\bdifference\b|\bwhy\b/iu.test(text);
  const actionHowTo = /ทำ(?:ยังไง|อย่างไร)|ทำไง|how\s+(?:do|can|to)|(?:แล้ว|และ).*(?:ทำ|ออก|สร้าง|ยื่น).*ให้/iu.test(text);
  if (conceptual && !actionHowTo && !/แล้ว|มีกี่|เท่าไหร่|เดือนนี้|\b(?:our|my|this\s+month)\b/iu.test(text)
    && (explanationRequest || !/ช่วย|ให้หน่อย/iu.test(text))) {
    if (/ภ\.?\s*ง\.?\s*ด\.?\s*(?:3|53)|pnd\s*(?:3|53)/iu.test(text)) return { featureKey: 'wht_pnd53', label: 'ภ.ง.ด.3 และ ภ.ง.ด.53' };
    if (/50\s*(?:ทวิ|bis|tawi)/iu.test(text)) return { featureKey: 'wht_50bis', label: '50 ทวิ' };
    if (/หัก\s*ณ\s*ที่จ่าย|withhold|\bwht\b/iu.test(text)) return { featureKey: 'expenses', label: 'ภาษีหัก ณ ที่จ่าย' };
    if (/ใบสำคัญจ่าย|payment\s*voucher/iu.test(text)) return { featureKey: 'expenses', label: 'ใบสำคัญจ่าย' };
    if (/ใบรับรองแทนใบเสร็จ|substitute\s*receipt/iu.test(text)) return { featureKey: 'expenses', label: 'ใบรับรองแทนใบเสร็จ' };
    if (/\bVAT\b|แวท/iu.test(text)) return { featureKey: 'expenses', label: 'VAT' };
  }
  const question = /^(.*?)\s*(?:คืออะไร|หมายถึงอะไร)(?:\s*(?:นะ)?(?:คะ|ค่ะ|ครับ))?[?？]*$|^ทำไมต้อง(?:ทำ|ออก|ยื่น)\s*(.*?)(?:\s*(?:นะ)?(?:คะ|ค่ะ|ครับ))?[?？]*$/iu.exec(text.trim());
  const subject = (question?.[1] ?? question?.[2])?.trim();
  if (!subject) return undefined;
  if (/^(?:50\s*ทวิ|50\s*bis)$/iu.test(subject)) return { featureKey: 'wht_50bis', label: '50 ทวิ' };
  if (/^(?:ภ\.?\s*ง\.?\s*ด\.?\s*53|pnd\s*53)$/iu.test(subject)) return { featureKey: 'wht_pnd53', label: 'ภงด.53' };
  if (/^(?:ภ\.?\s*ง\.?\s*ด\.?\s*3|pnd\s*3)$/iu.test(subject)) return { featureKey: 'wht_pnd53', label: 'ภ.ง.ด.3' };
  if (subject === 'ใบสำคัญจ่าย') return { featureKey: 'expenses', label: 'ใบสำคัญจ่าย' };
  return undefined;
}

export function scopePolicyOverride(
  text: string,
  kind: LineAiSemanticSubrequestV2['kind'],
  permissions: readonly string[],
  entitledFeatureKeys: readonly string[] | null | undefined,
  language: ScopePolicyLanguage,
  toolHint?: string,
  offers?: readonly BillingOffer[],
): ScopePolicyOverride | undefined {
  if (isApprovalSettingsRequest(text)) return { reasonCode: 'APPROVAL_SETTINGS_WEB',
    text: permissions.includes('reimbursement.policy.manage')
      ? language === 'en' ? 'Open approval settings to choose who can approve claims.' : 'เลือกผู้อนุมัติใบเบิกได้ที่ตั้งค่าการอนุมัติค่ะ'
      : permissionLimitReplyText(language, language === 'en' ? 'change claim approval settings' : 'ตั้งผู้อนุมัติใบเบิก', permissions),
    webPage: permissions.includes('reimbursement.policy.manage') ? 'approval-settings' : permissionAlternative(permissions, language).page };
  const lineAction = lineActionBoundaryReplyText(text, permissions, language);
  if (lineAction) {
    const rule = lineActionRuleFor(text);
    return { reasonCode: 'LINE_ACTION_NOT_SUPPORTED', text: lineAction,
      webPage: rule?.page === 'substitute-receipts' && permissions.includes(rule.permission) ? rule.page : permissionAlternative(permissions, language).page };
  }
  const readOnly = readOnlyCaptureReplyText(text, permissions, language);
  if (readOnly) return { reasonCode: 'READONLY_ROLE_CANNOT_CREATE', text: readOnly, webPage: permissionAlternative(permissions, language).page };
  const writeAction = kind === 'write' ? LINE_CHAT_ACTIONS.find(action => NAMED_WRITE_ACTIONS.some(rule => rule.id === action.id && rule.test.test(text))) : undefined;
  if (writeAction && !permissions.includes(writeAction.permission)) return {
    reasonCode: 'ROLE_PERMISSION_REQUIRED', text: permissionLimitReplyText(language, language === 'en' ? 'perform this action' : writeAction.title, permissions),
    webPage: permissionAlternative(permissions, language).page,
  };
  const productAvailability = /^(?:(?:ระบบนี้|มั่งมี|Mangmee\s*Plus)\s*)?(?:ทำ|มี|ใช้|ดู|รองรับ).*(?:ได้|ไหม|มั้ย|ป่าว|เปล่า)\s*(?:คะ|ค่ะ|ครับ)?[?？]*$|\bcan\s+(?:you|we|this)\s+(?:do|use|create|issue|run|check|track|manage)\b|\bdoes\s+.*support/iu.test(text)
    && !/คืออะไร|หมายถึง|ต่างกัน|อธิบาย|\bexplain\b|\bwhat\s+(?:is|are)\b|\bdifference\b/iu.test(text);
  if (kind === 'general' && !productAvailability || kind !== 'write' && documentExplanationTopic(text)) return undefined;
  const whtKeys = /50\s*ทวิ|50\s*bis/iu.test(text) ? ['wht_50bis']
    : /ภ\.?\s*ง\.?\s*ด\.?\s*(?:53|3|สาม)|pnd\s*(?:53|3)/iu.test(text) ? ['wht_pnd53']
      : /หัก\s*ณ\s*ที่จ่าย|withholding|\bwht\b/iu.test(text) || toolHint?.startsWith('wht.') ? ['wht_50bis', 'wht_pnd53'] : undefined;
  if (whtKeys && !whtKeys.some(key => moduleFeatureEnabled(key, entitledFeatureKeys))) return {
    reasonCode: 'PACKAGE_FEATURE_NOT_ENABLED', text: featureLimitReplyText(whtKeys[0]!, language, undefined, offers, entitledFeatureKeys, permissions), webPage: 'packages',
  };
  const packageQuestion = toolHint !== undefined && PACKAGE_TOOL_HINTS.has(toolHint) && PACKAGE_WORD.test(text);
  if (!packageQuestion && !whtKeys) {
    const topic = unsoldModuleTopicFor(text);
    if (topic && !moduleFeatureEnabled(topic.featureKey, entitledFeatureKeys)) {
      return { reasonCode: 'PACKAGE_FEATURE_NOT_ENABLED', text: unsoldModuleReplyText(topic, language, offers),
        webPage: topic.featureKey && featurePackageOffer(topic.featureKey, offers) ? 'packages' : permissionAlternative(permissions, language).page };
    }
  }
  const tool = LINE_TOOL_REGISTRY.find(tool => tool.name === toolHint);
  if (kind === 'read' && tool && tool.name !== 'billing.get_package_catalog' && !hasToolPermissions(tool, permissions)) return {
    reasonCode: 'ROLE_PERMISSION_REQUIRED', text: toolPermissionReplyText(language, permissions), webPage: permissionAlternative(permissions, language).page,
  };
  return undefined;
}

/** Definitions and product offers are one fact-derived answer, never a model's unsolicited promise. */
export function documentExplanationReply(text: string, features: readonly string[] | null | undefined,
  permissions: readonly string[], language: ScopePolicyLanguage, offers?: readonly BillingOffer[]): string | undefined {
  const topic = documentExplanationTopic(text);
  if (!topic) return undefined;
  const en = language === 'en';
  const definition = topic.featureKey === 'wht_50bis'
    ? en ? 'A withholding certificate records the amount paid and tax withheld for the recipient.' : 'หนังสือรับรอง 50 ทวิบอกยอดที่จ่ายและภาษีที่หักไว้ให้ผู้รับเงินค่ะ'
    : topic.featureKey === 'wht_pnd53'
      ? en ? 'PND3 reports withholding for individuals and PND53 for legal entities.' : 'ภ.ง.ด.3 ใช้นำส่งภาษีที่หักจากบุคคลธรรมดา ส่วน ภ.ง.ด.53 ใช้กับนิติบุคคลค่ะ'
      : topic.label === 'ใบสำคัญจ่าย'
        ? en ? 'A payment voucher records an actual payment; a prepared voucher is still awaiting payment.' : 'ใบสำคัญจ่ายเป็นหลักฐานหลังบันทึกว่าจ่ายเงินจริง ส่วนใบเตรียมจ่ายยังไม่ได้จ่ายค่ะ'
        : topic.label === 'VAT' ? en ? 'VAT is value added tax; a receipt showing VAT is not by itself proof that it can be claimed.' : 'VAT คือภาษีมูลค่าเพิ่ม ยอดบนเอกสารยังไม่ได้แปลว่าใช้ตอนยื่นภาษีได้ค่ะ'
        : topic.label === 'ภาษีหัก ณ ที่จ่าย' ? en ? 'Withholding tax is deducted by the payer and remitted on the recipient’s behalf.' : 'ภาษีหัก ณ ที่จ่ายคือภาษีที่ผู้จ่ายหักไว้เพื่อนำส่งกรมสรรพากรแทนผู้รับเงินค่ะ'
          : en ? 'A substitute receipt supports a real business expense when the recipient cannot provide a complete receipt.' : 'ใบรับรองแทนใบเสร็จใช้ประกอบรายจ่ายจริงของร้านเมื่อผู้รับเงินออกใบเสร็จที่ครบถ้วนให้ไม่ได้ค่ะ';
  const actionId = topic.featureKey === 'wht_50bis' ? 'wht_certificate' : topic.featureKey === 'wht_pnd53' ? 'pnd53' : topic.label === 'ใบสำคัญจ่าย' ? 'payment_voucher' : undefined;
  const action = LINE_CHAT_ACTIONS.find(row => row.id === actionId);
  if (!moduleFeatureEnabled(topic.featureKey, features)) {
    return `${definition} ${featureLimitReplyText(topic.featureKey, language, topic.label, offers, features, permissions)}`;
  }
  if (!action || !canUseLineChatAction(action.id, permissions, features == null ? null : new Set(features))) return definition;
  return `${definition} ${en ? 'Use the action button to check the details before confirming.' : action.sentence}`;
}

/** Billing amendment 2026-09-13 and the package page: count exhaustion differs from term expiry. */
export function packageLifecycleReply(text: string, language: ScopePolicyLanguage): string | undefined {
  const quota = /(?:โควตา|จำนวนใบ|quota|receipt\s*reads?).*(?:หมด|ครบ|เต็ม|used\s*up|exhaust|run\s*out)|(?:ใช้|อ่าน|สแกน).*ใบเสร็จ.*(?:หมด|ครบ)|(?:หมด|ครบ).*(?:โควตา|จำนวนใบ)|(?:used\s*up|exhaust).*receipts?/iu.test(text);
  const period = /(?:หมด|สิ้นสุด).*แพ[็ก๊ค]+เกจ|แพ[็ก๊ค]+เกจ.*(?:หมด|สิ้นสุด)|หมดอายุ|(?:package|plan|subscription).*(?:expire|end|run\s*out)/iu.test(text);
  if (!quota && !period) return undefined;
  if (quota) return language === 'en'
    ? 'When receipt reads run out, AI stops reading new receipts; while your package is active, authorized staff can enter expenses manually on the web and the owner can buy a full package to add reads.'
    : 'เมื่อใช้จำนวนใบเสร็จครบ AI จะหยุดอ่านใบใหม่ แต่ถ้าแพ็กเกจยังไม่หมดอายุ ผู้มีสิทธิ์กรอกรายจ่ายเองบนเว็บได้ และเจ้าของกิจการซื้อแพ็กเกจเต็มเพิ่มได้ค่ะ';
  return language === 'en'
    ? 'When the paid period and any applicable renewal grace end, shop access is paused until renewal; your records are kept and the owner can open Packages to renew.'
    : 'เมื่อหมดอายุแพ็กเกจและพ้นระยะผ่อนผันต่ออายุที่ใช้ได้ ร้านจะถูกพักใช้งานจนกว่าจะต่ออายุ โดยข้อมูลเดิมยังอยู่ค่ะ เจ้าของกิจการเปิดหน้าแพ็กเกจเพื่อต่ออายุได้ค่ะ';
}
