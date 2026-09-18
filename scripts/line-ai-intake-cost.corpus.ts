/**
 * FROZEN cost corpus for the LINE intake-cost benchmark (remediation spec §10.1, plan D1/C).
 *
 * Data only: no provider, database, LINE, permission or runtime import belongs here, exactly like
 * `line-ai-latency-autonomy.corpus.ts` next to it. `line-ai-intake-cost-benchmark.ts` drives these
 * rows through the REAL gateway code paths; `line-ai-intake-cost.corpus.spec.ts` checks the
 * manifest's integrity and pins its content hash so a baseline and an after-run can never be
 * compared across two different corpora.
 *
 * Everything here is SYNTHETIC. Shop names, people, amounts, ids and dates are invented; no tax id
 * in this file passes the Thai 13-digit checksum, no LINE user id shape appears, and no phone
 * number is real (the spec asserts all three).
 *
 * Images are NOT committed as binaries: each image row carries a deterministic `image` spec that
 * the harness renders (SVG → JPEG/PNG through the already-installed `sharp`) and whose sha256 it
 * records per run.
 */

import { createHash } from 'node:crypto';

/** Pinned "today" for deterministic value candidates and receipt dates. Freezing it keeps the
 *  payload bytes (and therefore the cache prefix) identical between the baseline and any later run. */
export const INTAKE_COST_CORPUS_TODAY_ISO = '2026-09-17';

/**
 * Corpus version. v2 (2026-09-18) APPENDS the period task set of the period-resolution spec (P-06);
 * every v1 task is byte-identical, so an R5 baseline still compares task-by-task against a v2 run —
 * only the manifest hash changes, and the spec pins the new one.
 */
export const INTAKE_COST_CORPUS_VERSION = 2;

/** Coverage buckets spec §10.1 requires the corpus to contain. The spec file asserts each one is present. */
export const INTAKE_COST_COVERAGE = [
  'greeting',
  'casual',
  'business_read',
  'business_read_period',
  'capture_text',
  'capture_incomplete',
  'correction',
  'clarification_answer',
  'expired_context',
  'denied_capability',
  'mutation_refusal',
  'capability_help',
  'draft_continuation',
  'out_of_scope',
  'receipt_short',
  'receipt_long',
  'receipt_vat',
  'receipt_hard_to_read',
  'receipt_handwritten',
  'non_receipt_image',
  'reference_document',
] as const;
export type IntakeCostCoverage = (typeof INTAKE_COST_COVERAGE)[number];

/** Every intake route the parser can return. Mirrors the contract union; kept local so this file
 *  stays import-free of runtime modules. The spec cross-checks it against the contract. */
export type IntakeCostExpectedIntent =
  | 'EXPENSE_DOCUMENT_CAPTURE'
  | 'EXPENSE_DRAFT_CONTINUATION'
  | 'EXPENSE_CAPTURE_CORRECTION'
  | 'BUSINESS_DOCUMENT_REFERENCE'
  | 'SIGNATURE_UPLOAD_TICKET'
  | 'BUSINESS_READ_QUESTION'
  | 'ADVISOR_CONVERSATION'
  | 'MUTATION_REQUEST_REFUSAL'
  | 'CLARIFY'
  | 'UNSUPPORTED';

/** The deterministic API-side gate a route meets after intake. `query` is `line.ai.query`
 *  (process-line-webhook `canQuery`), `capture` is RECEIPT_CAPTURE_PERMISSIONS, `none` is a route
 *  answered without either gate (e.g. a clarify question). */
export type IntakeCostPermissionGate = 'query' | 'capture' | 'none';

export const RECEIPT_CAPTURE_PERMISSION_KEYS = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create'] as const;
export const QUERY_PERMISSION_KEY = 'line.ai.query';

/** A rendered synthetic page. `lines` is laid out top-down at a fixed step; the harness turns this
 *  into SVG and rasterises it. No field here depends on the machine's locale or clock. */
export type IntakeCostImageSpec = {
  format: 'jpeg' | 'png';
  widthPx: number;
  heightPx: number;
  background: string;
  /** Page rotation in degrees, for the deliberately hard-to-read slip. */
  rotateDeg?: number;
  /** JPEG quality; lower values make the hard-to-read slip genuinely noisy. */
  quality?: number;
  /** Extra blur radius in px, for the low-contrast slip. */
  blurSigma?: number;
  /** Ink strokes (signature) or plain shapes (product photo) drawn before the text. */
  shapes?: Array<
    | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string }
    | { kind: 'circle'; cx: number; cy: number; r: number; fill: string }
    | { kind: 'stroke'; d: string; color: string; width: number }
  >;
  lines: Array<{
    text: string;
    /** Points from the top of the page. Ascending, so the harness never has to sort. */
    y: number;
    x?: number;
    size?: number;
    family?: string;
    color?: string;
    weight?: 'normal' | 'bold';
    align?: 'left' | 'right' | 'center';
  }>;
};

/** Expected structured receipt reading. `vendorNameContains` is a case-insensitive substring so a
 *  transcription that keeps the legal prefix still counts; amounts are compared as exact decimals
 *  after comma-stripping, dates as exact ISO strings. */
export type IntakeCostReceiptExpectation = {
  grandTotalAmount: string;
  /** Only set when the page PRINTS a VAT amount; otherwise the reading must not invent one. */
  vatAmount?: string;
  expenseDate: string;
  vendorNameContains: string;
};

