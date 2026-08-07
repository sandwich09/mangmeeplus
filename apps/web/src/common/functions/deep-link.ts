export type DeepLinkTarget =
  | { type: 'dashboard'; companyId: string }
  | { type: 'product'; companyId: string; productId: string }
  | { type: 'stockMovement'; companyId: string; movementId: string }
  | { type: 'invoice'; companyId: string; invoiceId: string }
  | { type: 'expense'; companyId: string; expenseId: string }
  | { type: 'taxPeriod'; companyId: string; taxPeriodId: string }
  | { type: 'customer'; companyId: string; customerId: string }
  | { type: 'approval'; companyId: string; approvalId: string }
  | { type: 'report'; companyId: string; reportKey: string }
  | { type: 'settingsUser'; companyId: string; userId: string };

export function buildDeepLinkPath(target: DeepLinkTarget): string {
  const base = `/companies/${target.companyId}`;
  switch (target.type) {
    case 'dashboard':     return `${base}/dashboard`;
    case 'product':       return `${base}/inventory/products/${target.productId}`;
    case 'stockMovement': return `${base}/inventory/movements/${target.movementId}`;
    case 'invoice':       return `${base}/accounting/invoices/${target.invoiceId}`;
    case 'expense':       return `${base}/expenses/${target.expenseId}`;
    case 'taxPeriod':     return `${base}/tax/periods/${target.taxPeriodId}`;
    case 'customer':      return `${base}/crm/customers/${target.customerId}`;
    case 'approval':      return `${base}/approvals/${target.approvalId}`;
    case 'report':        return `${base}/reports/${target.reportKey}`;
    case 'settingsUser':  return `${base}/settings/users/${target.userId}`;
  }
}

// ponytail: simple regex matching, not a full router — fast and obvious
export function parseDeepLinkPath(pathname: string): DeepLinkTarget | null {
  const m = pathname.match(/^\/companies\/([^/]+)/);
  if (!m) return null;
  const companyId = m[1];
  const rest = pathname.slice(m[0].length);

  if (rest === '/dashboard' || rest === '') return { type: 'dashboard', companyId };

  const product = rest.match(/^\/inventory\/products\/([^/]+)$/);
  if (product) return { type: 'product', companyId, productId: product[1] };

  const movement = rest.match(/^\/inventory\/movements\/([^/]+)$/);
  if (movement) return { type: 'stockMovement', companyId, movementId: movement[1] };

  const invoice = rest.match(/^\/accounting\/invoices\/([^/]+)$/);
  if (invoice) return { type: 'invoice', companyId, invoiceId: invoice[1] };

  const expense = rest.match(/^\/expenses\/([^/]+)$/);
  if (expense) return { type: 'expense', companyId, expenseId: expense[1] };

  const taxPeriod = rest.match(/^\/tax\/periods\/([^/]+)$/);
  if (taxPeriod) return { type: 'taxPeriod', companyId, taxPeriodId: taxPeriod[1] };

  const customer = rest.match(/^\/crm\/customers\/([^/]+)$/);
  if (customer) return { type: 'customer', companyId, customerId: customer[1] };

  const approval = rest.match(/^\/approvals\/([^/]+)$/);
  if (approval) return { type: 'approval', companyId, approvalId: approval[1] };

  const report = rest.match(/^\/reports\/([^/]+)$/);
  if (report) return { type: 'report', companyId, reportKey: report[1] };

  const settingsUser = rest.match(/^\/settings\/users\/([^/]+)$/);
  if (settingsUser) return { type: 'settingsUser', companyId, userId: settingsUser[1] };

  return null;
}
