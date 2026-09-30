/**
 * AccountingSummaryAgent – reads ledger/accounting summary.
 * Allowlisted tools: read-only business summary tools.
 */
import type { AgentContext } from './agent-types';
import { periodFact } from './agent-types';
import type { AgentIntentItem, SpecialistOutput, AgentFact, AgentToolCall } from '@watchdog-bms/contracts';
import { LINE_DRAFT_UPDATE_TOOLS, LINE_TOOL_REGISTRY } from '@watchdog-bms/contracts';
import type { ErpToolClient } from '../infrastructure/erp-tool.client';
import { formatExpenseExplainReply } from './expense-explain-formatter';
import { formatDraftUpdateReply } from './draft-update-formatter';

export const ALLOWED_TOOLS = new Set([
  'public.lookup',
  'accounting.get_summary',
  'accounting.list_recent_documents',
  'accounting.get_document_detail',
  'accounting.get_receivable_summary',
  'ledger.get_financial_summary',
  'ledger.get_period_status',
  'ledger.get_report_summary',
    'bank.get_account_balances',
    'bank.get_reconciliation_status',
  'expense.list_recent',
  'expense.get_detail',
  'expense.explain_record',
  'expense.get_breakdown',
  'expense.get_daily_closing',
  'procurement.get_ap_outstanding',
  'procurement.get_summary',
  'procurement.search_suppliers',
  'procurement.get_purchase_order_detail',
  'sales.get_sales_summary',
  'crm.get_customer_summary',
  'crm.search_customers',
  'crm.get_customer_360',
  'crm.get_report_summary',
  'crm.get_pipeline_summary',
  'crm.list_open_followups',
  'crm.get_booking_summary',
  'crm.list_bookings',
  'crm.get_inbox_summary',
  'crm.list_conversations',
  'crm.get_conversation_summary',
  'crm.suggest_sales_followups',
  'company.get_current_context',
  'company.list_branches',
  'company.get_employee_summary',
  'company.get_employee_detail',
  'dashboard.get_business_health_summary',
  'notifications.list_open_alerts',
  'notifications.get_daily_summary',
  'tax.get_upcoming_tax_obligations',
  'tax.get_vat_summary',
  'tax.get_wht_summary',
  'tax.get_cit_calendar',
  'tax.list_missing_tax_documents',
  'tax.get_tax_code_profile',
  'tax.get_transaction_tax_summary',
  'tax.get_reconciliation_summary',
  'workflow.explain_run',
  'workflow.list_assigned_tasks',
  'workflow.list_recent_failures',
  'workflow.summarize_rule_health',
  'reimbursement.list_pending_approvals',
  'reimbursement.get_summary',
  'reimbursement.get_detail',
  'reports.get_monthly_report_summary',
  'billing.get_package_usage',
  // S-4 draft edit (spec §5.4). They belong to the accounting specialist because they act on the
  // expense record it already reads; the router catalog is what decides whether they are offered.
  ...LINE_DRAFT_UPDATE_TOOLS,
]);

