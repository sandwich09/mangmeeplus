'use client';
import { shopHasSystemWhtCertificates } from '@/features/expenses/expense-wht-certificates.logic';
import Link from 'next/link';
import { AccountNameScope, useAccountDisplayName } from '@/features/company-profile/AccountNameScope';
import { ACCOUNT_NAME_CHANGED_EVENT } from '@/features/company-profile/company-profile.api';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COMPANY_PROFILE_SETTINGS_PATH, COMPANY_PROFILE_SHOP_HASH, isBillingCustomerRecoveryPath } from '@watchdog-bms/contracts';
import { billingApi } from '@/features/billing/billing.api';
import { BillingWorkspaceContext } from '@/features/billing/BillingCustomerFrame';
import { usePathname, useRouter } from 'next/navigation';
import { WorkspaceShell } from '@/common/components/app-shell/WorkspaceShell';
import { stripThaiTitlePrefix } from '@/common/components/mangmee';
import { secondaryButtonClass } from '@/common/components/button/button-classes';
import { ForbiddenState } from '@/common/components/state';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { WORKSPACE_ICON_NODES as ICON_MAP } from './design-icons';
import type { WebSession } from '@/common/models/web-session.model';
import { WORKSPACE_MODULES, SIDEBAR_GROUP_ORDER } from './web-core-workspace.constants';
import {
  filterModulesForSession,
  buildAccountLinks,
  buildLockedNavItems,
  packageMenuTrailing,
  buildNavItems,
  collectMenuTargets,
  employeePageMenuKey,
  getActiveModuleKey,
  groupNavItems,
  resolveMenuKey,
  canAccessWorkspacePath,
} from './web-core-workspace.logic';
import { BranchFilterProvider, BranchSelector, CompanySwitcher } from './WorkspaceScope';
import { PlanTermBanner } from '@/features/plan-term/PlanTermBanner';
import { LockedShellProvider } from '@/features/plan-term/LockedShellScope';
import { PlanTermSidebarCard } from '@/features/plan-term/PlanTermSidebarCard';
import { fetchPlanTermNotice, PLAN_TERM_CHANGED_EVENT, type PlanTermNotice } from '@/features/plan-term/plan-term.api';
import { cardRenewalRunning, isLockedShellPath, planTermView } from '@/features/plan-term/plan-term.logic';
import { accessContextFingerprint, fetchMyContext, type MyContext } from './workspace-scope.api';
import { MenuFilterProvider } from './MenuFilterScope';
import { canSeeRoute } from './route-permissions';
import { NotificationBell } from '@/features/dashboard-notifications/NotificationBell';
import { ACCESS_CONTEXT_STALE_EVENT } from '@/common/api/authed-fetch';
import { checklistIsComplete } from '@/features/company-profile/company-profile.logic';
import { canOpenManualWeb } from '@/features/expenses/manual-expense-entry.logic';
import { canOpenDisbursementVoucherWeb } from '@/features/expenses/disbursement-voucher-entry.logic';
import { useProfileChecklist } from '@/features/company-profile/use-profile-checklist';
import { DemoLineChat } from '@/features/sales-demo/DemoLineChat';
import { DemoSessionBanner } from '@/features/sales-demo/DemoSessionBanner';

type Props = {
  children: React.ReactNode;
  companyId: string;
  session: WebSession;
};

// WEB-04: `session.companyId` used to stand in until /my-companies answered, so the header showed
// a raw ULID to every user on every cold load. A neutral placeholder is the honest stand-in;
// CompanySwitcher replaces it with the real name, or with a retry when the lookup fails.
const COMPANY_NAME_PLACEHOLDER = 'กำลังโหลด…';

/** The header user block: password, LINE link, logout. A locked shop keeps all three. */
const ACCOUNT_SECURITY_PERMISSIONS = ['account.password.change', 'account.identity.link', 'account.identity.unlink'];

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
  'counterparties',
  'reimbursements',
  'journal',
  'tax',
  'pnd53',
  'reports',
  'billing',
  'roles',
  'settings',
  'guide',
] as const;
// Wide string keys: this map whitelists arbitrary nav-item keys, so lookups take any string.
const DESIGN_HANDOFF_NAV_RANK = new Map<string, number>(DESIGN_HANDOFF_NAV_ORDER.map((key, index) => [key, index]));
const ACCESS_CONTEXT_POLL_MS = 60_000;

