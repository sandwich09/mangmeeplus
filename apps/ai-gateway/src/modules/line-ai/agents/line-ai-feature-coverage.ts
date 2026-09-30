import { LINE_TOOL_REGISTRY } from '@watchdog-bms/contracts';

export type LineAiCoverageStatus = 'covered' | 'web_only' | 'feature_gated';
export type LineAiQuestionKind = 'summary' | 'search' | 'list' | 'detail' | 'report' | 'explain' | 'suggestion' | 'evidence_capture';

export type LineAiCoverageTool = {
  name: string;
  requiredPermissions: readonly string[];
  anyOfPermissions?: readonly string[];
  sourceModule: string;
};

export type LineAiFeatureCoverageRow = {
  id: string;
  feature: string;
  status: LineAiCoverageStatus;
  questionKinds: readonly LineAiQuestionKind[];
  tools: readonly LineAiCoverageTool[];
  requiredPermissions: readonly string[];
  sourceModule: string;
  navigationMenuIds?: readonly string[];
  reason?: string;
  owningItem?: string;
};

const registryByName = new Map(LINE_TOOL_REGISTRY.map((tool) => [tool.name, tool]));

function tools(...names: string[]): LineAiCoverageTool[] {
  return names.map((name) => {
    const tool = registryByName.get(name);
    if (!tool) throw new Error(`Unknown LINE tool in coverage manifest: ${name}`);
    return {
      name,
      requiredPermissions: tool.requiredPermissions,
      ...(tool.anyOfPermissions?.length ? { anyOfPermissions: tool.anyOfPermissions } : {}),
      sourceModule: tool.sourceModule,
    };
  });
}

/**
 * 2026-07-15 executable baseline. `covered` means registry + router + specialist
 * reachability are observable in the gateway. API DI reachability stays governed by
 * the API controller tests and must not be inferred here.
 */
