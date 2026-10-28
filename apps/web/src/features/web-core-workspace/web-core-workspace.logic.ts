import type { PlanTermNotice } from '@/features/plan-term/plan-term.api';
import { planTermView } from '@/features/plan-term/plan-term.logic';
import type React from 'react';
import { COMPANY_PROFILE_ACCOUNT_HASH, COMPANY_PROFILE_SETTINGS_PATH, MENU_ENTITLEMENT_BINDINGS } from '@watchdog-bms/contracts';
import type { WorkspaceModule, NavItemGroup, NavItem } from './web-core-workspace.model';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { filterSettingsSidebarItems, PACKAGE_MENU } from './settings-menu.logic';
import { canSeeRoute, findRoutePermissionRule, ROUTE_PERMISSION_RULES } from './route-permissions';
import { ACCOUNTING_UI_HIDDEN, ACCOUNTING_UI_HIDDEN_MODULE_KEYS } from './web-core-workspace.constants';
import { OWN_SIGNATURE_PERMISSIONS } from '@/features/company-profile/company-profile.logic';
import { defaultCompanyLandingPath } from '@/common/auth/session-gate.logic';

export function companySwitcherTarget(input: {
  companyId: string;
  currentCompanyId: string;
  expired?: boolean;
  canManagePlan?: boolean;
  freeExpenseDrafts?: boolean;
  currentFreeExpenseDrafts?: boolean;
  currentPath: string;
}): string | null {
  const sameCompany = input.companyId === input.currentCompanyId;
  const free = input.freeExpenseDrafts === true || (sameCompany && input.currentFreeExpenseDrafts === true);
  const billingPath = /^\/companies\/[^/]+\/billing(?:\/|$)/.test(input.currentPath);
  if (sameCompany) {
    if (free && !/^\/companies\/[^/]+\/expenses(?:\/|$)/.test(input.currentPath) && !billingPath) return defaultCompanyLandingPath(input.companyId, true);
    return null;
  }
  if (billingPath && input.canManagePlan) return `/companies/${encodeURIComponent(input.companyId)}/billing`;
  if (input.expired && !free) return `/companies/${encodeURIComponent(input.companyId)}/renew`;
  return defaultCompanyLandingPath(input.companyId, free);
}

/** Accounting screens are closed this launch while the ledger keeps posting — see the constant. */
function accountingUiHidden(moduleKey: string): boolean {
  return ACCOUNTING_UI_HIDDEN && ACCOUNTING_UI_HIDDEN_MODULE_KEYS.has(moduleKey);
}

const ROUTE_GATED_MODULE_PATHS = new Map([
  ['poapproval', '/settings/po-approval'],
  ['discount', '/settings/discount-policy'],
  ['lineoa', '/settings/line-oa'],
]);

const ROLE_NAV_ROUTE_PATHS = [
  '/settings/permissions',
  '/settings/access-overview',
  '/settings/employees',
  ...ROUTE_GATED_MODULE_PATHS.values(),
];

export function filterModulesByPermissions(
  modules: WorkspaceModule[],
  userPermissions: string[],
): WorkspaceModule[] {
  return modules.filter((mod) => {
    if (accountingUiHidden(mod.key)) return false;
    if (mod.key === 'roles') {
      return ROLE_NAV_ROUTE_PATHS.some((path) => canSeeRoute(path, userPermissions));
    }
    if (mod.key === 'ai-suggestions') return canSeeRoute('/ai-suggestions', userPermissions);
    if (mod.key === 'tax') return canSeeRoute('/tax', userPermissions);
    const routePath = ROUTE_GATED_MODULE_PATHS.get(mod.key);
    if (routePath) return canSeeRoute(routePath, userPermissions);
    if (mod.requiredAnyPermissions.length === 0) return true;
    const hasAny = mod.requiredAnyPermissions.some((p) => userPermissions.includes(p));
    if (!hasAny) return false;
    if (mod.requiredAllPermissions && mod.requiredAllPermissions.length > 0) {
      return mod.requiredAllPermissions.every((p) => userPermissions.includes(p));
    }
    return true;
  });
}

export function filterModulesForSession(modules: WorkspaceModule[], permissions: string[], freeExpenseDrafts = false): WorkspaceModule[] {
  const visible = filterModulesByPermissions(modules, permissions);
  return freeExpenseDrafts ? visible.filter((module) => module.key === 'expenses') : visible;
}

