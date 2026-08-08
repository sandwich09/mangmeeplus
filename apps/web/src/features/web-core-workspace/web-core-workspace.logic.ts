import type React from 'react';
import type { WorkspaceModule, NavGroup, NavItem } from './web-core-workspace.model';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { filterSettingsSidebarItems } from './settings-menu.logic';
import { canSeeRoute, findRoutePermissionRule, ROUTE_PERMISSION_RULES } from './route-permissions';

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
    if (mod.key === 'roles') {
      return ROLE_NAV_ROUTE_PATHS.some((path) => canSeeRoute(path, userPermissions));
    }
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

/** Prevents protected workspace pages from rendering when opened by URL directly. */
export function canAccessWorkspacePath(
  modules: WorkspaceModule[],
  userPermissions: string[],
  companyId: string,
  pathname: string,
): boolean {
  const reportsBase = `/companies/${companyId}/reports`;
  // Retained history stays discoverable in navigation, but its narrow snapshot grant opens only
  // the exact history workspace. It must never open future report sub-routes that may create work.
  const reportsHistoryOnly = userPermissions.includes('report.snapshot.read')
    && !userPermissions.includes('report.catalog.read');
  if (reportsHistoryOnly && isUnderHref(pathname, reportsBase)) return pathname === reportsBase;

  const workspacePath = pathname.startsWith(`/companies/${companyId}`)
    ? pathname.slice(`/companies/${companyId}`.length) || '/'
    : pathname;
  if (findRoutePermissionRule(workspacePath)) return canSeeRoute(workspacePath, userPermissions);

  const matchingModule = modules
    .filter((module) => {
      const href = module.buildHref(companyId);
      return pathname === href || pathname.startsWith(`${href}/`);
    })
    .sort((a, b) => b.buildHref(companyId).length - a.buildHref(companyId).length)[0];

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
): NavItem[] {
  const moduleMap = new Map(modules.map((mod) => [mod.key, mod]));
  // 'notifications' stays here so the module never renders as a top-level row: the notification
  // centre is reached from the header bell, not from the sidebar.
  const settingsChildKeys = new Set(['poapproval', 'discount', 'notifications', 'lineoa']);

  return modules.flatMap((mod) => {
    if (settingsChildKeys.has(mod.key)) return [];
    // Retained-only Reports (snapshot read without the catalog) can no longer create anything, and
    // the sidebar cannot tell whether this company ever produced an artifact — for the launch
    // package it never did, so the row would be a permanently empty one. The page keeps its route
    // and its permissions, so a retained download stays reachable by its own link.
    if (mod.key === 'reports' && retainedReportsOnly(userPermissions)) return [];

    const item: NavItem = {
      key: mod.key,
      label: t(mod.labelKey as Parameters<typeof t>[0], locale),
      icon: iconMap[mod.iconKey] ?? null,
      href: mod.status === 'disabled' ? undefined : mod.buildHref(companyId),
      disabled: mod.status === 'disabled',
      group: mod.navGroup,
    };

    if (mod.key === 'roles') {
      const childItems: NavItem['subItems'] = [];
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
      if (canSeeRoute('/settings/access-overview', userPermissions)) {
        childItems.push({
          key: 'roles.individual',
          label: t('module.individual' as Parameters<typeof t>[0], locale),
          href: MODULELESS_SUBITEM_HREFS.accessOverview(companyId),
          icon: iconMap.UserIcon,
          tone: 'slate',
        });
      }
      if (canSeeRoute('/settings/employees', userPermissions)) {
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
      if (hasAnyPermission(userPermissions, ['expense.read', 'expense.read_own'])) {
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
      if (hasAnyPermission(userPermissions, ['expense.create'])) {
        childItems.push({
          key: 'expenses.manual',
          label: t('expenses.tab_manual' as Parameters<typeof t>[0], locale),
          href: `/companies/${companyId}/expenses/manual`,
          icon: iconMap.PlusIcon,
          tone: 'slate',
        });
      }
      if (hasAnyPermission(userPermissions, ['expense.category.manage'])) {
        childItems.push({
          key: 'expenses.categories',
          label: t('expenses.tab_categories' as Parameters<typeof t>[0], locale),
          href: `/companies/${companyId}/expenses/categories`,
          icon: iconMap.TagIcon,
          tone: 'slate',
        });
      }
      // Company-signature stamping is feature-disabled (owner decision 2026-08-05): approved
      // assets had no consumer (the signature-fill step was never wired), so the menu entry is
      // hidden until the stamping flow ships. API + data stay intact.
      //
      // The nav is built here, not from FEATURE_CATALOG — that catalog only decides what a company may
      // buy. A submenu missing from this list simply does not exist for the user, however the catalog
      // is wired.
      if (hasAnyPermission(userPermissions, ['expense.review', 'expense.confirm', 'expense.read_own'])) {
        childItems.push({
          key: 'expenses.substitute_receipt',
          label: t('expenses.tab_substitute_receipts' as Parameters<typeof t>[0], locale),
          href: `/companies/${companyId}/expenses/substitute-receipts`,
          icon: iconMap.SwapIcon,
          tone: 'slate',
        });
      }
      if (hasAnyPermission(userPermissions, ['company.setup.manage'])) {
        childItems.push({
          key: 'expenses.substitute_receipt_policy',
          label: 'ตั้งค่าใบรับรองแทนใบเสร็จ',
          href: MODULELESS_SUBITEM_HREFS.substituteReceiptPolicy(companyId),
          icon: iconMap.DollarLineIcon,
          tone: 'slate',
        });
      }
      if (hasAnyPermission(userPermissions, ['expense.evidence.read'])) {
        childItems.push({
          key: 'expenses.evidence',
          label: t('expenses.tab_evidence' as Parameters<typeof t>[0], locale),
          href: `/companies/${companyId}/expenses/evidence`,
          icon: iconMap.ShieldIcon,
          tone: 'slate',
        });
      }

      item.subItems = childItems;
    }

    if (mod.key === 'settings') {
      const childItems: NavItem['subItems'] = [];
      if (hasAnyPermission(userPermissions, ['company.settings.view', 'company.setup.manage'])) {
        childItems.push({
          key: 'settings.overview',
          label: 'ภาพรวมการตั้งค่า',
          href: mod.buildHref(companyId),
          icon: iconMap.GridIcon,
          tone: 'slate',
        });
      }
      for (const child of filterSettingsSidebarItems(userPermissions)) {
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
  groupOrder: NavGroup[],
): { group: NavGroup; items: NavItem[] }[] {
  return groupOrder
    .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
    .filter((g) => g.items.length > 0);
}