const TOOL_FACT_LABELS: Record<string, string> = {
  'accounting.get_document_detail': 'ข้อมูลเอกสารบัญชี',
  'accounting.get_receivable_summary': 'สรุปลูกหนี้คงค้าง',
  'expense.get_detail': 'ข้อมูลค่าใช้จ่าย',
  'expense.explain_record': 'ที่มาของยอดในบิล',
  'expense.draft.set_header': 'ตัวอย่างการแก้รายการ',
  'expense.draft.set_line': 'ตัวอย่างการแก้รายการ',
  'expense.draft.add_charge': 'ตัวอย่างการแก้รายการ',
  'expense.draft.remove_line': 'ตัวอย่างการแก้รายการ',
  'expense.draft.set_vat_mode': 'ตัวอย่างการแก้รายการ',
  'reimbursement.get_summary': 'สรุปเบิกจ่าย',
  'reimbursement.get_detail': 'ข้อมูลเบิกจ่าย',
  'reports.get_monthly_report_summary': 'สรุปรายงานรายเดือน',
  'crm.get_customer_summary': 'สรุปลูกค้า',
  'crm.search_customers': 'รายชื่อลูกค้า',
  'crm.get_customer_360': 'ข้อมูลลูกค้า',
  'crm.get_report_summary': 'รายงาน CRM',
  'crm.get_pipeline_summary': 'สรุป Pipeline',
  'crm.list_open_followups': 'งานติดตามลูกค้า',
  'crm.get_booking_summary': 'สรุปนัดหมาย',
  'crm.list_bookings': 'รายการนัดหมาย',
  'crm.get_inbox_summary': 'สรุปกล่องข้อความ CRM',
  'crm.list_conversations': 'รายการสนทนา CRM',
  'crm.get_conversation_summary': 'ข้อมูลการสนทนา CRM',
  'notifications.list_open_alerts': 'แจ้งเตือนที่เปิดอยู่',
  'notifications.get_daily_summary': 'สรุปแจ้งเตือนรายวัน',
  'reimbursement.list_pending_approvals': 'เบิกจ่ายรออนุมัติ',
  'accounting.get_summary': 'สรุปเอกสารบัญชี',
  'accounting.list_recent_documents': 'เอกสารบัญชีล่าสุด',
  'expense.get_breakdown': 'สรุปค่าใช้จ่ายแยกกลุ่ม',
  'expense.get_daily_closing': 'สรุปปิดร้าน',
  'procurement.get_ap_outstanding': 'เจ้าหนี้ค้างจ่าย',
  'procurement.get_summary': 'สรุปใบสั่งซื้อ',
  'procurement.search_suppliers': 'รายชื่อผู้ขาย',
  'procurement.get_purchase_order_detail': 'ข้อมูลใบสั่งซื้อ',
  'ledger.get_period_status': 'สถานะงวดบัญชี',
  'ledger.get_report_summary': 'สรุปรายงานบัญชี',
  'company.get_employee_summary': 'พนักงาน',
  'tax.get_upcoming_tax_obligations': 'ภาษีที่ต้องยื่น',
  'tax.get_vat_summary': 'สรุป VAT',
  'tax.get_wht_summary': 'สรุปภาษีหัก ณ ที่จ่าย',
  'tax.get_cit_calendar': 'ปฏิทินภาษีเงินได้นิติบุคคล',
  'tax.list_missing_tax_documents': 'เอกสารภาษีที่ขาด',
  'tax.get_tax_code_profile': 'โปรไฟล์และความหมาย Tax Code',
  'tax.get_transaction_tax_summary': 'สรุปภาษีซื้อขาย นำเข้า ส่งออก และ ภ.พ.36',
  'tax.get_reconciliation_summary': 'กระทบยอดเอกสาร Tax Event บัญชี และแบบภาษี',
  'workflow.explain_run': 'รายละเอียดการทำงานอัตโนมัติ',
  'workflow.list_assigned_tasks': 'งานที่ได้รับมอบหมาย',
  'workflow.list_recent_failures': 'automation ที่ล้มเหลว',
  'workflow.summarize_rule_health': 'สุขภาพ automation',
  'billing.get_package_usage': 'แพ็กเกจและใบเสร็จคงเหลือ',
};

function formatMoney(value: unknown): string {
  const amount = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(amount)
    ? amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
}

