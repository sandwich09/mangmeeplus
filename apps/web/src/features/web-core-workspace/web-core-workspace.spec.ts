import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_CATALOG, MENU_ENTITLEMENT_BINDINGS } from '@watchdog-bms/contracts';
import { filterModulesByPermissions, filterModulesForSession, canAccessFreeExpenseWorkspacePath, companySwitcherTarget, getActiveModuleKey, groupNavItems, buildAccountLinks, packageMenuTrailing, buildLockedNavItems, buildNavItems, canAccessWorkspacePath, collectMenuTargets, employeePageMenuKey, resolveMenuKey } from './web-core-workspace.logic';
import { isLockedShellPath } from '@/features/plan-term/plan-term.logic';
import { WORKSPACE_MODULES, NAV_GROUP_ORDER, SIDEBAR_GROUP_ORDER, ACCOUNTING_UI_HIDDEN_MODULE_KEYS } from './web-core-workspace.constants';
import type { NavItem } from './web-core-workspace.model';
import { isActiveNavSubItem } from '@/common/components/app-shell/app-sidebar.logic';
import { canSeeRoute, findRoutePermissionRule, ROUTE_PERMISSION_RULES } from './route-permissions';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { canOpenDisbursementVoucherWeb } from '@/features/expenses/disbursement-voucher-entry.logic';

describe('free expense workspace routing', () => {
  it('opens only expenses and routes eligible expired shops to drafts', () => {
    const modules = filterModulesForSession(WORKSPACE_MODULES, ['expense.read_own', 'expense.receipt.upload'], true);
    assert.deepEqual(modules.map((module) => module.key), ['expenses']);
    const nav = buildNavItems(modules, 'co', 'th', {}, ['expense.read_own', 'expense.receipt.upload'], [], false, false, true, true);
    assert.deepEqual(nav.map((item) => item.key), ['expenses']);
    assert.deepEqual(nav[0]!.subItems?.map((item) => item.key), ['expenses.list', 'expenses.upload']);
    assert.equal(canAccessFreeExpenseWorkspacePath('co', '/companies/co/expenses'), true);
    assert.equal(canAccessFreeExpenseWorkspacePath('co', '/companies/co/expenses/upload'), true);
    assert.equal(canAccessFreeExpenseWorkspacePath('co', '/companies/co/expenses/manual'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['expense.read_own'], 'co', '/companies/co/dashboard', true), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['company.plan.manage'], 'co', '/companies/co/billing', true), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, [], 'co', '/companies/co/billing', true), false);
    assert.equal(companySwitcherTarget({ companyId: 'free', currentCompanyId: 'paid', expired: true, freeExpenseDrafts: true, currentPath: '/companies/paid/dashboard' }), '/companies/free/expenses');
    assert.equal(companySwitcherTarget({ companyId: 'paid', currentCompanyId: 'free', expired: true, currentFreeExpenseDrafts: true, currentPath: '/companies/free/expenses' }), '/companies/paid/renew');
  });

  it('keeps แพ็กเกจ in a free shop for the holder of company.plan.manage only (spec §8 rule 11–12)', () => {
    const member = ['expense.read_own', 'expense.receipt.upload'];
    for (const [permissions, holder] of [[[...member, 'company.plan.manage'], true], [member, false]] as const) {
      const nav = buildNavItems(filterModulesForSession(WORKSPACE_MODULES, [...permissions], true), 'co', 'th', {}, [...permissions], [], false, false, true, true);
      assert.deepEqual(nav.map((item) => item.key), holder ? ['expenses', 'billing'] : ['expenses']);
      if (holder) assert.deepEqual([nav[1]!.label, nav[1]!.href], ['แพ็กเกจ', '/companies/co/billing']);
      assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, [...permissions], 'co', '/companies/co/billing', true), holder);
    }
  });
});

