/**
 * Pure domain logic for AI Gateway LINE turn orchestration.
 * No NestJS, HTTP, database, or LINE SDK imports.
 */
import type { LineAiIntent, LineAiAgent, LineAiRefusalReason, LineAiTurnRequest } from '@watchdog-bms/contracts';
import { LINE_TOOL_REGISTRY, LINE_ALLOWED_TOOL_CATEGORIES } from '@watchdog-bms/contracts';
import type { ToolMeta } from '@watchdog-bms/contracts';

// Mutation keywords (Thai + English)
const MUTATION_KW_TH = ['สั่งซื้อ', 'สั่งขาย', 'ชำระ', 'โอนเงิน', 'จ่ายเงิน', 'ลบ', 'แก้ไข', 'เพิ่ม', 'อัปเดต', 'ตัดสต็อก', 'รับสินค้า', 'อนุมัติ', 'ปฏิเสธ', 'ยกเลิก', 'บันทึก', 'ส่งออก', 'นำเข้า'];
const MUTATION_KW_EN = ['create', 'add', 'delete', 'remove', 'update', 'edit', 'approve', 'reject', 'cancel', 'post', 'transfer', 'pay', 'purchase', 'sell', 'order', 'export', 'import'];

// Tax contexts such as import/export are nouns in read questions, not mutations.
// Handle them before the broad item-07 mutation keywords, while keeping actual
// tax filing/configuration/payment verbs fail-closed.
const TAX_KW = [
  'ภาษี', 'แวต', 'ภ.พ.30', 'ภ.พ.36', 'ภพ30', 'ภพ36', 'สรรพากร', 'ศุลกากร', 'สรรพสามิต',
  'tax code', 'tax profile', 'vat', 'pp30', 'pp36', 'import tax', 'import vat', 'export tax',
  'zero-rated', 'non-taxable', 'o0', 'o1', 'o7', 'ox',
];
const TAX_MUTATION_KW = [
  'ยื่นภาษี', 'ยื่นแบบ', 'ชำระภาษี', 'จ่ายภาษี', 'แก้ไข tax code', 'เพิ่ม tax code',
  'อัปเดต tax code', 'เปิดใช้ tax code', 'เปิดใช้งาน tax code', 'นำเข้า tax code',
  'คำนวณภาษีใหม่', 'ส่งออกรายงานภาษี', 'file tax', 'pay tax', 'create tax code',
  'update tax code', 'edit tax code', 'approve tax code', 'activate tax code',
  'import tax code', 'recompute tax', 'export tax report',
];
const TAX_CODE_KW = ['tax code', 'tax profile', 'sap', 'o0', 'o1', 'o7', 'ox'];
const TAX_TRANSACTION_KW = [
  'ซื้อ', 'ขาย', 'นำเข้าสินค้า', 'นำเข้าบริการ', 'ส่งออกสินค้า', 'ส่งออกบริการ', 'ภ.พ.36', 'ภพ36',
  'pp36', 'import tax', 'import vat', 'export tax', 'zero-rated', 'ยกเว้น', 'non-taxable',
  'ศุลกากร', 'สรรพสามิต', 'ใบลดหนี้', 'ใบเพิ่มหนี้',
];
const TAX_RECONCILIATION_KW = ['กระทบยอด', 'reconciliation', 'tax event', 'g/l', 'gl', 'บัญชีแยกประเภท'];

// Unsupported module keywords
const UNSUPPORTED_KW_TH = ['บัญชี', 'เงินเดือน', 'เจ้าหนี้', 'ลูกหนี้', 'ธนาคาร', 'งบดุล', 'กำไรขาดทุน'];
const UNSUPPORTED_KW_EN = ['payroll', 'crm', 'bank reconciliation'];
const LEDGER_KW = ['accounting', 'ledger', 'trial balance', 'balance sheet', 'profit and loss', 'p&l', 'financial'];

const INV_KW = ['สินค้า', 'สต็อก', 'คลัง', 'product', 'stock', 'inventory', 'warehouse', 'low stock', 'movement', 'balance'];
const NOTIF_KW = ['แจ้งเตือน', 'การแจ้งเตือน', 'สรุปประจำวัน', 'alert', 'notification', 'daily summary'];

function matchAny(text: string, kws: string[]): boolean {
  return kws.some((k) => text.includes(k));
}

