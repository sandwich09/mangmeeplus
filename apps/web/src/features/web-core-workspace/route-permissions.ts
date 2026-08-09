export type RoutePermissionRule = {
  path: string;
  anyOf: readonly string[];
};

export const ROUTE_PERMISSION_RULES: readonly RoutePermissionRule[] = [
  { path: '/settings/permissions', anyOf: ['access.role.manage'] },
  { path: '/settings/roles', anyOf: ['access.role.manage'] },
  { path: '/settings/po-approval', anyOf: ['procurement.purchase_order.manage'] },
  { path: '/settings/discount-policy', anyOf: ['crm.customer.update'] },
  { path: '/settings/substitute-receipt', anyOf: ['company.setup.manage'] },
  { path: '/settings/line-oa', anyOf: ['crm.channel.manage'] },
  { path: '/settings/notifications', anyOf: ['notification.preference.manage'] },
  { path: '/settings/notification-rules', anyOf: ['notification.rule.manage'] },
  { path: '/settings/access-overview', anyOf: ['access.employee.read'] },
  { path: '/settings/employees', anyOf: ['access.employee.read'] },
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
  { path: '/settings/crm-catalog/new', anyOf: ['inventory.product.manage'] },
  { path: '/settings/crm-catalog', anyOf: ['inventory.product.read'] },
  {
    path: '/settings/security',
    anyOf: ['account.password.change', 'account.identity.link', 'account.identity.unlink'],
  },
  { path: '/tax/evidence', anyOf: ['tax.config.read'] },
  { path: '/tax/reconciliation', anyOf: ['tax.report.read'] },
  { path: '/tax', anyOf: ['tax.period.read'] },
  { path: '/notifications', anyOf: ['notification.read'] },
  {
    path: '/inventory',
    anyOf: [
      'inventory.location.read', 'inventory.movement.read', 'inventory.movement.create',
      'inventory.stock_count.create', 'inventory.movement.adjust', 'inventory.report.read',
    ],
  },
  { path: '/journal', anyOf: ['ledger.journal.read'] },
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
  {
    path: '/expenses',
    anyOf: [
      'expense.read', 'expense.read_related', 'expense.read_own', 'expense.receipt.upload', 'expense.create',
      'expense.confirm', 'expense.category.manage', 'expense.signature.manage', 'expense.evidence.read',
    ],
  },
  {
    path: '/reimbursements',
    anyOf: ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own', 'reimbursement.approve', 'reimbursement.finance_review'],
  },
];

function isUnderPath(path: string, rulePath: string): boolean {
  return path === rulePath || path.startsWith(`${rulePath}/`);
}

export function findRoutePermissionRule(path: string): RoutePermissionRule | undefined {
  return ROUTE_PERMISSION_RULES
    .filter((rule) => isUnderPath(path, rule.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

export function canSeeRoute(path: string, permissions: readonly string[]): boolean {
  const rule = findRoutePermissionRule(path);
  return Boolean(rule?.anyOf.some((permission) => permissions.includes(permission)));
}