describe('disbursement-voucher web entrances', () => {
  it('shows the child only with read permission AND the setting, leaving the other children unchanged', () => {
    for (const read of [false, true]) {
      for (const flag of [undefined, false, true]) {
        const permissions = ['expense.read_own', ...(read ? ['expense.disbursement.read'] : [])];
        const session = { companyId: 'co', permissions, disbursementVoucherWebEntry: flag };
        const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
        const children = buildNavItems(modules, 'co', 'th', {}, permissions, [], false,
          canOpenDisbursementVoucherWeb(session, 'co')).find((item) => item.key === 'expenses')!.subItems!;
        const voucher = children.find((child) => child.key === 'expenses.disbursement_vouchers');
        assert.equal(Boolean(voucher), read && flag === true);
        if (voucher) {
          assert.equal(voucher.label, 'ใบเตรียมจ่าย/ใบสำคัญจ่าย');
          assert.equal(voucher.href, '/companies/co/expenses/disbursement-vouchers');
        }
        assert.deepEqual(children.filter((child) => child !== voucher).map((child) => child.key),
          ['expenses.list', 'expenses.substitute_receipt']);
      }
    }
    for (const permissions of [['expense.read_own'], ['expense.read_own', 'expense.disbursement.read']]) {
      const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
      const hasChild = (shown?: boolean) => buildNavItems(modules, 'co', 'th', {}, permissions, [], false, shown)
        .find((item) => item.key === 'expenses')!.subItems!.some((child) => child.key === 'expenses.disbursement_vouchers');
      assert.equal(hasChild(), false, 'a caller without the setting keeps the new menu hidden');
      assert.equal(hasChild(true), permissions.includes('expense.disbursement.read'), 'the builder also checks read permission');
    }
  });

  it('does not let the new permissions open the expenses group by themselves', () => {
    const permissions = ['expense.disbursement.read', 'expense.disbursement.prepare',
      'expense.disbursement.approve', 'expense.disbursement.pay', 'expense.disbursement.issue'];
    assert.equal(filterModulesByPermissions(WORKSPACE_MODULES, permissions).some((module) => module.key === 'expenses'), false);
    assert.equal(canSeeRoute('/expenses', permissions), false);
    assert.equal(buildNavItems(filterModulesByPermissions(WORKSPACE_MODULES, permissions), 'co', 'th', {}, permissions, [], false, true)
      .some((item) => item.key === 'expenses'), false);
  });

  it('uses read for the list and document and prepare for new, ahead of the general expense rule', () => {
    for (const [path, permission] of [
      ['/expenses/disbursement-vouchers', 'expense.disbursement.read'],
      ['/expenses/disbursement-vouchers/new', 'expense.disbursement.prepare'],
      ['/expenses/disbursement-vouchers/doc-1', 'expense.disbursement.read'],
    ] as const) {
      assert.deepEqual(findRoutePermissionRule(path)?.anyOf, [permission]);
      assert.equal(canSeeRoute(path, [permission]), true);
      assert.equal(canSeeRoute(path, ['expense.read', 'expense.create']), false);
      for (const other of ['expense.disbursement.read', 'expense.disbursement.prepare']) {
        assert.equal(canSeeRoute(path, [other]), other === permission);
      }
      assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, [permission], 'co', `/companies/co${path}`), true);
      assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['expense.read'], 'co', `/companies/co${path}`), false);
    }
  });
});

