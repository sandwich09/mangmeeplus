'use client';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { withLineExternalBrowser } from '@/common/auth/line-in-app-browser.logic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSidebar } from './SidebarContext';
import { isActiveNavSubItem, isPointerArrival, lineLinkMenuRow, revealScrollDelta } from './app-sidebar.logic';
import { ChevronDownIcon } from '@/common/icons';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';
import { getInitials, getMangmeeMenuTone, type MangmeeTone } from '@/common/components/mangmee';
import { AlertModal } from '@/common/components/modal';
import type { DictionaryKey, SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { roleDisplayName } from '@/features/employee-access/role-picker.logic';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { logoutCurrentSession } from '@/common/auth/session';
import { getAccountSecurityState, type AccountSecurityState } from '@/features/auth/auth.api';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { useDialogFocus } from '@/common/hooks/use-dialog-focus';
import { useIsDesktop, useMediaQuery } from '@/common/hooks/use-media-query';

export type NavItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  href?: string;
  trailing?: { label: string; warning: boolean };
  /** `badgeLabel`: a short word on the row that needs the person, e.g. "ยังไม่ครบ" on the shop details row. */
  subItems?: { key: string; label: string; href: string; icon?: React.ReactNode; tone?: MangmeeTone; badgeCount?: number; badgeLabel?: string }[];
  disabled?: boolean;
  /** §15.4.1 E: an unfinished company setup, shown as one dot until the checklist is complete. */
  attention?: boolean;
  group: string;
};

/** A row of the user menu that leads to the person's own things (account, signature). */
export type AccountLink = { key: string; label: string; href: string };

type Props = {
  navItems: NavItem[];
  activeKey?: string;
  locale: SupportedLocale;
  userName?: string;
  /** every role key the session holds (e.g. OWNER) — all of them show in the sidebar footer per the มั่งมี design */
  userRoles?: string[];
  userRoleNames?: Record<string, string>;
  showAccountSecurity?: boolean;
  /** The person's own pages, listed first in the user menu: nobody should need a company setting to find their account. */
  accountLinks?: AccountLink[];
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

const groupLabelKey: Record<string, 'nav.group.operate' | 'nav.group.finance' | 'nav.group.growth' | 'nav.group.admin' | 'nav.group.help'> = {
  main: 'nav.group.operate',
  operate: 'nav.group.operate',
  finance: 'nav.group.finance',
  growth: 'nav.group.growth',
  admin: 'nav.group.admin',
  help: 'nav.group.help',
};

const USER_MENU_ROW = 'flex min-h-11 w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm font-medium';

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
      className="mr-1 h-2 w-2 shrink-0 rounded-full bg-amber-500"
    />
  );
}