export function canAccessFreeExpenseWorkspacePath(companyId: string, pathname: string): boolean {
  const root = `/companies/${encodeURIComponent(companyId)}/expenses`;
  if (pathname === root || pathname === `${root}/upload`) return true;
  const detailId = pathname.startsWith(`${root}/`) ? pathname.slice(root.length + 1) : '';
  return Boolean(detailId && !detailId.includes('/') && !['manual', 'categories', 'signatures', 'evidence', 'substitute-receipts'].includes(detailId));
}

function hasAnyPermission(userPermissions: string[], required: string[]): boolean {
  return required.some((permission) => userPermissions.includes(permission));
}

/** Matches a route against a menu href, on path boundaries only ('/settings' never swallows '/settings-x'). */
function isUnderHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

/** Sub-items that have no module of their own, shared with active-route resolution. */
const MODULELESS_SUBITEM_HREFS = {
  accessOverview: (companyId: string) => `/companies/${companyId}/settings/access-overview`,
  employees: (companyId: string) => `/companies/${companyId}/settings/employees`,
  substituteReceiptPolicy: (companyId: string) => `/companies/${companyId}/settings/substitute-receipt`,
};

/**
 * คู่มือการใช้งานระบบ — one sub-item per source manual. The manuals are read-only pages carrying no
 * company data, so they are deliberately not a WorkspaceModule: there is no entitlement to sell and
 * no permission to hold. Whoever can open the workspace can read how it works.
 * Labels are the document titles themselves, so they stay Thai here as with the other
 * document-named sub-items above.
 */
const USER_GUIDE_NAV_KEY = 'guide';

/**
 * เรียงตามลำดับเมนูจริงในแถบซ้าย (ค่าใช้จ่ายและใบเสร็จ → การเบิกจ่าย)
 * โดยคู่มือใบรับรองแทนใบเสร็จอยู่ถัดจากค่าใช้จ่ายและใบเสร็จ เพราะเป็นเมนูย่อยของกลุ่มนั้น
 * ผู้ใช้จึงหาคู่มือได้จากตำแหน่งเดียวกับที่จำเมนูไว้ ไม่ต้องไล่อ่านทั้งรายการ
 *
 * ภาษี และ รายงานการเงิน ซ่อนไว้ก่อน (owner decision 2026-08-10) เพราะยังไม่เปิดใช้ฟีเจอร์
 * เนื้อหาและ route ของทั้งสองเล่มยังอยู่ครบ เพิ่มกลับเข้า array นี้เมื่อฟีเจอร์เปิดใช้งาน:
 *   { key: 'guide.tax', label: 'ภาษี', slug: 'tax', iconKey: 'DocsIcon' },
 *   { key: 'guide.reports', label: 'รายงานการเงิน', slug: 'reports', iconKey: 'PieChartIcon' },
 */
const USER_GUIDE_PAGES = [
  { key: 'guide.getting_started', label: 'เริ่มใช้งานร้านและ LINE', slug: 'getting-started', iconKey: 'FileIcon' },
  { key: 'guide.expenses', label: 'ค่าใช้จ่ายและใบเสร็จ', slug: 'expenses', iconKey: 'FileIcon' },
  { key: 'guide.substitute_receipts', label: 'ใบรับรองแทนใบเสร็จ', slug: 'substitute-receipts', iconKey: 'SwapIcon' },
  { key: 'guide.reimbursements', label: 'การเบิกจ่าย', slug: 'reimbursements', iconKey: 'DollarLineIcon' },
] as const;

function buildUserGuideNavItem(companyId: string, iconMap: Record<string, React.ReactNode>): NavItem {
  const subItems = USER_GUIDE_PAGES.map((page) => ({
    key: page.key,
    label: page.label,
    href: `/companies/${companyId}/user-guide/${page.slug}`,
    icon: iconMap[page.iconKey] ?? null,
    tone: 'slate' as const,
  }));

  return {
    key: USER_GUIDE_NAV_KEY,
    label: 'คู่มือการใช้งานระบบ',
    icon: iconMap.DocsIcon ?? null,
    href: subItems[0]!.href,
    subItems,
    // Its own heading: under "ตั้งค่า" the guide was the only row an employee had there.
    group: 'help',
  };
}

/**
 * The person's own pages, for the user menu (found 2026-10-13: an employee had no way to them). Someone without a
 * company-settings right gets the account page that lives outside the company. A locked shop keeps the account row and
 * loses the signature row, which is a business page.
 */
