'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isBillingCustomerRecoveryPath } from '@watchdog-bms/contracts';
import { billingApi } from '@/features/billing/billing.api';
import { BillingWorkspaceContext } from '@/features/billing/BillingCustomerFrame';
import { usePathname, useRouter } from 'next/navigation';
import { WorkspaceShell } from '@/common/components/app-shell/WorkspaceShell';
import { stripThaiTitlePrefix } from '@/common/components/mangmee';
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
import { PlanTermBanner } from '@/features/plan-term/PlanTermBanner';
import { PlanTermSidebarCard } from '@/features/plan-term/PlanTermSidebarCard';
import { accessContextFingerprint, fetchMyContext, type MyContext } from './workspace-scope.api';
import { MenuFilterProvider } from './MenuFilterScope';
import { NotificationBell } from '@/features/dashboard-notifications/NotificationBell';
import { ACCESS_CONTEXT_STALE_EVENT } from '@/common/api/authed-fetch';
import { checklistIsComplete } from '@/features/company-profile/company-profile.logic';
import { useProfileChecklist } from '@/features/company-profile/use-profile-checklist';

type Props = {
  children: React.ReactNode;
  companyId: string;
  session: WebSession;
};

// Only implemented entry points; permissions still decide which enabled features are visible.
const DESIGN_HANDOFF_NAV_ORDER = [
  'dashboard',
  'inbox',
  'customers',
  'booking',
  'crmreport',
  'crmsettings',
  'salesdoc',
  'expenses',
  'reimbursements',
  'journal',
  'tax',
  'reports',
  'roles',
  'settings',
  'guide',
] as const;
// Wide string keys: this map whitelists arbitrary nav-item keys, so lookups take any string.
const DESIGN_HANDOFF_NAV_RANK = new Map<string, number>(DESIGN_HANDOFF_NAV_ORDER.map((key, index) => [key, index]));
const ACCESS_CONTEXT_POLL_MS = 60_000;

export default function WorkspaceLayoutClient({ children, companyId, session }: Props) {
  const pathname = usePathname();
  // Layouts survive client navigation; resolve billing access on both entry paths.
  if (isBillingCustomerRecoveryPath(pathname, companyId) || pathname === `/companies/${encodeURIComponent(companyId)}/settings/profile`)
    return <BillingWorkspaceLayout companyId={companyId} session={session}>{children}</BillingWorkspaceLayout>;
  return <BusinessWorkspaceLayout companyId={companyId} session={session}>{children}</BusinessWorkspaceLayout>;
}

function BillingWorkspaceLayout({ children, companyId, session }: Props) {
  const [view, setView] = useState<'loading' | 'workspace' | 'recovery'>('loading');
  useEffect(() => {
    let active = true;
    setView('loading');
    // Only the recovery-safe billing read runs before knowing whether business
    // navigation may mount. Expired/held/denied companies keep the minimal exits.
    void billingApi(companyId).status().then(status => {
      if (active) setView(status.accessState === 'ACTIVE' ? 'workspace' : 'recovery');
    }).catch(() => { if (active) setView('recovery'); });
    return () => { active = false; };
  }, [companyId]);
  if (view === 'loading') return <p role="status" className="p-8 text-gray-500">กำลังเปิดหน้าแพ็กเกจ…</p>;
  if (view === 'recovery') return <>{children}</>;
  return <BillingWorkspaceContext.Provider value={true}><BusinessWorkspaceLayout companyId={companyId} session={session}>{children}</BusinessWorkspaceLayout></BillingWorkspaceContext.Provider>;
}

function BusinessWorkspaceLayout({ children, companyId, session }: Props) {
  const locale: SupportedLocale = 'th';
  const pathname = usePathname();
  const router = useRouter();
  // WEB-04: `session.companyId` used to stand in until /my-companies answered, so the header showed
  // a raw ULID to every user on every cold load. A neutral placeholder is the honest stand-in;
  // CompanySwitcher replaces it with the real name, or with a retry when the lookup fails.
  const companyName = 'กำลังโหลด…';
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
    () => buildNavItems(filteredModules, companyId, locale, ICON_MAP, session.permissions, session.roles),
    [filteredModules, companyId, locale, session.permissions, session.roles],
  );

  // §15.4.1 E: the Owner asked for a mark on ตั้งค่าบริษัท "จนกว่าจะตั้งครบ". Only the holder of the
  // key that can actually fill the form is asked — nobody else pays for the read, and nobody else
  // is shown a job they cannot do. `null` (unknown, or the read failed) shows nothing.
  const canManageLegalIdentity = session.permissions.includes('company.legal_identity.manage');
  const profileChecklistItems = useProfileChecklist(companyId, canManageLegalIdentity);
  const setupIncomplete = profileChecklistItems !== null && !checklistIsComplete(profileChecklistItems);

  const navItems = useMemo(
    () => groupNavItems(allNavItems, NAV_GROUP_ORDER)
      .flatMap((g) => g.items)
      .filter((item) => DESIGN_HANDOFF_NAV_RANK.has(item.key))
      .sort((a, b) => DESIGN_HANDOFF_NAV_RANK.get(a.key)! - DESIGN_HANDOFF_NAV_RANK.get(b.key)!)
      .map((item) => (item.key === 'settings' && setupIncomplete ? { ...item, attention: true } : item)),
    [allNavItems, setupIncomplete],
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
    // WEB-06: while the redirect above is in flight, say where the user is going. `null` rendered a
    // white page, which on a slow phone is indistinguishable from a hung site.
    // With nowhere to send them, the explicit no-access state below stands instead.
    return fallbackHref ? (
      <main className="flex min-h-dvh items-center justify-center bg-brand-25 p-6">
        <p role="status" aria-live="polite" className="rounded-2xl border border-brand-100 bg-white px-6 py-5 text-center text-base font-semibold text-gray-700 shadow-[var(--shadow-theme-sm)]">
          กำลังพาไปหน้าที่ใช้ได้…
        </p>
      </main>
    ) : (
      <BrandedState
        eyebrow="การเข้าถึงบริษัท"
        title="ยังไม่มีหน้าที่คุณเปิดได้ในบริษัทนี้"
        description="ฟีเจอร์ที่คุณมีสิทธิ์อาจถูกปิดใช้งานอยู่ กรุณาติดต่อผู้ดูแลบริษัทเพื่อเปิดฟีเจอร์หรือปรับสิทธิ์ให้"
      />
    );
  }

  return (
    <BranchFilterProvider companyId={companyId} onContextLoaded={applyLatestAccessContext}>
      <div className="[--app-header-h:112px] sm:[--app-header-h:68px]">
      <WorkspaceShell
        companyName={companyName}
        companyArea={
          <div className="flex min-w-0 flex-1 flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:gap-2">
            <CompanySwitcher companyId={companyId} fallbackName={companyName} />
            <BranchSelector />
          </div>
        }
        headerExtras={session.permissions.includes('notification.read') ? <NotificationBell companyId={companyId} locale={locale} /> : undefined}
        banner={<PlanTermBanner companyId={companyId} />}
        sidebarFooter={<PlanTermSidebarCard companyId={companyId} />}
        // Owner decision 2026-08-15: the shell shows the person, not their คำนำหน้า. Stripped at the
        // shell boundary so the sidebar name and both avatar initials agree — the session name is
        // the global User row, which a company-scoped rename does not always reach.
        userName={stripThaiTitlePrefix(session.displayName) || undefined}
        userRoles={session.roles}
        userRoleNames={session.roleNames}
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
      </div>
    </BranchFilterProvider>
  );
}
