'use client';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { withLineExternalBrowser } from '@/common/auth/line-in-app-browser.logic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSidebar } from './SidebarContext';
import { isActiveNavSubItem, lineLinkMenuRow } from './app-sidebar.logic';
import { ChevronDownIcon, HorizontalDotsIcon } from '@/common/icons';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';
import { Button } from '@/common/components/button';
import { getInitials, getMangmeeMenuTone, type MangmeeTone } from '@/common/components/mangmee';
import { AlertModal, Modal } from '@/common/components/modal';
import type { DictionaryKey, SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { logoutCurrentSession } from '@/common/auth/session';
import { getAccountSecurityState, type AccountSecurityState } from '@/features/auth/auth.api';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { useIsDesktop, useMediaQuery } from '@/common/hooks/use-media-query';

export type NavItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  href?: string;
  subItems?: { key: string; label: string; href: string; icon?: React.ReactNode; tone?: MangmeeTone; badgeCount?: number }[];
  disabled?: boolean;
  /** §15.4.1 E: an unfinished company setup, shown as one dot until the checklist is complete. */
  attention?: boolean;
  group: string;
};

type Props = {
  navItems: NavItem[];
  activeKey?: string;
  locale: SupportedLocale;
  userName?: string;
  /** every role key the session holds (e.g. OWNER) — all of them show in the sidebar footer per the มั่งมี design */
  userRoles?: string[];
  userRoleNames?: Record<string, string>;
  showAccountSecurity?: boolean;
  /** Bottom-of-sidebar slot above the user block (plan-term card). Hidden on the icon-only rail. */
  footerExtras?: React.ReactNode;
};

type MenuIconProps = {
  icon: React.ReactNode;
  tone: MangmeeTone;
  menuKey: string;
  active?: boolean;
  variant?: 'item' | 'dropdown';
};

function MenuIcon({ icon, tone, menuKey, active = false, variant = 'item' }: MenuIconProps) {
  const wrapperClass = variant === 'dropdown' ? 'menu-dropdown-icon-wrap' : 'menu-item-icon-wrap';
  const canvasClass =
    variant === 'dropdown'
      ? 'menu-dropdown-icon-canvas'
      : active
        ? 'menu-item-icon-active'
        : 'menu-item-icon-inactive';

  return (
    <span
      aria-hidden="true"
      className={wrapperClass}
      data-tone={tone}
      data-menu-key={menuKey}
      data-active={active ? 'true' : 'false'}
    >
      <span className={canvasClass}>{icon}</span>
    </span>
  );
}

const groupLabelKey: Record<string, 'nav.group.operate' | 'nav.group.finance' | 'nav.group.growth' | 'nav.group.admin'> = {
  main: 'nav.group.operate',
  operate: 'nav.group.operate',
  finance: 'nav.group.finance',
  growth: 'nav.group.growth',
  admin: 'nav.group.admin',
};

const roleLabelKey: Record<string, DictionaryKey> = {
  OWNER: 'role.OWNER',
  SYSTEM_ADMIN: 'role.SYSTEM_ADMIN',
  ADMIN: 'role.ADMIN',
  MANAGER: 'role.MANAGER',
  HR: 'role.HR',
  SALES: 'role.SALES',
  INVENTORY: 'role.INVENTORY',
  FINANCE: 'role.FINANCE',
  ACCOUNTANT: 'role.ACCOUNTANT',
  MARKETING: 'role.MARKETING',
  STAFF: 'role.STAFF',
  AUDITOR_READONLY: 'role.AUDITOR_READONLY',
  COMPANY_VIEW: 'role.COMPANY_VIEW',
};

/**
 * One amber dot on a module row whose setup is unfinished (§15.4.1 E). Rendered right after the
 * label, so it lands next to the icon when the sidebar is collapsed and the label is not there.
 */
function AttentionDot() {
  return (
    <span
      role="img"
      aria-label="ตั้งค่ายังไม่ครบ"
      title="ตั้งค่ายังไม่ครบ"
      data-testid="nav-attention-dot"
      className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
    />
  );
}