export function buildAccountLinks(companyId: string, permissions: readonly string[], locked = false): { key: string; label: string; href: string }[] {
  const base = `/companies/${encodeURIComponent(companyId)}`;
  return [
    {
      key: 'account',
      label: 'บัญชีของฉัน',
      href: `${base}/account`,
    },
    ...(!locked && OWN_SIGNATURE_PERMISSIONS.some((key) => permissions.includes(key))
      ? [{ key: 'signature', label: 'ลายเซ็นของฉัน', href: `${base}/expenses/signatures` }]
      : []),
  ];
}

/** Prevents protected workspace pages from rendering when opened by URL directly. */
export function canAccessWorkspacePath(
  modules: WorkspaceModule[],
  userPermissions: string[],
  companyId: string,
  pathname: string,
  freeExpenseDrafts = false,
): boolean {
  if (freeExpenseDrafts) {
    if (/^\/companies\/[^/]+\/billing(?:\/|$)/.test(pathname) && userPermissions.includes('company.plan.manage')) return true;
    return canAccessFreeExpenseWorkspacePath(companyId, pathname);
  }
  if (pathname === `/companies/${companyId}/account`) return true;
  const reportsBase = `/companies/${companyId}/reports`;
  // Retained history stays discoverable in navigation, but its narrow snapshot grant opens only
  // the exact history workspace. It must never open future report sub-routes that may create work.
  const reportsHistoryOnly = userPermissions.includes('report.snapshot.read')
    && !userPermissions.includes('report.catalog.read');
  if (reportsHistoryOnly && isUnderHref(pathname, reportsBase)) return pathname === reportsBase;

  const workspacePath = pathname.startsWith(`/companies/${companyId}`)
    ? pathname.slice(`/companies/${companyId}`.length) || '/'
    : pathname;
  const matchingModule = modules
    .filter((module) => {
      const href = module.buildHref(companyId);
      return pathname === href || pathname.startsWith(`${href}/`);
    })
    .sort((a, b) => b.buildHref(companyId).length - a.buildHref(companyId).length)[0];

  // Hoisted above BOTH gates below on purpose. `/journal` also owns a ROUTE_PERMISSION_RULES entry,
  // so the rule branch would open it to any holder of `ledger.journal.read`; `/period-closing` has
  // no rule and would fall through to the no-match default, which is "allowed". Either path would
  // leave a hidden screen reachable by a typed-in URL.
  if (matchingModule && accountingUiHidden(matchingModule.key)) return false;

  // A notification/task deep link must still reach the exact-assignment probe after a role edit
  // removes every reimbursement permission. Keep this to the hub root and a claim's journey page
  // (a cuid, never `new` or another sub-route): neither adds a sidebar row, and the page/API expose
  // no claim unless the server confirms the frozen assignment.
  if ((workspacePath === '/reimbursements' || /^\/reimbursements\/c[a-z0-9]{20,}$/.test(workspacePath))
    && userPermissions.includes('account.session.read')) return true;

  if (findRoutePermissionRule(workspacePath)) return canSeeRoute(workspacePath, userPermissions);

  if (!matchingModule || matchingModule.requiredAnyPermissions.length === 0) return true;
  if (!hasAnyPermission(userPermissions, matchingModule.requiredAnyPermissions)) return false;
  return !matchingModule.requiredAllPermissions?.length
    || matchingModule.requiredAllPermissions.every((permission) => userPermissions.includes(permission));
}

/** Reports with retained-artifact reads only: every create/compute root is already denied. */
export function retainedReportsOnly(userPermissions: readonly string[]): boolean {
  return userPermissions.includes('report.snapshot.read')
    && !userPermissions.includes('report.catalog.read');
}

