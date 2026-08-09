import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_CATALOG, MENU_ENTITLEMENT_BINDINGS } from '@watchdog-bms/contracts';
import { filterModulesByPermissions, getActiveModuleKey, groupNavItems, buildNavItems, canAccessWorkspacePath, collectMenuTargets, resolveMenuKey } from './web-core-workspace.logic';
import { WORKSPACE_MODULES, NAV_GROUP_ORDER, ACCOUNTING_UI_HIDDEN_MODULE_KEYS } from './web-core-workspace.constants';
import type { NavItem } from './web-core-workspace.model';
import { canSeeRoute, findRoutePermissionRule, ROUTE_PERMISSION_RULES } from './route-permissions';

// Superset of every module permission — an OWNER-like session.
const ALL_MODULE_PERMISSIONS = Array.from(
  new Set([
    ...WORKSPACE_MODULES.flatMap((mod) => [...mod.requiredAnyPermissions, ...(mod.requiredAllPermissions ?? [])]),
    ...ROUTE_PERMISSION_RULES.flatMap((rule) => rule.anyOf),
  ]),
);

const MODULE_TAB_GATES = [
  {
    moduleKey: 'inventory',
    path: '/companies/abc/inventory',
    permissions: [
      'inventory.location.read',
      'inventory.movement.read',
      'inventory.movement.create',
      'inventory.stock_count.create',
      'inventory.movement.adjust',
      'inventory.report.read',
    ],
  },
  {
    moduleKey: 'procurement',
    path: '/companies/abc/procurement',
    permissions: [
      'procurement.supplier.read',
      'procurement.purchase_request.read',
      'procurement.purchase_order.read',
      'procurement.goods_receipt.read',
    ],
  },
  {
    moduleKey: 'accounts-payable',
    path: '/companies/abc/accounts-payable',
    permissions: [
      'procurement.vendor_bill.read',
      'procurement.supplier_payment.read',
      'procurement.ap.report',
    ],
  },
  {
    moduleKey: 'banking',
    path: '/companies/abc/banking',
    permissions: [
      'bank.account.read',
      'bank.cash.read',
      'bank.statement.read',
      'bank.match.read',
      'bank.reconciliation.read',
      'bank.adjustment.read',
    ],
  },
  {
    moduleKey: 'workflow',
    path: '/companies/abc/workflow',
    permissions: ['workflow.webhook.manage'],
  },
  {
    moduleKey: 'crm',
    path: '/companies/abc/crm',
    permissions: ['crm.follow_up.read'],
  },
] as const;