export const LINE_AI_FEATURE_COVERAGE: readonly LineAiFeatureCoverageRow[] = [
  {
    id: 'public_lookup_v2', feature: 'Policy-bounded public lookup', status: 'feature_gated',
    questionKinds: ['explain'], tools: tools('public.lookup'), requiredPermissions: ['ai.tool.invoke'],
    sourceModule: 'public', owningItem: 'W09',
    reason: 'Semantic v2 executor and public lookup flags must be enabled; API policy admission is not searched evidence.',
  },
  {
    id: 'reimbursement_draft_v2', feature: 'Reimbursement draft collection and preview', status: 'feature_gated',
    questionKinds: ['evidence_capture'],
    tools: tools('reimbursement.draft.get_options', 'reimbursement.draft.preview_create', 'reimbursement.draft.preview_update'),
    requiredPermissions: ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.finance_review'],
    sourceModule: 'reimbursements', owningItem: 'W06c',
    reason: 'Semantic v2 and reimbursement draft flags must be enabled; API rechecks each tool permission and confirmation before mutation.',
  },
  {
    id: 'company_context', feature: 'Company and branch context', status: 'covered',
    questionKinds: ['summary', 'list'],
    tools: tools('company.get_current_context', 'company.list_branches'),
    requiredPermissions: ['company.setup.read', 'company.branch.read'], sourceModule: 'data-model-core',
  },
  {
    id: 'dashboard_health', feature: 'Business health dashboard', status: 'covered', questionKinds: ['summary'],
    tools: tools('dashboard.get_business_health_summary'), requiredPermissions: ['dashboard.read'],
    sourceModule: 'dashboard-notifications', navigationMenuIds: ['dashboard'],
  },
  {
    id: 'notifications', feature: 'Alerts and daily notifications', status: 'covered', questionKinds: ['summary', 'list'],
    tools: tools('notifications.list_open_alerts', 'notifications.get_daily_summary'), requiredPermissions: ['notification.read'],
    sourceModule: 'dashboard-notifications', navigationMenuIds: ['notifications'],
  },
  {
    id: 'inventory_product_search', feature: 'Inventory product search', status: 'covered', questionKinds: ['search'],
    tools: tools('inventory.search_products'), requiredPermissions: ['inventory.product.read'], sourceModule: 'inventory',
  },
  {
    id: 'inventory_operations', feature: 'Inventory balances, low stock, and movements', status: 'covered',
    questionKinds: ['summary', 'list', 'detail'],
    tools: tools('inventory.get_stock_balance', 'inventory.list_low_stock', 'inventory.summarize_stock_movements'),
    requiredPermissions: ['inventory.product.read', 'inventory.movement.read', 'inventory.report.read'], sourceModule: 'inventory',
  },
  {
    id: 'ledger_financial_summary', feature: 'Ledger financial summary', status: 'covered', questionKinds: ['report'],
    tools: tools('ledger.get_financial_summary'), requiredPermissions: ['ledger.report.read'], sourceModule: 'ledger',
  },
  {
    id: 'expenses', feature: 'Expense recency, breakdown, and owner daily closing', status: 'covered', questionKinds: ['summary', 'list'],
    tools: tools('expense.list_recent', 'expense.get_breakdown', 'expense.get_daily_closing'), requiredPermissions: ['expense.read', 'expense.read_related', 'expense.read_own'],
    sourceModule: 'expenses', navigationMenuIds: ['expenses'],
  },
  {
    id: 'substitute_receipt_queue', feature: 'Substitute receipts waiting for my signature or approval', status: 'covered', questionKinds: ['summary', 'list'],
    tools: tools('expense.list_substitute_receipts_to_sign'), requiredPermissions: ['expense.read_related', 'expense.read_own', 'expense.confirm'],
    sourceModule: 'expenses',
  },
  {
    id: 'sales_received', feature: 'Sales and customer cash received summary', status: 'covered', questionKinds: ['report'],
    tools: tools('sales.get_sales_summary'), requiredPermissions: ['crm.report.read'], sourceModule: 'accounting-documents',
  },
  {
    id: 'crm_followup_suggestions', feature: 'CRM sales follow-up suggestions', status: 'feature_gated', questionKinds: ['suggestion'],
    tools: tools('crm.suggest_sales_followups'), requiredPermissions: ['crm.customer.read'], sourceModule: 'crm-sales',
    owningItem: '10G', reason: 'Registered but router-disabled and no API adapter is wired.',
  },
  {
    id: 'accounting_evidence_tool', feature: 'Model-selectable accounting evidence capture', status: 'feature_gated',
    questionKinds: ['evidence_capture'], tools: tools('accounting.capture_receipt_evidence'),
    requiredPermissions: ['expense.receipt.upload'], sourceModule: 'expenses', owningItem: '10G',
    reason: 'Registered but router-disabled; receipt intake uses the separate deterministic API-owned pipeline.',
  },
  {
    id: 'accounting_documents', feature: 'Accounting document summaries and recent documents', status: 'covered',
    questionKinds: ['summary', 'list'], tools: tools('accounting.get_summary', 'accounting.list_recent_documents'),
    requiredPermissions: ['accounting.document.read', 'accounting.document.read_related'], sourceModule: 'accounting-documents', navigationMenuIds: ['salesdoc'],
  },
  {
    id: 'procurement_ap', feature: 'Accounts payable outstanding', status: 'covered', questionKinds: ['summary', 'report'],
    tools: tools('procurement.get_ap_outstanding'), requiredPermissions: ['procurement.ap.report'], sourceModule: 'procurement',
  },
  {
    id: 'employees', feature: 'Employee headcount and named employee detail', status: 'covered', questionKinds: ['summary', 'detail'],
    tools: tools('company.get_employee_summary', 'company.get_employee_detail'), requiredPermissions: ['access.employee.read'],
    sourceModule: 'employee-access',
  },
  {
    id: 'banking', feature: 'Bank balances and reconciliation', status: 'feature_gated', questionKinds: ['summary'],
    tools: tools('bank.get_account_balances', 'bank.get_reconciliation_status'),
    requiredPermissions: ['bank.account.read', 'bank.reconciliation.read'], sourceModule: 'banking', owningItem: '13/14',
    reason: 'Registered but router-disabled until the banking source modules ship.',
  },
  {
    id: 'reimbursements', feature: 'Pending reimbursements', status: 'covered', questionKinds: ['list'],
    tools: tools('reimbursement.list_pending_approvals'), requiredPermissions: ['reimbursement.approve'], sourceModule: 'reimbursements',
  },
  {
    id: 'hr_leave', feature: 'HR leave summary', status: 'feature_gated', questionKinds: ['summary'],
    tools: tools('hr.get_leave_summary'), requiredPermissions: ['hr.leave.read'], sourceModule: 'hr', owningItem: '20',
    reason: 'Registered but router-disabled until the HR source adapter ships.',
  },
  {
    id: 'governed_reports', feature: 'Governed monthly reports', status: 'covered', questionKinds: ['report'],
    tools: tools('reports.get_monthly_report_summary'),
    requiredPermissions: ['report.catalog.read', 'report.dataset.read', 'report.query.run'], sourceModule: 'reports',
    navigationMenuIds: ['reports'],
  },
  {
    id: 'tax', feature: 'Tax obligations, summaries, profiles, and reconciliation', status: 'covered',
    questionKinds: ['summary', 'list', 'detail', 'report'],
    tools: tools(
      'tax.get_upcoming_tax_obligations', 'tax.get_vat_summary', 'tax.get_wht_summary', 'tax.get_cit_calendar',
      'tax.list_missing_tax_documents', 'tax.get_tax_code_profile', 'tax.get_transaction_tax_summary', 'tax.get_reconciliation_summary',
    ),
    requiredPermissions: ['tax.period.read', 'tax.event.read', 'tax.review_issue.read', 'tax.profile.read', 'tax.config.read', 'tax.report.read', 'ledger.journal.read'],
    sourceModule: 'tax',
  },
  {
    id: 'workflow', feature: 'Workflow tasks, failures, run explanation, and rule health', status: 'covered',
    questionKinds: ['summary', 'list', 'explain'],
    tools: tools('workflow.explain_run', 'workflow.list_assigned_tasks', 'workflow.list_recent_failures', 'workflow.summarize_rule_health'),
    requiredPermissions: ['workflow.run.read', 'workflow.task.read', 'workflow.rule.read'], sourceModule: 'workflow',
  },

  // Coverage closure for shipped reads, followed by the remaining explicit web-only gaps.
  { id: 'crm_customers', feature: 'CRM customer summary, search, and 360', status: 'covered', questionKinds: ['summary', 'search', 'detail'], tools: tools('crm.get_customer_summary', 'crm.search_customers', 'crm.get_customer_360'), requiredPermissions: ['crm.customer.read'], sourceModule: 'crm', navigationMenuIds: ['customers'] },
  { id: 'crm_inbox', feature: 'CRM inbox conversations', status: 'covered', questionKinds: ['summary', 'list', 'detail'], tools: tools('crm.get_inbox_summary', 'crm.list_conversations', 'crm.get_conversation_summary'), requiredPermissions: ['crm.inbox.read'], sourceModule: 'crm-inbox', navigationMenuIds: ['inbox'] },
  { id: 'crm_booking', feature: 'CRM bookings', status: 'covered', questionKinds: ['summary', 'list', 'detail'], tools: tools('crm.get_booking_summary', 'crm.list_bookings'), requiredPermissions: ['crm.booking.read'], sourceModule: 'crm', navigationMenuIds: ['booking'] },
  { id: 'crm_reports', feature: 'CRM reports, pipeline, and follow-ups', status: 'covered', questionKinds: ['summary', 'list', 'report'], tools: tools('crm.get_report_summary', 'crm.get_pipeline_summary', 'crm.list_open_followups'), requiredPermissions: ['crm.report.read', 'crm.opportunity.read', 'crm.follow_up.read'], sourceModule: 'crm/crm-inbox', navigationMenuIds: ['crmreport'] },
  { id: 'inventory_product_detail', feature: 'Inventory product detail', status: 'covered', questionKinds: ['detail'], tools: tools('inventory.get_product_detail'), requiredPermissions: ['inventory.product.read'], sourceModule: 'inventory' },
  { id: 'accounting_document_detail', feature: 'Accounting document detail and receivables', status: 'covered', questionKinds: ['detail', 'summary'], tools: tools('accounting.get_document_detail', 'accounting.get_receivable_summary'), requiredPermissions: ['accounting.document.read', 'accounting.document.read_related'], sourceModule: 'accounting-documents' },
  { id: 'expense_detail', feature: 'Expense detail and record explanation', status: 'covered', questionKinds: ['detail', 'explain'], tools: tools('expense.get_detail', 'expense.explain_record'), requiredPermissions: ['expense.read', 'expense.review', 'expense.read_related', 'expense.read_own'], sourceModule: 'expenses' },
  // Capture appendix §10.1 (spec §17.5). The tool is registered and API-wired, but the question it
  // answers — "ไฟล์เมื่อกี้ทำไมส่งไม่ได้" — is answered DETERMINISTICALLY by the webhook's own §17.5
  // handler before any model runs, exactly as §17.5 requires when AI is unavailable. It is not in
  // the router catalog or a specialist's allow-list yet, so claiming coverage here would be false.
  {
    id: 'line_file_attempt', feature: 'Explain what happened to a file sent over LINE', status: 'feature_gated',
    questionKinds: ['explain'], tools: tools('line.explain_file_attempt'),
    requiredPermissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create'],
    sourceModule: 'line-ai', owningItem: 'W02-LINE (capture appendix §10.1)',
    reason: 'Answered deterministically by the §17.5 LINE status handler; the router catalog and the specialist allow-lists do not offer this tool yet.',
  },
  // S-4 (draft-control spec §5.4). `covered` describes gateway reachability only, which is what this
  // manifest asserts; whether the five tools are OFFERED on a given deployment is
  // `LINE_AI_DRAFT_EDIT_ENABLED`, enforced in the router catalog and the API executor.
  { id: 'expense_draft_edit', feature: 'Edit a captured expense draft over LINE (preview then confirm)', status: 'covered', questionKinds: ['detail'], tools: tools('expense.draft.set_header', 'expense.draft.set_line', 'expense.draft.add_charge', 'expense.draft.remove_line', 'expense.draft.set_vat_mode'), requiredPermissions: ['expense.update'], sourceModule: 'expenses' },
  { id: 'reimbursement_detail', feature: 'Reimbursement summary and detail', status: 'covered', questionKinds: ['summary', 'detail'], tools: tools('reimbursement.get_summary', 'reimbursement.get_detail'), requiredPermissions: ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'], sourceModule: 'reimbursements' },
  { id: 'reimbursement_backlog', feature: 'Whose desk the waiting reimbursement claims are on', status: 'covered', questionKinds: ['summary', 'list'], tools: tools('reimbursement.get_approval_backlog'), requiredPermissions: ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'], sourceModule: 'reimbursements' },
  { id: 'procurement_operations', feature: 'Suppliers and purchase orders', status: 'covered', questionKinds: ['summary', 'search', 'detail'], tools: tools('procurement.get_summary', 'procurement.search_suppliers', 'procurement.get_purchase_order_detail'), requiredPermissions: ['procurement.supplier.read', 'procurement.purchase_order.read'], sourceModule: 'procurement' },
  { id: 'ledger_journal', feature: 'Journal entries', status: 'web_only', questionKinds: ['list', 'detail'], tools: [], requiredPermissions: ['ledger.journal.read'], sourceModule: 'ledger', navigationMenuIds: ['journal'], reason: 'Financial summary does not expose journal entries.' },
  { id: 'ledger_periods', feature: 'Ledger period status and canonical reports', status: 'covered', questionKinds: ['summary', 'detail', 'report'], tools: tools('ledger.get_period_status', 'ledger.get_report_summary'), requiredPermissions: ['ledger.period.read', 'ledger.report.read'], sourceModule: 'ledger', navigationMenuIds: ['closing'] },
  { id: 'role_read', feature: 'Role and permission read', status: 'web_only', questionKinds: ['list', 'detail'], tools: [], requiredPermissions: ['access.role.read'], sourceModule: 'employee-access', navigationMenuIds: ['roles'], reason: 'No LINE role read tool is registered; mutations remain blocked.' },

  // Navigation placeholders or owning features not production-ready for LINE reads.
  { id: 'sales_navigation', feature: 'POS sales navigation', status: 'feature_gated', questionKinds: ['summary', 'list', 'detail'], tools: [], requiredPermissions: [], sourceModule: 'sales', navigationMenuIds: ['sales'], owningItem: 'owning feature', reason: 'The menu has no grantable view permission yet.' },
  { id: 'broadcast', feature: 'CRM broadcast', status: 'feature_gated', questionKinds: ['summary', 'list'], tools: [], requiredPermissions: ['crm.report.read'], sourceModule: 'crm-sales', navigationMenuIds: ['broadcast'], owningItem: 'owning feature', reason: 'Broadcast read contracts are not shipped.' },
  { id: 'po_approval_policy', feature: 'Purchase-order approval policy', status: 'feature_gated', questionKinds: ['summary', 'detail'], tools: [], requiredPermissions: ['procurement.approval_policy.read'], sourceModule: 'procurement', navigationMenuIds: ['poapproval'], owningItem: 'owning feature', reason: 'Permission and source contract are forward-declared only.' },
  { id: 'discount_policy', feature: 'CRM discount policy', status: 'feature_gated', questionKinds: ['summary', 'detail'], tools: [], requiredPermissions: ['crm.discount_policy.read'], sourceModule: 'crm-sales', navigationMenuIds: ['discount'], owningItem: 'owning feature', reason: 'Permission and source contract are forward-declared only.' },
  { id: 'fixed_assets', feature: 'Fixed assets', status: 'feature_gated', questionKinds: ['summary', 'search', 'detail'], tools: [], requiredPermissions: [], sourceModule: 'fixed-assets', owningItem: '21', reason: 'Owning module is not production-ready.' },
  { id: 'marketplace', feature: 'Marketplace orders and performance', status: 'feature_gated', questionKinds: ['summary', 'list', 'detail', 'report'], tools: [], requiredPermissions: [], sourceModule: 'marketplace', owningItem: '19', reason: 'Owning module is not production-ready.' },
] as const;
