// ---- Item 10C+/มั่งมี Flow A: menu × action permission matrix projection (spec D3) ----
// The backend's flat permission-key RBAC stays the only authorization mechanism; this
// registry is a read-only projection so the Permissions screen can show a
// role × menu × [view|create|edit|del|approve] grid without a schema change.
// Menu ids/routes mirror the มั่งมี Flow A design handoff's permissions.ts/routes.md.

export type MenuId =
  | 'dashboard'
  | 'inbox'
  | 'sales'
  | 'customers'
  | 'booking'
  | 'crmreport'
  | 'broadcast'
  | 'expenses'
  | 'journal'
  | 'salesdoc'
  | 'reports'
  | 'closing'
  | 'roles'
  | 'poapproval'
  | 'discount'
  | 'notifications';

export type ActionId = 'view' | 'create' | 'edit' | 'del' | 'approve';

export type MenuGroup = 'main' | 'shop' | 'fin' | 'settings';

export type MenuDefinition = {
  id: MenuId;
  labelTh: string;
  group: MenuGroup;
  route: string;
  /** action -> permission keys that grant it (ANY match = granted). Omitted action = not grantable via the matrix. */
  actions: Partial<Record<ActionId, string[]>>;
};

// Booking/broadcast/PO-approval/discount-policy keys are forward-declared for the
// มั่งมี Flow A backend integration (see docs/plans/mangmee-flow-a-be-integration-plan.md
// Phases 5-7, tracked as this repo's Track B) — they are not registered permission keys
// yet, so those cells simply resolve to false everywhere until that work lands.
export const MENU_REGISTRY: MenuDefinition[] = [
  { id: 'dashboard', labelTh: 'แดชบอร์ด', group: 'main', route: '/dashboard', actions: { view: ['dashboard.read'] } },
  {
    id: 'inbox',
    labelTh: 'กล่องข้อความ',
    group: 'main',
    route: '/inbox',
    actions: {
      view: ['crm.inbox.read'],
      create: ['crm.inbox.reply'],
      edit: ['crm.inbox.assign', 'crm.inbox.resolve'],
    },
  },
  // No POS/sales module exists yet; menu is registered (matches handoff sidebar) but not grantable.
  { id: 'sales', labelTh: 'การขาย', group: 'shop', route: '/sales', actions: {} },
  {
    id: 'customers',
    labelTh: 'ลูกค้า',
    group: 'shop',
    route: '/customers',
    actions: {
      view: ['crm.customer.read'],
      create: ['crm.customer.create'],
      edit: ['crm.customer.update'],
      del: ['crm.customer.archive'],
    },
  },
  {
    id: 'booking',
    labelTh: 'การจองออนไลน์',
    group: 'shop',
    route: '/bookings',
    actions: {
      view: ['crm.booking.read'],
      create: ['crm.booking.create'],
      edit: ['crm.booking.update'],
      del: ['crm.booking.cancel'],
    },
  },
  { id: 'crmreport', labelTh: 'รายงาน CRM', group: 'shop', route: '/crm-reports', actions: { view: ['crm.report.read'] } },
  {
    id: 'broadcast',
    labelTh: 'บรอดแคสต์',
    group: 'shop',
    route: '/broadcast',
    actions: {
      // view mirrors the workspace sidebar gate (web-core-workspace.constants.ts) so both surfaces
      // answer the same; crm.campaign.* write keys stay forward-declared until broadcast ships.
      view: ['crm.report.read'],
      create: ['crm.campaign.create'],
      edit: ['crm.campaign.manage'],
      del: ['crm.campaign.manage'],
    },
  },
  {
    id: 'expenses',
    labelTh: 'ค่าใช้จ่าย+ใบเสร็จ',
    group: 'fin',
    route: '/expenses',
    actions: {
      view: ['expense.read'],
      create: ['expense.create'],
      edit: ['expense.review'],
      del: ['expense.void', 'expense.delete'],
      approve: ['expense.confirm'],
    },
  },
  {
    id: 'journal',
    labelTh: 'สมุดรายวัน',
    group: 'fin',
    route: '/journal',
    actions: {
      view: ['ledger.journal.read'],
      create: ['journal.entry.create'],
      edit: ['journal.entry.post'],
      del: ['journal.entry.reverse'],
    },
  },
  {
    id: 'salesdoc',
    labelTh: 'เอกสารขาย',
    group: 'fin',
    route: '/sales-documents',
    actions: {
      view: ['accounting.document.read', 'accounting.document.read_related', 'accounting.quotation.read', 'accounting.invoice.read', 'accounting.billing_note.read', 'accounting.receipt.read', 'accounting.tax_invoice.read', 'accounting.credit_note.read', 'accounting.debit_note.read'],
      create: ['accounting.document.create', 'accounting.quotation.create', 'accounting.invoice.create', 'accounting.billing_note.create', 'accounting.receipt.create', 'accounting.credit_note.create', 'accounting.debit_note.create'],
      edit: ['accounting.document.update', 'accounting.quotation.update', 'accounting.invoice.update', 'accounting.billing_note.update', 'accounting.receipt.update'],
      del: ['accounting.document.void', 'accounting.quotation.void', 'accounting.invoice.void', 'accounting.billing_note.void', 'accounting.receipt.void', 'accounting.tax_invoice.void', 'accounting.credit_note.void', 'accounting.debit_note.void'],
      approve: ['accounting.document.issue', 'accounting.quotation.issue', 'accounting.invoice.issue', 'accounting.billing_note.issue', 'accounting.receipt.issue', 'accounting.tax_invoice.issue', 'accounting.credit_note.issue', 'accounting.debit_note.issue'],
    },
  },
  { id: 'reports', labelTh: 'รายงานการเงิน', group: 'fin', route: '/reports', actions: { view: ['report.catalog.read'] } },
  {
    id: 'closing',
    labelTh: 'ปิดงวด',
    group: 'fin',
    route: '/period-closing',
    actions: { view: ['ledger.period.read'], approve: ['ledger.period.close'] },
  },
  {
    id: 'roles',
    labelTh: 'สิทธิ์การใช้งาน',
    group: 'settings',
    route: '/settings/permissions',
    actions: {
      view: ['access.role.read'],
      create: ['access.role.manage'],
      edit: ['access.role.manage'],
      del: ['access.role.manage'],
    },
  },
  {
    id: 'poapproval',
    labelTh: 'อนุมัติคำสั่งซื้อ',
    group: 'settings',
    route: '/settings/po-approval',
    actions: { view: ['procurement.approval_policy.read'], edit: ['procurement.approval_policy.manage'] },
  },
  {
    id: 'discount',
    labelTh: 'นโยบายส่วนลด',
    group: 'settings',
    route: '/settings/discount-policy',
    actions: { view: ['crm.discount_policy.read'], edit: ['crm.discount_policy.manage'] },
  },
  {
    id: 'notifications',
    labelTh: 'การแจ้งเตือน',
    group: 'settings',
    route: '/settings/notifications',
    actions: { view: ['notification.read'], edit: ['notification.preference.manage'] },
  },
];