describe('filterModulesByPermissions', () => {
  it('shows dashboard only with dashboard.read', () => {
    const withoutPermission = filterModulesByPermissions(WORKSPACE_MODULES, []);
    const withPermission = filterModulesByPermissions(WORKSPACE_MODULES, ['dashboard.read']);

    assert.ok(!withoutPermission.some((m) => m.key === 'dashboard'));
    assert.ok(withPermission.some((m) => m.key === 'dashboard'));
  });

  it('hides permissions menu for user with no admin permissions', () => {
    const result = filterModulesByPermissions(WORKSPACE_MODULES, []);
    assert.ok(!result.some((m) => m.key === 'roles'));
  });

  it('hides the permissions menu from a role reader without manage access', () => {
    const result = filterModulesByPermissions(WORKSPACE_MODULES, ['access.role.read']);
    assert.ok(!result.some((m) => m.key === 'roles'));
  });

  it('shows permissions menu for a role manager', () => {
    const result = filterModulesByPermissions(WORKSPACE_MODULES, ['access.role.manage']);
    assert.ok(result.some((m) => m.key === 'roles'));
  });

  it('shows the people menu for an employee reader', () => {
    const result = filterModulesByPermissions(WORKSPACE_MODULES, ['access.employee.read']);
    assert.ok(result.some((m) => m.key === 'roles'));
  });

  it('hides the people menu from an effective-access-only viewer', () => {
    const result = filterModulesByPermissions(WORKSPACE_MODULES, ['access.effective.read']);
    assert.ok(!result.some((m) => m.key === 'roles'));
  });

  it('does not let legacy admin grants bypass employee-access navigation', () => {
    const result = filterModulesByPermissions(WORKSPACE_MODULES, ['admin.role.read', 'admin.user.manage']);
    assert.ok(!result.some((m) => m.key === 'roles'));
  });

  it('shows company settings to company owners and accounting/tax readers', () => {
    const hasSettings = (permissions: string[]) =>
      filterModulesByPermissions(WORKSPACE_MODULES, permissions).some((m) => m.key === 'settings');
    // Owner / Company owner / Admin
    assert.ok(hasSettings(['company.settings.view']));
    assert.ok(hasSettings(['company.setup.manage']));
    assert.ok(hasSettings(['ledger.account.read']));
    assert.ok(hasSettings(['tax.profile.read']));
    // Keys every role holds must NOT open it — this is what used to show the menu to everyone.
    assert.ok(!hasSettings(['account.password.change']));
    assert.ok(!hasSettings(['company.branch.read']));
    assert.ok(!hasSettings(['inventory.product.read']));
    assert.ok(!hasSettings(['account.session.read']));
  });

  it('shows inbox when user has CRM inbox permission', () => {
    const result = filterModulesByPermissions(WORKSPACE_MODULES, ['crm.inbox.read']);
    assert.ok(result.some((m) => m.key === 'inbox'));
  });

  it('shows CRM settings when the user can read the shared product catalog', () => {
    const result = filterModulesByPermissions(WORKSPACE_MODULES, ['inventory.product.read']);
    assert.equal(result.find((m) => m.key === 'crmsettings')?.navGroup, 'operate');
    assert.ok(!result.some((m) => m.key === 'inventory'));
  });

  it('groups sales documents with customer and sales work', () => {
    const result = filterModulesByPermissions(WORKSPACE_MODULES, ['accounting.document.read']);
    assert.equal(result.find((module) => module.key === 'salesdoc')?.navGroup, 'operate');
  });

  it('keeps each module reachable through every tab gate owned by that feature', () => {
    for (const { moduleKey, permissions } of MODULE_TAB_GATES) {
      for (const permission of permissions) {
        assert.ok(
          filterModulesByPermissions(WORKSPACE_MODULES, [permission]).some((module) => module.key === moduleKey),
          `${moduleKey}: ${permission}`,
        );
      }
    }
  });

  it('does not leak Inventory or CRM through another feature permission', () => {
    assert.ok(!filterModulesByPermissions(WORKSPACE_MODULES, ['inventory.product.read']).some((module) => module.key === 'inventory'));
    assert.ok(!filterModulesByPermissions(WORKSPACE_MODULES, ['crm.ai.read']).some((module) => module.key === 'crm'));
    assert.ok(!filterModulesByPermissions(WORKSPACE_MODULES, ['accounting.document.read']).some((module) => module.key === 'crm'));
  });

  it('shows every module for a session holding all module permissions', () => {
    const result = filterModulesByPermissions(WORKSPACE_MODULES, ALL_MODULE_PERMISSIONS);
    assert.equal(result.length, WORKSPACE_MODULES.length - ACCOUNTING_UI_HIDDEN_MODULE_KEYS.size);
  });

  // Owner decision 2026-08-09: the accounting screens are closed this launch while the ledger keeps
  // posting server-side. The hide is presentation-only, so it must survive a session that holds
  // every ledger permission — the entitlement is deliberately still ON.
  it('hides the accounting screens even from a session holding every ledger permission', () => {
    const keys = filterModulesByPermissions(WORKSPACE_MODULES, ALL_MODULE_PERMISSIONS).map((m) => m.key);
    assert.ok(!keys.includes('journal'), 'สมุดรายวัน is hidden');
    assert.ok(!keys.includes('closing'), 'รอบบัญชี is hidden');
  });
});

describe('getActiveModuleKey', () => {
  it('returns dashboard for exact match', () => {
    const key = getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/dashboard');
    assert.equal(key, 'dashboard');
  });

  it('returns dashboard for sub-path', () => {
    const key = getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/dashboard/overview');
    assert.equal(key, 'dashboard');
  });

  it('returns null for unknown path', () => {
    const key = getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/unknown/path');
    assert.equal(key, null);
  });

  it('returns lineoa, not settings, for the LINE OA connect page', () => {
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings/line-oa'), 'lineoa');
  });

  it('returns the most specific module for nested settings pages', () => {
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings/po-approval'), 'poapproval');
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings/discount-policy'), 'discount');
  });

  it('still returns settings for the settings index', () => {
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings'), 'settings');
  });

  it('still returns roles for the permissions page', () => {
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings/permissions'), 'roles');
  });

  it('still returns crmsettings for crm catalog sub-paths', () => {
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings/crm-catalog/new'), 'crmsettings');
  });

  it('returns settings for settings child pages without their own module', () => {
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings/branches'), 'settings');
  });

  it('returns null for people sub-routes so only the sub-item highlights', () => {
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings/employees'), null);
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings/access-overview'), null);
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings/employees/123'), null);
  });

  it('returns null for the expense policy settings route so only its sub-item highlights', () => {
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings/substitute-receipt'), null);
  });

  it('does not treat a shared prefix without a path boundary as a match', () => {
    assert.equal(getActiveModuleKey(WORKSPACE_MODULES, 'abc', '/companies/abc/settings/line-oa-legacy'), 'settings');
  });
});

