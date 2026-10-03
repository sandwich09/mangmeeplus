import {
  EXPENSE_PAYMENT_STATUS_LABELS,
  EXPENSE_STATUS_LABELS,
  LEDGER_ACCOUNT_CLASS_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS,
  TAX_EVIDENCE_STATUS_LABELS,
  type ReportResultDto,
} from '@watchdog-bms/contracts';

type Words = Readonly<Record<string, string>>;

// A foreign currency keeps its code, as on every other page; only the baht has a Thai word.
const CURRENCY: Words = { THB: 'บาท' };
// The notification words where they exist (แจ้งเพื่อทราบ, สำคัญ).
const SEVERITY: Words = { normal: 'ปกติ', info: 'แจ้งเพื่อทราบ', warning: 'ควรตรวจสอบ', critical: 'สำคัญ' };

/**
 * The words a person reads for the machine values report rows carry (enum names, metric keys), by report and
 * column. The rows themselves keep the machine values: the assistant's report tool reads `source`, `section` and
 * ISO currencies from the same rows. The report page and the CSV get them through reportResultForPeople.
 * Words that already have a shared label (contracts) come from it; the others match the page that shows the thing.
 */
export const REPORT_VALUE_TEXT: Readonly<Record<string, Readonly<Record<string, Words>>>> = {
  'financial.trial_balance': { accountClass: LEDGER_ACCOUNT_CLASS_LABELS },
  'financial.profit_and_loss': { section: LEDGER_ACCOUNT_CLASS_LABELS },
  'financial.balance_sheet': { section: LEDGER_ACCOUNT_CLASS_LABELS },
  'ar.aging': { paymentStatus: { ...EXPENSE_PAYMENT_STATUS_LABELS, OVERDUE: 'เกินกำหนดชำระ' }, currency: CURRENCY },
  'sales.summary': {
    source: { issued_invoices: 'ใบแจ้งหนี้ที่ออกแล้ว', crm_open_pipeline: 'โอกาสการขายที่ยังเปิดอยู่' },
    currency: CURRENCY,
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
    movementType: {
      STOCK_IN: 'รับเข้า', STOCK_OUT: 'จ่ายออก', TRANSFER_IN: 'รับโอน', TRANSFER_OUT: 'โอนออก',
      COUNT_ADJUSTMENT_IN: 'ปรับนับ (เพิ่ม)', COUNT_ADJUSTMENT_OUT: 'ปรับนับ (ลด)', ADJUSTMENT_IN: 'ปรับเพิ่ม', ADJUSTMENT_OUT: 'ปรับลด',
    },
    direction: { IN: 'เข้า', OUT: 'ออก' },
  },
  'expense.summary': { status: EXPENSE_STATUS_LABELS, currency: CURRENCY },
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
  'bank.cash_position': { currency: CURRENCY },
  'ops.workflow_sla': {
    metric: {
      workflow_runs_total: 'การทำงานของกฎอัตโนมัติทั้งหมด',
      workflow_runs_failed: 'การทำงานที่ล้มเหลว',
      workflow_runs_partial_failed: 'การทำงานที่สำเร็จบางส่วน',
      workflow_tasks_open: 'งานที่มอบหมายที่ยังเปิดอยู่',
      workflow_tasks_snoozed: 'งานที่มอบหมายที่เลื่อนแจ้งเตือน',
      workflow_tasks_overdue_visible: 'งานที่มอบหมายที่เกินกำหนด',
      workflow_rules_enabled: 'กฎอัตโนมัติที่เปิดใช้งาน',
      workflow_dead_letters_open: 'ข้อผิดพลาดค้างที่ยังไม่แก้ไข',
    },
    severity: SEVERITY,
  },
  'ops.dashboard_health': {
    severity: SEVERITY,
    freshnessStatus: { fresh: 'ข้อมูลล่าสุด', stale: 'ข้อมูลอาจไม่ล่าสุด', partial: 'ข้อมูลไม่ครบทุกส่วน', unavailable: 'ยังไม่มีข้อมูล' },
  },
  'ai.suggestion_summary': {
    metric: {
      ai_suggestions_total: 'คำแนะนำจาก AI ทั้งหมด',
      ai_suggestions_high_risk: 'คำแนะนำจาก AI ที่ต้องระวัง',
      ai_suggestions_needs_data_visible: 'คำแนะนำจาก AI ที่ยังขาดข้อมูล',
      ai_suggestions_new: 'คำแนะนำจาก AI สถานะใหม่',
      ai_suggestions_in_review: 'คำแนะนำจาก AI ที่กำลังตรวจสอบ',
      ai_suggestions_blocked_by_permission: 'คำแนะนำจาก AI ที่สิทธิ์ไม่เพียงพอ',
      ai_suggestions_blocked_by_source_state: 'คำแนะนำจาก AI ที่ข้อมูลต้นทางเปลี่ยน',
      ai_suggestions_failed: 'คำแนะนำจาก AI ที่สร้างไม่สำเร็จ',
      ai_suggestions_source_draft_created: 'คำแนะนำจาก AI ที่สร้างร่างแล้ว',
      ai_suggestions_dismissed: 'คำแนะนำจาก AI ที่ปิดแล้ว',
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