export type PermissionMatrixCell = Partial<Record<ActionId, boolean>>;

export type PermissionMatrixRow = {
  roleId: string;
  roleKey: string;
  roleLabel: string;
  /** System roles (incl. OWNER) are read-only in the matrix UI — edits 403 at the write endpoint. */
  locked: boolean;
  menus: Partial<Record<MenuId, PermissionMatrixCell>>;
};

export type PermissionMatrix = {
  generatedAt: string;
  menus: MenuDefinition[];
  rows: PermissionMatrixRow[];
};

/** Menu ids visible to a caller holding `permissions` (any mapped `view` key grants visibility). */
export function getVisibleMenus(permissions: string[], registry: MenuDefinition[] = MENU_REGISTRY): MenuId[] {
  const granted = new Set(permissions);
  return registry.filter((menu) => (menu.actions.view ?? []).some((key) => granted.has(key))).map((menu) => menu.id);
}

/**
 * Grants that make a role a "people-manager". A requester WITHOUT access.role.manage
 * (e.g. MANAGER, who holds access.employee.update/disable for day-to-day assignment)
 * may not assign such roles nor suspend/disable their holders — the API use-cases
 * enforce this; the web role picker uses the same list to hide options that would 403.
 */
export const PRIVILEGED_GRANT_KEYS = [
  'access.employee.create', 'access.employee.update', 'access.employee.disable',
  'access.employee.credential.issue', 'access.role.manage', 'access.role.operational.assign',
  'admin.user.manage', 'admin.role.manage',
];

export function hasPrivilegedGrant(permissionKeys: string[]): boolean {
  return permissionKeys.some((key) => PRIVILEGED_GRANT_KEYS.includes(key));
}