describe('groupNavItems', () => {
  const items: NavItem[] = [
    { key: 'dashboard', label: 'Dashboard', icon: null, group: 'main' },
    { key: 'sales', label: 'Sales', icon: null, group: 'operate' },
    { key: 'reports', label: 'Reports', icon: null, group: 'finance' },
  ];

  it('groups items by navGroup in order', () => {
    const grouped = groupNavItems(items, NAV_GROUP_ORDER);
    assert.equal(grouped[0].group, 'main');
    assert.equal(grouped[1].group, 'operate');
    assert.equal(grouped[2].group, 'finance');
  });

  it('omits groups with no items', () => {
    const grouped = groupNavItems(items, NAV_GROUP_ORDER);
    assert.ok(!grouped.some((g) => g.group === 'admin'));
  });
});

describe('buildNavItems', () => {
  it('keeps planned modules clickable for owner workspace access', () => {
    const item = buildNavItems(WORKSPACE_MODULES, 'owner-company', 'en', {}).find((nav) => nav.key === 'booking');
    assert.equal(item?.href, '/companies/owner-company/bookings');
    assert.equal(item?.disabled, false);
  });

  it('keeps registered top-level routes aligned with their navigation targets', () => {
    const routeToModule = {
      '/settings/crm-catalog': 'crmsettings',
      '/tax': 'tax',
      '/inventory': 'inventory',
      // '/journal' is deliberately absent: its route rule and its module still exist, but the
      // screen is closed this launch (ACCOUNTING_UI_HIDDEN), so it has no nav target to align
      // with. The dedicated hide tests below cover it instead.
      '/reports': 'reports',
      '/ai-suggestions': 'ai-suggestions',
      '/crm': 'crm',
      '/inbox': 'inbox',
      '/banking': 'banking',
      '/procurement': 'procurement',
      '/accounts-payable': 'accounts-payable',
      '/workflow': 'workflow',
      '/expenses': 'expenses',
      '/reimbursements': 'reimbursements',
    } as const;

    for (const [path, moduleKey] of Object.entries(routeToModule)) {
      const rule = ROUTE_PERMISSION_RULES.find((candidate) => candidate.path === path);
      assert.ok(rule, `${path}: missing route rule`);
      for (const permission of rule.anyOf) {
        const modules = filterModulesByPermissions(WORKSPACE_MODULES, [permission]);
        assert.ok(modules.some((module) => module.key === moduleKey), `${path}: module ${permission}`);
        const item = buildNavItems(modules, 'co', 'th', {}, [permission]).find((nav) => nav.key === moduleKey);
        if (path === '/reports' && permission === 'report.snapshot.read') {
          assert.equal(item, undefined, `${path}: retained-only history intentionally has no row`);
        } else {
          assert.equal(item?.href, `/companies/co${path}`, `${path}: nav ${permission}`);
        }
        assert.equal(
          canAccessWorkspacePath(WORKSPACE_MODULES, [permission], 'co', `/companies/co${path}`),
          true,
          `${path}: route ${permission}`,
        );
      }
    }
  });

  it('only includes people submenu entries granted to the current user', () => {
    const employeeModules = filterModulesByPermissions(WORKSPACE_MODULES, ['access.employee.read']);
    const employeeItems = buildNavItems(employeeModules, 'employee-company', 'th', {}, ['access.employee.read']);
    assert.deepEqual(
      employeeItems.find((item) => item.key === 'roles')?.subItems?.map((item) => item.key),
      ['roles.individual', 'employees'],
    );
    assert.equal(
      employeeItems.find((item) => item.key === 'roles')?.href,
      '/companies/employee-company/settings/access-overview',
    );

    const overviewModules = filterModulesByPermissions(WORKSPACE_MODULES, ['access.effective.read']);
    const overviewItems = buildNavItems(overviewModules, 'overview-company', 'th', {}, ['access.effective.read']);
    assert.ok(!overviewItems.some((item) => item.key === 'roles'));
  });

  // The บทบาทและสิทธิ์ settings card was removed, so the sidebar child is the only route in.
  // It must never be offered to someone canAccessWorkspacePath would bounce off that page.
  it('offers บทบาทและสิทธิ์ only to users the permissions page itself would admit', () => {
    const roleItems = buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, ['access.role.manage']),
      'role-company', 'th', {}, ['access.role.manage'],
    );
    const permissionsChild = roleItems.find((item) => item.key === 'roles')?.subItems
      ?.find((sub) => sub.key === 'roles.permissions');
    assert.equal(permissionsChild?.href, '/companies/role-company/settings/permissions');
    assert.equal(
      canAccessWorkspacePath(WORKSPACE_MODULES, ['access.role.manage'], 'role-company', permissionsChild!.href),
      true,
    );

    const readOnly = buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, ['access.role.read']),
      'role-company', 'th', {}, ['access.role.read'],
    );
    assert.ok(!readOnly.some((item) => item.key === 'roles'));
    assert.equal(
      canAccessWorkspacePath(
        WORKSPACE_MODULES, ['access.role.read'], 'role-company',
        '/companies/role-company/settings/permissions',
      ),
      false,
    );
  });

  it('targets the first visible roles child for each isolated permission set', () => {
    const cases = [
      ['access.role.manage', 'roles.permissions', '/settings/permissions'],
      ['access.employee.read', 'roles.individual', '/settings/access-overview'],
      ['procurement.purchase_order.manage', 'poapproval', '/settings/po-approval'],
      ['crm.customer.update', 'discount', '/settings/discount-policy'],
      ['crm.channel.manage', 'lineoa', '/settings/line-oa'],
    ] as const;

    for (const [permission, childKey, suffix] of cases) {
      const items = buildNavItems(
        filterModulesByPermissions(WORKSPACE_MODULES, [permission]),
        'co', 'th', {}, [permission],
      );
      const roles = items.find((item) => item.key === 'roles');
      assert.equal(roles?.subItems?.[0]?.key, childKey, permission);
      assert.equal(roles?.href, `/companies/co${suffix}`, permission);
    }
  });

  it('nests settings children under permissions menu instead of rendering them as top-level rows', () => {
    const items = buildNavItems(WORKSPACE_MODULES, 'owner-company', 'th', {});
    const permissionsItem = items.find((nav) => nav.key === 'roles');

    assert.ok(permissionsItem);
    assert.ok(!items.some((nav) => nav.key === 'poapproval'));
    assert.equal(permissionsItem.href, '/companies/owner-company/settings/permissions');
    assert.deepEqual(
      permissionsItem.subItems?.map((sub) => sub.key),
      ['roles.permissions', 'roles.individual', 'employees', 'poapproval', 'discount', 'lineoa'],
    );
    assert.equal(permissionsItem.subItems?.[0]?.href, '/companies/owner-company/settings/permissions');
    assert.equal(permissionsItem.subItems?.[1]?.href, '/companies/owner-company/settings/access-overview');
    assert.equal(permissionsItem.subItems?.[3]?.href, '/companies/owner-company/settings/po-approval');
    assert.equal(permissionsItem.subItems?.[5]?.href, '/companies/owner-company/settings/line-oa');
  });

  it('builds the ordered accounting workflow and advanced settings submenu from effective permissions', () => {
    const permissions = [
      'company.settings.view', 'ledger.account.read', 'tax.profile.read', 'tax.config.read',
      'ledger.posting-rule.read', 'company.branch.read', 'account.identity.link',
    ];
    const settings = buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, permissions),
      'owner-company', 'th', {}, permissions,
    ).find((nav) => nav.key === 'settings');

    assert.deepEqual(settings?.subItems?.map((sub) => sub.key), [
      'settings.overview',
      'settings.accounting-tax-setup',
      'settings.chart-of-accounts',
      'settings.tax-codes',
      'settings.tax-accounts',
      'settings.branches',
    ]);
  });

  it('builds expenses submenu entries for a full-permission user', () => {
    const permissions = ['expense.read', 'expense.read_own', 'expense.receipt.upload', 'expense.create', 'expense.category.manage', 'expense.signature.manage', 'company.setup.manage', 'expense.evidence.read'];
    const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
    const expenses = buildNavItems(modules, 'owner-company', 'th', {}, permissions).find((nav) => nav.key === 'expenses');

    assert.deepEqual(expenses?.subItems?.map((sub) => sub.key), [
      'expenses.list',
      'expenses.upload',
      'expenses.manual',
      'expenses.categories',
      'expenses.substitute_receipt',
      'expenses.substitute_receipt_policy',
      'expenses.evidence',
    ]);
    assert.deepEqual(expenses?.subItems?.map((sub) => sub.href), [
      '/companies/owner-company/expenses',
      '/companies/owner-company/expenses/upload',
      '/companies/owner-company/expenses/manual',
      '/companies/owner-company/expenses/categories',
      '/companies/owner-company/expenses/substitute-receipts',
      '/companies/owner-company/settings/substitute-receipt',
      '/companies/owner-company/expenses/evidence',
    ]);
  });

  it('shows only the list submenu to a read-only expense user', () => {
    const permissions = ['expense.read_own'];
    const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
    const expenses = buildNavItems(modules, 'limited-company', 'th', {}, permissions).find((nav) => nav.key === 'expenses');

    // A solo owner reaches their own substitute receipts on expense.read_own alone — that is the
    // gate at web-core-workspace.logic.ts, not a leak. Nothing else opens on read-own.
    assert.deepEqual(expenses?.subItems?.map((sub) => sub.key), ['expenses.list', 'expenses.substitute_receipt']);
  });

  it('shows related expense and substitute-receipt views without mutation menus', () => {
    const permissions = ['expense.read_related'];
    const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
    const expenses = buildNavItems(modules, 'related-company', 'th', {}, permissions).find((nav) => nav.key === 'expenses');

    assert.deepEqual(expenses?.subItems?.map((sub) => sub.key), ['expenses.list', 'expenses.substitute_receipt']);
  });

  it('shows the expenses module and only upload to an upload-only user', () => {
    const permissions = ['expense.receipt.upload'];
    const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
    const expenses = buildNavItems(modules, 'upload-company', 'th', {}, permissions).find((nav) => nav.key === 'expenses');

    assert.deepEqual(expenses?.subItems?.map((sub) => sub.key), ['expenses.upload']);
  });

  it('keeps the expenses module reachable through any expense submenu permission', () => {
    const permissions = [
      'expense.read',
      'expense.read_own',
      'expense.receipt.upload',
      'expense.create',
      'expense.category.manage',
      'expense.signature.manage',
      'expense.evidence.read',
    ];

    for (const permission of permissions) {
      assert.ok(
        filterModulesByPermissions(WORKSPACE_MODULES, [permission]).some((module) => module.key === 'expenses'),
        permission,
      );
    }
    assert.ok(!filterModulesByPermissions(WORKSPACE_MODULES, ['reimbursement.read']).some((module) => module.key === 'expenses'));
    assert.ok(!filterModulesByPermissions(WORKSPACE_MODULES, ['company.setup.manage']).some((module) => module.key === 'expenses'));
  });

  it('requires company.setup.manage for the substitute-receipt policy submenu', () => {
    const withPermission = buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, ['expense.read', 'company.setup.manage']),
      'policy-company',
      'th',
      {},
      ['expense.read', 'company.setup.manage'],
    ).find((nav) => nav.key === 'expenses');
    const withoutPermission = buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, ['expense.read']),
      'policy-company',
      'th',
      {},
      ['expense.read'],
    ).find((nav) => nav.key === 'expenses');

    assert.ok(withPermission?.subItems?.some((sub) => sub.key === 'expenses.substitute_receipt_policy'));
    assert.ok(!withoutPermission?.subItems?.some((sub) => sub.key === 'expenses.substitute_receipt_policy'));
  });

  it('requires expense.evidence.read for the evidence submenu', () => {
    const readOnly = buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, ['expense.read']),
      'limited-company',
      'th',
      {},
      ['expense.read'],
    ).find((nav) => nav.key === 'expenses');
    const evidenceOnly = buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, ['expense.evidence.read']),
      'evidence-company',
      'th',
      {},
      ['expense.evidence.read'],
    ).find((nav) => nav.key === 'expenses');

    assert.ok(!readOnly?.subItems?.some((sub) => sub.key === 'expenses.evidence'));
    assert.ok(evidenceOnly?.subItems?.some((sub) => sub.key === 'expenses.evidence'));
  });
});

