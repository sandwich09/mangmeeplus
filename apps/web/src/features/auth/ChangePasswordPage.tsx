'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/common/components/button';
import { TextField } from '@/common/components/field';
import { logoutCurrentSession } from '@/common/auth/session';
import { trimmed } from '@/common/forms/trim';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useLocale } from '@/common/i18n/use-locale';
import { localizedErrorMessage } from '@/common/i18n/error-message.logic';
import { changePassword } from './auth.api';

/**
 * `homePath` is set only when the server confirmed this session is free to navigate away — a
 * temporary-password session gets null, because every route it could reach bounces it back here.
 */
export default function ChangePasswordPage({ homePath = null }: { homePath?: string | null }) {
  const [locale] = useLocale();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read after mount so the server and the first client render agree; a page opened straight from
  // the URL bar has nothing to go back to, and a back button that does nothing is worse than none.
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => setCanGoBack(window.history.length > 1), []);

  // A temporary-password session is blocked from every business route — the API answers
  // 403 "Password change required" and the client bounces straight back here, so the URL bar
  // and the back button cannot leave. Signing out is the only real way off this page.
  const handleCancel = async () => {
    setSigningOut(true);
    setError(null);
    if (!(await logoutCurrentSession('/login'))) {
      setSigningOut(false);
      setError(t('shell.signout_failed', locale));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const current = trimmed(currentPassword);
    const nextPassword = trimmed(newPassword);
    if (nextPassword.length < 8) {
      setError(t('auth.change.error.min', locale));
      return;
    }
    // A date-of-birth temporary password is already 8 characters, so the length rule alone
    // let people "change" it to itself. The API enforces this too; this is the fast answer.
    if (nextPassword === current) {
      setError(t('auth.change.error.same', locale));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Cookie-authenticated via the shared client; /v1/auth/* is exempt from the
      // must-change-password block so this works with a temporary password.
      await changePassword(current, nextPassword);
      localStorage.removeItem('watchdog.pendingRedirectPath');
      localStorage.removeItem('watchdog.pendingCompanyId');
      // The guard re-reads UserCredential.mustChangePassword per request, so the block already
      // cleared. Ending the session is deliberate: every session opened with the temporary
      // password is retired, forcing a fresh sign-in with the new one.
      const loggedOut = await logoutCurrentSession('/login');
      if (!loggedOut) throw new Error('Password changed, but the session could not be ended.');
    } catch (nextError) {
      setError(localizedErrorMessage(nextError, locale, {
        fallback: 'auth.change.error.failed',
        conflictCodes: {
          current_password_incorrect: 'auth.change.error.current',
          password_reuse: 'auth.change.error.same',
        },
      }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-lg border border-gray-200 p-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t('auth.change.title', locale)}</h1>
          <p className="text-sm text-gray-500 mt-1">{t(homePath ? 'auth.change.optional_subtitle' : 'auth.change.subtitle', locale)}</p>
        </div>
        {error && (
          <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <TextField
            label={t('auth.change.current', locale)}
            name="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <TextField
            label={t('auth.change.new', locale)}
            name="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            hint={t('auth.reset.hint_min', locale)}
          />
          <Button type="submit" className="w-full" loading={loading} disabled={signingOut}>
            {t('auth.change.submit', locale)}
          </Button>
          {homePath && (
            <div className="flex gap-3">
              {canGoBack && (
                <Button type="button" variant="secondary" className="flex-1" disabled={loading || signingOut} loading={Boolean(loading || signingOut)} onClick={() => window.history.back()}>
                  {t('auth.change.back', locale)}
                </Button>
              )}
              <Link
                href={homePath}
                className="flex h-10 flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('auth.change.home', locale)}
              </Link>
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            loading={signingOut}
            disabled={loading}
            onClick={() => void handleCancel()}
          >
            {t('auth.change.cancel', locale)}
          </Button>
        </form>
      </div>
    </div>
  );
}
