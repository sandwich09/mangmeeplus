import {
  ACCOUNTING_DOCUMENT_STATUS_LABELS as DOCUMENT_STATUS,
  ACCOUNTING_DOCUMENT_TYPE_LABELS as DOCUMENT_TYPE,
  ACCOUNTING_PAYMENT_STATUS_LABELS,
  AI_RISK_LEVEL_LABELS,
  AI_SUGGESTION_NEEDS_DATA_LABEL,
  AI_SUGGESTION_STATUS_LABELS,
  EXPENSE_STATUS_LABELS,
  LEDGER_ACCOUNT_CLASS_LABELS,
  NOTIFICATION_SEVERITY_LABELS,
  REPORT_CURRENCY_WORDS,
  REPORT_FRESHNESS_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  TAX_EVIDENCE_STATUS_LABELS,
  WORKFLOW_DEAD_LETTER_RESOLUTION_LABELS as DEAD_LETTER,
  WORKFLOW_RULE_STATUS_LABELS as RULE,
  WORKFLOW_RUN_STATUS_LABELS as RUN,
  WORKFLOW_TAB_LABELS as AUTOMATION,
  WORKFLOW_TASK_STATUS_LABELS as TASK,
  type ReportResultDto,
} from '@watchdog-bms/contracts';

type Words = Readonly<Record<string, string>>;

// The notification words for the levels they share (แจ้งเพื่อทราบ, สำคัญ); ปกติ and ควรตรวจสอบ are the report's own.
const SEVERITY: Words = { normal: 'ปกติ', info: NOTIFICATION_SEVERITY_LABELS.info, warning: 'ควรตรวจสอบ', critical: NOTIFICATION_SEVERITY_LABELS.critical };

/**
 * The words a person reads for the machine values report rows carry (enum names, metric keys), by report and
 * column. The rows themselves keep the machine values: the assistant's report tool reads `source`, `section` and
 * ISO currencies from the same rows. The report page and the CSV get them through reportResultForPeople.
 * Every word a page also shows comes from its shared list in contracts; only words no page shows are written here.
 */