export type IntakeCostTask = {
  id: string;
  kind: 'text' | 'image';
  coverage: IntakeCostCoverage;
  /** LINE message text (the caption, for an image row). */
  messageText: string;
  /** Server-derived permission keys the API would send for this synthetic user. */
  permissions: string[];
  activeCategories?: Array<{ id: string; name: string }>;
  conversationContext?: {
    windowMinutes: number;
    maxTurns: number;
    lastTurnAt?: string;
    recentTurns: Array<{ at: string; userMessagePreview?: string; assistantReplyPreview?: string; intent?: string; agent?: string; refused?: boolean }>;
  };
  openClarifications?: Array<{
    id: string;
    question: string;
    text: string;
    subject?: string;
    askedAt: string;
    clarifyForIntent?: IntakeCostExpectedIntent;
    candidateExpenseIds?: string[];
  }>;
  recentCapturedExpenses?: Array<{ id: string; label: string; amount?: string; expenseDate?: string; sourceDocumentType?: string; createdAt: string }>;
  activeExpenseDrafts?: Array<{
    expenseId: string;
    label: string;
    status: 'OPEN' | 'PAUSED' | 'PAUSED_INTERRUPTED' | 'INPUT_ENDED_COMPLETE' | 'INPUT_ENDED_INCOMPLETE';
    questions: Array<{ id: string; prompt: string; itemRef?: string }>;
  }>;
  image?: IntakeCostImageSpec;
  expect: {
    /** Allowed routes. More than one is allowed ONLY when the contract genuinely permits both;
     *  `alternativesWhy` then has to say which contract sentence allows it. */
    intents: IntakeCostExpectedIntent[];
    alternativesWhy?: string;
    /** Which deterministic gate this route meets afterwards, and whether this user passes it. */
    permissionGate: IntakeCostPermissionGate;
    permissionOutcome: 'allowed' | 'denied';
    /** True when routing this message to ANY expense-writing route would be wrong (spec §10.1
     *  "a bare number after the context expired must NOT capture"). */
    forbidCapture?: boolean;
    /** The ids from `openClarifications` this message must be judged to answer. */
    resolvesClarificationIds?: string[];
    /** Image rows that must hand a page transcription back for OCR reuse. */
    requiresDocumentText?: boolean;
    receipt?: IntakeCostReceiptExpectation;
  };
};

const CATEGORIES = [
  { id: 'cat-food-01', name: 'ค่าอาหารและเครื่องดื่ม' },
  { id: 'cat-fuel-02', name: 'ค่าน้ำมันและเดินทาง' },
  { id: 'cat-office-03', name: 'ค่าอุปกรณ์สำนักงาน' },
  { id: 'cat-util-04', name: 'ค่าสาธารณูปโภค' },
  { id: 'cat-market-05', name: 'ค่าการตลาด' },
] as const;

/**
 * The owner-shaped permission set: `line.ai.query` + the LINE capture keys + every key the enabled
 * router tools declare (derived once from `LINE_TOOL_REGISTRY.requiredPermissions` /
 * `anyOfPermissions[0]` over `ROUTER_ENABLED_TOOLS`, then written out here so the manifest stays
 * data-only and frozen). Anything short of this silently disables the prepared simple-read lane —
 * which is a COST lane — and would make the baseline measure a path production does not take.
 */
const FULL_PERMISSIONS = [
  'line.ai.query',
  // Paired with `line.ai.query` in the capability pack. The API's gateway client mints the
  // single-use actor delegations ONLY for a caller that holds it, and without those delegations the
  // prepared simple-read lane refuses every turn.
  'ai.tool.invoke',
  'expense.create',
  'expense.receipt.upload',
  'expense.receipt.line_upload',
  'access.employee.read',
  'accounting.document.read',
  'company.branch.read',
  'company.setup.read',
  'crm.booking.read',
  'crm.customer.read',
  'crm.follow_up.read',
  'crm.inbox.read',
  'crm.opportunity.read',
  'crm.report.read',
  'dashboard.read',
  'expense.read',
  'expense.update',
  'inventory.movement.read',
  'inventory.product.read',
  'inventory.report.read',
  'ledger.journal.read',
  'ledger.period.read',
  'ledger.report.read',
  'notification.read',
  'procurement.ap.report',
  'procurement.purchase_order.read',
  'procurement.supplier.read',
  'reimbursement.approve',
  'reimbursement.read',
  'report.catalog.read',
  'report.dataset.read',
  'report.query.run',
  'tax.config.read',
  'tax.event.read',
  'tax.period.read',
  'tax.profile.read',
  'tax.report.read',
  'tax.review_issue.read',
  'workflow.rule.read',
  'workflow.run.read',
  'workflow.task.read',
] as const;

/** A staff member who may chat but may not create expenses. */
const READ_ONLY_PERMISSIONS = ['line.ai.query', 'ai.tool.invoke', 'expense.read', 'dashboard.read', 'crm.customer.read'] as const;
/** A capture-only user with no chat/read entitlement at all. */
const NO_QUERY_PERMISSIONS = ['expense.create', 'expense.receipt.line_upload'] as const;

const ctx = (turns: Array<{ at: string; user?: string; bot?: string; intent?: string }>) => ({
  windowMinutes: 15,
  maxTurns: 15,
  lastTurnAt: turns[turns.length - 1]!.at,
  recentTurns: turns.map((t) => ({
    at: t.at,
    ...(t.user ? { userMessagePreview: t.user } : {}),
    ...(t.bot ? { assistantReplyPreview: t.bot } : {}),
    ...(t.intent ? { intent: t.intent, agent: 'general' } : {}),
  })),
});

const THERMAL = 'Helvetica';
const THAI = 'Thonburi';
const HANDWRITING = 'Bradley Hand';

/** Receipt page: a 22-line grocery slip. Built here so the row stays readable. */
const LONG_RECEIPT_LINES: IntakeCostImageSpec['lines'] = [
  { text: 'ร้านมั่งมีมาร์ท สาขาทดสอบ', y: 44, x: 200, size: 22, family: THAI, weight: 'bold', align: 'center' },
  { text: 'เลขประจำตัวผู้เสียภาษี 1111111111111', y: 70, x: 200, size: 13, family: THAI, align: 'center' },
  { text: 'ใบเสร็จรับเงิน / RECEIPT', y: 94, x: 200, size: 15, family: THAI, align: 'center' },
  { text: 'เลขที่ INV-2026-000188   วันที่ 15/09/2026', y: 118, x: 200, size: 13, family: THAI, align: 'center' },
  { text: '--------------------------------------------', y: 138, x: 20, size: 13, family: THERMAL },
];
const LONG_RECEIPT_ITEMS: Array<[string, string, string]> = [
  ['ข้าวสารหอมมะลิ 5 กก.', '2', '390.00'],
  ['น้ำมันพืช 1 ลิตร', '3', '165.00'],
  ['น้ำตาลทราย 1 กก.', '4', '112.00'],
  ['ไข่ไก่ เบอร์ 2 แผง', '2', '196.00'],
  ['นมสด 1 ลิตร', '6', '342.00'],
  ['กาแฟสำเร็จรูป ถุง', '2', '258.00'],
  ['ผงซักฟอก 900 ก.', '2', '178.00'],
  ['น้ำยาล้างจาน 500 มล.', '3', '147.00'],
  ['กระดาษทิชชู 6 ม้วน', '2', '158.00'],
  ['ถุงขยะ 30x40 แพ็ค', '4', '176.00'],
  ['ซอสหอยนางรม ขวด', '2', '118.00'],
  ['น้ำปลา 700 มล.', '2', '96.00'],
  ['พริกแกงเผ็ด ถุง', '5', '125.00'],
  ['เส้นหมี่ ห่อ', '4', '116.00'],
  ['ปลากระป๋อง กระป๋อง', '8', '184.00'],
  ['น้ำดื่ม 1.5 ลิตร แพ็ค', '3', '156.00'],
  ['ถ่านไฟฉาย AA แพ็ค', '2', '118.00'],
  ['ไม้กวาดดอกหญ้า ด้าม', '1', '89.00'],
  ['ผ้าเช็ดโต๊ะ ผืน', '4', '96.00'],
  ['ช้อนพลาสติก แพ็ค', '3', '87.00'],
  ['หลอดดูด แพ็ค', '2', '48.00'],
  ['กล่องข้าวกระดาษ แพ็ค', '2', '132.00'],
];