describe('canAccessWorkspacePath', () => {
  it('blocks a protected module URL without its read permission', () => {
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, [], 'abc', '/companies/abc/sales-documents'), false);
  });

  it('allows a protected module URL with its read permission', () => {
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['accounting.document.read'], 'abc', '/companies/abc/sales-documents'), true);
  });

  it('hides the retained report row from the sidebar but keeps its page reachable', () => {
    const retainedPermissions = ['report.snapshot.read'];
    const retainedModules = filterModulesByPermissions(WORKSPACE_MODULES, retainedPermissions);
    const retainedNav = buildNavItems(retainedModules, 'abc', 'th', {}, retainedPermissions)
      .find((item) => item.key === 'reports');

    // The launch package ships Reports OFF, so a retained-only row would be permanently empty. The
    // route and its permissions stay: a company that produced artifacts before its disable still
    // downloads them from its own link, and the page titles itself ประวัติรายงาน.
    assert.equal(retainedNav, undefined);
    assert.ok(retainedModules.some((module) => module.key === 'reports'));
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, retainedPermissions, 'abc', '/companies/abc/reports'), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, retainedPermissions, 'abc', '/companies/abc/reports/new'), false);
  });

  // Owner decision 2026-08-09: closing the accounting screens must not be defeatable by typing the
  // URL. `/journal` is the sharp case — it owns a ROUTE_PERMISSION_RULES entry, so the rule branch
  // would answer first and open it to any holder of `ledger.journal.read`. `/period-closing` owns
  // no rule and would otherwise reach the "no module matched → allowed" default.
  it('blocks the closed accounting screens by URL, even with every ledger permission', () => {
    const ledgerPermissions = ['ledger.journal.read', 'ledger.period.read', 'journal.entry.create', 'journal.entry.post'];
    for (const path of ['/journal', '/journal/jv_01HZ', '/period-closing']) {
      assert.equal(
        canAccessWorkspacePath(WORKSPACE_MODULES, ledgerPermissions, 'abc', `/companies/abc${path}`),
        false,
        `${path} must not open`,
      );
    }
    // Sibling finance screens that are open this launch are untouched by the hide.
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['expense.read'], 'abc', '/companies/abc/expenses'), true);
  });

  /**
   * Audit H-15: the layout sent every inaccessible path to /dashboard and rendered nothing while it
   * waited. Turning dashboard_notifications off strips dashboard.* — it is not platform-invariant —
   * so the redirect target was unreachable too and the whole company became a blank document.
   *
   * The layout now lands on the first module the session can actually open. These pin the two
   * inputs that decision reads, so a future permission change cannot quietly recreate the dead end.
   */
  it('leaves a reachable landing when dashboard is the feature that was switched off', () => {
    // Everything dashboard.* is gone; the company still bought expenses.
    const withoutDashboard = ['expense.read'];
    const reachable = filterModulesByPermissions(WORKSPACE_MODULES, withoutDashboard)
      .filter((module) => canAccessWorkspacePath(WORKSPACE_MODULES, withoutDashboard, 'abc', module.buildHref('abc')));

    assert.ok(reachable.length > 0, 'a landing exists that is not the dashboard');
    assert.equal(
      canAccessWorkspacePath(WORKSPACE_MODULES, withoutDashboard, 'abc', '/companies/abc/dashboard'),
      false,
      'and the old hardcoded target is exactly the one that is unreachable',
    );
  });

  // The other half: with nothing reachable the layout must render an explanation rather than null,
  // so this asserts the state the layout branches on is genuinely empty rather than merely small.
  it('reports no reachable landing at all for a session stripped of every module permission', () => {
    const reachable = filterModulesByPermissions(WORKSPACE_MODULES, [])
      .filter((module) => canAccessWorkspacePath(WORKSPACE_MODULES, [], 'abc', module.buildHref('abc')));

    assert.deepEqual(reachable.map((module) => module.key), []);
  });

  it('keeps the ordinary reports label and sub-route access while Reports is enabled', () => {
    const enabledPermissions = ['report.catalog.read', 'report.snapshot.read'];
    const enabledModules = filterModulesByPermissions(WORKSPACE_MODULES, enabledPermissions);
    const enabledNav = buildNavItems(enabledModules, 'abc', 'th', {}, enabledPermissions)
      .find((item) => item.key === 'reports');

    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, enabledPermissions, 'abc', '/companies/abc/reports/new'), true);
    assert.equal(enabledNav?.label, 'รายงานการเงิน');
  });

  it('allows every module URL through each tab gate owned by that feature', () => {
    for (const { moduleKey, path, permissions } of MODULE_TAB_GATES) {
      for (const permission of permissions) {
        assert.equal(
          canAccessWorkspacePath(WORKSPACE_MODULES, [permission], 'abc', path),
          true,
          `${moduleKey}: ${permission}`,
        );
      }
    }
  });

  it('separates employee and role settings permissions', () => {
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['access.employee.read'], 'abc', '/companies/abc/settings/access-overview'), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['access.role.read'], 'abc', '/companies/abc/settings/employees'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['access.effective.read'], 'abc', '/companies/abc/settings/access-overview'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['access.role.read'], 'abc', '/companies/abc/settings/permissions'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['access.role.manage'], 'abc', '/companies/abc/settings/permissions'), true);
  });

  it('does not let legacy admin grants bypass employee-access routes', () => {
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['admin.role.read'], 'abc', '/companies/abc/settings/permissions'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['admin.user.manage'], 'abc', '/companies/abc/settings/employees'), false);
  });

  it('checks company settings child routes by their feature permissions', () => {
    // The parked security route redirects; path access follows the (removed) menu entry.
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['account.session.read'], 'abc', '/companies/abc/settings/security'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['tax.profile.read'], 'abc', '/companies/abc/settings/branches'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['company.branch.read'], 'abc', '/companies/abc/settings/branches'), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['company.branch.read'], 'abc', '/companies/abc/settings/chart-of-accounts'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['ledger.account.read'], 'abc', '/companies/abc/settings/chart-of-accounts'), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['company.branch.read'], 'abc', '/companies/abc/settings/tax-codes'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['tax.profile.read'], 'abc', '/companies/abc/settings/tax-codes'), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['tax.config.read'], 'abc', '/companies/abc/settings/tax-accounts'), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['ledger.account.read'], 'abc', '/companies/abc/settings/accounting-tax-setup/review'), true);
  });

  it('checks substitute-receipt policy settings by its API permission', () => {
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['access.role.read'], 'abc', '/companies/abc/settings/substitute-receipt'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['company.setup.manage'], 'abc', '/companies/abc/settings/substitute-receipt'), true);
  });

  it('closes the discount policy with CRM instead of the universal setup key', () => {
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['company.setup.read'], 'abc', '/companies/abc/settings/discount-policy'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['crm.customer.read'], 'abc', '/companies/abc/settings/discount-policy'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['crm.customer.update'], 'abc', '/companies/abc/settings/discount-policy'), true);
  });

  it('keeps every registered route aligned with the workspace path gate', () => {
    // Screens closed this launch (ACCOUNTING_UI_HIDDEN) keep their route rule and their permissions
    // but must NOT open — the alignment invariant does not apply to them. Derived from the module
    // list so it follows the hidden set rather than restating it.
    const closedPaths = new Set(WORKSPACE_MODULES
      .filter((module) => ACCOUNTING_UI_HIDDEN_MODULE_KEYS.has(module.key))
      .map((module) => module.buildHref('abc').slice('/companies/abc'.length)));

    for (const rule of ROUTE_PERMISSION_RULES) {
      if (closedPaths.has(rule.path)) continue;
      const path = `/companies/abc${rule.path}`;
      assert.equal(canSeeRoute(rule.path, []), false, `${rule.path}: direct empty`);
      assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, [], 'abc', path), false, `${rule.path}: path empty`);
      for (const permission of rule.anyOf) {
        assert.equal(canSeeRoute(rule.path, [permission]), true, `${rule.path}: direct ${permission}`);
        assert.equal(
          canAccessWorkspacePath(WORKSPACE_MODULES, [permission], 'abc', path),
          true,
          `${rule.path}: path ${permission}`,
        );
      }
    }
  });

  it('uses the most specific registered rule on nested routes', () => {
    assert.equal(canSeeRoute('/tax/evidence', ['tax.period.read']), false);
    assert.equal(canSeeRoute('/tax/evidence', ['tax.config.read']), true);
    assert.equal(canSeeRoute('/settings/crm-catalog/new', ['inventory.product.read']), false);
    assert.equal(canSeeRoute('/settings/crm-catalog/new', ['inventory.product.manage']), true);
    assert.equal(findRoutePermissionRule('/settings/accounting-tax-setup/review')?.path, '/settings/accounting-tax-setup');
  });
});