export const REPORT_VALUE_TEXT: Readonly<Record<string, Readonly<Record<string, Words>>>> = {
  'financial.trial_balance': { accountClass: LEDGER_ACCOUNT_CLASS_LABELS },
  'financial.profit_and_loss': { section: LEDGER_ACCOUNT_CLASS_LABELS },
  'financial.balance_sheet': { section: LEDGER_ACCOUNT_CLASS_LABELS },
  'ar.aging': { paymentStatus: ACCOUNTING_PAYMENT_STATUS_LABELS, currency: REPORT_CURRENCY_WORDS },
  'sales.summary': {
    source: { issued_invoices: `${DOCUMENT_TYPE.INVOICE}ที่${DOCUMENT_STATUS.ISSUED}`, crm_open_pipeline: 'โอกาสการขายที่ยังเปิดอยู่' },
    currency: REPORT_CURRENCY_WORDS,
  },
  'sales.pipeline': {
    metric: {
      open_pipeline_count: 'โอกาสการขายที่ยังเปิดอยู่',
      pipeline_total_amount: 'มูลค่าที่คาดไว้ของโอกาสการขายที่ยังเปิดอยู่',
      followups_due_today: 'งานติดตามลูกค้าที่ครบกำหนดวันนี้',
      followups_overdue: 'งานติดตามลูกค้าที่เลยกำหนด',
      stuck_opportunities: 'โอกาสการขายที่ไม่มีความคืบหน้า',
    },
  },
  'inventory.stock_movement': {
    movementType: STOCK_MOVEMENT_TYPE_LABELS,
    direction: { IN: 'เข้า', OUT: 'ออก' },
  },
  'expense.summary': { status: EXPENSE_STATUS_LABELS, currency: REPORT_CURRENCY_WORDS },
  'expense.accountant_evidence': {
    sourceDocumentType: SOURCE_DOCUMENT_TYPE_LABELS,
    taxEvidenceStatus: TAX_EVIDENCE_STATUS_LABELS,
    expenseStatus: EXPENSE_STATUS_LABELS,
    inputVatClaimStatus: { CLAIMABLE: 'ใช้ภาษีซื้อได้', NON_CLAIMABLE: 'ใช้ภาษีซื้อไม่ได้', NEEDS_REVIEW: 'รอตรวจว่าใช้ภาษีซื้อได้หรือไม่' },
  },
  'tax.summary': {
    taxType: { VAT: 'ภาษีมูลค่าเพิ่ม', WHT: 'ภาษีหัก ณ ที่จ่าย', CIT: 'ภาษีเงินได้นิติบุคคล', CUSTOMS: 'อากรและภาษีนำเข้า' },
    formType: {
      PP30: 'ภ.พ.30', PP36: 'ภ.พ.36', PND3: 'ภ.ง.ด.3', PND53: 'ภ.ง.ด.53', PND50: 'ภ.ง.ด.50', PND51: 'ภ.ง.ด.51',
      CUSTOMS_SUPPORT: 'ข้อมูลประกอบอากรและภาษีนำเข้า',
    },
    status: {
      OPEN: 'เปิดอยู่', NEEDS_REVIEW: 'มีรายการต้องตรวจ', READY_FOR_REVIEW: 'พร้อมให้ตรวจ', REVIEWED: 'ตรวจแล้ว',
      EXPORTED: 'สร้างไฟล์ยื่นแบบแล้ว', FILED: 'ยื่นแบบแล้ว', PAID: 'ชำระแล้ว', CLOSED: 'ปิดงวดแล้ว', AMENDED: 'ยื่นแบบเพิ่มเติมแล้ว',
    },
  },
  'bank.cash_position': { currency: REPORT_CURRENCY_WORDS },
  'ops.workflow_sla': {
    metric: {
      workflow_runs_total: `การทำงานของ${AUTOMATION.rules}ทั้งหมด`,
      workflow_runs_failed: `การทำงานที่${RUN.FAILED}`,
      workflow_runs_partial_failed: `การทำงานที่${RUN.PARTIAL_FAILED}`,
      workflow_tasks_open: `${AUTOMATION.tasks}ที่ยัง${TASK.OPEN}`,
      workflow_tasks_snoozed: `${AUTOMATION.tasks}ที่${TASK.SNOOZED}`,
      workflow_tasks_overdue_visible: `${AUTOMATION.tasks}ที่เกินกำหนด`,
      workflow_rules_enabled: `${AUTOMATION.rules}ที่${RULE.ENABLED}`,
      workflow_dead_letters_open: `${AUTOMATION['dead-letters']}ที่${DEAD_LETTER.OPEN}`,
    },
    severity: SEVERITY,
  },
  'ops.dashboard_health': {
    severity: SEVERITY,
    // The dashboard snapshot also has partial (some cards missing) and unavailable (no card at all).
    freshnessStatus: { fresh: REPORT_FRESHNESS_LABELS.fresh, stale: REPORT_FRESHNESS_LABELS.stale, partial: 'ข้อมูลไม่ครบทุกส่วน', unavailable: 'ยังไม่มีข้อมูล' },
  },
  'ai.suggestion_summary': {
    metric: {
      ai_suggestions_total: 'คำแนะนำจาก AI ทั้งหมด',
      ai_suggestions_high_risk: `คำแนะนำจาก AI ที่${AI_RISK_LEVEL_LABELS.HIGH}`,
      ai_suggestions_needs_data_visible: `คำแนะนำจาก AI ที่${AI_SUGGESTION_NEEDS_DATA_LABEL}`,
      // ai_suggestions_<status> rows, one per status the adapter counts.
      ...Object.fromEntries(Object.entries(AI_SUGGESTION_STATUS_LABELS).map(([status, word]) => [`ai_suggestions_${status.toLowerCase()}`, `คำแนะนำจาก AI สถานะ${word}`])),
    },
    severity: SEVERITY,
  },
};

const wordFor = (words: Words | undefined, value: string): string | undefined =>
  words && Object.hasOwn(words, value) ? words[value] : undefined;

/** A copy of a report result with the words a person reads: mapped values, ใช่/ไม่ใช่ for yes/no, and chart labels. */
export function reportResultForPeople<T extends Pick<ReportResultDto, 'dataset' | 'columns' | 'rows' | 'chart'>>(result: T): T {
  const columns = REPORT_VALUE_TEXT[result.dataset.code] ?? {};
  const cell = (key: string, value: ReportResultDto['rows'][number][string]) => {
    if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
    return typeof value === 'string' ? wordFor(columns[key], value) ?? value : value;
  };
  // Chart labels are the values of one of the report's columns.
  const label = (value: string) => Object.values(columns).map((words) => wordFor(words, value)).find(Boolean) ?? value;
  return {
    ...result,
    rows: result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cell(key, value)]))),
    ...(result.chart ? { chart: { ...result.chart, labels: result.chart.labels.map(label) } } : {}),
  };
}
