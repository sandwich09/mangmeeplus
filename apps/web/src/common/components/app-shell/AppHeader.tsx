'use client';
import React, { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useSidebar } from './SidebarContext';
import { getInitials } from '@/common/components/mangmee';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { logoutCurrentSession } from '@/common/auth/session';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { useIsDesktop } from '@/common/hooks/use-media-query';
import { AlertModal } from '@/common/components/modal';

type Props = {
  companyId?: string;
  companyName?: string;
  /** Optional interactive area (e.g. company switcher + branch filter); replaces the plain company name. */
  companyArea?: React.ReactNode;
  /** Optional controls rendered top-right before the user menu (e.g. notification bell). */
  headerExtras?: React.ReactNode;
  locale: SupportedLocale;
  userName?: string;
  showAccountSecurity?: boolean;
};

const AppHeader: React.FC<Props> = ({
  companyId,
  companyName,
  companyArea,
  headerExtras,
  locale,
  userName,
  showAccountSecurity,
}) => {
  const { isMobileOpen, toggleSidebar, toggleMobileSidebar } = useSidebar();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const isDesktop = useIsDesktop();
  const userMenuRef = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(userMenuRef, useCallback(() => setUserMenuOpen(false), []));
  // The security page is parked; /change-password is the real form the menu label promises.
  const resetPasswordHref = '/change-password';
  const userLabel = userName ?? t('shell.user_menu', locale);
  useCloseOnOutsideClick(userMenuRef, useCallback(() => setUserMenuOpen(false), []));

  const handleToggle = () => {
    if (isDesktop) {
      toggleSidebar();
    } else {
      toggleMobileSidebar();
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setUserMenuOpen(false);
    setSigningOut(true);
    if (!(await logoutCurrentSession())) {
      setSigningOut(false);
      // Themed dialog instead of window.alert(): the browser alert ignored the app theme.
      setSignOutFailed(true);
    }
  };

  return (
    /* Shell stack: header z-30 < backdrop z-40 < drawer z-50 < modal/popover portals z-[99999]+. */
    <header className="sticky top-0 z-30 flex h-[var(--app-header-h)] w-full shrink-0 border-b border-gray-200 bg-white">
      <div className="flex w-full items-center justify-between gap-3 px-4 lg:px-7">
        {/* Left: hamburger + company name */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:border-brand-200 hover:bg-brand-25 sm:h-10 sm:w-10 lg:hidden"
            onClick={handleToggle}
            aria-label={t('shell.toggle_sidebar', locale)}
          >
            {isMobileOpen ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M6.21967 7.28131C5.92678 6.98841 5.92678 6.51354 6.21967 6.22065C6.51256 5.92775 6.98744 5.92775 7.28033 6.22065L11.999 10.9393L16.7176 6.22078C17.0105 5.92789 17.4854 5.92788 17.7782 6.22078C18.0711 6.51367 18.0711 6.98855 17.7782 7.28144L13.0597 12L17.7782 16.7186C18.0711 17.0115 18.0711 17.4863 17.7782 17.7792C17.4854 18.0721 17.0105 18.0721 16.7176 17.7792L11.999 13.0607L7.28033 17.7794C6.98744 18.0722 6.51256 18.0722 6.21967 17.7794C5.92678 17.4865 5.92678 17.0116 6.21967 16.7187L10.9384 12L6.21967 7.28131Z" fill="currentColor" />
              </svg>
            ) : (
              <svg width="16" height="12" viewBox="0 0 16 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M0.583252 1C0.583252 0.585788 0.919038 0.25 1.33325 0.25H14.6666C15.0808 0.25 15.4166 0.585786 15.4166 1C15.4166 1.41421 15.0808 1.75 14.6666 1.75L1.33325 1.75C0.919038 1.75 0.583252 1.41422 0.583252 1ZM0.583252 11C0.583252 10.5858 0.919038 10.25 1.33325 10.25L14.6666 10.25C15.0808 10.25 15.4166 10.5858 15.4166 11C15.4166 11.4142 15.0808 11.75 14.6666 11.75L1.33325 11.75C0.919038 11.75 0.583252 11.4142 0.583252 11ZM1.33325 5.25C0.919038 5.25 0.583252 5.58579 0.583252 6C0.583252 6.41421 0.919038 6.75 1.33325 6.75L7.99992 6.75C8.41413 6.75 8.74992 6.41421 8.74992 6C8.74992 5.58579 8.41413 5.25 7.99992 5.25L1.33325 5.25Z" fill="currentColor" />
              </svg>
            )}
          </button>
          {companyArea ?? (companyName && <span className="truncate text-sm font-semibold text-gray-700">{companyName}</span>)}
        </div>

        {/* Right: notifications + user menu */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {headerExtras}
          {/* User menu */}
          <div ref={userMenuRef} className="relative">
            <button
              onClick={() => setUserMenuOpen((o) => !o)}
              className="flex h-11 w-11 items-center gap-2 rounded-lg px-0 hover:bg-gray-100 sm:h-10 sm:w-10"
              aria-label={t('shell.user_menu', locale)}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-sm font-bold text-brand-700">
                {getInitials(userLabel)}
              </span>
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white py-2 shadow-[var(--shadow-theme-md)]">
                {showAccountSecurity && (
                  <Link
                    href={resetPasswordHref}
                    className="block w-full px-4 py-3 text-left text-sm font-bold text-gray-800 hover:bg-brand-25 hover:text-brand-700"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    {t('shell.reset_password', locale)}
                  </Link>
                )}
                <button
                  className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 hover:bg-red-50 hover:text-red-700"
                  onClick={handleSignOut}
                  disabled={signingOut}
                >
                  {signingOut ? t('shell.signing_out', locale) : t('shell.signout', locale)}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <AlertModal
        open={signOutFailed}
        title={t('shell.signout', locale)}
        message={t('shell.signout_failed', locale)}
        closeLabel={t('common.close', locale)}
        onClose={() => setSignOutFailed(false)}
      />
    </header>
  );
};

export default AppHeader;