describe('WORKSPACE_MODULES', () => {
  it('keeps module-backed route rules aligned with their navigation gates', () => {
    const routeToModule = {
      '/inventory': 'inventory',
      '/journal': 'journal',
      '/reports': 'reports',
      '/ai-suggestions': 'ai-suggestions',
      '/crm': 'crm',
      '/inbox': 'inbox',
      '/banking': 'banking',
      '/procurement': 'procurement',
      '/accounts-payable': 'accounts-payable',
      '/workflow': 'workflow',
      '/expenses': 'expenses',
      '/reimbursements': 'reimbursements',
    } as const;

    for (const [path, moduleKey] of Object.entries(routeToModule)) {
      assert.deepEqual(
        findRoutePermissionRule(path)?.anyOf,
        WORKSPACE_MODULES.find((module) => module.key === moduleKey)?.requiredAnyPermissions,
        path,
      );
    }
  });

  // A sub-feature is switched off by stripping the permissions its catalog entry owns
  // (featureKeyDeniedByEntitlement resolves a permission through the FIRST submenu claiming it).
  // So a submenu whose nav gate also accepts a permission ANOTHER submenu owns can never be
  // turned off: the other owner keeps that permission alive and the entry stays visible. That is
  // how ใบรับรองแทนใบเสร็จ stayed reachable through expense.read_own, which expenses.list owns —
  // in the nav and on GET /companies/:companyId/substitute-receipts alike. Only owned permissions
  // are probed, because an unowned one cannot be stripped by any sub-feature in the first place.
  it('never lets one submenu be revealed by a permission another submenu owns', () => {
    const owner = new Map<string, string>();
    const submenuKeys = new Set<string>();
    for (const feature of FEATURE_CATALOG) {
      for (const submenu of feature.submenus) {
        submenuKeys.add(submenu.key);
        for (const permission of submenu.permissionKeys) {
          if (!owner.has(permission)) owner.set(permission, submenu.key);
        }
      }
    }

    const leaks: string[] = [];
    for (const [permission, ownedBy] of owner) {
      const modules = filterModulesByPermissions(WORKSPACE_MODULES, [permission]);
      const revealed = buildNavItems(modules, 'co', 'th', {}, [permission])
        .flatMap((nav) => (nav.subItems ?? []).map((sub) => sub.key));
      for (const key of revealed) {
        if (submenuKeys.has(key) && key !== ownedBy) leaks.push(`${key} is revealed by ${permission}, owned by ${ownedBy}`);
      }
    }
    assert.deepEqual(leaks, []);
  });

  it('has no duplicate keys', () => {
    const keys = WORKSPACE_MODULES.map((m) => m.key);
    const unique = new Set(keys);
    assert.equal(unique.size, keys.length);
  });

  it('stays aligned with menu entitlement bindings', () => {
    assert.deepEqual(
      MENU_ENTITLEMENT_BINDINGS.map((binding) => binding.navKey).sort(),
      WORKSPACE_MODULES.map((module) => module.key).sort(),
    );

    const modulesByKey = new Map(WORKSPACE_MODULES.map((module) => [module.key, module]));
    for (const binding of MENU_ENTITLEMENT_BINDINGS) {
      const module = modulesByKey.get(binding.navKey);
      assert.ok(module, `${binding.navKey}: workspace module is required`);
      assert.equal(binding.group, module.navGroup, `${binding.navKey}: group`);
      assert.equal(binding.iconKey, module.iconKey, `${binding.navKey}: iconKey`);
      assert.deepEqual(
        [...binding.gatePermissions, ...(binding.retainedGatePermissions ?? [])],
        module.requiredAnyPermissions,
        `${binding.navKey}: gatePermissions`,
      );
    }
  });

  it('marks API-backed/current pages ready while prototype-only pages stay planned', () => {
    const byKey = new Map(WORKSPACE_MODULES.map((module) => [module.key, module.status]));
    assert.equal(byKey.get('expenses'), 'ready');
    assert.equal(byKey.get('reports'), 'ready');
    assert.equal(byKey.get('roles'), 'ready');
    assert.equal(byKey.get('booking'), 'ready');
    assert.equal(byKey.get('customers'), 'ready');
    assert.equal(byKey.has('broadcast'), false);
  });
});