function dailyClosingFacts(data: Record<string, unknown>): Array<{ label: string; value: string }> | undefined {
  const occurred = data['occurredToday'] as Record<string, unknown> | undefined;
  const due = data['dueEndOfDay'] as Record<string, unknown> | undefined;
  const overdue = data['overdue'] as Record<string, unknown> | undefined;
  const unscheduled = data['unscheduledOutstanding'] as Record<string, unknown> | undefined;
  const submitted = data['submittedToday'] as Record<string, unknown> | undefined;
  const pending = data['pendingReview'] as Record<string, unknown> | undefined;
  const evidence = data['evidenceBlockers'] as Record<string, unknown> | undefined;
  const duplicates = data['duplicateRisks'] as Record<string, unknown> | undefined;
  const scope = data['scope'] as Record<string, unknown> | undefined;
  if (typeof data['date'] !== 'string' || !occurred || !due || !overdue || !unscheduled
    || typeof submitted?.['count'] !== 'number' || typeof pending?.['count'] !== 'number'
    || typeof evidence?.['count'] !== 'number' || typeof duplicates?.['count'] !== 'number' || !scope) return undefined;

  const money = (value: unknown): string | undefined => {
    if (!Array.isArray(value)) return undefined;
    const groups: string[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') return undefined;
      const group = item as Record<string, unknown>;
      if (typeof group['currency'] !== 'string' || typeof group['total'] !== 'string' || typeof group['count'] !== 'number') return undefined;
      groups.push(`${formatMoney(group['total'])} ${group['currency']} (${group['count']} รายการ)`);
    }
    return groups.length > 0 ? groups.join(', ') : 'ไม่มี';
  };
  const bounded = (value: unknown): Record<string, unknown> | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const bucket = value as Record<string, unknown>;
    return typeof bucket['total'] === 'number' && Array.isArray(bucket['items']) ? bucket : undefined;
  };
  const itemLines = (value: unknown, amountField: 'grandTotalAmount' | 'outstandingAmount'): string => {
    const bucket = bounded(value);
    if (!bucket) return '';
    const lines = (bucket['items'] as Array<Record<string, unknown>>).slice(0, 3).map((item) => {
      const party = String(item['vendorName'] ?? item['categoryName'] ?? item['expenseNumber'] ?? 'ไม่ระบุรายการ');
      const payment = item['paymentStatus'] === 'PAID' ? 'จ่ายแล้ว'
        : item['paymentStatus'] === 'PARTIALLY_PAID' ? 'จ่ายบางส่วน'
          : item['paymentStatus'] === 'UNPAID' ? 'ยังไม่จ่าย' : undefined;
      const review = ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(String(item['status'] ?? '')) ? 'รอตรวจ' : undefined;
      return `${party} ${formatMoney(item[amountField])} ${String(item['currency'] ?? '')}${payment ? ` · ${payment}` : ''}${review ? ` · ${review}` : ''}`.trim();
    });
    const remaining = typeof bucket['remaining'] === 'number' ? bucket['remaining'] : Math.max(0, Number(bucket['total']) - lines.length);
    return lines.length > 0 ? ` — ${lines.join('; ')}${remaining > 0 ? `; อีก ${remaining} รายการ` : ''}` : '';
  };
  const occurredItems = bounded(occurred['items']);
  const totals = money(occurred['totals']);
  const paid = money(occurred['paid']);
  const outstanding = money(occurred['outstanding']);
  const dueTotals = money(due['totals']);
  const overdueTotals = money(overdue['totals']);
  const unscheduledTotals = money(unscheduled['totals']);
  if (!occurredItems || totals === undefined || paid === undefined || outstanding === undefined
    || dueTotals === undefined || overdueTotals === undefined || unscheduledTotals === undefined
    || !bounded(due['items']) || !bounded(overdue['items']) || !bounded(unscheduled['items'])) return undefined;

  const scopeLabel = scope['kind'] === 'all_branches' ? 'ทุกสาขาของบริษัท'
    : scope['kind'] === 'restricted_branches' ? 'เฉพาะสาขาตามสิทธิ์'
      : scope['kind'] === 'selected_branch' ? 'เฉพาะสาขาที่เลือก' : undefined;
  if (!scopeLabel) return undefined;
  return [
    { label: `สรุปปิดร้านวันที่ ${data['date']}`, value: scopeLabel },
    { label: 'ค่าใช้จ่ายที่เกิดวันนี้', value: `${occurredItems['total']} รายการ — ${totals}${itemLines(occurred['items'], 'grandTotalAmount')}` },
    { label: 'จ่ายแล้ว', value: paid },
    { label: 'ยังค้างจากรายการวันนี้', value: outstanding },
    { label: 'ถึงกำหนดวันนี้ (ไม่ได้แปลว่าอนุมัติให้จ่าย)', value: `${dueTotals}${itemLines(due['items'], 'outstandingAmount')}` },
    { label: 'เกินกำหนด', value: `${overdueTotals}${itemLines(overdue['items'], 'outstandingAmount')}` },
    { label: 'ยังไม่มีกำหนดจ่าย', value: `${unscheduledTotals}${itemLines(unscheduled['items'], 'outstandingAmount')}` },
    { label: 'ส่งเข้าระบบวันนี้', value: `${submitted['count']} รายการ` },
    { label: 'งานที่ต้องตรวจ', value: `รอตรวจ ${pending['count']} รายการ, หลักฐานต้องตาม ${evidence['count']} รายการ, เสี่ยงซ้ำ ${duplicates['count']} รายการ` },
    { label: 'ขอบเขตข้อมูล', value: 'ระบบไม่สามารถรู้บิลที่ไม่เคยส่งเข้าระบบได้' },
  ];
}