const AppSidebar: React.FC<Props> = ({ navItems, activeKey, locale, userName, userRoles, userRoleNames, showAccountSecurity, accountLinks = [], footerExtras }) => {
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
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [accountSecurity, setAccountSecurity] = useState<AccountSecurityState | null>(null);
  const [accountSecurityFailed, setAccountSecurityFailed] = useState(false);
  const [accountSecurityReload, setAccountSecurityReload] = useState(0);
  const sidebarRef = useRef<HTMLElement>(null);
  useDialogFocus(isMobileOpen, sidebarRef);
  const activeItemRef = useRef<HTMLElement | null>(null);
  const navScrollRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const initializedSubmenuRef = useRef(false);
  const manuallyToggledSubmenuRef = useRef(false);
  const manuallyOpenedSubmenuRef = useRef<string | null>(null);
  /** Last pathname the route-sync effect acted on, so it runs once per navigation. */
  const syncedPathRef = useRef<string | null>(null);
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** The collapse button was pressed with the pointer on the sidebar, and the pointer has not left since. */
  const closedUnderPointerRef = useRef(false);
  // A member holding several roles sees all of them, so the shell answers "ฉันเป็นตำแหน่งอะไร" (spec R9).
  // Deduped after translation: two custom role keys both fall back to the same generic label, and
  // "เมนูผู้ใช้ · เมนูผู้ใช้" reads as a bug. First appearance keeps its position.
  const roleLabel = userRoles?.length
    ? [...new Set(userRoles.map((role) => {
      const name = userRoleNames?.[role]?.trim();
      const label = roleDisplayName(name ? { key: role, name, isSystem: false } : role, locale);
      return !name && label === role ? (locale === 'th' ? 'บทบาทกำหนดเอง' : 'Custom role') : label;
    }))].join(' · ')
    : null;
  const displayUserName = userName;
  const footerLabel = displayUserName ?? roleLabel;
  const footerInitials = getInitials(footerLabel);
  // The security page is parked; /change-password is the real form the menu label promises.
  const resetPasswordHref = '/change-password';
  useCloseOnOutsideClick(userMenuRef, useCallback(() => setUserMenuOpen(false), []));

  // No question first: signing out loses nothing that signing in does not bring back (thai-ux-standard §4.1).
  // The menu stays open while it works, so the row itself shows "กำลังออกจากระบบ...".
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    if (!(await logoutCurrentSession())) {
      setSigningOut(false);
      setUserMenuOpen(false);
      // Themed dialog instead of window.alert(): the browser alert ignored the app theme.
      setSignOutFailed(true);
    }
  };

  const lineLinkRow = lineLinkMenuRow(accountSecurity);

  // Read each time the LINE row opens so an Admin repair is visible without reloading the app.
  // Its own account.session.read permission is independent of the password-menu permission.
  useEffect(() => {
    if (!userMenuOpen) return;
    let current = true;
    setAccountSecurity(null); setAccountSecurityFailed(false);
    void getAccountSecurityState().then(state => { if (current) setAccountSecurity(state); })
      .catch(() => { if (current) setAccountSecurityFailed(true); });
    return () => { current = false; };
  }, [userMenuOpen, accountSecurityReload]);

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
  const getMenuTone = (nav: NavItem): MangmeeTone => getMangmeeMenuTone(nav.key, nav.group === 'help' ? 'admin' : nav.group);
  /** On the icon-only rail a row has no words on screen, so its name goes to the tooltip and to assistive tech. */
  const railName = (label: string) => (sidebarVisible ? {} : { title: label, 'aria-label': label });
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
      // The group a shop works in every day; it used to be พนักงานและสิทธิ์.
      if (navItems.some((nav) => nav.key === 'expenses' && nav.subItems)) {
        setOpenSubmenu('expenses');
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
    const revealActiveItem = () => {
      const rootBox = scrollRoot.getBoundingClientRect();
      const itemBox = activeItem.getBoundingClientRect();
      const top = revealScrollDelta(rootBox, itemBox);
      if (top) scrollRoot.scrollBy({ top });
    };
    // Wait for the submenu height transition once; the old immediate + delayed centring made the
    // menu visibly jump twice on every route change.
    const delayedScroll = window.setTimeout(revealActiveItem, 320);
    return () => window.clearTimeout(delayedScroll);
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
      ref={sidebarRef}
      role={isMobileOpen ? 'dialog' : undefined}
      aria-modal={isMobileOpen ? true : undefined}
      aria-label={isMobileOpen ? 'เมนูหลัก' : undefined}
      tabIndex={isMobileOpen ? -1 : undefined}
      onClick={event => {
        if (isMobileOpen && (event.target as Element).closest('a[href]')) closeMobileSidebar();
      }}
      onKeyDown={event => {
        if (!isMobileOpen || event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
          .filter(node => node.getClientRects().length > 0 && !node.closest('[inert]'));
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); event.currentTarget.focus(); return; }
        const outside = !controls.includes(document.activeElement as HTMLElement);
        if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
      }}
      className={`fixed top-0 left-0 z-50 mt-[var(--app-header-h)] flex h-[calc(100dvh-var(--app-header-h))] flex-col border-r border-gray-200 bg-white px-5 text-gray-900 transition-all duration-300 ease-in-out lg:mt-0 lg:h-dvh
        ${isExpanded || isMobileOpen || isHovered ? 'w-[min(289px,85vw)] lg:w-[289px]' : 'w-[86px]'}
        ${isMobileOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}
        lg:visible lg:translate-x-0`}
      aria-hidden={isOffCanvas ? true : undefined}
      inert={isOffCanvas ? true : undefined}
      onMouseEnter={(event) => {
        if (!isPointerArrival(event.nativeEvent.relatedTarget as Node | null, closedUnderPointerRef.current)) return;
        closedUnderPointerRef.current = false;
        if (isDesktop && supportsHover && !isExpanded) setIsHovered(true);
      }}
      onMouseLeave={() => {
        closedUnderPointerRef.current = false;
        if (supportsHover) setIsHovered(false);
      }}
    >
      <div className={`py-6 flex items-center justify-between ${!isExpanded && !isHovered ? 'lg:flex-col lg:justify-center lg:gap-3' : ''}`}>
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-brand-500 to-brand-900">
            <MangmeeLogo size={24} />
          </span>
          {sidebarVisible && <span className="text-lg font-extrabold text-gray-900">มั่ง<span className="text-brand-700">มี</span></span>}
        </Link>
        {isMobileOpen && <button type="button" className="mangmee-btn mangmee-btn-quiet lg:hidden" onClick={closeMobileSidebar}>ปิดเมนู</button>}
        {/* On the rail the button is kept only where hovering cannot open the menu: with a mouse the menu opens under
            the pointer and the button would jump away from it. */}
        {(sidebarVisible || !supportsHover) && (
          <button
            type="button"
            onClick={(event) => {
              closedUnderPointerRef.current = isExpanded && Boolean(event.currentTarget.closest('aside')?.matches(':hover'));
              setIsHovered(false);
              toggleSidebar();
            }}
            className="hidden h-11 w-11 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 lg:flex"
            aria-label={t(isExpanded ? 'shell.collapse_sidebar' : 'shell.expand_sidebar', locale)}
            title={t(isExpanded ? 'shell.collapse_sidebar' : 'shell.expand_sidebar', locale)}
            aria-expanded={isExpanded}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={isExpanded ? '' : 'rotate-180'}>
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
                          className={`px-3 text-xs font-medium flex text-gray-500 ${
                            sidebarVisible ? 'justify-start' : 'lg:justify-center'
                          } ${idx > 0 ? 'pt-5' : ''}`}
                        >
                          {sidebarVisible ? groupLabel : (
                            <>
                              <span className="sr-only">{groupLabel}</span>
                              <span aria-hidden="true" className="my-2 block h-px w-6 bg-gray-200" />
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
                            {...railName(nav.label)}
                            className={`menu-item group ${
                              highlighted ? 'menu-item-active' : 'menu-item-inactive'
                            } cursor-pointer ${!isExpanded && !isHovered ? 'lg:justify-center' : 'lg:justify-start'} ${nav.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                            data-tone={tone}
                            data-active={highlighted ? 'true' : 'false'}
                          >
                            <MenuIcon icon={nav.icon} tone={tone} menuKey={nav.key} active={highlighted} />
                            {sidebarVisible && <span className="menu-item-text">{nav.label}</span>}
                            {nav.attention && !(sidebarVisible && openSubmenu === nav.key && nav.subItems?.some((sub) => sub.badgeLabel)) && <AttentionDot />}
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
                              {...railName(nav.label)}
                              className={`menu-item group ${active ? 'menu-item-active' : 'menu-item-inactive'} ${!isExpanded && !isHovered ? 'lg:justify-center' : 'lg:justify-start'}`}
                              data-tone={tone}
                              data-active={active ? 'true' : 'false'}
                            >
                              <MenuIcon icon={nav.icon} tone={tone} menuKey={nav.key} active={active} />
                              {sidebarVisible && <span className="menu-item-text">{nav.label}</span>}
                              {sidebarVisible && nav.trailing && <span className={`ml-auto shrink-0 whitespace-nowrap text-xs ${nav.trailing.warning ? 'text-warning-700' : 'text-gray-500'}`}>{nav.trailing.label}</span>}
                              {nav.attention && <AttentionDot />}
                            </Link>
                          )
                        )}
                        {nav.subItems && sidebarVisible && (
                          <div
                            ref={(el) => { subMenuRefs.current[nav.key] = el; }}
                            inert={openSubmenu !== nav.key ? true : undefined}
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
                                    {sub.badgeLabel && (
                                      <span className="ml-auto shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{sub.badgeLabel}</span>
                                    )}
                                    {sub.badgeCount ? (
                                      <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
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
              {accountLinks.map((link) => (
                <Link key={link.key} href={link.href} className={`${USER_MENU_ROW} text-gray-700 hover:bg-brand-25 hover:text-brand-700`} onClick={() => setUserMenuOpen(false)}>
                  {link.label}
                </Link>
              ))}
              {showAccountSecurity && (
                <Link
                  href={resetPasswordHref}
                  className={`${USER_MENU_ROW} text-gray-700 hover:bg-brand-25 hover:text-brand-700`}
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
                aria-busy={!accountSecurity && !accountSecurityFailed}
                onClick={lineLinkRow.disabled ? undefined : () => {
                  setUserMenuOpen(false);
                  window.location.assign(withLineExternalBrowser(`/api/auth/line-login/start?returnTo=${encodeURIComponent('/signup/welcome')}`, navigator.userAgent));
                }}
                className={`${USER_MENU_ROW} ${
                  lineLinkRow.disabled
                    ? 'cursor-not-allowed text-gray-400'
                    : 'text-gray-700 hover:bg-brand-25 hover:text-brand-700'
                }`}
              >
                <span>{t(lineLinkRow.labelKey, locale)}</span>
                {lineLinkRow.badgeKey && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    lineLinkRow.badgeKey === 'shell.line_link.badge_linked' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {t(lineLinkRow.badgeKey, locale)}
                  </span>
                )}
              </button>
              {accountSecurityFailed && <div className="space-y-2 px-4 pb-3">
                <p role="alert" className="text-sm text-red-700">โหลดสถานะบัญชีไม่ได้ กดลองอีกครั้ง</p>
                <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={() => setAccountSecurityReload(value => value + 1)}>ลองอีกครั้ง</button>
              </div>}
              {accountSecurity?.lineLinked && accountSecurity.lineMessagingReady === false && (
                <p className="px-4 pb-3 text-sm text-amber-800">LINE ยังรับข้อความไม่ได้ แจ้งผู้ดูแลให้ออก QR ใหม่</p>
              )}
              <button
                type="button"
                className={`${USER_MENU_ROW} text-gray-700 hover:bg-gray-50`}
                onClick={() => void handleSignOut()}
                disabled={signingOut} aria-busy={Boolean(signingOut)}
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
