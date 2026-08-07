/**
 * AccountingSummaryAgent – reads ledger/accounting summary.
 * Allowlisted tools: read-only business summary tools.
 */
import type { AgentContext } from './agent-types';
import type { AgentIntentItem, SpecialistOutput, AgentFact, AgentToolCall } from '@watchdog-bms/contracts';
import { LINE_TOOL_REGISTRY } from '@watchdog-bms/contracts';
import type { ErpToolClient } from '../infrastructure/erp-tool.client';

export const ALLOWED_TOOLS = new Set([
  'accounting.get_summary',
  'accounting.list_recent_documents',
  'accounting.get_document_detail',
  'accounting.get_receivable_summary',
  'ledger.get_financial_summary',
  'ledger.get_period_status',
  'ledger.get_report_summary',
  'expense.list_recent',
  'expense.get_detail',
  'expense.get_breakdown',
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
]);

const TOOL_FACT_LABELS: Record<string, string> = {
  'accounting.get_document_detail': 'ข้อมูลเอกสารบัญชี',
  'accounting.get_receivable_summary': 'สรุปลูกหนี้คงค้าง',
  'expense.get_detail': 'ข้อมูลค่าใช้จ่าย',
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
};

function formatMoney(value: unknown): string {
  const amount = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(amount)
    ? amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
}

function hasExplicitShape(data: unknown): boolean {
  if (Array.isArray(data)) return true;
  if (!data || typeof data !== 'object') return data !== undefined && data !== null;
  return Object.values(data as Record<string, unknown>).some(hasExplicitShape);
}

export const ACCOUNTING_SUMMARY_SYSTEM_PROMPT = `
You are the Accounting Summary Agent for WatchDog-BMS LINE AI.
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
  constructor(private readonly erpTools: ErpToolClient) {}

  async run(ctx: AgentContext, intentItem: AgentIntentItem, toolBudget: number, toolInput: Record<string, unknown> = {}): Promise<SpecialistOutput> {
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
    const toolData: Array<{ tool: string; data: unknown }> = [];
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
      toolData.push({ tool: tool.name, data: result.data });

      if (tool.name === 'notifications.get_daily_summary') {
        if (typeof result.data !== 'number') { readFailed = true; toolData.pop(); continue; }
        facts.push({ label: TOOL_FACT_LABELS[tool.name] ?? tool.name, value: `${result.data} รายการ`, ...(result.sourceRefs[0] && { sourceRef: result.sourceRefs[0] }) });
        continue;
      }

      const data = result.data as Record<string, unknown>;
      if (data['reviewRequired'] === true) requiresHumanReview = true;
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
        const summary = data['summary'] as Record<string, unknown> | undefined;
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
          continue;
        }
        const items = Array.isArray(data['items']) ? data['items'] as Array<Record<string, unknown>> : [];
        if (items.length === 0) {
          pushFacts({ label: 'ค่าใช้จ่าย', value: 'ยังไม่มีรายการ' });
        } else {
          const totalAmount = items.reduce((sum, item) => sum + Number(String(item['grandTotalAmount'] ?? '0').replace(/,/g, '')), 0);
          pushFacts({ label: 'ยอดทั้งหมด', value: `${formatMoney(totalAmount)} บาท` });
        }
      } else if (tool.name === 'expense.get_breakdown') {
        if (data['totalCount'] === undefined || data['totalAmount'] === undefined) { readFailed = true; toolData.pop(); continue; }
        pushFacts({
          label: 'ค่าใช้จ่าย',
          value: `${String(data['totalCount'])} รายการ รวม ${formatMoney(data['totalAmount'])} บาท`,
        });
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

    if (permissionDenied && facts.length === 0) {
      return { ...stub('accounting', 'PERMISSION_DENIED', 'ไม่มีสิทธิ์เข้าถึงข้อมูลบัญชี'), toolCalls };
    }
    if (unsupportedModule && facts.length === 0) {
      return { ...stub('accounting', 'UNSUPPORTED', 'ฟีเจอร์นี้ยังไม่พร้อมใช้งาน กรุณาตรวจสอบผ่านเว็บแอป'), toolCalls };
    }
    if (readFailed && facts.length === 0) {
      return {
        ...stub('accounting', 'FAILED', requested.has('expense.list_recent')
          ? 'ไม่สามารถดึงรายการค่าใช้จ่ายได้ในขณะนี้'
          : 'ไม่สามารถดึงข้อมูลได้ในขณะนี้'),
        toolCalls,
      };
    }
    if (requested.has('expense.list_recent') && facts.length === 0) {
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
    };
  }
}

function stub(agent: 'accounting', status: SpecialistOutput['status'], summary: string): SpecialistOutput {
  return { agent, status, summary, facts: [], suggestions: [], toolCalls: [], requiresHumanReview: false };
}