export function classifyIntent(text: string, hasAttachment = false): LineAiIntent {
  if (hasAttachment) return 'capture_accounting_evidence';
  if (matchAny(text, TAX_KW)) {
    return matchAny(text, TAX_MUTATION_KW) ? 'mutation_request' : 'read_summary';
  }
  if (matchAny(text, [...MUTATION_KW_TH, ...MUTATION_KW_EN])) return 'mutation_request';
  if (matchAny(text, LEDGER_KW)) return 'read_summary';
  if (matchAny(text, [...UNSUPPORTED_KW_TH, ...UNSUPPORTED_KW_EN])) return 'unsupported_module';
  if (matchAny(text, INV_KW)) return 'read_detail';
  if (matchAny(text, NOTIF_KW)) return 'read_summary';
  return 'read_summary';
}

export function chooseAgent(intent: LineAiIntent, text: string): LineAiAgent {
  if (intent === 'mutation_request' || intent === 'unsupported_module') return 'general';
  if (matchAny(text, TAX_KW)) return 'tax';
  if (matchAny(text, LEDGER_KW)) return 'cfo';
  if (matchAny(text, INV_KW)) return 'inventory';
  if (matchAny(text, NOTIF_KW)) return 'notifications';
  return 'general';
}

/** Returns tools available for a given agent and context. Permission check is done in ERP core. */
export function selectTools(agent: LineAiAgent, intent: LineAiIntent, text = ''): ToolMeta[] {
  if (intent === 'mutation_request' || intent === 'unsupported_module' || intent === 'forbidden') {
    return [];
  }
  const tools = LINE_TOOL_REGISTRY.filter(
    (t) => t.executionReady !== false && t.supportedAgents.includes(agent) && LINE_ALLOWED_TOOL_CATEGORIES.includes(t.category),
  );
  const priority = [
    ...(agent === 'tax' && matchAny(text, TAX_CODE_KW) ? ['tax.get_tax_code_profile'] : []),
    ...(agent === 'tax' && matchAny(text, TAX_RECONCILIATION_KW) ? ['tax.get_reconciliation_summary'] : []),
    ...(agent === 'tax' && matchAny(text, TAX_TRANSACTION_KW) ? ['tax.get_transaction_tax_summary'] : []),
    ...(agent === 'tax' && matchAny(text, ['vat', 'แวต', 'ภ.พ.30', 'ภพ30', 'pp30']) ? ['tax.get_vat_summary'] : []),
    ...(agent === 'tax' && matchAny(text, ['เอกสาร', 'หลักฐาน', 'ขาด', 'missing']) ? ['tax.list_missing_tax_documents'] : []),
    ...(agent === 'tax' && matchAny(text, ['หัก ณ ที่จ่าย', 'wht', 'pnd']) ? ['tax.get_wht_summary'] : []),
    ...(agent === 'tax' && matchAny(text, ['cit', 'ภาษีเงินได้นิติบุคคล']) ? ['tax.get_cit_calendar'] : []),
    ...(matchAny(text, ['สาขา', 'branch']) ? ['company.list_branches'] : []),
    ...(matchAny(text, ['สต็อกต่ำ', 'low stock']) ? ['inventory.list_low_stock'] : []),
    ...(matchAny(text, ['เคลื่อนไหว', 'movement']) ? ['inventory.summarize_stock_movements'] : []),
    ...(matchAny(text, ['คงเหลือ', 'balance']) ? ['inventory.get_stock_balance'] : []),
    ...(matchAny(text, ['แจ้งเตือน', 'alert', 'notification']) ? ['notifications.list_open_alerts'] : []),
    ...(matchAny(text, ['สรุปประจำวัน', 'daily summary']) ? ['notifications.get_daily_summary'] : []),
    'dashboard.get_business_health_summary',
    'company.get_current_context',
  ];
  return [...tools].sort((a, b) => {
    const ai = priority.indexOf(a.name);
    const bi = priority.indexOf(b.name);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

/** Returns refusal reason for refused intents. */
export function getRefusalReason(intent: LineAiIntent): LineAiRefusalReason | undefined {
  if (intent === 'mutation_request') return 'mutation_blocked';
  if (intent === 'unsupported_module') return 'unsupported_module';
  if (intent === 'forbidden') return 'forbidden';
  return undefined;
}

/** Validate that incoming turn request fields are present (server-derived ctx only). */
export function validateTurnRequest(req: LineAiTurnRequest): string | null {
  if (!req.requestId) return 'Missing requestId';
  if (!req.userContext?.internalUserId) return 'Missing internalUserId in userContext';
  if (!req.userContext?.companyId) return 'Missing companyId in userContext';
  if (!req.messageText) return 'Missing messageText';
  return null;
}