it('P24-2b keeps all seven scope-control templates touch-sized with forced-colors-safe focus', () => {
  const source = readFileSync(new URL('./WorkspaceScope.tsx', import.meta.url), 'utf8');
  const classes = [...source.matchAll(/<button\b[\s\S]*?className=(?:"([^"]*)"|\{`([^`]*)`)/g)]
    .map((match) => match[1] ?? match[2] ?? '');
  assert.equal(classes.length, 7, 'both triggers/retries, company/branch options and all-branches option');
  for (const value of classes) {
    assert.match(value, /(?:^|\s)(?:h-11|min-h-11)(?:\s|$)/);
    assert.doesNotMatch(value, /\bsm:h-10\b/);
    assert.match(value, /focus-visible:outline-hidden/);
    assert.match(value, /focus-visible:ring-2/);
    assert.match(value, /focus-visible:ring-brand-500/);
  }
  assert.equal([...source.matchAll(/t\('client_notice\.retry', locale\)/g)].length, 2);
  assert.equal(t('client_notice.retry', 'th'), 'ลองอีกครั้ง');
  assert.equal(t('client_notice.retry', 'en'), 'Try again');
  for (const locale of ['th', 'en'] as const) {
    assert.ok(t('shell.scope.load_failed', locale).toLowerCase().includes(t('client_notice.retry', locale).toLowerCase()),
      `${locale} accessible name contains the visible retry action`);
  }
  assert.equal([...source.matchAll(/max-h-\[calc\(100dvh-var\(--app-header-h\)-1rem\)\] overflow-y-auto/g)].length, 2,
    'both company and branch popups have a viewport-bounded vertical scroller');
});

it('MOBILE-1 both scope pickers constrain long names and retain 44px controls on phones', () => {
  const source = readFileSync(new URL('./WorkspaceScope.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/className="relative min-w-0 max-w-full flex-1 sm:flex-none"/g) ?? []).length, 2);
  assert.equal((source.match(/className="flex h-11 w-full min-w-0 max-w-full overflow-hidden /g) ?? []).length, 2);
  assert.match(source, /<span className="min-w-0 flex-1 truncate">\{label\}<\/span>/);
  assert.match(source, /<span className="min-w-0 flex-1 truncate text-left text-sm" title=\{label\}>\{label\}<\/span>/);
});

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
  it('hides AI entry points without a template source right and keeps authorized review links', () => {
    for (const permission of ['ai.suggestion.read', 'ai.suggestion.read_own']) {
      assert.equal(filterModulesByPermissions(WORKSPACE_MODULES, [permission]).some(module => module.key === 'ai-suggestions'), false);
      assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, [permission], 'co', '/companies/co/ai-suggestions/retained-review'), false);
      for (const source of ['bank.cash.read', 'crm.customer.read', 'inventory.report.read', 'tax.review_issue.read', 'workflow.task.read']) {
        const permissions = [permission, source];
        const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
        assert.ok(modules.some(module => module.key === 'ai-suggestions'));
        assert.ok(buildNavItems(modules, 'co', 'th', {}, permissions).some(item => item.key === 'ai-suggestions'));
        assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, permissions, 'co', '/companies/co/ai-suggestions/retained-review'), true);
      }
    }
    assert.equal(canSeeRoute('/ai-suggestions', ['bank.cash.read']), false);
  });
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
        const permissions = path === '/ai-suggestions' ? [permission, 'bank.cash.read'] : [permission];
        const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
        assert.ok(modules.some((module) => module.key === moduleKey), `${path}: module ${permission}`);
        const item = buildNavItems(modules, 'co', 'th', {}, permissions).find((nav) => nav.key === moduleKey);
        if (path === '/reports' && permission === 'report.snapshot.read') {
          assert.equal(item, undefined, `${path}: retained-only history intentionally has no row`);
        } else {
          assert.equal(item?.href, `/companies/co${path}`, `${path}: nav ${permission}`);
        }
        assert.equal(
          canAccessWorkspacePath(WORKSPACE_MODULES, permissions, 'co', `/companies/co${path}`),
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
      ['roles.individual'],
    );
    assert.equal(
      employeeItems.find((item) => item.key === 'roles')?.href,
      '/companies/employee-company/settings/access-overview',
    );

    const creatorPermissions = ['access.employee.read', 'access.employee.create'];
    const creatorItems = buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, creatorPermissions),
      'employee-company', 'th', {}, creatorPermissions,
    );
    // 2026-10-13: adding a person is the list page's button, not a row; the list is the way in.
    assert.deepEqual(
      creatorItems.find((item) => item.key === 'roles')?.subItems?.map((item) => item.key),
      ['roles.individual'],
    );
    assert.equal(employeePageMenuKey('employee-company', '/companies/employee-company/settings/employees', creatorItems), 'roles.individual');
    assert.equal(employeePageMenuKey('employee-company', '/companies/employee-company/settings/employees/emp-1', creatorItems), 'roles.individual');
    assert.equal(employeePageMenuKey('employee-company', '/companies/employee-company/settings/access-overview', creatorItems), null);

    const createOnlyItems = buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, ['access.employee.create']),
      'employee-company', 'th', {}, ['access.employee.create'],
    );
    // Someone who may add people but may not open the list keeps the row: it is their one way in.
    assert.deepEqual(
      createOnlyItems.find((item) => item.key === 'roles')?.subItems?.map((item) => item.key),
      ['employees'],
    );
    assert.equal(employeePageMenuKey('employee-company', '/companies/employee-company/settings/employees', createOnlyItems), null);

    const editorItems = buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, ['access.employee.read', 'access.employee.update']),
      'employee-company', 'th', {}, ['access.employee.read', 'access.employee.update'],
    );
    assert.ok(!editorItems.find((item) => item.key === 'roles')?.subItems?.some((item) => item.key === 'employees'));

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
    const ownerPermissions = [...ALL_MODULE_PERMISSIONS, 'access.employee.create'];
    const items = buildNavItems(WORKSPACE_MODULES, 'owner-company', 'th', {}, ownerPermissions);
    const permissionsItem = items.find((nav) => nav.key === 'roles');

    assert.ok(permissionsItem);
    assert.ok(!items.some((nav) => nav.key === 'poapproval'));
    // The list of people first, then the roles (2026-10-13).
    assert.equal(permissionsItem.href, '/companies/owner-company/settings/access-overview');
    assert.deepEqual(
      permissionsItem.subItems?.map((sub) => sub.key),
      ['roles.individual', 'roles.permissions', 'poapproval', 'discount', 'lineoa'],
    );
    assert.equal(permissionsItem.subItems?.[0]?.href, '/companies/owner-company/settings/access-overview');
    assert.equal(permissionsItem.subItems?.[1]?.href, '/companies/owner-company/settings/permissions');
    assert.equal(permissionsItem.subItems?.[2]?.href, '/companies/owner-company/settings/po-approval');
    assert.equal(permissionsItem.subItems?.[4]?.href, '/companies/owner-company/settings/line-oa');
  });

  // คู่มือการใช้งานระบบ carries no company data and gates on nothing, so a session holding no
  // permission at all still gets the row — and every listed manual must stay reachable from it.
  // ภาษี/รายงานการเงิน are hidden from the row while their features are unreleased; their routes
  // stay open, which is exactly what the reachability loop below still asserts.
  // Found 2026-10-13: an employee had no way to their own e-mail or signature; the account page sits behind a company-settings right.
  it('gives every person a way to their own account and, with a signature right, to their signature', () => {
    assert.deepEqual(buildAccountLinks('co', ['company.setup.read', 'expense.review']), [
      { key: 'account', label: 'บัญชีของฉัน', href: '/companies/co/account' },
      { key: 'signature', label: 'ลายเซ็นของฉัน', href: '/companies/co/expenses/signatures' },
    ]);
    // No company-settings right: the account page outside the company. No signature right: no signature row.
    assert.deepEqual(buildAccountLinks('co', ['expense.read_own']), [{ key: 'account', label: 'บัญชีของฉัน', href: '/companies/co/account' }]);
    // A locked shop refuses business pages, so the signature row goes and the account row stays.
    assert.deepEqual(buildAccountLinks('co', ['expense.signature.self_manage'], true).map((link) => link.key), ['account']);
  });

  it('puts the guide under its own heading, after the settings group', () => {
    assert.equal(buildNavItems([], 'co', 'th', {}, []).find((nav) => nav.key === 'guide')?.group, 'help');
    assert.equal(SIDEBAR_GROUP_ORDER.at(-1), 'help');
    // The module groups stay as contracts know them: the guide is not a module.
    assert.ok(!(NAV_GROUP_ORDER as string[]).includes('help'));
  });

  it('always offers the user-guide menu with one sub-item per released manual', () => {
    const guide = buildNavItems([], 'guide-company', 'th', {}, []).find((nav) => nav.key === 'guide');

    assert.ok(guide);
    // ลำดับต้องตรงกับลำดับเมนูจริงในแถบซ้าย ไม่ใช่ลำดับที่เขียนไฟล์คู่มือ
    assert.deepEqual(guide.subItems?.map((sub) => sub.key), [
      'guide.getting_started',
      'guide.expenses',
      'guide.substitute_receipts',
      'guide.reimbursements',
    ]);
    assert.deepEqual(guide.subItems?.map((sub) => sub.href), [
      '/companies/guide-company/user-guide/getting-started',
      '/companies/guide-company/user-guide/expenses',
      '/companies/guide-company/user-guide/substitute-receipts',
      '/companies/guide-company/user-guide/reimbursements',
    ]);
    assert.equal(guide.href, '/companies/guide-company/user-guide/getting-started');
    for (const slug of ['getting-started', 'expenses', 'substitute-receipts', 'reimbursements', 'tax', 'reports']) {
      assert.equal(
        canAccessWorkspacePath(WORKSPACE_MODULES, [], 'guide-company', `/companies/guide-company/user-guide/${slug}`),
        true,
        slug,
      );
    }
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

    // In the order of the work; the policy page is a setting and sits with the settings rows.
    assert.deepEqual(expenses?.subItems?.map((sub) => sub.key), [
      'expenses.list',
      'expenses.upload',
      'expenses.manual',
      'expenses.substitute_receipt',
      'expenses.evidence',
      'expenses.categories',
    ]);
    assert.deepEqual(expenses?.subItems?.map((sub) => sub.href), [
      '/companies/owner-company/expenses',
      '/companies/owner-company/expenses/upload',
      '/companies/owner-company/expenses/manual',
      '/companies/owner-company/expenses/substitute-receipts',
      '/companies/owner-company/expenses/evidence',
      '/companies/owner-company/expenses/categories',
    ]);
    const paying = [...permissions, 'expense.disbursement.read', 'wht.certificate.issue'];
    assert.deepEqual(
      buildNavItems(filterModulesByPermissions(WORKSPACE_MODULES, paying), 'owner-company', 'th', {}, paying, [], true, true)
        .find((nav) => nav.key === 'expenses')?.subItems?.map((sub) => sub.key),
      ['expenses.list', 'expenses.upload', 'expenses.manual', 'expenses.disbursement_vouchers', 'expenses.wht_certificates',
        'expenses.substitute_receipt', 'expenses.evidence', 'expenses.categories'],
    );
  });

  // manual-expense-web-entry-flag spec §9.1: the sidebar item follows the one predicate
  // (`canOpenManualWeb`), passed in by the layout. Desktop and phone render this same list.
  it('leaves the manual-entry item out when the company does not show it, and nothing else', () => {
    const permissions = ['expense.read', 'expense.read_own', 'expense.receipt.upload', 'expense.create', 'expense.category.manage', 'expense.signature.manage', 'company.setup.manage', 'expense.evidence.read'];
    const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
    const keys = (canOpenManualExpense?: boolean) => buildNavItems(modules, 'owner-company', 'th', {}, permissions, [], canOpenManualExpense)
      .find((nav) => nav.key === 'expenses')?.subItems?.map((sub) => sub.key);
    const all = ['expenses.list', 'expenses.upload', 'expenses.manual', 'expenses.substitute_receipt', 'expenses.evidence', 'expenses.categories'];

    assert.deepEqual(keys(true), all);
    assert.deepEqual(keys(false), all.filter((key) => key !== 'expenses.manual'));
    // A caller that says nothing keeps the permission rule: the setting can only ever hide.
    assert.deepEqual(keys(), all);
    // And it never shows the item to a session that may not create.
    assert.equal(buildNavItems(filterModulesByPermissions(WORKSPACE_MODULES, ['expense.read_own']), 'co', 'th', {}, ['expense.read_own'])
      .find((nav) => nav.key === 'expenses')?.subItems?.some((sub) => sub.key === 'expenses.manual'), false);
  });

  it('keeps the rarely used personal signature page out of the Expenses submenu', () => {
    for (const permission of ['expense.signature.self_manage', 'expense.confirm', 'expense.signature.manage']) {
      const permissions = ['expense.read_own', permission];
      const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
      const expenses = buildNavItems(modules, 'owner-company', 'th', {}, permissions).find((nav) => nav.key === 'expenses');
      assert.equal(expenses?.subItems?.some((sub) => sub.key === 'expenses.signatures'), false, permission);
    }
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
      'expense.receipt.line_upload',
      'expense.create',
      'expense.category.manage',
      'expense.signature.self_manage',
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

  // The policy page is a setting: since 2026-10-13 its one row is under ตั้งค่าบริษัท (it was also under the daily
  // expense rows). The permission that shows it is unchanged.
  it('requires company.setup.manage for the substitute-receipt policy row, which sits with the settings rows', () => {
    const rows = (permissions: string[]) => buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, permissions), 'policy-company', 'th', {}, permissions,
    ).flatMap((nav) => (nav.subItems ?? []).map((sub) => `${nav.key} > ${sub.href}`));
    const policyRow = 'settings > /companies/policy-company/settings/substitute-receipt';

    assert.deepEqual(rows(['expense.read', 'company.setup.manage']).filter((row) => row.endsWith('/settings/substitute-receipt')), [policyRow]);
    assert.deepEqual(rows(['expense.read']).filter((row) => row.endsWith('/settings/substitute-receipt')), []);
  });

  it('keeps shop settings inside ตั้งค่าร้าน and gives แพ็กเกจ its own permission-checked row', () => {
    const permissions = ['company.settings.view', 'company.setup.read', 'company.setup.manage', 'company.branch.read', 'company.tax_signature.manage', 'company.plan.manage'];
    const settings = buildNavItems(filterModulesByPermissions(WORKSPACE_MODULES, permissions), 'co', 'th', {}, permissions)
      .find((nav) => nav.key === 'settings');
    assert.deepEqual(settings?.subItems?.map((sub) => [sub.key, sub.label, sub.href]), [
      ['settings.overview', 'ภาพรวมการตั้งค่า', '/companies/co/settings'],
      ['settings.company-profile', 'ข้อมูลร้าน', '/companies/co/settings/profile'],
      ['settings.branches', 'สาขา', '/companies/co/settings/branches'],
      ['settings.substitute-receipt', 'ตั้งค่าใบรับรองแทนใบเสร็จ', '/companies/co/settings/substitute-receipt'],
      ['settings.e-wht', 'จ่ายผ่าน e-WHT ของธนาคาร', '/companies/co/settings/e-wht'],
      ['settings.tax-signature', 'ลายเซ็นบน 50 ทวิ', '/companies/co/settings/tax-signature'],
    ]);
    assert.equal(buildLockedNavItems('co', {}, ['company.plan.manage']).find((item) => item.key === 'billing')?.label, 'แพ็กเกจ');
    const nav = buildNavItems(filterModulesByPermissions(WORKSPACE_MODULES, permissions), 'co', 'th', {}, permissions);
    const billing = nav.find(item => item.key === 'billing');
    assert.deepEqual(billing, { key: 'billing', label: 'แพ็กเกจ', href: '/companies/co/billing', icon: null, group: 'admin' });
    assert.ok(!buildNavItems([], 'co', 'th', {}, ['company.setup.manage']).some(item => item.key === 'billing'));
    assert.equal(buildNavItems([], 'co', 'th', {}, ['company.plan.manage']).some(item => item.key === 'settings'), false);
    for (const path of ['/billing', '/billing/return', '/billing/invoices/one']) assert.equal(resolveMenuKey(`/companies/co${path}`, collectMenuTargets(nav)), 'billing');
    // Each settings page lights its own row and never the overview with it (the sidebar's own rule).
    const rows = settings!.subItems!;
    for (const [path, key] of [['/settings', 'settings.overview'], ['/settings/profile', 'settings.company-profile'], ['/settings/branches', 'settings.branches'],
      ['/settings/substitute-receipt', 'settings.substitute-receipt'], ['/settings/e-wht', 'settings.e-wht'], ['/settings/tax-signature', 'settings.tax-signature']] as const) {
      const pathname = `/companies/co${path}`;
      const activeKey = getActiveModuleKey(WORKSPACE_MODULES, 'co', pathname) ?? undefined;
      assert.deepEqual(rows.filter((row) => isActiveNavSubItem(pathname, activeKey, row, rows)).map((row) => row.key), [key], path);
    }
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
  it('lets a frozen reimbursement assignee reach the hub probe without adding a general nav grant', () => {
    const permissions = ['account.session.read'];
    assert.equal(filterModulesByPermissions(WORKSPACE_MODULES, permissions).some((module) => module.key === 'reimbursements'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, permissions, 'abc', '/companies/abc/reimbursements'), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, permissions, 'abc', '/companies/abc/reimbursements/admin'), false);
    // The claim's journey page is the same probe (spec §8); creating a claim is not.
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, permissions, 'abc', '/companies/abc/reimbursements/cmfr2x9k00001a2b3c4d5e6f7'), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, permissions, 'abc', '/companies/abc/reimbursements/new'), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, permissions, 'abc', '/companies/abc/reimbursements/cmfr2x9k00001a2b3c4d5e6f7/edit'), false);
  });

  it('blocks a protected module URL without its read permission', () => {
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, [], 'abc', '/companies/abc/sales-documents'), false);
  });

  it('allows a protected module URL with its read permission', () => {
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['accounting.document.read'], 'abc', '/companies/abc/sales-documents'), true);
  });

  it('lets a LINE receipt uploader return to an owned expense draft from its deep link', () => {
    assert.equal(
      canAccessWorkspacePath(WORKSPACE_MODULES, ['expense.receipt.line_upload'], 'abc', '/companies/abc/expenses/expense-1'),
      true,
    );
  });

  it('lets an income creator reach the dedicated mutation page without broad document read', () => {
    const path = '/companies/abc/sales-documents/record-income';
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['accounting.invoice.create'], 'abc', path), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['accounting.payment.create'], 'abc', path), false);
  });

  it('protects the income-expense ledger URL with either supported read permission', () => {
    const path = '/companies/abc/income-expense-ledger';
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, [], 'abc', path), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['accounting.document.read'], 'abc', path), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['expense.read'], 'abc', path), true);
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
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['access.employee.read'], 'abc', '/companies/abc/settings/employees'), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['access.employee.create'], 'abc', '/companies/abc/settings/employees'), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['access.employee.update'], 'abc', '/companies/abc/settings/employees'), true);
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
        const permissions = rule.path === '/ai-suggestions' ? [permission, 'bank.cash.read'] : [permission];
        assert.equal(canSeeRoute(rule.path, permissions), true, `${rule.path}: direct ${permission}`);
        assert.equal(
          canAccessWorkspacePath(WORKSPACE_MODULES, permissions, 'abc', path),
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

  it('opens only a counterparty detail deep link to expense users, not the full registry', () => {
    const uploader = ['expense.receipt.upload'];
    assert.equal(canSeeRoute('/counterparties', uploader), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, uploader, 'abc', '/companies/abc/counterparties'), false);
    assert.equal(canSeeRoute('/counterparties/cp-1', uploader), true);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, uploader, 'abc', '/companies/abc/counterparties/cp-1'), true);

    const creator = ['expense.create'];
    assert.equal(canSeeRoute('/counterparties', creator), false);
    assert.equal(canSeeRoute('/counterparties/cp-1', creator), true);
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
        // SETTINGS-PERMS is a web-only entrance change; leave the shared/LINE binding intact.
        [...binding.gatePermissions, ...(binding.retainedGatePermissions ?? []),
          ...(binding.navKey === 'settings' ? ['company.setup.read'] : [])].sort(),
        [...module.requiredAnyPermissions].sort(),
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


