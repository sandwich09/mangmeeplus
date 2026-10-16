'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { Button, secondaryButtonClass } from '@/common/components/button';
import { TextField } from '@/common/components/field';
import { Notice } from '@/common/components/notice';
import { logoutCurrentSession } from '@/common/auth/session';
import { trimmed } from '@/common/forms/trim';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useLocale } from '@/common/i18n/use-locale';
import { localizedErrorMessage } from '@/common/i18n/error-message.logic';
import { changePassword } from './auth.api';
import { AuthFrame, authTitleClass } from './AuthFrame';

/**
 * `homePath` is set only when the server confirmed this session is free to navigate away — a
 * temporary-password session gets null, because every route it could reach bounces it back here.
 */
export default function ChangePasswordPage({
  homePath = null,
  isForcedPasswordChange = false,
  canSkipCurrentPassword = false,
}: {
  homePath?: string | null;
  isForcedPasswordChange?: boolean;
  canSkipCurrentPassword?: boolean;
}) {
  const [locale] = useLocale();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPasswordRequired, setCurrentPasswordRequired] = useState(!canSkipCurrentPassword);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Said under the field it is about, in the page's own words: the browser's own bubble speaks the
  // browser's language and points at nothing (`noValidate` on the form).
  const [fieldErrors, setFieldErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
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
    // The API rejects reuse in both forms; compare locally only when this form collected the
    // current password, because a forced flow deliberately does not retain it in the browser.
    const nextErrors: typeof fieldErrors = {
      ...(currentPasswordRequired && !current ? { current: locale === 'th' ? 'กรอกรหัสผ่านปัจจุบัน' : 'Enter your current password.' } : {}),
      ...(nextPassword.length < 8 ? { next: t('auth.change.error.min', locale) }
        : current && nextPassword === current ? { next: t('auth.change.error.same', locale) } : {}),
      ...(confirmPassword.length === 0 ? { confirm: t('auth.reset.error.confirm_required', locale) }
        : confirmPassword !== newPassword ? { confirm: t('auth.reset.error.mismatch', locale) } : {}),
    };
    setFieldErrors(nextErrors);
    const firstWrong = nextErrors.current ? 'current-password' : nextErrors.next ? 'new-password' : nextErrors.confirm ? 'confirm-password' : null;
    if (firstWrong) {
      setError(null);
      document.getElementById(firstWrong)?.focus();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Cookie-authenticated via the shared client; /v1/auth/* is exempt from the
      // must-change-password block so this works with a temporary password.
      await changePassword(currentPasswordRequired ? current : undefined, nextPassword);
      localStorage.removeItem('watchdog.pendingRedirectPath');
      localStorage.removeItem('watchdog.pendingCompanyId');
      // The guard re-reads UserCredential.mustChangePassword per request, so the block already
      // cleared. Ending the session is deliberate: every session opened with the temporary
      // password is retired, forcing a fresh sign-in with the new one. `changed=1` lets the
      // sign-in page say that the change worked (thai-ux-standard §6.1: every action has a done state).
      const loggedOut = await logoutCurrentSession('/login?changed=1');
      if (!loggedOut) throw new Error('Password changed, but the session could not be ended.');
    } catch (nextError) {
      const code = (nextError as { code?: string }).code;
      if (code === 'current_password_required') setCurrentPasswordRequired(true);
      // A mistake in one field is said under that field; anything else is the system's and goes on top.
      if (code === 'current_password_incorrect') {
        setFieldErrors({ current: t('auth.change.error.current', locale) });
        document.getElementById('current-password')?.focus();
      } else if (code === 'password_reuse') {
        setFieldErrors({ next: t('auth.change.error.same', locale) });
        document.getElementById('new-password')?.focus();
      } else {
        setError(localizedErrorMessage(nextError, locale, {
          fallback: 'auth.change.error.failed',
          conflictCodes: {
            current_password_incorrect: 'auth.change.error.current',
            current_password_required: 'auth.change.error.current_required',
            password_reuse: 'auth.change.error.same',
          },
        }));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame>
      <h1 className={authTitleClass}>{t('auth.change.title', locale)}</h1>
      <p className="mt-1 text-sm text-gray-600">{t(isForcedPasswordChange ? 'auth.change.subtitle' : 'auth.change.optional_subtitle', locale)}</p>
      {error && <Notice tone="error" className="mt-4">{error}</Notice>}
      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
        {currentPasswordRequired && (
          <TextField
            label={t('auth.change.current', locale)}
            name="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => { setCurrentPassword(e.target.value); if (fieldErrors.current) setFieldErrors((prev) => ({ ...prev, current: undefined })); }}
            error={fieldErrors.current}
          />
        )}
        <TextField
          label={t('auth.change.new', locale)}
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => { setNewPassword(e.target.value); if (fieldErrors.next) setFieldErrors((prev) => ({ ...prev, next: undefined })); }}
          // The rule is said once: as the hint, or as the error when it was broken.
          hint={fieldErrors.next ? undefined : t('auth.reset.hint_min', locale)}
          error={fieldErrors.next}
        />
        <TextField
          label={t('auth.reset.confirm_password', locale)}
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); if (fieldErrors.confirm) setFieldErrors((prev) => ({ ...prev, confirm: undefined })); }}
          error={fieldErrors.confirm}
        />
        {/* One way to back out, never three. A session that may leave gets `ยกเลิก` (back where it
            came from, or home when this tab has nowhere to go back to); a temporary-password
            session is bounced back here from every route, so signing out is its only real exit. */}
        <ActionGroup className="pt-1">
          {homePath ? (
            <Link
              href={homePath}
              className={secondaryButtonClass}
              aria-disabled={loading || signingOut || undefined}
              onClick={(event) => {
                if (loading || signingOut) { event.preventDefault(); return; }
                if (canGoBack) { event.preventDefault(); window.history.back(); }
              }}
            >
              {t('auth.change.back', locale)}
            </Link>
          ) : (
            <Button type="button" variant="secondary" loading={signingOut} disabled={loading} onClick={() => void handleCancel()}>
              {t('auth.change.cancel', locale)}
            </Button>
          )}
          <Button type="submit" loading={loading} disabled={signingOut}>
            {t('auth.change.submit', locale)}
          </Button>
        </ActionGroup>
      </form>
    </AuthFrame>
  );
}