describe('resolveMenuKey', () => {
  // The permission-filtered nav list an OWNER-like session would see.
  const targets = collectMenuTargets(
    buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, ALL_MODULE_PERMISSIONS),
      'abc',
      'th',
      {},
      ALL_MODULE_PERMISSIONS,
    ),
  );
  const at = (pathname: string) => resolveMenuKey(pathname, targets);

  // The 'expenses' parent and its 'expenses.list' child share one href, so which of the two
  // names the menu is arbitrary — both identify the same screen. Only the grouping matters.
  it('resolves a list route to a stable key', () => {
    assert.equal(at('/companies/abc/expenses'), 'expenses');
  });

  // The whole point: a detail route is claimed by no href more specific than the list's, so it
  // counts as the same menu and the list's filter survives the round trip.
  it('keeps a row detail route on the list it was opened from', () => {
    assert.equal(at('/companies/abc/expenses/exp_01HZ'), at('/companies/abc/expenses'));
  });

  // ...while a sibling tab has an href of its own and is therefore a different menu.
  it('separates sibling tabs from the list', () => {
    assert.equal(at('/companies/abc/expenses/evidence'), 'expenses.evidence');
    assert.equal(at('/companies/abc/expenses/upload'), 'expenses.upload');
    assert.equal(at('/companies/abc/expenses/manual'), 'expenses.manual');
  });

  it('resolves an unrelated menu to itself', () => {
    assert.equal(at('/companies/abc/dashboard'), 'dashboard');
  });

  it('returns null for a path no menu claims', () => {
    assert.equal(at('/unknown/path'), null);
  });

  // 'journal' used to resolve here: it is absent from the sidebar's design-handoff order but still
  // counted as a menu of its own. The accounting screens are closed this launch, so it is now not a
  // menu at all and claims no path.
  it('claims no menu for a screen closed this launch', () => {
    assert.equal(at('/companies/abc/journal'), null);
  });

  it('skips targets with no href', () => {
    assert.deepEqual(collectMenuTargets([{ key: 'x', label: 'x', icon: null, group: 'main' } as NavItem]), []);
  });
});