function hasExplicitShape(data: unknown): boolean {
  if (Array.isArray(data)) return true;
  if (!data || typeof data !== 'object') return data !== undefined && data !== null;
  return Object.values(data as Record<string, unknown>).some(hasExplicitShape);
}

export const ACCOUNTING_SUMMARY_SYSTEM_PROMPT = `
You are the Accounting Summary Agent for MangmeePlus LINE AI.
Your job is to summarize accounting and ledger information from permission-checked tool results only.
Do not invent numbers.
Treat SAP Tax Codes as company/profile-scoped aliases. Never infer O1 or any external code without the returned profile and effective date; legacy SAP ERP O1 and current S/4HANA O1 can mean different rates.
Keep zero-rated, exempt, non-taxable, import VAT, imported-service PP36, customs, excise, and withholding-tax meanings separate.
Explain read results only; do not present them as legal advice.
Do not post journals, approve expenses, make payments, close periods, file tax, or mutate accounting records.
If data is missing, say that the data is unavailable and suggest web review.
Output language must follow the user's input language.
`.trim();

export class AccountingSummaryAgent {
  constructor(private readonly erpTools: ErpToolClient, private readonly lineDraftEditEnabled = true) {}

  async run(
    ctx: AgentContext,
    intentItem: AgentIntentItem,
    toolBudget: number,
    toolInput: Record<string, unknown> = {},
    /** Period-resolution spec §3.4: the period the turn asked for, in the user's own words plus its
     *  dates (`เดือนที่แล้ว (1–31 ส.ค. 2569)`). Display only — it never selects or widens a read. */
    periodLabel?: string,
  ): Promise<SpecialistOutput> {
    const requested = new Set(intentItem.requiredTools);
    const tools = LINE_TOOL_REGISTRY
      .filter((t) => ALLOWED_TOOLS.has(t.name))
      .filter((t) => requested.size === 0 || requested.has(t.name))
      .slice(0, toolBudget);

    if (tools.length === 0) {
      return stub('accounting', 'UNSUPPORTED', 'ไม่มีเครื่องมือบัญชีที่พร้อมใช้งาน');
    }

    const toolCalls: AgentToolCall[] = [];
    const facts: AgentFact[] = [];
    // Spec §3.4: one period line per tool that echoed a window, appended AFTER the numbers it covers
    // and only for a tool whose read actually landed in `toolData`.
    const periodFacts: Array<{ tool: string; fact: AgentFact }> = [];
    const toolData: Array<{ tool: string; data: unknown; input?: Record<string, unknown> }> = [];
    let asOf: string | undefined;
    let permissionDenied = false;
    let unsupportedModule = false;
    let readFailed = false;
    let requiresHumanReview = false;

    for (const tool of tools) {
      const t0 = Date.now();
      const result = await this.erpTools.invoke(tool, ctx, toolInput);
      const durationMs = Date.now() - t0;
      const callStatus = result.status === 'ok' ? 'ok' : result.status;
      // M-02 G4: the failure code must reach AiToolInvocation.errorCode, not just the status class.
      toolCalls.push({ name: tool.name, status: callStatus, durationMs, ...(result.errorCode ? { errorCode: result.errorCode } : {}) });

      if (result.status === 'forbidden') { permissionDenied = true; continue; }
      if (result.status === 'unsupported_module') { unsupportedModule = true; continue; }
      if (result.status !== 'ok') { readFailed = true; continue; }
      if (!hasExplicitShape(result.data)) { readFailed = true; continue; }
      toolData.push({ tool: tool.name, data: result.data, input: toolInput });
      if (asOf === undefined) asOf = result.asOf;

      if (tool.name === 'notifications.get_daily_summary') {
        if (typeof result.data !== 'number') { readFailed = true; toolData.pop(); continue; }
        facts.push({ label: TOOL_FACT_LABELS[tool.name] ?? tool.name, value: `${result.data} รายการ`, ...(result.sourceRefs[0] && { sourceRef: result.sourceRefs[0] }) });
        continue;
      }

      const data = result.data as Record<string, unknown>;
      if (data['reviewRequired'] === true) requiresHumanReview = true;
      const period = periodFact(data, periodLabel);
      if (period) periodFacts.push({ tool: tool.name, fact: period });
      const sourceRef = result.sourceRefs[0];
      let sourceAttached = false;
      const pushFacts = (...items: Array<{ label: string; value: string }>) => {
        facts.push(...items.map((item) => {
          if (!sourceRef || sourceAttached) return item;
          sourceAttached = true;
          return { ...item, sourceRef };
        }));
      };
      if (data['found'] === false) {
        pushFacts({ label: TOOL_FACT_LABELS[tool.name] ?? tool.name, value: 'ไม่พบรายการที่ระบุ' });
      } else if (tool.name === 'company.list_branches') {
        const branches = Array.isArray(data['branches']) ? data['branches'] as Array<Record<string, unknown>> : undefined;
        if (typeof data['total'] !== 'number' && !branches) { readFailed = true; toolData.pop(); continue; }
        pushFacts({ label: 'สาขาทั้งหมด', value: `${String(data['total'] ?? branches!.length)} สาขา` });
        if (branches && branches.length > 0) {
          pushFacts({ label: 'รายชื่อสาขา', value: branches.slice(0, 10).map((b) => String(b['name'] ?? '-')).join(', ') });
        }
      } else if (tool.name === 'ledger.get_financial_summary') {
        pushFacts(
          { label: 'กำไรสุทธิ', value: String(data['netProfit'] ?? '-') },
          { label: 'สินทรัพย์รวม', value: String(data['totalAssets'] ?? '-') },
        );
      } else if (tool.name === 'ledger.get_period_status') {
        pushFacts({ label: `งวดบัญชี ${String(data['periodKey'] ?? '-')}`, value: `สถานะ ${String(data['status'] ?? '-')}, ${String(data['startDate'] ?? '-')} ถึง ${String(data['endDate'] ?? '-')}` });
      } else if (tool.name === 'ledger.get_report_summary') {
        const trial = data['trialBalance'] as Record<string, unknown> | undefined;
        const pnl = data['profitAndLoss'] as Record<string, unknown> | undefined;
        const balance = data['balanceSheet'] as Record<string, unknown> | undefined;
        if (trial) pushFacts({ label: 'งบทดลอง', value: `เดบิต ${String(trial['totalDebit'] ?? '-')}, เครดิต ${String(trial['totalCredit'] ?? '-')}, ผลต่าง ${String(trial['difference'] ?? '-')}` });
        if (pnl) pushFacts({ label: 'กำไรขาดทุน', value: `รายได้ ${String(pnl['revenue'] ?? '-')}, กำไรสุทธิ ${String(pnl['netProfit'] ?? '-')}` });
        if (balance) pushFacts({ label: 'งบดุล', value: `สินทรัพย์ ${String(balance['totalAssets'] ?? '-')}, หนี้สิน ${String(balance['totalLiabilities'] ?? '-')}, ส่วนของผู้ถือหุ้น ${String(balance['totalEquity'] ?? '-')}` });
        if (data['currency'] === null) pushFacts({ label: 'สกุลเงิน', value: 'แหล่งข้อมูลรายงานบัญชีนี้ไม่ได้ระบุสกุลเงิน' });
      } else if (tool.name === 'procurement.get_summary') {
        if (typeof data['total'] !== 'number') { readFailed = true; toolData.pop(); continue; }
        pushFacts({ label: 'ใบสั่งซื้อทั้งหมด', value: `${String(data['total'])} รายการ` });
        if (data['monetarySummaryAvailable'] === false) pushFacts({ label: 'ยอดเงินรวมใบสั่งซื้อ', value: 'แหล่งข้อมูลนี้ไม่มีผลรวมยอดเงินแบบแยกสกุลเงิน' });
      } else if (tool.name === 'procurement.search_suppliers') {
        const items = Array.isArray(data['items']) ? data['items'] as Array<Record<string, unknown>> : undefined;
        if (typeof data['total'] !== 'number' && !items) { readFailed = true; toolData.pop(); continue; }
        pushFacts({ label: 'ผู้ขายที่พบ', value: `${String(data['total'] ?? items!.length)} ราย` });
        if (items && items.length > 0) pushFacts({ label: 'รายชื่อผู้ขาย', value: items.slice(0, 10).map((item) => String(item['displayName'] ?? '-')).join(', ') });
      } else if (tool.name === 'procurement.get_purchase_order_detail') {
        pushFacts(
          { label: 'ใบสั่งซื้อ', value: `${String(data['purchaseOrderNumber'] ?? data['id'] ?? '-')} (${String(data['status'] ?? '-')})` },
          { label: 'ยอดรวม', value: `${String(data['grandTotalAmount'] ?? '-')} ${String(data['currency'] ?? '')}`.trim() },
        );
      } else if (tool.name === 'sales.get_sales_summary') {
        if (data['totalSales'] === undefined) { readFailed = true; toolData.pop(); continue; }
        pushFacts({ label: data['basis'] === 'recorded_received_payments' ? 'ยอดรับเงินจริง' : 'ยอดขาย', value: `${String(data['totalSales'])} บาท` });
        if (typeof data['transactionCount'] === 'number' || typeof data['transactionCount'] === 'string') {
          pushFacts({ label: 'จำนวนรายการ', value: `${String(data['transactionCount'])} รายการ` });
        }
      } else if (tool.name === 'crm.suggest_sales_followups') {
        pushFacts({ label: 'ลูกค้าที่ควรติดตาม', value: `${String(data['count'] ?? 0)} รายการ` });
      } else if (tool.name === 'company.get_current_context') {
        pushFacts({ label: 'บริษัท', value: String(data['name'] ?? '-') });
      } else if (tool.name === 'company.get_employee_detail') {
        const employee = data['employee'] as Record<string, unknown> | undefined;
        const candidates = Array.isArray(data['candidates']) ? data['candidates'] as Array<Record<string, unknown>> : [];
        if (employee) {
          const roles = Array.isArray(employee['roles']) ? (employee['roles'] as string[]).join('/') : '-';
          const contact = [employee['phoneNumber'], employee['email']].filter(Boolean).join(', ');
          pushFacts({ label: 'ข้อมูลพนักงาน', value: `${String(employee['name'] ?? '-')} (${roles})${contact ? ` ติดต่อ: ${contact}` : ''}` });
        } else if (candidates.length > 0) {
          pushFacts({ label: 'พบหลายคน', value: candidates.map((c) => String(c['name'] ?? '-')).join(', ') });
        } else {
          pushFacts({ label: 'ข้อมูลพนักงาน', value: 'ไม่พบพนักงานตามชื่อที่ระบุ' });
        }
      } else if (tool.name === 'dashboard.get_business_health_summary') {
        if (!Array.isArray(data['widgets'])) { readFailed = true; toolData.pop(); continue; }
        const widgets = data['widgets'];
        pushFacts({ label: 'แดชบอร์ด', value: `${widgets.length} ตัวชี้วัด` });
      } else if (tool.name === 'expense.list_recent') {
        // Branch the user named could not be resolved: the tool returned the real branch catalog
        // instead of records. Surface both so the composed answer offers the actual names rather
        // than reporting zero expenses for a branch that exists under another spelling.
        if (typeof data['branchUnresolved'] === 'string') {
          const names = Array.isArray(data['availableBranches'])
            ? (data['availableBranches'] as Array<Record<string, unknown>>).map((b) => String(b['name'] ?? '')).filter(Boolean)
            : [];
          pushFacts({
            label: 'สาขา',
            value: `ไม่พบสาขา "${data['branchUnresolved']}"${names.length ? ` สาขาที่มี: ${names.join(', ')}` : ''}`,
          });
          continue;
        }
        const summary = data['summary'] as Record<string, unknown> | undefined;
        const items = Array.isArray(data['items']) ? data['items'] as Array<Record<string, unknown>> : [];
        if (summary) {
          pushFacts(
            { label: 'ยอดทั้งหมด', value: `${formatMoney(summary['totalAmount'])} บาท` },
            // Work in progress is everything from DRAFT through READY_FOR_CONFIRMATION, not just
            // drafts. `draftAmount` is the pre-`pendingAmount` API fallback, not a second figure.
            { label: 'รอตรวจสอบ', value: `${formatMoney(summary['pendingAmount'] ?? summary['draftAmount'])} บาท` },
            { label: 'ยืนยันแล้ว', value: `${formatMoney(summary['confirmedAmount'])} บาท` },
            { label: 'จ่ายแล้ว', value: `${formatMoney(summary['paidAmount'])} บาท` },
            { label: 'ยังไม่จ่าย', value: `${formatMoney(summary['unpaidAmount'])} บาท` },
          );
          for (const item of items.slice(0, 5)) {
            const vendor = String(item['vendorNameSnapshot'] ?? item['vendorName'] ?? '').trim();
            if (vendor) pushFacts({ label: 'รายการค่าใช้จ่ายล่าสุด', value: `${vendor} ${formatMoney(item['grandTotalAmount'])} บาท` });
          }
          continue;
        }
        if (items.length === 0) {
          pushFacts({ label: 'ค่าใช้จ่าย', value: 'ยังไม่มีรายการ' });
        } else {
          const totalAmount = items.reduce((sum, item) => sum + Number(String(item['grandTotalAmount'] ?? '0').replace(/,/g, '')), 0);
          pushFacts({ label: 'ยอดทั้งหมด', value: `${formatMoney(totalAmount)} บาท` });
        }
      } else if (tool.name === 'expense.explain_record') {
        // Spec §5.5: the whole answer is the deterministic Thai template, so the grounded fact IS
        // that text. The orchestrator uses the same renderer for replyText and never lets the model
        // rewrite it; this fact exists so the output is SUCCEEDED and carries the record's link.
        const explained = formatExpenseExplainReply(data, this.lineDraftEditEnabled);
        if (!explained) { readFailed = true; toolData.pop(); continue; }
        pushFacts({ label: TOOL_FACT_LABELS[tool.name]!, value: explained });
      } else if ((LINE_DRAFT_UPDATE_TOOLS as readonly string[]).includes(tool.name)) {
        // Spec §5.4: a preview is stated by the deterministic template, never phrased by the model —
        // the whole point is that no sentence about this money exists that the server did not
        // compute. A payload the formatter cannot fully verify is treated as a failed read.
        const rendered = formatDraftUpdateReply(data);
        if (!rendered) { readFailed = true; toolData.pop(); continue; }
        pushFacts({ label: TOOL_FACT_LABELS[tool.name]!, value: rendered });
      } else if (tool.name === 'expense.get_breakdown') {
        // Same shape as list_recent's branchUnresolved below: a categoryName/vendorName the caller
        // sent can resolve to several matches or none, so the tool returns the name catalog instead
        // of a breakdown. Keep this in toolData (never popped) and out of readFailed so the
        // orchestrator's generalized name-resolution reply (spec item 2c) can read it — popping here
        // was the bug: it silently turned a legitimate clarification into "ไม่สามารถดึงข้อมูลได้".
        const nameIssueField = (['category', 'vendor'] as const).find(
          (field) => typeof data[`${field}Ambiguous`] === 'string' || typeof data[`${field}Unresolved`] === 'string',
        );
        if (nameIssueField) {
          const ambiguous = data[`${nameIssueField}Ambiguous`];
          const requestedName = String(ambiguous ?? data[`${nameIssueField}Unresolved`]);
          const availableKey = nameIssueField === 'category' ? 'availableCategories' : 'availableVendors';
          const names = Array.isArray(data[availableKey])
            ? (data[availableKey] as Array<Record<string, unknown>>).map((entry) => String(entry['name'] ?? '')).filter(Boolean)
            : [];
          const fieldLabel = nameIssueField === 'category' ? 'หมวด' : 'ร้าน';
          pushFacts({
            label: fieldLabel,
            value: typeof ambiguous === 'string'
              ? `"${requestedName}" มีหลาย${fieldLabel}${names.length ? `: ${names.join(', ')}` : ''}`
              : `ไม่พบ${fieldLabel} "${requestedName}"${names.length ? ` ${fieldLabel}ที่มี: ${names.join(', ')}` : ''}`,
          });
          continue;
        }
        if (data['totalCount'] === undefined || data['totalAmount'] === undefined) { readFailed = true; toolData.pop(); continue; }
        pushFacts({
          label: 'ค่าใช้จ่าย',
          value: `${String(data['totalCount'])} รายการ รวม ${formatMoney(data['totalAmount'])} บาท`,
        });
        // R-L4/spec §3 row 4-5: the whole point of a breakdown question is which group is which —
        // the model previously saw only the grand total and had nothing to compose a breakdown
        // answer from. Top 8 per axis (R-A2's own cap); each group's own amount is already the
        // tool's grounded number, never recomputed here.
        const group = (rows: unknown, label: string, nameKey: string) => {
          for (const row of (Array.isArray(rows) ? rows as Array<Record<string, unknown>> : []).slice(0, 8)) {
            pushFacts({ label, value: `${String(row[nameKey] ?? '-')} ${formatMoney(row['totalAmount'])} บาท (${String(row['count'] ?? '-')} รายการ)` });
          }
        };
        group(data['byCategory'], 'หมวด', 'category');
        group(data['byBranch'], 'สาขา', 'branch');
        group(data['byVendor'], 'ร้าน', 'vendor');
      } else if (tool.name === 'expense.get_daily_closing') {
        const dailyFacts = dailyClosingFacts(data);
        if (!dailyFacts) { readFailed = true; toolData.pop(); continue; }
        pushFacts(...dailyFacts);
      } else {
        // Generic shaping for the wider read-tool set (tax/workflow/AP/...): surface count/total
        // style fields for the deterministic fallback; the model answer layer gets the full raw
        // data via toolData either way.
        const summaryBits: string[] = [];
        for (const key of ['total', 'count', 'openCount', 'overdueCount', 'unassignedCount', 'outstandingTotal', 'headcount', 'netPayable', 'dueSoonCount']) {
          if (data[key] !== undefined && (typeof data[key] === 'string' || typeof data[key] === 'number')) {
            summaryBits.push(`${key}: ${String(data[key])}`);
          }
        }
        const emptyCollections = Object.values(data).filter(Array.isArray) as unknown[][];
        const explicitMessage = typeof data['message'] === 'string' ? data['message'] : undefined;
        if (summaryBits.length === 0 && !explicitMessage && emptyCollections.length > 0 && emptyCollections.every((items) => items.length === 0)) {
          pushFacts({ label: TOOL_FACT_LABELS[tool.name] ?? tool.name, value: 'ไม่มีรายการ' });
          continue;
        }
        pushFacts({
          label: TOOL_FACT_LABELS[tool.name] ?? tool.name,
          value: data['reviewRequired'] === true
            ? String(data['message'] ?? 'ต้องให้ผู้ดูแลภาษีตรวจสอบก่อนใช้ผลลัพธ์')
            : explicitMessage ?? (summaryBits.length > 0 ? summaryBits.join(', ') : 'ข้อมูลพร้อมแล้ว (ดูรายละเอียดในเว็บแอป)'),
        });
      }
    }

    for (const entry of periodFacts) {
      if (toolData.some((item) => item.tool === entry.tool)) facts.push(entry.fact);
    }

    if (permissionDenied && facts.length === 0) {
      return { ...stub('accounting', 'PERMISSION_DENIED', 'ไม่มีสิทธิ์เข้าถึงข้อมูลบัญชี'), toolCalls };
    }
    if (unsupportedModule && facts.length === 0) {
      return { ...stub('accounting', 'UNSUPPORTED', 'ฟีเจอร์นี้ยังไม่พร้อมใช้งาน กรุณาตรวจสอบผ่านเว็บแอป'), toolCalls };
    }
    if (readFailed && facts.length === 0) {
      return {
        ...stub('accounting', 'FAILED', requested.has('expense.list_recent') || requested.has('expense.get_daily_closing')
          ? 'ไม่สามารถดึงรายการค่าใช้จ่ายได้ในขณะนี้'
          : 'ไม่สามารถดึงข้อมูลได้ในขณะนี้'),
        toolCalls,
      };
    }
    if ((requested.has('expense.list_recent') || requested.has('expense.get_daily_closing')) && facts.length === 0) {
      return { ...stub('accounting', 'UNSUPPORTED', 'ไม่พบรายการค่าใช้จ่ายที่พร้อมแสดง หรือไม่สามารถดึงรายการค่าใช้จ่ายได้ในขณะนี้'), toolCalls };
    }

    return {
      agent: 'accounting',
      status: facts.length > 0 ? 'SUCCEEDED' : 'UNSUPPORTED',
      summary: facts.length > 0 ? facts.map((f) => `${f.label}: ${f.value}`).join(', ') : 'ไม่พบข้อมูลบัญชี (endpoint ยังไม่พร้อม)',
      facts,
      suggestions: [],
      toolCalls,
      requiresHumanReview,
      toolData,
      ...(asOf ? { asOf } : {}),
    };
  }
}

function stub(agent: 'accounting', status: SpecialistOutput['status'], summary: string): SpecialistOutput {
  return { agent, status, summary, facts: [], suggestions: [], toolCalls: [], requiresHumanReview: false };
}