const AppSidebar: React.FC<Props> = ({ navItems, activeKey, locale, userName, userRoles, userRoleNames, showAccountSecurity, footerExtras }) => {
  const { isExpanded, isMobileOpen, isHovered, openSubmenu, setIsHovered, setOpenSubmenu, toggleSidebar, toggleSubmenu, closeMobileSidebar } =
    useSidebar();
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const supportsHover = useMediaQuery('(hover: hover)');
  const isOffCanvas = !isDesktop && !isMobileOpen;

  // On mobile/tablet the sidebar is an overlay drawer — once navigation lands on a
  // new route, close it so only the page content shows (no-op on desktop where the
  // drawer is never open).
  useEffect(() => {
    closeMobileSidebar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!isMobileOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMobileSidebar();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [closeMobileSidebar, isMobileOpen]);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>({});
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [accountSecurity, setAccountSecurity] = useState<AccountSecurityState | null>(null);
  const activeItemRef = useRef<HTMLElement | null>(null);
  const navScrollRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const initializedSubmenuRef = useRef(false);
  const manuallyToggledSubmenuRef = useRef(false);
  const manuallyOpenedSubmenuRef = useRef<string | null>(null);
  /** Last pathname the route-sync effect acted on, so it runs once per navigation. */
  const syncedPathRef = useRef<string | null>(null);
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // A member holding several roles sees all of them, so the shell answers "ฉันเป็นตำแหน่งอะไร" (spec R9).
  // Deduped after translation: two custom role keys both fall back to the same generic label, and
  // "เมนูผู้ใช้ · เมนูผู้ใช้" reads as a bug. First appearance keeps its position.
  const roleLabel = userRoles?.length
    ? [...new Set(userRoles.map((role) => roleLabelKey[role]
      ? t(roleLabelKey[role], locale)
      : userRoleNames?.[role]?.trim() || (locale === 'th' ? 'บทบาทกำหนดเอง' : 'Custom role')))].join(' · ')
    : null;
  const displayUserName = userName === 'นภา' ? 'คุณนภา วงศ์ทอง' : userName;
  const footerLabel = displayUserName ?? roleLabel;
  const footerInitials = userName === 'นภา' ? 'นภ' : getInitials(footerLabel);
  // The security page is parked; /change-password is the real form the menu label promises.
  const resetPasswordHref = '/change-password';
  useCloseOnOutsideClick(userMenuRef, useCallback(() => setUserMenuOpen(false), []));

  const handleSignOut = async () => {
    if (signingOut) return;
    setUserMenuOpen(false);
    setSigningOut(true);
    if (!(await logoutCurrentSession())) {
      setSigningOut(false);
      setSignOutOpen(false);
      // Themed dialog instead of window.alert(): the browser alert ignored the app theme.
      setSignOutFailed(true);
    }
  };

  const lineLinkRow = lineLinkMenuRow(accountSecurity);

  // Lazy: the link state is only needed once the menu is on screen, so the shell never pays for
  // it on mount. The menu item itself renders from permissions alone — the badge just appears.
  useEffect(() => {
    if (!userMenuOpen || !showAccountSecurity || accountSecurity) return;
    void getAccountSecurityState().then(setAccountSecurity).catch(() => undefined);
  }, [accountSecurity, showAccountSecurity, userMenuOpen]);

  const isActive = (path: string) => path === pathname;
  const isActiveItem = (nav: NavItem) => {
    // A matching child owns its route tree. Without this, getActiveModuleKey resolves to the
    // parent's key and both rows light up on nested workflow pages.
    if (nav.subItems?.some((sub) => pathname === sub.href || pathname.startsWith(sub.href + '/'))) return false;
    if (activeKey) return nav.key === activeKey;
    if (nav.href && isActive(nav.href)) return true;
    return false;
  };
  const subItemCandidates = navItems.flatMap((nav) => nav.subItems ?? []);
  const shouldSubmenuOpenForRoute = (nav: NavItem) =>
    Boolean(nav.subItems && (isActiveItem(nav) || nav.subItems.some((sub) =>
      isActiveNavSubItem(pathname, activeKey, sub, subItemCandidates))));
  const sidebarVisible = isExpanded || isHovered || isMobileOpen;
  const getMenuTone = (nav: NavItem): MangmeeTone => getMangmeeMenuTone(nav.key, nav.group);
  const setActiveAnchorRef = (node: HTMLAnchorElement | null) => {
    if (node) activeItemRef.current = node;
  };
  const setActiveButtonRef = (node: HTMLButtonElement | null) => {
    if (node) activeItemRef.current = node;
  };

  // Follow the route, then leave the accordion alone. This used to also depend on
  // `openSubmenu` and re-assert the active parent whenever they differed, which meant that on
  // any page whose module has children (ค่าใช้จ่ายและใบเสร็จ, พนักงานและสิทธิ์) the user could
  // neither collapse that parent nor open a different one — every toggle was undone on the next
  // render. Syncing once per pathname keeps deep links opening the right drawer without
  // fighting the clicks that follow.
  useEffect(() => {
    // navItems arrives empty on the first render while permissions resolve; syncing against it
    // would burn this pathname and leave the correct parent closed once the real nav lands.
    if (navItems.length === 0) return;
    if (syncedPathRef.current === pathname) return;
    syncedPathRef.current = pathname;

    const activeParent = navItems.find((nav) => shouldSubmenuOpenForRoute(nav));
    if (activeParent) {
      initializedSubmenuRef.current = true;
      setOpenSubmenu(activeParent.key);
      return;
    }
    if (!initializedSubmenuRef.current) {
      initializedSubmenuRef.current = true;
      if (navItems.some((nav) => nav.key === 'roles' && nav.subItems)) {
        setOpenSubmenu('roles');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, navItems, pathname, setOpenSubmenu]);

  // Layout effect, not effect: the drawer's inline height is read during render, so measuring
  // after paint left it as the invalid string `undefinedpx` for one frame on a menu's first
  // expand — the drawer snapped open instead of animating.
  useLayoutEffect(() => {
    if (openSubmenu !== null && subMenuRefs.current[openSubmenu]) {
      setSubMenuHeight((prev) => ({
        ...prev,
        [openSubmenu]: subMenuRefs.current[openSubmenu]?.scrollHeight ?? 0,
      }));
    }
  }, [openSubmenu]);

  useEffect(() => {
    if (manuallyToggledSubmenuRef.current) {
      manuallyToggledSubmenuRef.current = false;
      return undefined;
    }
    const activeItem = activeItemRef.current;
    const scrollRoot = navScrollRef.current;
    if (!activeItem || !scrollRoot || !sidebarVisible) return undefined;
    const scrollToActiveItem = () => {
      const rootBox = scrollRoot.getBoundingClientRect();
      const itemBox = activeItem.getBoundingClientRect();
      const centeredTop = scrollRoot.scrollTop + itemBox.top - rootBox.top - ((rootBox.height - itemBox.height) / 2);
      scrollRoot.scrollTo({ top: Math.max(0, centeredTop) });
    };
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(scrollToActiveItem);
    });
    const delayedScroll = window.setTimeout(scrollToActiveItem, 360);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(delayedScroll);
    };
  }, [activeKey, openSubmenu, pathname, sidebarVisible]);

  useEffect(() => {
    const submenuKey = manuallyOpenedSubmenuRef.current;
    if (!submenuKey || submenuKey !== openSubmenu || !sidebarVisible) return undefined;
    const revealSubmenu = () => {
      const scrollRoot = navScrollRef.current;
      const submenu = subMenuRefs.current[submenuKey];
      const trigger = submenu?.previousElementSibling;
      if (!scrollRoot || !submenu || !(trigger instanceof HTMLElement)) return;
      const rootBox = scrollRoot.getBoundingClientRect();
      const triggerBox = trigger.getBoundingClientRect();
      const overflow = submenu.getBoundingClientRect().bottom - rootBox.bottom;
      if (overflow > 0) {
        scrollRoot.scrollBy({
          top: Math.min(overflow, Math.max(0, triggerBox.top - rootBox.top)),
          behavior: 'smooth',
        });
      }
      manuallyOpenedSubmenuRef.current = null;
    };
    const delayedScroll = window.setTimeout(revealSubmenu, 360);
    return () => window.clearTimeout(delayedScroll);
  }, [openSubmenu, sidebarVisible, subMenuHeight]);

  return (
    <aside
      className={`fixed top-0 left-0 z-50 mt-[var(--app-header-h)] flex h-[calc(100dvh-var(--app-header-h))] flex-col border-r border-gray-200 bg-white px-5 text-gray-900 transition-all duration-300 ease-in-out lg:mt-0 lg:h-dvh
        ${isExpanded || isMobileOpen || isHovered ? 'w-[min(289px,85vw)] lg:w-[289px]' : 'w-[86px]'}
        ${isMobileOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}
        lg:visible lg:translate-x-0`}
      aria-hidden={isOffCanvas ? true : undefined}
      inert={isOffCanvas ? true : undefined}
      onMouseEnter={() => supportsHover && !isExpanded && setIsHovered(true)}
      onMouseLeave={() => supportsHover && setIsHovered(false)}
    >
      <div className={`py-6 flex items-center ${!isExpanded && !isHovered ? 'lg:justify-center' : 'justify-between'}`}>
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-brand-500 to-brand-900">
            <MangmeeLogo size={24} />
          </span>
          {sidebarVisible && <span className="text-lg font-extrabold text-gray-900">มั่ง<span className="text-brand-700">มี</span></span>}
        </Link>
        {sidebarVisible && (
          <button
            type="button"
            onClick={() => {
              setIsHovered(false);
              toggleSidebar();
            }}
            className="hidden h-11 w-11 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 lg:flex"
            aria-label={t('shell.toggle_sidebar', locale)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6l-6 6 6 6M3 12h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      <div ref={navScrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav>
          <div className="flex flex-col gap-4">
            <div>
              <ul className="flex flex-col gap-1.5">
                {navItems.map((nav, idx) => {
                  const active = isActiveItem(nav);
                  const highlighted = active;
                  const tone = getMenuTone(nav);
                  const prevGroup = idx > 0 ? navItems[idx - 1].group : nav.group;
                  const showGroupHeading = idx === 0 || nav.group !== prevGroup;
                  const groupLabel = nav.group === 'main' ? '' : t(groupLabelKey[nav.group], locale);
                  return (
                    <React.Fragment key={nav.key}>
                      {showGroupHeading && nav.group !== 'main' && (
                        <li
                          aria-label={groupLabel}
                          className={`px-3 text-[11px] font-medium tracking-[0.01em] flex leading-[20px] text-gray-400 ${
                            sidebarVisible ? 'justify-start' : 'lg:justify-center'
                          } ${idx > 0 ? 'pt-5' : ''}`}
                        >
                          {sidebarVisible ? groupLabel : (
                            <>
                              <span className="sr-only">{groupLabel}</span>
                              <HorizontalDotsIcon />
                            </>
                          )}
                        </li>
                      )}
                      <li>
                        {nav.subItems ? (
                          <button
                            type="button"
                            // Parents with children only expand/collapse. Navigating here too would
                            // yank the user off their current page on every collapse, and would bounce
                            // anyone whose permissions cover a child but not the parent's own href.
                            onClick={() => {
                              manuallyToggledSubmenuRef.current = true;
                              manuallyOpenedSubmenuRef.current = openSubmenu === nav.key ? null : nav.key;
                              toggleSubmenu(nav.key);
                            }}
                            ref={highlighted ? setActiveButtonRef : undefined}
                            disabled={nav.disabled}
                            aria-expanded={openSubmenu === nav.key}
                            className={`menu-item group ${
                              highlighted ? 'menu-item-active' : 'menu-item-inactive'
                            } cursor-pointer ${!isExpanded && !isHovered ? 'lg:justify-center' : 'lg:justify-start'} ${nav.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                            data-tone={tone}
                            data-active={highlighted ? 'true' : 'false'}
                          >
                            <MenuIcon icon={nav.icon} tone={tone} menuKey={nav.key} active={highlighted} />
                            {sidebarVisible && <span className="menu-item-text">{nav.label}</span>}
                            {nav.attention && <AttentionDot />}
                            {sidebarVisible && (
                              <ChevronDownIcon
                                className={`ml-auto w-5 h-5 transition-transform duration-200 ${
                                  openSubmenu === nav.key ? 'rotate-180 text-brand-500' : ''
                                }`}
                              />
                            )}
                          </button>
                        ) : nav.disabled ? (
                          <span
                            className={`menu-item group menu-item-inactive cursor-not-allowed opacity-50 ${!isExpanded && !isHovered ? 'lg:justify-center' : 'lg:justify-start'}`}
                            data-tone={tone}
                          >
                            <MenuIcon icon={nav.icon} tone={tone} menuKey={nav.key} />
                            {sidebarVisible && <span className="menu-item-text">{nav.label}</span>}
                          </span>
                        ) : (
                          nav.href && (
                            <Link
                              href={nav.href}
                              ref={active ? setActiveAnchorRef : undefined}
                              aria-current={active ? 'page' : undefined}
                              className={`menu-item group ${active ? 'menu-item-active' : 'menu-item-inactive'} ${!isExpanded && !isHovered ? 'lg:justify-center' : 'lg:justify-start'}`}
                              data-tone={tone}
                              data-active={active ? 'true' : 'false'}
                            >
                              <MenuIcon icon={nav.icon} tone={tone} menuKey={nav.key} active={active} />
                              {sidebarVisible && <span className="menu-item-text">{nav.label}</span>}
                              {nav.attention && <AttentionDot />}
                            </Link>
                          )
                        )}
                        {nav.subItems && sidebarVisible && (
                          <div
                            ref={(el) => { subMenuRefs.current[nav.key] = el; }}
                            className="overflow-hidden transition-all duration-300"
                            style={{ height: openSubmenu === nav.key ? `${subMenuHeight[nav.key]}px` : '0px' }}
                          >
                            <ul className="mt-2 ml-4 space-y-1">
                              {nav.subItems.map((sub) => {
                                const subActive = isActiveNavSubItem(pathname, activeKey, sub, subItemCandidates);
                                const subTone = sub.tone ?? 'slate';
                                return (
                                <li key={sub.key}>
                                  <Link
                                    href={sub.href}
                                    ref={subActive ? setActiveAnchorRef : undefined}
                                    className={`menu-dropdown-item ${subActive ? 'menu-dropdown-item-active' : 'menu-dropdown-item-inactive'}`}
                                  >
                                    {sub.icon && <MenuIcon icon={sub.icon} tone={subTone} menuKey={sub.key} active={subActive} variant="dropdown" />}
                                    {sub.label}
                                    {sub.badgeCount ? (
                                      <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">
                                        {sub.badgeCount > 99 ? '99+' : sub.badgeCount}
                                      </span>
                                    ) : null}
                                  </Link>
                                </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </li>
                    </React.Fragment>
                  );
                })}
              </ul>
            </div>
          </div>
        </nav>
      </div>

      {footerExtras && (isExpanded || isHovered || isMobileOpen) && (
        <div className="shrink-0 px-1">{footerExtras}</div>
      )}

      {/* User identity and account actions stay together at the bottom of the navigation. */}
      {footerLabel && (
        <div ref={userMenuRef} className={`relative mt-6 shrink-0 border-t border-gray-200 px-1 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4`}>
          {userMenuOpen && (
            <div id="sidebar-user-menu" className="absolute bottom-full left-0 z-10 mb-2 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white py-2 shadow-[var(--shadow-theme-md)]">
              {showAccountSecurity && (
                <Link
                  href={resetPasswordHref}
                  className="block w-full px-4 py-3 text-left text-sm font-bold text-gray-800 hover:bg-brand-25 hover:text-brand-700"
                  onClick={() => setUserMenuOpen(false)}
                >
                  {t('shell.reset_password', locale)}
                </Link>
              )}
              {/* One LINE-link row, two lineages merged: the ACTION is the production-proven
                  LINE-login OAuth start (Owner UAT round 1 — full navigation because the BFF
                  302s to LINE; returnTo is the welcome page because that is the only page
                  carrying the spec §4F merge dialog; withLineExternalBrowser keeps the OAuth
                  cookie and callback in one browser). The STATE is the self-link work: a lazy
                  account-security fetch drives the badge, and the row is DISABLED until the
                  state lands and permanently once linked (owner directive 2026-09-01 — an
                  accidental tap must not start a re-link and burn LINE OA push quota). */}
              <button
                type="button"
                disabled={lineLinkRow.disabled}
                onClick={lineLinkRow.disabled ? undefined : () => {
                  setUserMenuOpen(false);
                  window.location.assign(withLineExternalBrowser(`/api/auth/line-login/start?returnTo=${encodeURIComponent('/signup/welcome')}`, navigator.userAgent));
                }}
                className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium ${
                  lineLinkRow.disabled
                    ? 'cursor-not-allowed text-gray-400'
                    : 'text-gray-700 hover:bg-brand-25 hover:text-brand-700'
                }`}
              >
                <span>{t(lineLinkRow.labelKey, locale)}</span>
                {lineLinkRow.badgeKey && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    lineLinkRow.badgeKey === 'shell.line_link.badge_linked' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {t(lineLinkRow.badgeKey, locale)}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 hover:bg-red-50 hover:text-red-700"
                onClick={() => {
                  setUserMenuOpen(false);
                  setSignOutOpen(true);
                }}
                disabled={signingOut}
              >
                {signingOut ? t('shell.signing_out', locale) : t('shell.signout', locale)}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setUserMenuOpen((open) => !open)}
            aria-label={t('shell.user_menu', locale)}
            aria-expanded={userMenuOpen}
            aria-controls="sidebar-user-menu"
            aria-haspopup="true"
            className={`flex w-full items-center gap-3 rounded-xl py-2 text-left hover:bg-gray-50 ${sidebarVisible ? 'px-2' : 'lg:justify-center lg:px-0'}`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-brand-100 text-sm font-bold text-brand-700">
              {footerInitials}
            </span>
            {sidebarVisible && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold text-gray-800">{footerLabel}</span>
                  {displayUserName && roleLabel && <span className="mt-0.5 block truncate text-xs font-medium text-gray-500">{roleLabel}</span>}
                </span>
                <span className={`shrink-0 text-gray-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}>
                  <ChevronDownIcon />
                </span>
              </>
            )}
          </button>
        </div>
      )}
      <Modal
        open={signOutOpen}
        title={t('shell.signout', locale)}
        size="sm"
        closeLabel={t('common.close', locale)}
        onClose={() => { if (!signingOut) setSignOutOpen(false); }}
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setSignOutOpen(false)} disabled={signingOut}>
              {t('common.cancel', locale)}
            </Button>
            <Button type="button" variant="danger" onClick={() => void handleSignOut()} loading={signingOut}>
              {signingOut ? t('shell.signing_out', locale) : t('shell.signout', locale)}
            </Button>
          </>
        )}
      >
        <p className="text-sm text-gray-600">{t('shell.signout_confirm', locale)}</p>
      </Modal>
      <AlertModal
        open={signOutFailed}
        title={t('shell.signout', locale)}
        message={t('shell.signout_failed', locale)}
        closeLabel={t('common.close', locale)}
        onClose={() => setSignOutFailed(false)}
      />
    </aside>
  );
};

export default AppSidebar;