const longReceiptSpec = (): IntakeCostImageSpec => {
  const lines: IntakeCostImageSpec['lines'] = [...LONG_RECEIPT_LINES];
  let y = 160;
  for (const [name, qty, amount] of LONG_RECEIPT_ITEMS) {
    lines.push({ text: `${name}`, y, x: 20, size: 13, family: THAI });
    lines.push({ text: `x${qty}`, y, x: 250, size: 13, family: THERMAL });
    lines.push({ text: amount, y, x: 380, size: 13, family: THERMAL, align: 'right' });
    y += 22;
  }
  lines.push({ text: '--------------------------------------------', y: y + 6, x: 20, size: 13, family: THERMAL });
  lines.push({ text: 'รวมจำนวน 22 รายการ', y: y + 30, x: 20, size: 14, family: THAI });
  lines.push({ text: 'ยอดรวมทั้งสิ้น', y: y + 56, x: 20, size: 17, family: THAI, weight: 'bold' });
  lines.push({ text: '3,587.00', y: y + 56, x: 380, size: 17, family: THERMAL, weight: 'bold', align: 'right' });
  lines.push({ text: 'เงินสด 3,600.00   เงินทอน 13.00', y: y + 82, x: 20, size: 13, family: THAI });
  lines.push({ text: 'ขอบคุณที่ใช้บริการค่ะ', y: y + 108, x: 200, size: 13, family: THAI, align: 'center' });
  return { format: 'jpeg', widthPx: 400, heightPx: y + 130, background: '#ffffff', quality: 88, lines };
};

