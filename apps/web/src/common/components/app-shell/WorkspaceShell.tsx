'use client';
import React from 'react';
import { SidebarProvider, useSidebar } from './SidebarContext';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import Backdrop from './Backdrop';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { WorkspaceLocaleContext } from '@/common/i18n/locale-context';
import type { AccountLink, NavItem } from './AppSidebar';

type Props = {
  children: React.ReactNode;
  companyName?: string;
  companyArea?: React.ReactNode;
  headerExtras?: React.ReactNode;
  /** Full-width strip under the sticky header, above every page: company-wide notices only. */
  banner?: React.ReactNode;
  /** Rendered at the bottom of the sidebar, above the user block (e.g. the plan-term card). */
  sidebarFooter?: React.ReactNode;
  userName?: string;
  userRoles?: string[];
  userRoleNames?: Record<string, string>;
  showAccountSecurity?: boolean;
  /** The person's own pages (account, signature), listed first in the user menu. */
  accountLinks?: AccountLink[];
  locale: SupportedLocale;
  navItems?: NavItem[];
  activeKey?: string;
};

// Inner component so it can read sidebar state after SidebarProvider mounts
function ShellInner({
  children,
  companyName,
  companyArea,
  headerExtras,
  banner,
  sidebarFooter,
  userName,
  userRoles,
  userRoleNames,
  showAccountSecurity,
  accountLinks,
  locale,
  navItems = [],
  activeKey,
}: Props) {
  const { isExpanded, isMobileOpen } = useSidebar();

  const mainContentMargin = isMobileOpen
    ? 'ml-0'
    : isExpanded
    ? 'lg:ml-[289px]'
    : 'lg:ml-[86px]';
  // The same offset as a variable, for bars fixed to the bottom of the window: they start where the content starts.
  const contentLeftVariable = isMobileOpen
    ? ''
    : isExpanded
    ? 'lg:[--workspace-content-left:289px]'
    : 'lg:[--workspace-content-left:86px]';

  return (
    <div className="mangmee-shell">
      <a
        href="#workspace-main"
        inert={isMobileOpen ? true : undefined}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100000] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-gray-900 focus:shadow-lg"
      >
        {t('shell.skip_to_content', locale)}
      </a>
      <AppSidebar
        navItems={navItems}
        activeKey={activeKey}
        locale={locale}
        userName={userName}
        userRoles={userRoles}
        userRoleNames={userRoleNames}
        showAccountSecurity={showAccountSecurity}
        accountLinks={accountLinks}
        footerExtras={sidebarFooter}
      />
      <Backdrop />
      <div inert={isMobileOpen ? true : undefined} className={`flex min-h-dvh min-w-0 flex-1 flex-col transition-all duration-300 ease-in-out ${mainContentMargin} ${contentLeftVariable}`}>
        <AppHeader
          companyName={companyName}
          companyArea={companyArea}
          headerExtras={headerExtras}
          locale={locale}
        />
        {banner}
        <main id="workspace-main" className="mangmee-content">
          <WorkspaceLocaleContext.Provider value={locale}>{children}</WorkspaceLocaleContext.Provider>
        </main>
      </div>
    </div>
  );
}

export function WorkspaceShell({
  children,
  companyName,
  companyArea,
  headerExtras,
  banner,
  sidebarFooter,
  userName,
  userRoles,
  userRoleNames,
  showAccountSecurity,
  accountLinks,
  locale,
  navItems,
  activeKey,
}: Props) {
  return (
    <SidebarProvider>
      <ShellInner
        companyName={companyName}
        companyArea={companyArea}
        headerExtras={headerExtras}
        banner={banner}
        sidebarFooter={sidebarFooter}
        userName={userName}
        userRoles={userRoles}
        userRoleNames={userRoleNames}
        showAccountSecurity={showAccountSecurity}
        accountLinks={accountLinks}
        locale={locale}
        navItems={navItems}
        activeKey={activeKey}
      >
        {children}
      </ShellInner>
    </SidebarProvider>
  );
}