export function buildNavItems(
  modules: WorkspaceModule[],
  companyId: string,
  locale: SupportedLocale,
  iconMap: Record<string, React.ReactNode>,
  userPermissions: string[] = [
    ...modules.flatMap((module) => module.requiredAnyPermissions),
    ...ROUTE_PERMISSION_RULES.flatMap((rule) => rule.anyOf),
  ],
  _roles: readonly string[] = [],
  // `canOpenManualWeb` of the session (manual-expense-web-entry-flag spec §9.1). A caller that says
  // nothing keeps the permission rule, so the company setting can only ever hide the item.
  canOpenManualExpense: boolean = userPermissions.includes('expense.create'),
  canOpenDisbursementVoucher: boolean = false,
  systemCertificatesAvailable: boolean = true,
  freeExpenseDrafts = false,
): NavItem[] {
  if (freeExpenseDrafts) modules = modules.filter((module) => module.key === 'expenses');
  const moduleMap = new Map(modules.map((mod) => [mod.key, mod]));
  // 'notifications' stays here so the module never renders as a top-level row: the notification
  // centre is reached from the header bell, not from the sidebar.
  const settingsChildKeys = new Set(['poapproval', 'discount', 'notifications', 'lineoa']);

  const moduleItems = modules.flatMap((mod) => {
    if (settingsChildKeys.has(mod.key)) return [];
    if (mod.key === 'ai-suggestions') {
      if (!canSeeRoute('/ai-suggestions', userPermissions)) return [];
    } else if (MENU_ENTITLEMENT_BINDINGS.some((binding) => binding.navKey === mod.key && binding.navigation === 'contextual')) return [];
    // Retained-only Reports (snapshot read without the catalog) can no longer create anything, and
    // the sidebar cannot tell whether this company ever produced an artifact — for the launch
    // package it never did, so the row would be a permanently empty one. The page keeps its route
    // and its permissions, so a retained download stays reachable by its own link.
    if (mod.key === 'reports' && retainedReportsOnly(userPermissions)) return [];

    const item: NavItem = {
      key: mod.key,
      label: t(mod.labelKey as Parameters<typeof t>[0], locale),
      // The settings row draws sliders: its three-dots key (kept, the contracts binding names it) read as "more" and,
      // on the icon-only rail, as a group separator.
      icon: (mod.key === 'settings' ? iconMap.SettingsIcon : undefined) ?? iconMap[mod.iconKey] ?? null,
      href: mod.status === 'disabled' ? undefined : mod.buildHref(companyId),
      disabled: mod.status === 'disabled',
      group: mod.navGroup,
    };

    if (mod.key === 'roles') {
      const childItems: NavItem['subItems'] = [];
      const canSeeEmployeeList = canSeeRoute('/settings/access-overview', userPermissions);
      // The list first: it is where the work with people starts (2026-10-13).
      if (canSeeEmployeeList) {
        childItems.push({
          key: 'roles.individual',
          label: t('module.individual' as Parameters<typeof t>[0], locale),
          href: MODULELESS_SUBITEM_HREFS.accessOverview(companyId),
          icon: iconMap.UserIcon,
          tone: 'slate',
        });
      }
      // The settings landing no longer carries a บทบาทและสิทธิ์ card, so this child is the only
      // way in. The shared route rule keeps it aligned with direct-path access.
      if (canSeeRoute('/settings/permissions', userPermissions)) {
        childItems.push({
          key: 'roles.permissions',
          label: 'บทบาทและสิทธิ์',
          href: mod.buildHref(companyId),
          icon: iconMap.ShieldIcon,
          tone: 'slate',
        });
      }
      // เพิ่มพนักงาน is an action, and the list page carries its button. The row stays only for someone who may add
      // people but may not open the list, so that nobody loses their one way in.
      if (!canSeeEmployeeList && userPermissions.includes('access.employee.create')) {
        childItems.push({
          key: 'employees',
          label: t('module.add_employee' as Parameters<typeof t>[0], locale),
          href: MODULELESS_SUBITEM_HREFS.employees(companyId),
          icon: iconMap.PlusIcon,
          tone: 'slate',
        });
      }

      for (const childKey of ['poapproval', 'discount', 'lineoa']) {
        const child = moduleMap.get(childKey);
        if (!child) continue;
        const childPath = ROUTE_GATED_MODULE_PATHS.get(childKey)!;
        if (!canSeeRoute(childPath, userPermissions)) continue;
        childItems.push({
          key: child.key,
          label: t(child.labelKey as Parameters<typeof t>[0], locale),
          href: child.buildHref(companyId),
          icon: iconMap[child.iconKey] ?? null,
          tone: child.key === 'lineoa' ? 'line' : 'purple',
        });
      }

      if (childItems.length === 0) return [];
      item.href = childItems[0]!.href;
      item.subItems = childItems;
    }

    if (mod.key === 'expenses') {
      const childItems: NavItem['subItems'] = [];
      if (hasAnyPermission(userPermissions, ['expense.read', 'expense.read_related', 'expense.read_own'])) {
        childItems.push({
          key: 'expenses.list',
          label: t('expenses.tab_list' as Parameters<typeof t>[0], locale),
          href: `/companies/${companyId}/expenses`,
          icon: iconMap.DocsIcon,
          tone: 'slate',
        });
      }
      if (hasAnyPermission(userPermissions, ['expense.receipt.upload'])) {
        childItems.push({
          key: 'expenses.upload',
          label: t('expenses.tab_upload' as Parameters<typeof t>[0], locale),
          href: `/companies/${companyId}/expenses/upload`,
          icon: iconMap.FileIcon,
          tone: 'slate',
        });
      }
      if (!freeExpenseDrafts && canOpenManualExpense && hasAnyPermission(userPermissions, ['expense.create'])) {
        childItems.push({
          key: 'expenses.manual',
          label: t('expenses.tab_manual' as Parameters<typeof t>[0], locale),
          href: `/companies/${companyId}/expenses/manual`,
          icon: iconMap.PlusIcon,
          tone: 'slate',
        });
      }
      // The order of the work (2026-10-13): record, pay, the papers that follow a payment, then what is rarely opened.
      if (!freeExpenseDrafts && canOpenDisbursementVoucher && userPermissions.includes('expense.disbursement.read')) {
        childItems.push({
          key: 'expenses.disbursement_vouchers',
          label: t('expenses.tab_disbursement_vouchers', locale),
          href: `/companies/${companyId}/expenses/disbursement-vouchers`,
          icon: iconMap.DocsIcon,
          tone: 'slate',
        });
      }
      if (!freeExpenseDrafts && hasAnyPermission(userPermissions, ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link'])) {
        childItems.push({ key: 'expenses.wht_certificates', label: t('expenses.certificates.title', locale),
          href: `/companies/${companyId}/expenses/wht-certificates`, icon: iconMap.DocsIcon, tone: 'slate' });
      }
      if (!freeExpenseDrafts && hasAnyPermission(userPermissions, ['expense.review', 'expense.confirm', 'expense.read_related', 'expense.read_own'])) {
        childItems.push({
          key: 'expenses.substitute_receipt',
          label: t('expenses.tab_substitute_receipts' as Parameters<typeof t>[0], locale),
          href: `/companies/${companyId}/expenses/substitute-receipts`,
          icon: iconMap.SwapIcon,
          tone: 'slate',
        });
      }
      if (!freeExpenseDrafts && hasAnyPermission(userPermissions, ['expense.evidence.read'])) {
        childItems.push({
          key: 'expenses.evidence',
          label: t('expenses.tab_evidence' as Parameters<typeof t>[0], locale),
          href: `/companies/${companyId}/expenses/evidence`,
          icon: iconMap.ShieldIcon,
          tone: 'slate',
        });
      }
      if (!freeExpenseDrafts && hasAnyPermission(userPermissions, ['expense.category.manage'])) {
        childItems.push({
          key: 'expenses.categories',
          label: t('expenses.tab_categories' as Parameters<typeof t>[0], locale),
          href: `/companies/${companyId}/expenses/categories`,
          icon: iconMap.TagIcon,
          tone: 'slate',
        });
      }
      item.subItems = childItems;
    }

    if (mod.key === 'settings') {
      const childItems: NavItem['subItems'] = [];
      if (hasAnyPermission(userPermissions, ['company.settings.view', 'company.setup.read', 'company.setup.manage'])) {
        childItems.push({
          key: 'settings.overview',
          label: 'ภาพรวมการตั้งค่า',
          href: mod.buildHref(companyId),
          icon: iconMap.GridIcon,
          tone: 'slate',
        });
      }
      for (const child of filterSettingsSidebarItems(userPermissions, systemCertificatesAvailable)) {
        childItems.push({
          key: `settings.${child.key}`,
          label: child.section === 'advanced' ? `${child.title} (ขั้นสูง)` : child.title,
          href: `/companies/${companyId}${child.href}`,
          icon: iconMap[child.iconKey] ?? null,
          tone: child.tone,
        });
      }
      item.subItems = childItems;
    }

    return [item];
  });

  // Package management is independent of paid feature access and follows an explicit company grant.
  if (userPermissions.includes('company.plan.manage')) {
    moduleItems.push({ key: 'billing', label: PACKAGE_MENU.title, href: `/companies/${companyId}${PACKAGE_MENU.href}`,
      icon: iconMap.BoxIcon ?? null, group: 'admin' });
  }
  return freeExpenseDrafts ? moduleItems : [...moduleItems, buildUserGuideNavItem(companyId, iconMap)];
}

/**
 * The entire sidebar of a shop with no usable package (spec §12 เว็บลูกค้า, Owner 2026-09-20).
 * Fixed rather than filtered: these two are the only destinations the term guard still serves.
 * The package link appears only for memberships with `company.plan.manage`.
 *
 * Every href here must satisfy `isLockedShellPath`, the redirect's copy of the same list.
 */
export function buildLockedNavItems(
  companyId: string,
  iconMap: Record<string, React.ReactNode>,
  permissions: readonly string[] = [],
): NavItem[] {
  const items: NavItem[] = [{
    key: 'settings',
    label: 'ตั้งค่าร้าน',
    icon: iconMap.SettingsIcon ?? null,
    href: `/companies/${companyId}/settings`,
    group: 'admin',
  }];
  if (permissions.includes('company.plan.manage')) {
    items.push({
      key: 'billing',
      label: PACKAGE_MENU.title,
      icon: iconMap.BoxIcon ?? null,
      href: `/companies/${companyId}${PACKAGE_MENU.href}`,
      group: 'admin',
    });
  }
  return items;
}

export function getActiveModuleKey(
  modules: WorkspaceModule[],
  companyId: string,
  pathname: string,
): string | null {
  // Sub-item routes with no module resolve to no module at all: falling back to the nearest
  // one ('settings') would light up ตั้งค่าบริษัท next to the sub-item the user actually opened.
  if (Object.values(MODULELESS_SUBITEM_HREFS).some((buildHref) => isUnderHref(pathname, buildHref(companyId)))) {
    return null;
  }

  // Most specific module wins, as in canAccessWorkspacePath: '/settings/line-oa' belongs to
  // 'lineoa', not to the shorter 'settings' prefix that happens to be declared before it.
  const match = modules
    .filter((mod) => isUnderHref(pathname, mod.buildHref(companyId)))
    .sort((a, b) => b.buildHref(companyId).length - a.buildHref(companyId).length)[0];

  return match?.key ?? null;
}

/**
 * The add/edit employee page has no row of its own (the list page carries its button), so it lights the list it is
 * opened from. Null when the list row is not in this person's menu: their own เพิ่มพนักงาน row then lights by its path.
 */
export function employeePageMenuKey(companyId: string, pathname: string, items: NavItem[]): string | null {
  if (!isUnderHref(pathname, MODULELESS_SUBITEM_HREFS.employees(companyId))) return null;
  return items.some((item) => item.subItems?.some((sub) => sub.key === 'roles.individual')) ? 'roles.individual' : null;
}

/** Every navigable menu target, parents and sub-items alike. A disabled module has no href. */
export function collectMenuTargets(items: NavItem[]): { key: string; href: string }[] {
  return items.flatMap((item) => [
    ...(item.href ? [{ key: item.key, href: item.href }] : []),
    ...(item.subItems ?? []).flatMap((sub) => (sub.href ? [{ key: sub.key, href: sub.href }] : [])),
  ]);
}

/**
 * Which sidebar entry a route belongs to. Same most-specific-wins rule as getActiveModuleKey,
 * but over sub-item hrefs, which is what separates a sibling tab from a row's detail page:
 * '/expenses/evidence' is a menu of its own, while '/expenses/<id>' is claimed by no href
 * more specific than '/expenses' and so belongs to the list it was opened from.
 */
export function resolveMenuKey(pathname: string, targets: { key: string; href: string }[]): string | null {
  const match = targets
    .filter((target) => isUnderHref(pathname, target.href))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return match?.key ?? null;
}

export function groupNavItems(
  items: NavItem[],
  groupOrder: NavItemGroup[],
): { group: NavItemGroup; items: NavItem[] }[] {
  return groupOrder
    .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
    .filter((g) => g.items.length > 0);
}

export function packageMenuTrailing(notice: PlanTermNotice | null, cardRenewal = false): NavItem['trailing'] {
  return notice?.termEndsAt ? { label: `เหลือ ${Math.max(0, notice.daysLeft)} วัน`, warning: planTermView(notice) === 'warning-banner' && !cardRenewal } : undefined;
}
