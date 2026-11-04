import { hasAiSuggestionSourceAccess } from '@watchdog-bms/contracts';
import { COMPANY_PROFILE_SETTINGS_PATH } from '@watchdog-bms/contracts';

export type RoutePermissionRule = {
  path: string;
  anyOf: readonly string[];
};

export const ROUTE_PERMISSION_RULES: readonly RoutePermissionRule[] = [
  { path: '/counterparties', anyOf: ['accounting.counterparty.read', 'accounting.counterparty.manage'] },
  // The API checks creator/uploader provenance before exposing a single row.
  { path: '/counterparties/', anyOf: ['accounting.counterparty.read', 'accounting.counterparty.manage', 'expense.read_related', 'accounting.document.read_related', 'expense.create', 'expense.update', 'expense.review', 'expense.receipt.upload', 'expense.receipt.line_upload'] },
  { path: '/settings/permissions', anyOf: ['access.role.manage'] },
  { path: '/settings/roles', anyOf: ['access.role.manage'] },
  { path: '/settings/po-approval', anyOf: ['procurement.purchase_order.manage'] },
  { path: '/settings/discount-policy', anyOf: ['crm.customer.update'] },
  { path: '/settings/e-wht', anyOf: ['company.setup.manage'] },
  { path: '/settings/substitute-receipt', anyOf: ['company.setup.manage'] },
  // Read also accepts legacy manage-only roles, without changing their saved grants. A
  // manager can open the page and read the masked shop block plus their own account section; the
  // shop form itself un-masks and saves only for a holder of `company.legal_identity.manage`,
  // which the API enforces separately from access to the settings hub.
  { path: COMPANY_PROFILE_SETTINGS_PATH, anyOf: ['company.setup.read', 'company.setup.manage'] },
  { path: '/settings/line-oa', anyOf: ['crm.channel.manage'] },
  { path: '/settings/notifications', anyOf: ['notification.preference.manage'] },
  { path: '/settings/notification-rules', anyOf: ['notification.rule.manage'] },
  { path: '/settings/access-overview', anyOf: ['access.employee.read'] },
  { path: '/settings/employees', anyOf: ['access.employee.read', 'access.employee.create', 'access.employee.update'] },
  { path: '/settings/branches', anyOf: ['company.branch.read', 'company.branch.manage'] },
  {
    path: '/settings/accounting-tax-setup',
    anyOf: [
      'ledger.account.read', 'ledger.account.manage',
      'tax.profile.read', 'tax.profile.manage', 'tax.config.read', 'tax.config.manage',
    ],
  },
  { path: '/settings/chart-of-accounts', anyOf: ['ledger.account.read', 'ledger.account.manage'] },
  {
    path: '/settings/tax-codes',
    anyOf: ['tax.profile.read', 'tax.profile.manage', 'tax.config.read', 'tax.config.manage'],
  },
  {
    path: '/settings/tax-accounts',
    anyOf: ['tax.config.read', 'tax.config.manage', 'ledger.posting-rule.read', 'ledger.posting-rule.manage'],
  },
  // WHT certificate system issuance plan §2.1b/§3.3 (Decision B): OWNER-only, deliberately not
  // `tax.profile.manage` (which FINANCE/ACCOUNTANT already hold).
  { path: '/settings/tax-signature', anyOf: ['company.tax_signature.manage'] },
  { path: '/settings/crm-catalog/new', anyOf: ['inventory.product.manage'] },
  { path: '/settings/crm-catalog', anyOf: ['inventory.product.read'] },
  {
    path: '/settings/security',
    anyOf: ['account.password.change', 'account.identity.link', 'account.identity.unlink'],
  },
  { path: '/tax/evidence', anyOf: ['tax.config.read'] },
  { path: '/tax/reconciliation', anyOf: ['tax.report.read'] },
  { path: '/tax/withholding', anyOf: ['wht.pnd53.read', 'wht.pnd53.prepare'] },
  { path: '/tax/pnd53', anyOf: ['wht.pnd53.read', 'wht.pnd53.prepare'] },
  { path: '/tax', anyOf: ['tax.period.read'] },
  { path: '/notifications/preferences', anyOf: ['notification.preference.manage'] },
  { path: '/notifications', anyOf: ['notification.read'] },
  // Same screen as /settings/notification-rules — both URLs must demand the same authority.
  { path: '/notifications/rules', anyOf: ['notification.rule.manage'] },
  {
    path: '/inventory',
    anyOf: [
      'inventory.location.read', 'inventory.movement.read', 'inventory.movement.create',
      'inventory.stock_count.create', 'inventory.movement.adjust', 'inventory.report.read',
    ],
  },
  { path: '/journal', anyOf: ['ledger.journal.read'] },
  {
    path: '/sales-documents/record-income',
    anyOf: ['accounting.document.create', 'accounting.invoice.create'],
  },
  { path: '/income-expense-ledger', anyOf: ['accounting.document.read', 'expense.read'] },
  { path: '/reports', anyOf: ['report.catalog.read', 'report.snapshot.read'] },
  { path: '/ai-suggestions', anyOf: ['ai.suggestion.read', 'ai.suggestion.read_own'] },
  {
    path: '/crm',
    anyOf: ['crm.customer.read', 'crm.lead.read', 'crm.opportunity.read', 'crm.report.read', 'crm.follow_up.read'],
  },
  { path: '/inbox', anyOf: ['crm.inbox.read'] },
  {
    path: '/banking',
    anyOf: [
      'bank.account.read', 'bank.cash.read', 'bank.statement.read', 'bank.match.read',
      'bank.reconciliation.read', 'bank.adjustment.read',
    ],
  },
  {
    path: '/procurement',
    anyOf: [
      'procurement.supplier.read', 'procurement.purchase_request.read',
      'procurement.purchase_order.read', 'procurement.goods_receipt.read',
      'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
      'procurement.goods_receipt.read_related',
    ],
  },
  {
    path: '/accounts-payable',
    anyOf: [
      'procurement.vendor_bill.read', 'procurement.supplier_payment.read',
      'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related', 'procurement.ap.report',
    ],
  },
  {
    path: '/workflow',
    anyOf: [
      'workflow.template.read', 'workflow.rule.read', 'workflow.task.read',
      'workflow.run.read', 'workflow.dead_letter.read', 'workflow.webhook.manage',
    ],
  },
  { path: '/expenses/disbursement-vouchers/new', anyOf: ['expense.disbursement.prepare'] },
  { path: '/expenses/disbursement-vouchers/', anyOf: ['expense.disbursement.read'] },
  { path: '/expenses/disbursement-vouchers', anyOf: ['expense.disbursement.read'] },
  {
    path: '/expenses',
    anyOf: [
      'expense.read', 'expense.read_related', 'expense.read_own', 'expense.receipt.upload', 'expense.receipt.line_upload', 'expense.create',
      'expense.confirm', 'expense.category.manage', 'expense.signature.self_manage', 'expense.signature.manage', 'expense.evidence.read',
    ],
  },
  { path: '/expenses/wht-certificates', anyOf: ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link'] },
  {
    path: '/reimbursements',
    anyOf: ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own', 'reimbursement.approve', 'reimbursement.finance_review'],
  },
];

function isUnderPath(path: string, rulePath: string): boolean {
  return rulePath.endsWith('/') ? path.startsWith(rulePath) : path === rulePath || path.startsWith(`${rulePath}/`);
}

export function findRoutePermissionRule(path: string): RoutePermissionRule | undefined {
  return ROUTE_PERMISSION_RULES
    .filter((rule) => isUnderPath(path, rule.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

export function canSeeRoute(path: string, permissions: readonly string[]): boolean {
  const rule = findRoutePermissionRule(path);
  if (rule?.path === '/ai-suggestions' && !hasAiSuggestionSourceAccess(permissions)) return false;
  return Boolean(rule?.anyOf.some((permission) => permissions.includes(permission)));
}