export default function WorkspaceLayoutClient(props: Props) {
  return <AccountNameScope userId={props.session.userId} displayName={props.session.displayName ?? null}><WorkspaceLayoutContent {...props} /></AccountNameScope>;
}

function WorkspaceLayoutContent({ children, companyId, session }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const refresh = () => router.refresh();
    const legacy = () => { if (window.location.pathname === `/companies/${companyId}/settings/profile` && window.location.hash === '#account') router.replace(`/companies/${companyId}/account`); };
    legacy(); window.addEventListener('hashchange', legacy); window.addEventListener(ACCOUNT_NAME_CHANGED_EVENT, refresh);
    return () => { window.removeEventListener('hashchange', legacy); window.removeEventListener(ACCOUNT_NAME_CHANGED_EVENT, refresh); };
  }, [companyId, router]);
  // The shell's single plan-term read (spec §12): the locked two-menu sidebar, its banner and the
  // renewal redirect all answer from this one notice, so no page pays for a second call.
  const [loaded, setLoaded] = useState<{ companyId: string; notice: PlanTermNotice | null; cardRenewal: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const lockedRef = useRef(false);
  const settled = loaded?.companyId === companyId;
  const notice = settled ? loaded.notice : null;

  useEffect(() => {
    let active = true;
    void fetchPlanTermNotice(companyId).then(async (result) => {
      if (!active) return;
      // A failed re-read (null) while locked keeps the shell locked: an outage is not an unlock.
      // The first read still fails open (lockedRef starts false), as the note further down says.
      if (result === null && lockedRef.current) return;
      // RV30: leaving EXPIRED means the server layout's session/permissions are stale too
      // (billing-reconciler.service apply) — refresh them; the shell below switches by itself.
      const unlocked = result !== null && lockedRef.current && result.derivedState !== 'EXPIRED'; // result null = endpoint ล่ม ไม่ใช่ปลดล็อก
      const status = result && planTermView(result) === 'warning-banner'
        ? await billingApi(companyId).status().catch(() => null) : null;
      if (!active) return;
      setLoaded({ companyId, notice: result, cardRenewal: !!status && cardRenewalRunning(status) });
      if (unlocked) router.refresh();
    });
    return () => { active = false; };
  }, [companyId, revision, router]);

  useEffect(() => { lockedRef.current = notice?.derivedState === 'EXPIRED'; }, [notice?.derivedState]);

  // Billing recovery also has to notice ACTIVE -> EXPIRED while a purchase page stays open.
  // Other running business pages already re-read their access context on focus.
  useEffect(() => {
    if (notice?.derivedState !== 'EXPIRED' && !isBillingCustomerRecoveryPath(pathname ?? '', companyId)) return;
    const bump = () => setRevision((n) => n + 1);
    const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
    const end = Date.parse(notice?.termEndsAt ?? '');
    const timer = notice?.derivedState !== 'EXPIRED' && end > Date.now()
      ? window.setTimeout(bump, Math.min(2_147_483_647, end - Date.now() + 150)) : undefined;
    window.addEventListener(PLAN_TERM_CHANGED_EVENT, bump);
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(PLAN_TERM_CHANGED_EVENT, bump);
      window.removeEventListener('focus', bump);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [companyId, pathname, notice?.derivedState, notice?.termEndsAt]);

  // Nothing business-shaped may mount before the term is known: the business shell's first render
  // fires the nav, notification and access-context reads, which a locked shop answers with 403 —
  // and `authedApiFetch` turns that into a bounce to /renew. One notice round trip, then the right
  // shell. A failed read is already swallowed as `null` by fetchPlanTermNotice, so the workspace
  // still fails open when the notice endpoint itself is down.
  if (!settled) return <p role="status" className="p-8 text-gray-500">กำลังเปิดหน้า…</p>;

  // Owner 2026-09-20: a shop with no usable package has no business shell at all, on any path.
  if (notice?.derivedState === 'EXPIRED' && !(session.freeExpenseDrafts === true && notice.freeExpenseDrafts === true))
    return <LockedWorkspaceLayout companyId={companyId} session={session} notice={notice}>{children}</LockedWorkspaceLayout>;
  // Layouts survive client navigation; resolve billing access on both entry paths. The profile joins the recovery
  // frame only for someone who may open it: anyone else is refused in the business shell, like on any other page,
  // instead of falling into the shell-less recovery view when their billing read is refused.
  const onOwnProfilePage = pathname === `/companies/${encodeURIComponent(companyId)}/settings/profile`
    && canSeeRoute(COMPANY_PROFILE_SETTINGS_PATH, session.permissions);
  if (isBillingCustomerRecoveryPath(pathname, companyId) || onOwnProfilePage)
    return <BillingWorkspaceLayout companyId={companyId} session={session}
      notice={notice} cardRenewal={loaded?.cardRenewal} shellWhenBillingRefused={onOwnProfilePage && !session.permissions.includes('company.plan.manage')}>{children}</BillingWorkspaceLayout>;
  return <BusinessWorkspaceLayout companyId={companyId} session={session} notice={notice} cardRenewal={loaded?.cardRenewal}>{children}</BusinessWorkspaceLayout>;
}

/**
 * The whole web for a shop that has not bought a package (spec §12 เว็บลูกค้า): ตั้งค่า and, for the
 * OWNER, แพ็กเกจ. Deliberately without the bell, the setup checklist, the branch scope and the
 * plan-term card — every one of them is a business read the term guard refuses — and without the
 * page itself on a path this shop may not open, so a stale link cannot fire a screenful of 403s
 * before `PlanTermBanner` redirects it.
 */
function LockedWorkspaceLayout({ children, companyId, session, notice }: Props & { notice: PlanTermNotice }) {
  const displayName = useAccountDisplayName(session.displayName ?? null);
  const pathname = usePathname() ?? '';
  const navItems = useMemo(
    () => buildLockedNavItems(companyId, ICON_MAP, session.permissions).map(item => item.key === 'billing' ? { ...item, trailing: packageMenuTrailing(notice) } : item),
    [companyId, session.permissions, notice],
  );

  return (
    <div className="[--app-header-h:68px]">
      <WorkspaceShell
        companyName={COMPANY_NAME_PLACEHOLDER}
        companyArea={<CompanySwitcher companyId={companyId} fallbackName={COMPANY_NAME_PLACEHOLDER} />}
        banner={<PlanTermBanner companyId={companyId} notice={notice} />}
        userName={stripThaiTitlePrefix(displayName) || undefined}
        userRoles={session.roles}
        userRoleNames={session.roleNames}
        showAccountSecurity={ACCOUNT_SECURITY_PERMISSIONS.some((permission) => session.permissions.includes(permission))}
        accountLinks={buildAccountLinks(companyId, session.permissions, true)}
        locale="th"
        navItems={navItems}
        activeKey={resolveMenuKey(pathname, collectMenuTargets(navItems)) ?? undefined}
      >
        <LockedShellProvider value={true}>
          {/* F22/F20: the billing pages render inside this shell's header and sidebar, not their own
              recovery header with a "กลับหน้าเลือกบริษัท" link that loops back to /renew. */}
          <BillingWorkspaceContext.Provider value={true}>
            {(pathname === `/companies/${companyId}/account` || isLockedShellPath(pathname, companyId)) ? children : (
              <p role="status" aria-live="polite" className="p-8 text-gray-500">กำลังพาไปหน้าที่ใช้ได้…</p>
            )}
          </BillingWorkspaceContext.Provider>
        </LockedShellProvider>
      </WorkspaceShell>
    </div>
  );
}

/**
 * `shellWhenBillingRefused` (the shop details page, for a member without the package right): their billing read is
 * refused with 403 because of the missing right, not because the shop is locked. They get the business shell, as on
 * every other page they open, instead of a page with no menu and no way back. Every other outcome is as before.
 */
function BillingWorkspaceLayout({ children, companyId, session, notice, cardRenewal, shellWhenBillingRefused = false }: Props & { notice?: PlanTermNotice | null; cardRenewal?: boolean; shellWhenBillingRefused?: boolean }) {
  const [view, setView] = useState<'loading' | 'workspace' | 'recovery'>('loading');
  useEffect(() => {
    let active = true;
    setView('loading');
    // Only the recovery-safe billing read runs before knowing whether business
    // navigation may mount. Expired/held/denied companies keep the minimal exits.
    void billingApi(companyId).status().then(status => {
      if (active) setView(status.accessState === 'ACTIVE' ? 'workspace' : 'recovery');
    }).catch((error: unknown) => {
      if (active) setView(shellWhenBillingRefused && (error as { status?: unknown })?.status === 403 ? 'workspace' : 'recovery');
    });
    return () => { active = false; };
  }, [companyId, shellWhenBillingRefused]);
  // The same line as the shell's first read: this layout also frames the shop details page, which is not the package page.
  if (view === 'loading') return <p role="status" className="p-8 text-gray-500">กำลังเปิดหน้า…</p>;
  if (view === 'recovery') return <>{children}</>;
  return <BillingWorkspaceContext.Provider value={true}><BusinessWorkspaceLayout companyId={companyId} session={session} notice={notice} cardRenewal={cardRenewal}>{children}</BusinessWorkspaceLayout></BillingWorkspaceContext.Provider>;
}

function BusinessWorkspaceLayout({ children, companyId, session, notice = null, cardRenewal = false }: Props & { notice?: PlanTermNotice | null; cardRenewal?: boolean }) {
  const displayName = useAccountDisplayName(session.displayName ?? null);
  const locale: SupportedLocale = 'th';
  const pathname = usePathname();
  const router = useRouter();
  const companyName = COMPANY_NAME_PLACEHOLDER;
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

  const freeExpenseDrafts = session.freeExpenseDrafts === true;
  const filteredModules = useMemo(
    () => filterModulesForSession(WORKSPACE_MODULES, session.permissions, freeExpenseDrafts),
    [session.permissions, freeExpenseDrafts],
  );

  // A company setting, not a permission: it reaches the sidebar through the same predicate as every
  // other entrance to the manual expense page, and the fingerprint above refreshes it in open tabs.
  const canOpenManual = canOpenManualWeb(session, companyId);
  const canOpenDisbursementVoucher = canOpenDisbursementVoucherWeb(session, companyId);
  const allNavItems = useMemo(
    () => canOpenDisbursementVoucher
      ? buildNavItems(filteredModules, companyId, locale, ICON_MAP, session.permissions, session.roles, canOpenManual, true, shopHasSystemWhtCertificates(session.entitledFeatureKeys), freeExpenseDrafts)
      : buildNavItems(filteredModules, companyId, locale, ICON_MAP, session.permissions, session.roles, canOpenManual, false, shopHasSystemWhtCertificates(session.entitledFeatureKeys), freeExpenseDrafts),
    [filteredModules, companyId, locale, session.permissions, session.roles, canOpenManual, canOpenDisbursementVoucher, session.entitledFeatureKeys, freeExpenseDrafts],
  );

  // §15.4.1 E: the Owner asked for a mark on ตั้งค่าบริษัท "จนกว่าจะตั้งครบ". Only the holder of the
  // key that can actually fill the form is asked — nobody else pays for the read, and nobody else
  // is shown a job they cannot do. `null` (unknown, or the read failed) shows nothing.
  const canManageLegalIdentity = session.permissions.includes('company.legal_identity.manage');
  const profileChecklistItems = useProfileChecklist(companyId, canManageLegalIdentity);
  const setupIncomplete = profileChecklistItems !== null && !checklistIsComplete(profileChecklistItems);
  // The mark says its word on the row it means: the shop details row, when a shop fact is the missing one.
  const shopDetailsIncomplete = profileChecklistItems?.some((entry) => !entry.done && entry.hash === COMPANY_PROFILE_SHOP_HASH) ?? false;

  const navItems = useMemo(
    () => groupNavItems(allNavItems, SIDEBAR_GROUP_ORDER)
      .flatMap((g) => g.items)
      .filter((item) => DESIGN_HANDOFF_NAV_RANK.has(item.key) && !(session.isDemo && item.key === 'billing'))
      .sort((a, b) => DESIGN_HANDOFF_NAV_RANK.get(a.key)! - DESIGN_HANDOFF_NAV_RANK.get(b.key)!)
      .map((item) => (item.key === 'settings' && setupIncomplete ? {
        ...item,
        attention: true,
        subItems: item.subItems?.map((sub) => (sub.key === 'settings.company-profile' && shopDetailsIncomplete ? { ...sub, badgeLabel: 'ยังไม่ครบ' } : sub)),
      } : item.key === 'billing' ? { ...item, trailing: packageMenuTrailing(notice, cardRenewal) } : item)),
    [allNavItems, setupIncomplete, shopDetailsIncomplete, notice, cardRenewal, session.isDemo],
  );

  // Resolved from the full menu list, not the design-handoff subset above: a menu the sidebar
  // does not render still has to count as its own menu, or a filter would follow the user into it.
  const menuKey = useMemo(() => resolveMenuKey(pathname, collectMenuTargets(allNavItems)), [pathname, allNavItems]);

  const canAccessCurrentPath = canAccessWorkspacePath(WORKSPACE_MODULES, session.permissions, companyId, pathname, freeExpenseDrafts);

  // Keep denied pages in the shell and offer a page this session can actually open, named after where it goes.
  const fallback = useMemo(() => {
    const target = filteredModules.find((module) => canAccessWorkspacePath(
      WORKSPACE_MODULES, session.permissions, companyId, module.buildHref(companyId), freeExpenseDrafts,
    ));
    return target ? { href: target.buildHref(companyId), label: t(target.labelKey as Parameters<typeof t>[0], locale) } : null;
  }, [filteredModules, session.permissions, companyId, locale, freeExpenseDrafts]);

  const activeKey = getActiveModuleKey(filteredModules, companyId, pathname) ?? employeePageMenuKey(companyId, pathname, navItems) ?? resolveMenuKey(pathname, collectMenuTargets(navItems));

  return (
    <BranchFilterProvider companyId={companyId} onContextLoaded={applyLatestAccessContext}>
      <div className="[--app-header-h:68px]">
      <WorkspaceShell
        companyName={companyName}
        companyArea={
          // A phone: the shop name is a small caption over the branch picker, so the top bar is 68 px at every width
          // (it was 112 px on phones). Two buttons (several shops, or the two retries) sit side by side instead.
          <div className="flex min-w-0 flex-1 flex-col items-stretch gap-0.5 has-[[data-company-switch]]:flex-row has-[[data-company-switch]]:items-center has-[[data-company-switch]]:gap-2 has-[[data-scope-retry]]:flex-row has-[[data-scope-retry]]:items-center has-[[data-scope-retry]]:gap-2 sm:flex-row sm:items-center sm:gap-2">
            <CompanySwitcher companyId={companyId} fallbackName={companyName} currentFreeExpenseDrafts={freeExpenseDrafts} />
            <BranchSelector />
          </div>
        }
        headerExtras={!freeExpenseDrafts && session.permissions.includes('notification.read') ? <NotificationBell companyId={companyId} locale={locale} /> : undefined}
        banner={session.isDemo ? <DemoSessionBanner expiresAt={session.demoExpiresAt} /> : <PlanTermBanner companyId={companyId} notice={notice} freeExpenseDrafts={freeExpenseDrafts} />}
        sidebarFooter={!freeExpenseDrafts && !session.isDemo ? <PlanTermSidebarCard companyId={companyId} /> : undefined}
        // Owner decision 2026-08-15: the shell shows the person, not their คำนำหน้า. Stripped at the
        // shell boundary so the sidebar name and both avatar initials agree — the session name is
        // the global User row, which a company-scoped rename does not always reach.
        userName={stripThaiTitlePrefix(displayName) || undefined}
        userRoles={session.roles}
        userRoleNames={session.roleNames}
        showAccountSecurity={ACCOUNT_SECURITY_PERMISSIONS.some((permission) => session.permissions.includes(permission))}
        accountLinks={buildAccountLinks(companyId, session.permissions)}
        locale={locale}
        navItems={navItems}
        activeKey={activeKey ?? undefined}
      >
        <MenuFilterProvider menuKey={menuKey}>{canAccessCurrentPath ? children : (
          // The whole page: its title is the page's one heading, one sentence says what to do, and the way out sits
          // right under it, compact and named after its place (thai-ux-standard §1.6, §2.3, §3.1).
          <div className="mangmee-page">
            <ForbiddenState
              titleAs="h1"
              description=""
              packageAvailable={session.availablePermissions ? canAccessWorkspacePath(WORKSPACE_MODULES, session.availablePermissions, companyId, pathname, freeExpenseDrafts) : undefined}
              isOwner={session.roles.includes('OWNER')}
              action={fallback && <Link className={secondaryButtonClass} href={fallback.href}>{`กลับไป${fallback.label}`}</Link>}
            />
          </div>
        )}</MenuFilterProvider>
      </WorkspaceShell>
      {session.isDemo && <DemoLineChat key={companyId} companyId={companyId} />}
      </div>
    </BranchFilterProvider>
  );
}