describe('package management navigation', () => {
  it('places one billing entry at top level for the assigned permission', () => {
    const permissions = ['company.setup.read', 'company.plan.manage'];
    const items = buildNavItems(filterModulesByPermissions(WORKSPACE_MODULES, permissions), 'co', 'th', {}, permissions);
    assert.equal(items.filter(item => item.href === '/companies/co/billing').length, 1);
    assert.equal(items.find(item => item.key === 'billing')?.group, 'admin');
    assert.ok(!items.flatMap(item => item.subItems ?? []).some(item => item.href === '/companies/co/billing'));
  });
  it('keeps billing available without granting business settings when all feature modules are absent', () => {
    const items = buildNavItems([], 'co', 'th', {}, ['company.plan.manage']);
    assert.equal(items.find(item => item.key === 'billing')?.href, '/companies/co/billing');
    assert.equal(items.find(item => item.key === 'settings'), undefined);
  });

  it('does not add billing without the dedicated permission, regardless of role name', () => {
    const items = buildNavItems(WORKSPACE_MODULES, 'co', 'th', {}, ALL_MODULE_PERMISSIONS, ['CEO']);
    assert.equal(collectMenuTargets(items).some(item => item.href.endsWith('/billing')), false);
  });
});

// Owner 2026-09-20 (spec §12): a shop with no usable package sees two destinations and no more,
// whatever it is permitted to do — every other page is refused by the term guard behind them.
describe('locked shell navigation', () => {
  it('gives a permission holder ตั้งค่า and แพ็กเกจ, and nothing else', () => {
    const items = buildLockedNavItems('co', {}, ['company.plan.manage']);
    assert.deepEqual(items.map((item) => [item.label, item.href]), [
      ['ตั้งค่าร้าน', '/companies/co/settings'],
      ['แพ็กเกจ', '/companies/co/billing'],
    ]);
  });

  it('gives staff ตั้งค่า only when the package permission was not assigned', () => {
    assert.deepEqual(buildLockedNavItems('co', {}, ['company.setup.manage']).map((item) => item.key), ['settings']);
    assert.deepEqual(buildLockedNavItems('co', {}).map((item) => item.key), ['settings']);
  });

  // The menu and the redirect are two copies of one rule; a row the redirect bounces is a dead end.
  it('offers only paths the locked shell itself allows', () => {
    for (const target of collectMenuTargets(buildLockedNavItems('co', {}, ['company.plan.manage']))) {
      assert.equal(isLockedShellPath(target.href, 'co'), true, target.href);
    }
  });

  it('resolves the open menu from the same targets the shell renders', () => {
    const items = buildLockedNavItems('co', {}, ['company.plan.manage']);
    assert.equal(resolveMenuKey('/companies/co/billing', collectMenuTargets(items)), 'billing');
    assert.equal(resolveMenuKey('/companies/co/settings/profile', collectMenuTargets(items)), 'settings');
    assert.equal(resolveMenuKey('/companies/co/renew', collectMenuTargets(items)), null);
  });
});

