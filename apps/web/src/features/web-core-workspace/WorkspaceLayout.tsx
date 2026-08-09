'use client';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { WorkspaceShell } from '@/common/components/app-shell/WorkspaceShell';
import { BrandedState } from '@/common/components/state';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { WORKSPACE_ICON_NODES as ICON_MAP } from './design-icons';
import type { WebSession } from '@/common/models/web-session.model';
import { WORKSPACE_MODULES, NAV_GROUP_ORDER } from './web-core-workspace.constants';
import {
  filterModulesByPermissions,
  buildNavItems,
  collectMenuTargets,
  getActiveModuleKey,
  groupNavItems,
  resolveMenuKey,
  canAccessWorkspacePath,
} from './web-core-workspace.logic';
import { BranchFilterProvider, BranchSelector, CompanySwitcher } from './WorkspaceScope';
import { accessContextFingerprint, fetchMyContext, type MyContext } from './workspace-scope.api';
import { MenuFilterProvider } from './MenuFilterScope';
import { NotificationBell } from '@/features/dashboard-notifications/NotificationBell';
import { ACCESS_CONTEXT_STALE_EVENT } from '@/common/api/authed-fetch';

type Props = {
  children: React.ReactNode;
  companyId: string;
  session: WebSession;
};

const DESIGN_HANDOFF_NAV_ORDER = [
  'dashboard',
  'inbox',
  'customers',
  'booking',
  'salesdoc',
  'crmreport',
  'crmsettings',
  'expenses',
  'reimbursements',
  'journal',
  'tax',
  'reports',
  'closing',
  'roles',
  'settings',
  'guide',
] as const;
// Wide string keys: this map whitelists arbitrary nav-item keys, so lookups take any string.
const DESIGN_HANDOFF_NAV_RANK = new Map<string, number>(DESIGN_HANDOFF_NAV_ORDER.map((key, index) => [key, index]));
const ACCESS_CONTEXT_POLL_MS = 60_000;

export default function WorkspaceLayoutClient({ children, companyId, session }: Props) {
  const locale: SupportedLocale = 'th';
  const pathname = usePathname();
  const router = useRouter();
  const companyName = session.companyId;
  const currentAccessFingerprint = accessContextFingerprint(session);
  const accessCheckInFlight = useRef<Promise<void> | null>(null);

  const applyLatestAccessContext = useCallback((latest: MyContext) => {
    if (accessContextFingerprint(latest) !== currentAccessFingerprint) router.refresh();
  }, [currentAccessFingerprint, router]);

  const revalidateAccessContext = useCallback(() => {
    if (accessCheckInFlight.current) return;
    const check = fetchMyContext(companyId)
      .then(applyLatestAccessContext)
      .catch((error: unknown) => {
        // Membership/company access disappeared: let the server layout render its explicit
        // CompanyAccessUnavailable state. Network errors retain the current usable shell.
        if ((error as { status?: unknown })?.status === 403) router.refresh();
      })
      .finally(() => {
        if (accessCheckInFlight.current === check) accessCheckInFlight.current = null;
      });
    accessCheckInFlight.current = check;
  }, [applyLatestAccessContext, companyId, router]);

  useEffect(() => {
    const onFocus = () => revalidateAccessContext();
    const onVisible = () => { if (document.visibilityState === 'visible') revalidateAccessContext(); };
    const timer = window.setInterval(onVisible, ACCESS_CONTEXT_POLL_MS);
    window.addEventListener('focus', onFocus);
    window.addEventListener(ACCESS_CONTEXT_STALE_EVENT, onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(ACCESS_CONTEXT_STALE_EVENT, onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [revalidateAccessContext]);

  const filteredModules = useMemo(
    () => filterModulesByPermissions(WORKSPACE_MODULES, session.permissions),
    [session.permissions],
  );

  const allNavItems = useMemo(
    () => buildNavItems(filteredModules, companyId, locale, ICON_MAP, session.permissions),
    [filteredModules, companyId, locale, session.permissions],
  );

  const navItems = useMemo(
    () => groupNavItems(allNavItems, NAV_GROUP_ORDER)
      .flatMap((g) => g.items)
      .filter((item) => DESIGN_HANDOFF_NAV_RANK.has(item.key))
      .sort((a, b) => DESIGN_HANDOFF_NAV_RANK.get(a.key)! - DESIGN_HANDOFF_NAV_RANK.get(b.key)!),
    [allNavItems],
  );

  // Resolved from the full menu list, not the design-handoff subset above: a menu the sidebar
  // does not render still has to count as its own menu, or a filter would follow the user into it.
  const menuKey = useMemo(() => resolveMenuKey(pathname, collectMenuTargets(allNavItems)), [pathname, allNavItems]);

  const canAccessCurrentPath = canAccessWorkspacePath(WORKSPACE_MODULES, session.permissions, companyId, pathname);

  // Audit H-15: this used to send every inaccessible path to /dashboard unconditionally. Turning
  // dashboard_notifications off strips dashboard.* — it is not a platform-invariant feature — so the
  // redirect target was inaccessible too, and the `return null` below turned every page in the
  // company into a blank document: no header, no company switcher, no explanation. One click in the
  // partner console did that.
  //
  // The landing is now the first page this session can actually open, whatever combination of
  // features is off, rather than one hardcoded guess.
  const fallbackHref = useMemo(() => {
    const target = filteredModules.find((module) => canAccessWorkspacePath(
      WORKSPACE_MODULES, session.permissions, companyId, module.buildHref(companyId),
    ));
    return target?.buildHref(companyId) ?? null;
  }, [filteredModules, session.permissions, companyId]);

  React.useEffect(() => {
    if (!canAccessCurrentPath && fallbackHref && fallbackHref !== pathname) router.replace(fallbackHref);
  }, [canAccessCurrentPath, fallbackHref, pathname, router]);

  const activeKey = getActiveModuleKey(filteredModules, companyId, pathname);

  if (!canAccessCurrentPath) {
    // Blank only while the redirect above is in flight. With nowhere to send them, say so — a
    // signed-in person staring at an empty page cannot tell a permission change from an outage.
    return fallbackHref ? null : (
      <BrandedState
        eyebrow="การเข้าถึงบริษัท"
        title="ยังไม่มีหน้าที่คุณเปิดได้ในบริษัทนี้"
        description="ฟีเจอร์ที่คุณมีสิทธิ์อาจถูกปิดใช้งานอยู่ กรุณาติดต่อผู้ดูแลบริษัทเพื่อเปิดฟีเจอร์หรือปรับสิทธิ์ให้"
      />
    );
  }

  return (
    <BranchFilterProvider companyId={companyId} onContextLoaded={applyLatestAccessContext}>
      <WorkspaceShell
        companyId={companyId}
        companyName={companyName}
        companyArea={
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <CompanySwitcher companyId={companyId} fallbackName={companyName} />
            <BranchSelector />
          </div>
        }
        headerExtras={session.permissions.includes('notification.read') ? <NotificationBell companyId={companyId} locale={locale} /> : undefined}
        userName={session.displayName ?? undefined}
        userRole={session.roles[0]}
        showAccountSecurity={[
          'account.password.change',
          'account.identity.link',
          'account.identity.unlink',
        ].some((permission) => session.permissions.includes(permission))}
        locale={locale}
        navItems={navItems}
        activeKey={activeKey ?? undefined}
      >
        <MenuFilterProvider menuKey={menuKey}>{children}</MenuFilterProvider>
      </WorkspaceShell>
    </BranchFilterProvider>
  );
}