export const LINE_AI_INTAKE_COST_CORPUS: readonly IntakeCostTask[] = [
  // ── greeting / casual ───────────────────────────────────────────────────────
  {
    id: 'text-greeting-th', kind: 'text', coverage: 'greeting',
    messageText: 'สวัสดีค่ะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['ADVISOR_CONVERSATION', 'UNSUPPORTED'],
      alternativesWhy: 'Advisor is on in production, so a bare greeting is ADVISOR_CONVERSATION; the prompt also keeps UNSUPPORTED for small talk and the API answers both the same way.',
      permissionGate: 'query', permissionOutcome: 'allowed',
    },
  },
  {
    id: 'text-greeting-en', kind: 'text', coverage: 'greeting',
    messageText: 'hello there', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['ADVISOR_CONVERSATION', 'UNSUPPORTED'],
      alternativesWhy: 'Same as the Thai greeting: small talk is allowed on either route.',
      permissionGate: 'query', permissionOutcome: 'allowed',
    },
  },
  {
    id: 'text-casual-thanks', kind: 'text', coverage: 'casual',
    messageText: 'ขอบคุณมากนะคะ น้องมั่งมีน่ารักมาก', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['ADVISOR_CONVERSATION', 'UNSUPPORTED'],
      alternativesWhy: 'Thanks/banter is the ADVISOR_CONVERSATION route when advisor is on, UNSUPPORTED otherwise.',
      permissionGate: 'query', permissionOutcome: 'allowed',
    },
  },
  {
    id: 'text-casual-feeling', kind: 'text', coverage: 'casual',
    messageText: 'วันนี้เหนื่อยจังเลยค่ะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['ADVISOR_CONVERSATION', 'UNSUPPORTED'],
      alternativesWhy: 'Feelings with no business clause are social talk on either route.',
      permissionGate: 'query', permissionOutcome: 'allowed',
    },
  },
  {
    id: 'text-casual-joke', kind: 'text', coverage: 'casual',
    messageText: 'ขอมุขตลกหน่อยค่ะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['ADVISOR_CONVERSATION', 'UNSUPPORTED'],
      alternativesWhy: 'A joke ask is social; the composer owns the joke bank, so either route reaches it (the orchestrator rescues the UNSUPPORTED shape).',
      permissionGate: 'query', permissionOutcome: 'allowed',
    },
  },

  // ── business reads ──────────────────────────────────────────────────────────
  {
    id: 'text-read-sales-month', kind: 'text', coverage: 'business_read',
    messageText: 'เดือนนี้ขายได้เท่าไหร่คะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-read-expense-total', kind: 'text', coverage: 'business_read',
    messageText: 'เดือนนี้ใช้เงินไปเท่าไหร่แล้ว', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-read-expense-breakdown', kind: 'text', coverage: 'business_read',
    messageText: 'ขอสรุปค่าใช้จ่ายเดือนนี้แยกตามหมวดหน่อยค่ะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-read-tax-vat', kind: 'text', coverage: 'business_read',
    messageText: 'ภาษีมูลค่าเพิ่มเดือนที่แล้วต้องยื่นเท่าไหร่', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-read-inventory-low', kind: 'text', coverage: 'business_read',
    messageText: 'สินค้าอะไรใกล้หมดบ้างคะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-read-daily-closing', kind: 'text', coverage: 'business_read',
    messageText: 'วันนี้ปิดร้านต้องเช็คอะไรบ้าง ยังค้างจ่ายอะไรไหม', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-read-glossary-shorthand', kind: 'text', coverage: 'business_read',
    messageText: 'คชจ. เดือนนี้เท่าไหร่', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-read-ap-outstanding', kind: 'text', coverage: 'business_read',
    messageText: 'ยอดค้างจ่ายซัพพลายเออร์ตอนนี้เท่าไหร่', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-read-crm-new-customers', kind: 'text', coverage: 'business_read',
    messageText: 'เดือนนี้มีลูกค้าใหม่กี่รายคะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-read-explain-record', kind: 'text', coverage: 'business_read',
    messageText: 'ทำไมบิลเมื่อกี้ service charge ถึงคิดแยกเป็นอีกรายการคะ',
    permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    conversationContext: ctx([
      { at: '2026-09-17T03:40:00.000Z', user: '[ผู้ใช้ส่งรูป/ไฟล์เอกสารค่าใช้จ่าย]', bot: 'บันทึกค่าใช้จ่ายให้แล้วค่ะ', intent: 'EVIDENCE_CAPTURE' },
    ]),
    recentCapturedExpenses: [
      { id: 'exp-9001', label: 'ใบเสร็จรับเงิน · 17 ก.ย. 2569 · 1,284.00', amount: '1284.00', expenseDate: '2026-09-17', sourceDocumentType: 'RECEIPT', createdAt: '2026-09-17T03:40:10.000Z' },
    ],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },

  // ── expense capture by text ─────────────────────────────────────────────────
  {
    id: 'text-capture-coffee', kind: 'text', coverage: 'capture_text',
    messageText: 'ค่ากาแฟ 65 บาท', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['EXPENSE_DOCUMENT_CAPTURE'], permissionGate: 'capture', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-capture-two-items', kind: 'text', coverage: 'capture_text',
    messageText: 'ซื้อกระดาษ A4 2 รีม กับปากกา 1 กล่อง รวม 780 บาท ใช้ที่ออฟฟิศ',
    permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['EXPENSE_DOCUMENT_CAPTURE'], permissionGate: 'capture', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-capture-amount-only', kind: 'text', coverage: 'capture_incomplete',
    messageText: '350 บาท', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['CLARIFY'], permissionGate: 'none', permissionOutcome: 'allowed', forbidCapture: true,
    },
  },
  {
    id: 'text-capture-purpose-only', kind: 'text', coverage: 'capture_incomplete',
    messageText: 'จ่ายค่าน้ำมันรถไปส่งของค่ะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['CLARIFY', 'EXPENSE_DOCUMENT_CAPTURE'],
      alternativesWhy: 'The prompt says a spend note needs an amount AND a purpose; a purpose-only note may route to capture with amount in missingFields, or to CLARIFY. Both keep the money unwritten, so both are contract-legal.',
      permissionGate: 'capture', permissionOutcome: 'allowed',
    },
  },

  // ── correction of a recent capture ──────────────────────────────────────────
  {
    id: 'text-correction-amount', kind: 'text', coverage: 'correction',
    messageText: 'ยอดจริงๆ 590 นะคะ ไม่ใช่ 490',
    permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    conversationContext: ctx([
      { at: '2026-09-17T03:50:00.000Z', user: 'ค่าวัตถุดิบ 490 บาท', bot: 'บันทึกให้แล้วค่ะ 490.00 บาท', intent: 'EVIDENCE_CAPTURE' },
    ]),
    recentCapturedExpenses: [
      { id: 'exp-9002', label: 'บันทึกข้อความ · 17 ก.ย. 2569 · 490.00', amount: '490.00', expenseDate: '2026-09-17', sourceDocumentType: 'EXPENSE_NOTE_TEXT', createdAt: '2026-09-17T03:50:05.000Z' },
    ],
    expect: { intents: ['EXPENSE_CAPTURE_CORRECTION'], permissionGate: 'capture', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-correction-vendor', kind: 'text', coverage: 'correction',
    messageText: 'ที่จริงร้านคือ ร้านสมหมายพาณิชย์ ไม่ใช่ร้านลุงหมี',
    permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    conversationContext: ctx([
      { at: '2026-09-17T03:52:00.000Z', user: '[ผู้ใช้ส่งรูป/ไฟล์เอกสารค่าใช้จ่าย]', bot: 'บันทึกจากร้านลุงหมีแล้วค่ะ', intent: 'EVIDENCE_CAPTURE' },
    ]),
    recentCapturedExpenses: [
      { id: 'exp-9003', label: 'ใบเสร็จรับเงิน · 17 ก.ย. 2569 · 1,150.00', amount: '1150.00', expenseDate: '2026-09-17', sourceDocumentType: 'RECEIPT', createdAt: '2026-09-17T03:52:08.000Z' },
    ],
    expect: { intents: ['EXPENSE_CAPTURE_CORRECTION'], permissionGate: 'capture', permissionOutcome: 'allowed' },
  },

  // ── answering an open clarification ─────────────────────────────────────────
  {
    id: 'text-answer-open-clarification', kind: 'text', coverage: 'clarification_answer',
    messageText: 'ค่าเดินทางไปส่งของให้ลูกค้าค่ะ',
    permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    conversationContext: ctx([
      { at: '2026-09-17T04:00:00.000Z', user: '320 บาท', bot: 'รายการนี้เป็นค่าอะไรคะ', intent: 'CLARIFY' },
    ]),
    openClarifications: [
      {
        id: 'clr-7001', question: 'รายการนี้เป็นค่าอะไรคะ', text: '320 บาท',
        subject: 'expense', askedAt: '2026-09-17T04:00:05.000Z', clarifyForIntent: 'EXPENSE_DOCUMENT_CAPTURE',
      },
    ],
    expect: {
      intents: ['EXPENSE_DOCUMENT_CAPTURE', 'EXPENSE_DRAFT_CONTINUATION'],
      alternativesWhy: 'The prompt tells the router to classify the ORIGINAL request with the answer applied (capture); a router that instead sees it as resuming the pending item returns EXPENSE_DRAFT_CONTINUATION. Both complete the same user task.',
      permissionGate: 'capture', permissionOutcome: 'allowed',
      resolvesClarificationIds: ['clr-7001'],
    },
  },

  // ── expired context: a bare number must NOT capture ─────────────────────────
  {
    id: 'text-bare-number-expired-context', kind: 'text', coverage: 'expired_context',
    messageText: '480',
    permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['CLARIFY', 'UNSUPPORTED'],
      alternativesWhy: 'No conversationContext, no open clarification, no recent capture and no draft: the window has expired, so the only contract-legal answers are to ask or to decline. Capturing would invent a purpose.',
      permissionGate: 'none', permissionOutcome: 'allowed', forbidCapture: true,
    },
  },

  // ── denied capability ───────────────────────────────────────────────────────
  {
    id: 'text-denied-read-no-query-permission', kind: 'text', coverage: 'denied_capability',
    messageText: 'ขอดูยอดขายเดือนนี้หน่อยค่ะ',
    permissions: [...NO_QUERY_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['BUSINESS_READ_QUESTION'],
      permissionGate: 'query', permissionOutcome: 'denied',
    },
  },
  {
    id: 'text-denied-capture-read-only-user', kind: 'text', coverage: 'denied_capability',
    messageText: 'ค่าแท็กซี่ไปหาลูกค้า 120 บาท',
    permissions: [...READ_ONLY_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['EXPENSE_DOCUMENT_CAPTURE'],
      permissionGate: 'capture', permissionOutcome: 'denied',
    },
  },

  // ── mutation requests must refuse ───────────────────────────────────────────
  {
    id: 'text-mutation-approve', kind: 'text', coverage: 'mutation_refusal',
    messageText: 'อนุมัติใบเบิกของพนักงานให้หน่อยค่ะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['MUTATION_REQUEST_REFUSAL'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-mutation-transfer', kind: 'text', coverage: 'mutation_refusal',
    messageText: 'โอนเงินให้ซัพพลายเออร์ 5,000 บาทเลยนะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['MUTATION_REQUEST_REFUSAL'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },

  // ── capability / teach-me ───────────────────────────────────────────────────
  {
    id: 'text-capability-question', kind: 'text', coverage: 'capability_help',
    messageText: 'น้องมั่งมีทำอะไรได้บ้างคะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['UNSUPPORTED'],
      permissionGate: 'query', permissionOutcome: 'allowed',
    },
  },
  {
    id: 'text-teach-me', kind: 'text', coverage: 'capability_help',
    messageText: 'สอนใช้งานหน่อยค่ะ เริ่มยังไงดี', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['UNSUPPORTED'],
      permissionGate: 'query', permissionOutcome: 'allowed',
    },
  },

  // ── draft continuation ──────────────────────────────────────────────────────
  {
    id: 'text-draft-continuation-amount', kind: 'text', coverage: 'draft_continuation',
    messageText: '450 บาทค่ะ',
    permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    conversationContext: ctx([
      { at: '2026-09-17T04:10:00.000Z', user: 'ค่าซ่อมแอร์ร้าน', bot: 'ยอดเท่าไหร่คะ', intent: 'CLARIFY' },
    ]),
    activeExpenseDrafts: [
      {
        expenseId: 'exp-draft-5501', label: 'ค่าซ่อมแอร์ร้าน · ยังไม่ครบ', status: 'OPEN',
        questions: [{ id: 'q-1', prompt: 'ยอดเท่าไหร่คะ', itemRef: 'I01' }],
      },
    ],
    expect: {
      intents: ['EXPENSE_DRAFT_CONTINUATION'],
      permissionGate: 'capture', permissionOutcome: 'allowed',
    },
  },

  // ── out of scope ────────────────────────────────────────────────────────────
  {
    id: 'text-out-of-scope-gold-price', kind: 'text', coverage: 'out_of_scope',
    messageText: 'ราคาทองวันนี้เท่าไหร่คะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['UNSUPPORTED'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-out-of-scope-product-advice', kind: 'text', coverage: 'out_of_scope',
    messageText: 'ช่วงนี้ควรขายอะไรดีคะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: {
      intents: ['UNSUPPORTED', 'BUSINESS_READ_QUESTION'],
      alternativesWhy: 'The plan-route prompt names this exact phrase as unsupported_module (no grounded demand/margin tool), but the intake router may still route it as a business read and let the tool layer refuse. Both keep the refusal honest.',
      permissionGate: 'query', permissionOutcome: 'allowed',
    },
  },

  // ── images ──────────────────────────────────────────────────────────────────
  {
    id: 'image-thermal-short', kind: 'image', coverage: 'receipt_short',
    messageText: '', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    image: {
      format: 'jpeg', widthPx: 380, heightPx: 460, background: '#fdfdfb', quality: 88,
      lines: [
        { text: 'ร้านกาแฟมั่งมีคาเฟ่', y: 46, x: 190, size: 21, family: THAI, weight: 'bold', align: 'center' },
        { text: 'สาขาทดสอบ ถนนสมมติ', y: 70, x: 190, size: 13, family: THAI, align: 'center' },
        { text: 'ใบเสร็จรับเงิน', y: 100, x: 190, size: 16, family: THAI, align: 'center' },
        { text: 'เลขที่ RC-000712', y: 126, x: 24, size: 13, family: THAI },
        { text: 'วันที่ 16/09/2026 09:42', y: 150, x: 24, size: 13, family: THAI },
        { text: '------------------------------------', y: 172, x: 24, size: 13, family: THERMAL },
        { text: 'ลาเต้ร้อน', y: 198, x: 24, size: 14, family: THAI },
        { text: 'x2', y: 198, x: 230, size: 14, family: THERMAL },
        { text: '130.00', y: 198, x: 356, size: 14, family: THERMAL, align: 'right' },
        { text: 'ครัวซองต์เนยสด', y: 224, x: 24, size: 14, family: THAI },
        { text: 'x1', y: 224, x: 230, size: 14, family: THERMAL },
        { text: '55.00', y: 224, x: 356, size: 14, family: THERMAL, align: 'right' },
        { text: '------------------------------------', y: 246, x: 24, size: 13, family: THERMAL },
        { text: 'ยอดรวมทั้งสิ้น', y: 278, x: 24, size: 18, family: THAI, weight: 'bold' },
        { text: '185.00', y: 278, x: 356, size: 18, family: THERMAL, weight: 'bold', align: 'right' },
        { text: 'เงินสด', y: 308, x: 24, size: 13, family: THAI },
        { text: '200.00', y: 308, x: 356, size: 13, family: THERMAL, align: 'right' },
        { text: 'เงินทอน', y: 330, x: 24, size: 13, family: THAI },
        { text: '15.00', y: 330, x: 356, size: 13, family: THERMAL, align: 'right' },
        { text: 'ไม่รวมภาษีมูลค่าเพิ่ม', y: 362, x: 24, size: 12, family: THAI },
        { text: 'ขอบคุณที่ใช้บริการค่ะ', y: 400, x: 190, size: 13, family: THAI, align: 'center' },
      ],
    },
    expect: {
      intents: ['EXPENSE_DOCUMENT_CAPTURE'], permissionGate: 'capture', permissionOutcome: 'allowed',
      requiresDocumentText: true,
      receipt: { grandTotalAmount: '185.00', expenseDate: '2026-09-16', vendorNameContains: 'มั่งมีคาเฟ่' },
    },
  },
  {
    id: 'image-long-multiitem', kind: 'image', coverage: 'receipt_long',
    messageText: '', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    image: longReceiptSpec(),
    expect: {
      intents: ['EXPENSE_DOCUMENT_CAPTURE'], permissionGate: 'capture', permissionOutcome: 'allowed',
      requiresDocumentText: true,
      receipt: { grandTotalAmount: '3587.00', expenseDate: '2026-09-15', vendorNameContains: 'มั่งมีมาร์ท' },
    },
  },
  {
    id: 'image-vat-tax-invoice', kind: 'image', coverage: 'receipt_vat',
    messageText: '', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    image: {
      format: 'jpeg', widthPx: 560, heightPx: 520, background: '#ffffff', quality: 90,
      lines: [
        { text: 'บริษัท สมมติซัพพลาย จำกัด (สำนักงานใหญ่)', y: 48, x: 280, size: 19, family: THAI, weight: 'bold', align: 'center' },
        { text: '99/9 ถนนทดสอบ แขวงสมมติ เขตทดลอง กรุงเทพฯ 10900', y: 72, x: 280, size: 12, family: THAI, align: 'center' },
        { text: 'เลขประจำตัวผู้เสียภาษี 2222222222222', y: 94, x: 280, size: 12, family: THAI, align: 'center' },
        { text: 'ใบกำกับภาษี / ใบเสร็จรับเงิน', y: 128, x: 280, size: 17, family: THAI, weight: 'bold', align: 'center' },
        { text: 'เลขที่ TX-2026-0451', y: 158, x: 28, size: 13, family: THAI },
        { text: 'วันที่ 12/09/2026', y: 158, x: 532, size: 13, family: THAI, align: 'right' },
        { text: 'ลูกค้า: ร้านมั่งมีทดสอบ', y: 182, x: 28, size: 13, family: THAI },
        { text: '--------------------------------------------------------------', y: 206, x: 28, size: 12, family: THERMAL },
        { text: 'กระดาษถ่ายเอกสาร A4 80 แกรม', y: 234, x: 28, size: 13, family: THAI },
        { text: 'x8', y: 234, x: 380, size: 13, family: THERMAL },
        { text: '760.00', y: 234, x: 532, size: 13, family: THERMAL, align: 'right' },
        { text: 'หมึกพิมพ์ดำ รุ่นทดสอบ', y: 258, x: 28, size: 13, family: THAI },
        { text: 'x1', y: 258, x: 380, size: 13, family: THERMAL },
        { text: '240.00', y: 258, x: 532, size: 13, family: THERMAL, align: 'right' },
        { text: '--------------------------------------------------------------', y: 282, x: 28, size: 12, family: THERMAL },
        { text: 'รวมเป็นเงิน', y: 314, x: 320, size: 14, family: THAI },
        { text: '1,000.00', y: 314, x: 532, size: 14, family: THERMAL, align: 'right' },
        { text: 'ภาษีมูลค่าเพิ่ม 7%', y: 340, x: 320, size: 14, family: THAI },
        { text: '70.00', y: 340, x: 532, size: 14, family: THERMAL, align: 'right' },
        { text: 'จำนวนเงินรวมทั้งสิ้น', y: 372, x: 320, size: 16, family: THAI, weight: 'bold' },
        { text: '1,070.00', y: 372, x: 532, size: 16, family: THERMAL, weight: 'bold', align: 'right' },
        { text: 'ชำระโดย โอนเงิน', y: 410, x: 28, size: 12, family: THAI },
        { text: 'ผู้รับเงิน ______________________', y: 452, x: 28, size: 12, family: THAI },
      ],
    },
    expect: {
      intents: ['EXPENSE_DOCUMENT_CAPTURE'], permissionGate: 'capture', permissionOutcome: 'allowed',
      requiresDocumentText: true,
      receipt: { grandTotalAmount: '1070.00', vatAmount: '70.00', expenseDate: '2026-09-12', vendorNameContains: 'สมมติซัพพลาย' },
    },
  },
  {
    id: 'image-low-contrast-rotated', kind: 'image', coverage: 'receipt_hard_to_read',
    messageText: '', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    image: {
      format: 'jpeg', widthPx: 420, heightPx: 420, background: '#e9e6df', quality: 62, rotateDeg: 5, blurSigma: 0.6,
      lines: [
        { text: 'ร้านอะไหล่ทดสอบยนต์', y: 60, x: 210, size: 19, family: THAI, color: '#6d6a63', weight: 'bold', align: 'center' },
        { text: 'บิลเงินสด เลขที่ 0219', y: 92, x: 210, size: 13, family: THAI, color: '#77746d', align: 'center' },
        { text: 'วันที่ 14/09/2026', y: 120, x: 30, size: 13, family: THAI, color: '#77746d' },
        { text: 'น้ำมันเครื่อง 4 ลิตร', y: 168, x: 30, size: 14, family: THAI, color: '#6f6c65' },
        { text: '890.00', y: 168, x: 390, size: 14, family: THERMAL, color: '#6f6c65', align: 'right' },
        { text: 'ไส้กรองน้ำมัน', y: 196, x: 30, size: 14, family: THAI, color: '#6f6c65' },
        { text: '245.00', y: 196, x: 390, size: 14, family: THERMAL, color: '#6f6c65', align: 'right' },
        { text: 'ค่าแรงเปลี่ยนถ่าย', y: 224, x: 30, size: 14, family: THAI, color: '#6f6c65' },
        { text: '150.00', y: 224, x: 390, size: 14, family: THERMAL, color: '#6f6c65', align: 'right' },
        { text: '-------------------------------------', y: 248, x: 30, size: 12, family: THERMAL, color: '#83807a' },
        { text: 'รวมทั้งสิ้น', y: 286, x: 30, size: 17, family: THAI, color: '#5c5952', weight: 'bold' },
        { text: '1,285.00', y: 286, x: 390, size: 17, family: THERMAL, color: '#5c5952', weight: 'bold', align: 'right' },
        { text: 'ขอบคุณครับ', y: 340, x: 210, size: 13, family: THAI, color: '#7d7a73', align: 'center' },
      ],
    },
    expect: {
      intents: ['EXPENSE_DOCUMENT_CAPTURE'], permissionGate: 'capture', permissionOutcome: 'allowed',
      requiresDocumentText: true,
      receipt: { grandTotalAmount: '1285.00', expenseDate: '2026-09-14', vendorNameContains: 'ทดสอบยนต์' },
    },
  },
  {
    id: 'image-handwritten-cash-bill', kind: 'image', coverage: 'receipt_handwritten',
    messageText: '', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    image: {
      format: 'jpeg', widthPx: 420, heightPx: 400, background: '#fbf7e8', quality: 85,
      shapes: [
        { kind: 'stroke', d: 'M 24 130 L 396 130', color: '#c9c3ad', width: 1 },
        { kind: 'stroke', d: 'M 24 172 L 396 172', color: '#c9c3ad', width: 1 },
        { kind: 'stroke', d: 'M 24 214 L 396 214', color: '#c9c3ad', width: 1 },
        { kind: 'stroke', d: 'M 24 256 L 396 256', color: '#c9c3ad', width: 1 },
      ],
      lines: [
        { text: 'บิลเงินสด', y: 56, x: 210, size: 22, family: HANDWRITING, color: '#20304d', align: 'center' },
        { text: 'ร้านป้าแดงของชำ', y: 88, x: 210, size: 17, family: HANDWRITING, color: '#20304d', align: 'center' },
        { text: '13 ก.ย. 2569', y: 120, x: 30, size: 16, family: HANDWRITING, color: '#20304d' },
        { text: 'ผักสด', y: 164, x: 30, size: 17, family: HANDWRITING, color: '#20304d' },
        { text: '220', y: 164, x: 380, size: 17, family: HANDWRITING, color: '#20304d', align: 'right' },
        { text: 'ไข่ไก่ 2 แผง', y: 206, x: 30, size: 17, family: HANDWRITING, color: '#20304d' },
        { text: '196', y: 206, x: 380, size: 17, family: HANDWRITING, color: '#20304d', align: 'right' },
        { text: 'น้ำแข็ง', y: 248, x: 30, size: 17, family: HANDWRITING, color: '#20304d' },
        { text: '174', y: 248, x: 380, size: 17, family: HANDWRITING, color: '#20304d', align: 'right' },
        { text: 'รวม', y: 306, x: 30, size: 20, family: HANDWRITING, color: '#20304d' },
        { text: '590', y: 306, x: 380, size: 20, family: HANDWRITING, color: '#20304d', align: 'right' },
        { text: 'รับเงินแล้ว', y: 352, x: 30, size: 15, family: HANDWRITING, color: '#20304d' },
      ],
    },
    expect: {
      intents: ['EXPENSE_DOCUMENT_CAPTURE'], permissionGate: 'capture', permissionOutcome: 'allowed',
      requiresDocumentText: true,
      receipt: { grandTotalAmount: '590.00', expenseDate: '2026-09-13', vendorNameContains: 'ป้าแดง' },
    },
  },
  {
    id: 'image-check-bill-quantity-only', kind: 'image', coverage: 'reference_document',
    messageText: '', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    image: {
      format: 'jpeg', widthPx: 380, heightPx: 330, background: '#ffffff', quality: 88,
      lines: [
        { text: 'ร้านอาหารทดสอบครัวไทย', y: 46, x: 190, size: 18, family: THAI, weight: 'bold', align: 'center' },
        { text: 'ใบรายการอาหาร (เช็คบิล)', y: 74, x: 190, size: 14, family: THAI, align: 'center' },
        { text: 'โต๊ะ 7   14/09/2026 19:05', y: 100, x: 24, size: 12, family: THAI },
        { text: '------------------------------------', y: 122, x: 24, size: 12, family: THERMAL },
        { text: 'ต้มยำกุ้ง', y: 150, x: 24, size: 14, family: THAI },
        { text: 'x1', y: 150, x: 330, size: 14, family: THERMAL, align: 'right' },
        { text: 'ข้าวผัดปู', y: 176, x: 24, size: 14, family: THAI },
        { text: 'x2', y: 176, x: 330, size: 14, family: THERMAL, align: 'right' },
        { text: 'น้ำเปล่า', y: 202, x: 24, size: 14, family: THAI },
        { text: 'x3', y: 202, x: 330, size: 14, family: THERMAL, align: 'right' },
        { text: '------------------------------------', y: 224, x: 24, size: 12, family: THERMAL },
        { text: 'รวม 6 รายการ', y: 252, x: 24, size: 14, family: THAI },
        { text: 'กรุณาเรียกพนักงานเพื่อชำระเงิน', y: 292, x: 190, size: 12, family: THAI, align: 'center' },
      ],
    },
    expect: {
      intents: ['BUSINESS_DOCUMENT_REFERENCE', 'CLARIFY'],
      alternativesWhy: 'The prompt says quantity/items with no transaction total are ORDER_OR_CHECK_BILL and must get guidance only; a router that is not sure between reference and capture must choose CLARIFY. Neither may create an expense.',
      permissionGate: 'none', permissionOutcome: 'allowed', forbidCapture: true,
      requiresDocumentText: true,
    },
  },
  {
    id: 'image-signature-crop', kind: 'image', coverage: 'non_receipt_image',
    messageText: '', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    image: {
      format: 'png', widthPx: 420, heightPx: 200, background: '#ffffff',
      shapes: [
        { kind: 'stroke', d: 'M 60 140 C 90 60, 130 60, 145 120 C 158 170, 185 150, 195 105 C 205 60, 240 70, 250 125', color: '#101c33', width: 4 },
        { kind: 'stroke', d: 'M 250 125 C 270 95, 300 140, 340 100', color: '#101c33', width: 4 },
        { kind: 'stroke', d: 'M 120 155 L 330 152', color: '#101c33', width: 2 },
      ],
      lines: [],
    },
    expect: {
      intents: ['SIGNATURE_UPLOAD_TICKET', 'CLARIFY'],
      alternativesWhy: 'The prompt: ink strokes on a mostly blank background are SIGNATURE_UPLOAD_TICKET, and "when unsure between capture and signature, choose CLARIFY". Both keep it out of expense capture.',
      permissionGate: 'none', permissionOutcome: 'allowed', forbidCapture: true,
    },
  },
  {
    id: 'image-product-photo', kind: 'image', coverage: 'non_receipt_image',
    messageText: '', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    image: {
      format: 'jpeg', widthPx: 420, heightPx: 320, background: '#dfe7ef', quality: 86,
      shapes: [
        { kind: 'rect', x: 0, y: 220, w: 420, h: 100, fill: '#b9c6d3' },
        { kind: 'rect', x: 120, y: 90, w: 180, h: 140, fill: '#c2603f' },
        { kind: 'rect', x: 120, y: 90, w: 180, h: 26, fill: '#8d4530' },
        { kind: 'circle', cx: 210, cy: 168, r: 34, fill: '#f0e3c8' },
        { kind: 'circle', cx: 330, cy: 70, r: 26, fill: '#f6e08a' },
      ],
      lines: [],
    },
    expect: {
      intents: ['UNSUPPORTED', 'CLARIFY', 'BUSINESS_DOCUMENT_REFERENCE'],
      alternativesWhy: 'A picture with no document content is not intake evidence. UNSUPPORTED and CLARIFY are both contract-legal, and a cautious router may call it a non-business document reference; none of the three may capture an expense.',
      permissionGate: 'none', permissionOutcome: 'allowed', forbidCapture: true,
    },
  },
  {
    id: 'image-chat-screenshot', kind: 'image', coverage: 'non_receipt_image',
    messageText: '', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    image: {
      format: 'png', widthPx: 380, heightPx: 420, background: '#8fb4d9',
      shapes: [
        { kind: 'rect', x: 0, y: 0, w: 380, h: 54, fill: '#f2f4f7' },
        { kind: 'rect', x: 20, y: 80, w: 220, h: 56, fill: '#ffffff' },
        { kind: 'rect', x: 140, y: 156, w: 220, h: 56, fill: '#c6f0a0' },
        { kind: 'rect', x: 20, y: 232, w: 250, h: 78, fill: '#ffffff' },
        { kind: 'rect', x: 0, y: 366, w: 380, h: 54, fill: '#f2f4f7' },
      ],
      lines: [
        { text: 'กลุ่มงานร้านทดสอบ', y: 34, x: 20, size: 15, family: THAI, color: '#1d2733', weight: 'bold' },
        { text: 'พรุ่งนี้เปิดร้านกี่โมงคะ', y: 114, x: 32, size: 13, family: THAI, color: '#1d2733' },
        { text: 'เปิด 9 โมงเหมือนเดิมค่ะ', y: 190, x: 152, size: 13, family: THAI, color: '#1d2733' },
        { text: 'โอเคค่ะ เดี๋ยวไปช่วยจัดของ', y: 264, x: 32, size: 13, family: THAI, color: '#1d2733' },
        { text: 'ตอนเช้านะคะ', y: 288, x: 32, size: 13, family: THAI, color: '#1d2733' },
        { text: 'พิมพ์ข้อความ...', y: 398, x: 24, size: 13, family: THAI, color: '#7a828c' },
      ],
    },
    expect: {
      intents: ['UNSUPPORTED', 'CLARIFY', 'BUSINESS_DOCUMENT_REFERENCE'],
      alternativesWhy: 'A chat screenshot carries no amount and no document; UNSUPPORTED, CLARIFY and a non-expense reference are all legal, and none may create an expense.',
      permissionGate: 'none', permissionOutcome: 'allowed', forbidCapture: true,
    },
  },

  // ── v2: business reads that NAME a period (period-resolution spec P-06) ─────
  // Every one of these is answerable only if the deterministic resolver read the period and the tool
  // received exactly those boundaries; `INTAKE_COST_CORPUS_TODAY_ISO` fixes what each one resolves to.
  {
    id: 'text-period-sales-yesterday', kind: 'text', coverage: 'business_read_period',
    messageText: 'ยอดขายเมื่อวานเท่าไหร่คะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-period-expense-last-month', kind: 'text', coverage: 'business_read_period',
    messageText: 'ค่าใช้จ่ายเดือนที่แล้วรวมเท่าไหร่คะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-period-tax-vat-last-month', kind: 'text', coverage: 'business_read_period',
    messageText: 'VAT เดือนที่แล้วยอดเท่าไหร่คะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-period-crm-last-week', kind: 'text', coverage: 'business_read_period',
    messageText: 'สัปดาห์ที่แล้วมีลูกค้าใหม่กี่รายคะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-period-sales-named-month', kind: 'text', coverage: 'business_read_period',
    messageText: 'ยอดขาย ส.ค. 68 เท่าไหร่คะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-period-expense-explicit-range', kind: 'text', coverage: 'business_read_period',
    messageText: 'ค่าใช้จ่าย 1-15 ก.ย. รวมเท่าไหร่คะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-period-daily-closing-day-before', kind: 'text', coverage: 'business_read_period',
    messageText: 'ปิดยอดเมื่อวานซืนเป็นยังไงบ้างคะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-period-sales-last-year', kind: 'text', coverage: 'business_read_period',
    messageText: 'ยอดขายปีที่แล้วเท่าไหร่คะ', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
  {
    id: 'text-period-sales-last-month-en', kind: 'text', coverage: 'business_read_period',
    messageText: 'how much did we sell last month?', permissions: [...FULL_PERMISSIONS], activeCategories: [...CATEGORIES],
    expect: { intents: ['BUSINESS_READ_QUESTION'], permissionGate: 'query', permissionOutcome: 'allowed' },
  },
] as const;

/** Routes that WRITE (or start writing) an expense. `forbidCapture` rows must land outside this set. */
export const INTAKE_COST_CAPTURE_INTENTS: readonly IntakeCostExpectedIntent[] = [
  'EXPENSE_DOCUMENT_CAPTURE',
  'EXPENSE_DRAFT_CONTINUATION',
  'EXPENSE_CAPTURE_CORRECTION',
];

/** Deterministic API gate for a routed task: exactly the two permission checks
 *  `process-line-webhook.use-case.ts` applies after intake. */
export function intakeCostPermissionAllowed(task: IntakeCostTask): boolean {
  if (task.expect.permissionGate === 'none') return true;
  if (task.expect.permissionGate === 'query') return task.permissions.includes(QUERY_PERMISSION_KEY);
  return RECEIPT_CAPTURE_PERMISSION_KEYS.some((key) => task.permissions.includes(key));
}

/** Content hash of the frozen manifest. The benchmark prints it into every summary so a baseline
 *  and an after-run can be proven to have used the same corpus. */
export function intakeCostCorpusHash(): string {
  return createHash('sha256').update(JSON.stringify(LINE_AI_INTAKE_COST_CORPUS)).digest('hex');
}