it('settings view-only and legacy manage-only each open the hub and their readable pages from the menu', () => {
  for (const permissions of [
    ['company.setup.read', 'company.branch.read', 'document.sequence.read'],
    ['company.setup.manage', 'company.branch.manage', 'document.sequence.manage'],
  ]) {
    const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
    const settings = buildNavItems(modules, 'shop', 'th', {}, permissions).find(item => item.key === 'settings');
    assert.ok(settings);
    for (const key of ['settings.overview', 'settings.company-profile', 'settings.branches']) {
      const child = settings.subItems?.find(item => item.key === key);
      assert.ok(child, key);
      assert.ok(canAccessWorkspacePath(WORKSPACE_MODULES, permissions, 'shop', child.href!));
    }
    assert.equal(canSeeRoute('/settings/profile', permissions), true);
  }
  assert.equal(canSeeRoute('/settings/profile', ['company.branch.read']), false);
});

it('package menu days use the notice warning window and suppress orange while card renewal runs', () => {
  const notice = { derivedState: 'WARNING' as const, daysLeft: 7, termEndsAt: '2026-10-25', isOwner: true };
  assert.deepEqual(packageMenuTrailing(notice), { label: 'เหลือ 7 วัน', warning: true });
  assert.deepEqual(packageMenuTrailing(notice, true), { label: 'เหลือ 7 วัน', warning: false });
  assert.deepEqual(packageMenuTrailing({ ...notice, derivedState: 'ACTIVE' }), { label: 'เหลือ 7 วัน', warning: false });
  assert.deepEqual(packageMenuTrailing({ ...notice, isOwner: false }), { label: 'เหลือ 7 วัน', warning: false });
  assert.deepEqual(packageMenuTrailing({ ...notice, daysLeft: -2, derivedState: 'EXPIRED' }), { label: 'เหลือ 0 วัน', warning: false });
  assert.equal(packageMenuTrailing(null), undefined);
  assert.equal(packageMenuTrailing({ ...notice, termEndsAt: '' }), undefined);
});

it('FIX-Q2 settings hub and locked sidebar share the shop-settings name', () => {
  const source = readFileSync(new URL('../../../app/(workspace)/companies/[companyId]/settings/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /title="ตั้งค่าร้าน"/);
  assert.equal(buildLockedNavItems('co', {})[0].label, 'ตั้งค่าร้าน');
});
