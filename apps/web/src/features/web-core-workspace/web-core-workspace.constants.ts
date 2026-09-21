import type { WorkspaceModule, NavGroup } from './web-core-workspace.model';

/**
 * Accounting screens are not open to users in this launch (owner decision 2026-08-09; audit CR-2,
 * CR-3). This is PRESENTATION ONLY: the `double_entry_ledger` entitlement stays ON so background
 * posting, account codes and tax mapping keep working server-side, and no entitlement migration is
 * needed for companies already onboarded. Hiding here rather than in the entitlement is the whole
 * point — turning the feature off would stop the posting we still want.
 *
 * Covers both the sidebar row and direct-URL access (`filterModulesByPermissions` and
 * `canAccessWorkspacePath`). Set to false / empty the set to reopen the screens; the routes,
 * permissions and APIs are untouched.
 */
export const ACCOUNTING_UI_HIDDEN: boolean = true;

/** Workspace modules hidden by {@link ACCOUNTING_UI_HIDDEN}: สมุดรายวัน and รอบบัญชี. */
export const ACCOUNTING_UI_HIDDEN_MODULE_KEYS: ReadonlySet<string> = new Set(['journal', 'closing']);

export const WORKSPACE_MODULES: WorkspaceModule[] = [
  {
    key: 'dashboard',
    labelKey: 'module.dashboard',
    buildHref: (companyId) => `/companies/${companyId}/dashboard`,
    iconKey: 'GridIcon',
    navGroup: 'main',
    // An empty gate would make dashboard_notifications unable to hide this module.
    requiredAnyPermissions: ['dashboard.read'],
    status: 'ready',
    deepLinkTargets: ['dashboard'],
  },
  {
    key: 'inbox',
    labelKey: 'module.inbox',
    buildHref: (companyId) => `/companies/${companyId}/inbox`,
    iconKey: 'ChatIcon',
    navGroup: 'operate',
    requiredAnyPermissions: ['crm.inbox.read'],
    status: 'ready',
    deepLinkTargets: ['conversation'],
  },
  {
    key: 'sales',
    labelKey: 'module.sales',
    buildHref: (companyId) => `/companies/${companyId}/sales`,
    iconKey: 'ShoppingCartIcon',
    navGroup: 'operate',
    requiredAnyPermissions: ['accounting.quotation.read', 'accounting.invoice.read'],
    status: 'planned',
    deepLinkTargets: ['invoice'],
  },
  {
    key: 'customers',
    labelKey: 'module.customers',
    buildHref: (companyId) => `/companies/${companyId}/customers`,
    iconKey: 'GroupIcon',
    navGroup: 'operate',
    requiredAnyPermissions: ['crm.customer.read'],
    status: 'ready',
    deepLinkTargets: ['customer'],
  },
  {
    key: 'booking',
    labelKey: 'module.booking',
    buildHref: (companyId) => `/companies/${companyId}/bookings`,
    iconKey: 'CalendarIcon',
    navGroup: 'operate',
    requiredAnyPermissions: ['crm.booking.read'],
    status: 'ready',
    deepLinkTargets: ['customer'],
  },
  {
    key: 'crmreport',
    labelKey: 'module.crmreport',
    buildHref: (companyId) => `/companies/${companyId}/crm-reports`,
    iconKey: 'PieChartIcon',
    navGroup: 'operate',
    requiredAnyPermissions: ['crm.report.read'],
    status: 'planned',
    deepLinkTargets: ['report'],
  },
  {
    key: 'crmsettings',
    labelKey: 'module.crm_settings',
    buildHref: (companyId) => `/companies/${companyId}/settings/crm-catalog`,
    iconKey: 'TagIcon',
    navGroup: 'operate',
    requiredAnyPermissions: ['inventory.product.read'],
    status: 'ready',
    deepLinkTargets: ['product'],
  },
  // Broadcast is intentionally absent until the release entitlement is enabled end-to-end.
  {
    key: 'inventory',
    labelKey: 'module.inventory',
    buildHref: (companyId) => `/companies/${companyId}/inventory`,
    iconKey: 'BoxIcon',
    navGroup: 'operate',
    // Union of Inventory-owned card gates, including the ungateable stock-action/count cards.
    // Product/Scan are omitted because `inventory.product.*` is shared with CRM and must not leak this menu.
    requiredAnyPermissions: [
      'inventory.location.read',
      'inventory.movement.read',
      'inventory.movement.create',
      'inventory.stock_count.create',
      'inventory.movement.adjust',
      'inventory.report.read',
    ],
    status: 'ready',
    deepLinkTargets: ['product', 'stockMovement'],
  },
  {
    key: 'procurement',
    labelKey: 'module.procurement',
    buildHref: (companyId) => `/companies/${companyId}/procurement`,
    iconKey: 'ShoppingCartIcon',
    navGroup: 'operate',
    // Union of this route's tab gates so any enabled child keeps the module reachable.
    // Only `procurement` feature keys belong here.
    requiredAnyPermissions: [
      'procurement.supplier.read',
      'procurement.purchase_request.read',
      'procurement.purchase_order.read',
      'procurement.goods_receipt.read',
      'procurement.purchase_request.read_related',
      'procurement.purchase_order.read_related',
      'procurement.goods_receipt.read_related',
    ],
    status: 'ready',
    deepLinkTargets: ['supplier', 'purchaseOrder', 'purchaseRequest', 'goodsReceipt'],
  },
  {
    key: 'workflow',
    labelKey: 'module.workflow',
    buildHref: (companyId) => `/companies/${companyId}/workflow`,
    iconKey: 'BoltIcon',
    navGroup: 'operate',
    // Union of this route's tab gates; only `workflow` feature keys belong here.
    requiredAnyPermissions: [
      'workflow.template.read',
      'workflow.rule.read',
      'workflow.task.read',
      'workflow.run.read',
      'workflow.dead_letter.read',
      'workflow.webhook.manage',
    ],
    status: 'ready',
    deepLinkTargets: ['rule', 'run', 'task', 'deadLetter'],
  },
  {
    key: 'ai-suggestions',
    labelKey: 'module.ai_suggestions',
    buildHref: (companyId) => `/companies/${companyId}/ai-suggestions`,
    iconKey: 'PieChartIcon',
    navGroup: 'operate',
    requiredAnyPermissions: ['ai.suggestion.read', 'ai.suggestion.read_own'],
    status: 'ready',
    deepLinkTargets: ['suggestion'],
  },
  {
    key: 'expenses',
    labelKey: 'module.expenses',
    buildHref: (companyId) => `/companies/${companyId}/expenses`,
    iconKey: 'FileIcon',
    navGroup: 'finance',
    // Gated by the `expenses` feature only. Reimbursement (การเบิกจ่าย) has its own module below,
    // so `reimbursement.read` must not leak the expenses menu when expenses is off.
    requiredAnyPermissions: [
      'expense.read',
      'expense.read_related',
      'expense.read_own',
      'expense.receipt.upload',
      'expense.receipt.line_upload',
      'expense.create',
      'expense.confirm',
      'expense.category.manage',
      'expense.signature.self_manage',
      'expense.signature.manage',
      'expense.evidence.read',
    ],
    status: 'ready',
    deepLinkTargets: ['expense'],
  },
  {
    key: 'counterparties',
    labelKey: 'module.counterparties',
    buildHref: (companyId) => `/companies/${companyId}/counterparties`,
    iconKey: 'GroupIcon',
    navGroup: 'finance',
    requiredAnyPermissions: ['accounting.counterparty.read', 'accounting.counterparty.manage'],
    status: 'ready',
  },
  {
    key: 'journal',
    labelKey: 'module.journal',
    buildHref: (companyId) => `/companies/${companyId}/journal`,
    iconKey: 'SwapIcon',
    navGroup: 'finance',
    requiredAnyPermissions: ['ledger.journal.read'],
    status: 'ready',
    deepLinkTargets: ['invoice'],
  },
  {
    key: 'accounting',
    labelKey: 'module.accounting',
    buildHref: (companyId) => `/companies/${companyId}/accounting`,
    iconKey: 'DollarLineIcon',
    navGroup: 'finance',
    // Only sales_documents-owned permissions belong here; ledger access must not leak this menu.
    requiredAnyPermissions: [
      'accounting.document.read', 'accounting.document.read_related', 'accounting.quotation.read', 'accounting.invoice.read', 'accounting.billing_note.read',
      'accounting.receipt.read', 'accounting.tax_invoice.read', 'accounting.credit_note.read', 'accounting.debit_note.read',
    ],
    status: 'planned',
    statusReasonKey: 'module.status.planned',
    deepLinkTargets: ['invoice'],
  },
  {
    key: 'salesdoc',
    labelKey: 'module.salesdoc',
    buildHref: (companyId) => `/companies/${companyId}/sales-documents`,
    iconKey: 'DocsIcon',
    navGroup: 'operate',
    requiredAnyPermissions: [
      'accounting.document.read', 'accounting.document.read_related', 'accounting.quotation.read', 'accounting.invoice.read', 'accounting.billing_note.read',
      'accounting.receipt.read', 'accounting.tax_invoice.read', 'accounting.credit_note.read', 'accounting.debit_note.read',
    ],
    status: 'planned',
    deepLinkTargets: ['invoice'],
  },
  {
    key: 'tax',
    labelKey: 'module.tax',
    buildHref: (companyId) => `/companies/${companyId}/tax`,
    iconKey: 'DocsIcon',
    navGroup: 'finance',
    requiredAnyPermissions: ['tax.profile.read', 'tax.config.read', 'tax.period.read', 'tax.event.read', 'tax.report.read'],
    status: 'ready',
    deepLinkTargets: ['taxPeriod'],
  },
  {
    key: 'accounts-payable',
    labelKey: 'module.accounts_payable',
    buildHref: (companyId) => `/companies/${companyId}/accounts-payable`,
    iconKey: 'BankIcon',
    navGroup: 'finance',
    // Union of this route's tab gates so any enabled child keeps the module reachable.
    // Only `procurement` feature keys belong here.
    requiredAnyPermissions: [
      'procurement.vendor_bill.read',
      'procurement.supplier_payment.read',
      'procurement.vendor_bill.read_related',
      'procurement.supplier_payment.read_related',
      'procurement.ap.report',
    ],
    status: 'ready',
    deepLinkTargets: ['vendorBill', 'supplierPayment'],
  },
  {
    key: 'reimbursements',
    labelKey: 'module.reimbursements',
    buildHref: (companyId) => `/companies/${companyId}/reimbursements`,
    iconKey: 'DollarLineIcon',
    navGroup: 'finance',
    requiredAnyPermissions: ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own', 'reimbursement.approve', 'reimbursement.finance_review'],
    status: 'ready',
    deepLinkTargets: ['reimbursement'],
  },
  {
    key: 'banking',
    labelKey: 'module.banking',
    buildHref: (companyId) => `/companies/${companyId}/banking`,
    iconKey: 'DollarLineIcon',
    navGroup: 'finance',
    // Union of this route's tab gates so any enabled child keeps the module reachable.
    // Only `bank_reconciliation` feature keys belong here.
    requiredAnyPermissions: [
      'bank.account.read',
      'bank.cash.read',
      'bank.statement.read',
      'bank.match.read',
      'bank.reconciliation.read',
      'bank.adjustment.read',
    ],
    status: 'ready',
    deepLinkTargets: ['bankAccount', 'reconciliation'],
  },
  {
    key: 'reports',
    labelKey: 'module.reports',
    buildHref: (companyId) => `/companies/${companyId}/reports`,
    iconKey: 'PieChartIcon',
    navGroup: 'finance',
    // Only reports-owned permissions belong here; retained snapshot readers keep a visible,
    // history-only way back to old runs and exports after the commercial feature is switched off.
    requiredAnyPermissions: ['report.catalog.read', 'report.snapshot.read'],
    status: 'ready',
    deepLinkTargets: ['report'],
  },
  {
    key: 'closing',
    labelKey: 'module.closing',
    buildHref: (companyId) => `/companies/${companyId}/period-closing`,
    iconKey: 'LockIcon',
    navGroup: 'finance',
    requiredAnyPermissions: ['ledger.period.read'],
    status: 'planned',
    deepLinkTargets: ['report'],
  },
  {
    key: 'crm',
    labelKey: 'module.crm',
    buildHref: (companyId) => `/companies/${companyId}/crm`,
    iconKey: 'GroupIcon',
    navGroup: 'growth',
    // Union of this hub's CRM-owned tab/link gates. `crm.ai.*` belongs to the AI feature
    // and must not leak the CRM menu when CRM is off.
    requiredAnyPermissions: [
      'crm.customer.read',
      'crm.lead.read',
      'crm.opportunity.read',
      'crm.report.read',
      'crm.follow_up.read',
    ],
    status: 'ready',
    deepLinkTargets: ['customer', 'opportunity'],
  },
  {
    key: 'roles',
    labelKey: 'module.roles',
    buildHref: (companyId) => `/companies/${companyId}/settings/permissions`,
    iconKey: 'ShieldIcon',
    navGroup: 'admin',
    requiredAnyPermissions: [
      'access.role.read', 'access.role.manage',
      'access.employee.read', 'access.employee.create', 'access.employee.update',
      'access.effective.read',
    ],
    status: 'ready',
    deepLinkTargets: ['settingsUser'],
  },
  {
    key: 'settings',
    labelKey: 'module.settings',
    buildHref: (companyId) => `/companies/${companyId}/settings`,
    iconKey: 'HorizontalDotsIcon',
    navGroup: 'admin',
    // ตั้งค่าบริษัท is Owner / Company owner / Admin only. This used to be the union of every card
    // inside the hub, which included account.password.change and company.branch.read — keys every
    // role holds — so the menu showed for everyone. Account security is unaffected: it is reached
    // from the header user menu, not from here. company.setup.manage is kept alongside the
    // dedicated key so Owner/Admin keep the menu in an environment that has not run
    // sync-permissions yet (fails safe rather than open).
    requiredAnyPermissions: [
      'company.settings.view',
      'company.setup.manage',
      'ledger.account.read',
      'ledger.account.manage',
      'tax.profile.read',
      'tax.profile.manage',
      'tax.config.read',
      'tax.config.manage',
      'ledger.posting-rule.read',
      'ledger.posting-rule.manage',
    ],
    status: 'ready',
    deepLinkTargets: ['settingsUser'],
  },
  {
    key: 'poapproval',
    labelKey: 'module.poapproval',
    buildHref: (companyId) => `/companies/${companyId}/settings/po-approval`,
    iconKey: 'StampIcon',
    navGroup: 'admin',
    requiredAnyPermissions: ['procurement.purchase_order.read'],
    status: 'planned',
    deepLinkTargets: ['purchaseOrder'],
  },
  {
    key: 'discount',
    labelKey: 'module.discount',
    buildHref: (companyId) => `/companies/${companyId}/settings/discount-policy`,
    iconKey: 'TagIcon',
    navGroup: 'admin',
    // Matches the discount-policy API gate (crm.customer.read). company.setup.read is a key every
    // role holds, so it showed the menu on CRM-off companies where the page can only error.
    requiredAnyPermissions: ['crm.customer.read'],
    status: 'planned',
    deepLinkTargets: ['settingsUser'],
  },
  {
    key: 'notifications',
    labelKey: 'module.notifications',
    // The notification centre, not the preferences page: it is where deep links are read
    // and it links on to preferences/rules itself.
    buildHref: (companyId) => `/companies/${companyId}/notifications`,
    iconKey: 'BellIcon',
    navGroup: 'admin',
    requiredAnyPermissions: ['notification.read'],
    status: 'ready',
    deepLinkTargets: ['dashboard'],
  },
  {
    key: 'lineoa',
    labelKey: 'module.line_oa',
    buildHref: (companyId) => `/companies/${companyId}/settings/line-oa`,
    iconKey: 'ChatIcon',
    navGroup: 'admin',
    requiredAnyPermissions: ['crm.channel.read'],
    status: 'ready',
    deepLinkTargets: ['conversation'],
  },
];

export const NAV_GROUP_ORDER: NavGroup[] = ['main', 'operate', 'finance', 'growth', 'admin'];
