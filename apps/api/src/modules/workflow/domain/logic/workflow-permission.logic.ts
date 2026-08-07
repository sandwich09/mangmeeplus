// Maps a source module name to the read permission(s) that let a user see workflow
// rules/runs tied to that module. Spec: "Managing a workflow rule requires workflow
// permission and permission to read the source module used by the rule" — and ADMIN
// gets "no implicit bypass of source-module permissions". workflow.rule.read/run.read
// alone is necessary but not sufficient once a rule is tied to a specific source module.
export const WORKFLOW_SOURCE_MODULE_READ_PERMISSIONS: Record<string, string[]> = {
  dashboard: ['dashboard.read'],
  inventory: ['inventory.report.read', 'inventory.product.read'],
  reimbursements: ['reimbursement.read', 'reimbursement.read_own', 'reimbursement.approve', 'reimbursement.finance_review'],
  procurement: ['procurement.vendor_bill.read', 'procurement.purchase_order.read', 'procurement.ap.report'],
  tax: ['tax.period.read'],
  'accounting-documents': ['accounting.invoice.read', 'accounting.document.read'],
  banking: ['bank.match.read', 'bank.reconciliation.read'],
  crm: ['crm.report.read', 'crm.opportunity.read', 'crm.follow_up.read'],
  'ai-gateway': ['ai.tool.invoke'],
};

export function hasSourceModuleAccess(permissions: string[], sourceModule: string | undefined): boolean {
  if (!sourceModule) return true;
  const required = WORKFLOW_SOURCE_MODULE_READ_PERMISSIONS[sourceModule];
  if (!required || required.length === 0) return true;
  return required.some((p) => permissions.includes(p));
}
