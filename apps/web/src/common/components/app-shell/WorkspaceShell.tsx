'use client';
import React from 'react';
import { SidebarProvider, useSidebar } from './SidebarContext';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import Backdrop from './Backdrop';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { WorkspaceLocaleContext } from '@/common/i18n/locale-context';
import type { NavItem } from './AppSidebar';

type Props = {
  children: React.ReactNode;
  companyName?: string;
  companyArea?: React.ReactNode;
  headerExtras?: React.ReactNode;
  userName?: string;
  userRole?: string;
  showAccountSecurity?: boolean;
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
  userName,
  userRole,
  showAccountSecurity,
  locale,
  navItems = [],
  activeKey,
}: Props) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();

  const mainContentMargin = isMobileOpen
    ? 'ml-0'
    : isExpanded || isHovered
    ? 'lg:ml-[289px]'
    : 'lg:ml-[86px]';

  return (
    <div className="mangmee-shell">
      <a
        href="#workspace-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100000] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-gray-900 focus:shadow-lg"
      >
        {t('shell.skip_to_content', locale)}
      </a>
      <AppSidebar
        navItems={navItems}
        activeKey={activeKey}
        locale={locale}
        userName={userName}
        userRole={userRole}
        showAccountSecurity={showAccountSecurity}
      />
      <Backdrop />
      <div className={`flex min-h-screen min-w-0 flex-1 flex-col transition-all duration-300 ease-in-out ${mainContentMargin}`}>
        <AppHeader
          companyName={companyName}
          companyArea={companyArea}
          headerExtras={headerExtras}
          locale={locale}
        />
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
  userName,
  userRole,
  showAccountSecurity,
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
        userName={userName}
        userRole={userRole}
        showAccountSecurity={showAccountSecurity}
        locale={locale}
        navItems={navItems}
        activeKey={activeKey}
      >
        {children}
      </ShellInner>
    </SidebarProvider>
  );
}
