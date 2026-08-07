'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ApiError } from '@/common/models/api-error.model';
import { Button } from '@/common/components/button';
import { TextField } from '@/common/components/field';
import { trimmed } from '@/common/forms/trim';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useLocale } from '@/common/i18n/use-locale';
import { formatMessage, localizedErrorMessage } from '@/common/i18n/error-message.logic';
import { requestPasswordReset } from './auth.api';

function remainingCooldown(cooldownUntil: number | null): number {
  if (!cooldownUntil) return 0;
  return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

export default function ForgotPasswordPage() {
  const [locale, setLocale] = useLocale();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => setCooldownSeconds(remainingCooldown(cooldownUntil));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await requestPasswordReset(trimmed(username));
      setSubmitted(true);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError?.kind === 'rate_limited') {
        const nextCooldown = Date.now() + 30_000;
        setCooldownUntil(nextCooldown);
        setCooldownSeconds(remainingCooldown(nextCooldown));
      }
      setError(localizedErrorMessage(error, locale, { 429: 'error.rate_limited', fallback: 'auth.forgot.error' }));
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md space-y-5 rounded-xl border border-gray-200 bg-white p-8">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-gray-900">{t('auth.forgot.submitted.title', locale)}</h1>
            <p className="text-sm text-gray-600">{t('auth.forgot.submitted.body', locale)}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t('auth.forgot.support_line', locale)}
          </div>
          <Link href="/login" className="inline-flex text-sm font-medium text-brand-700 hover:text-brand-800">
            {t('auth.forgot.back_to_login', locale)}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-gray-200 bg-white p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-gray-900">{t('auth.forgot.title', locale)}</h1>
            <p className="text-sm text-gray-600">{t('auth.forgot.subtitle', locale)}</p>
          </div>
          <button
            type="button"
            onClick={() => setLocale(locale === 'th' ? 'en' : 'th')}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50"
            aria-label={t('shell.language', locale)}
          >
            {locale === 'th' ? 'EN' : 'ไทย'}
          </button>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('auth.forgot.support_line', locale)}
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
            {cooldownSeconds > 0 ? ` ${formatMessage(t('auth.forgot.retry_in', locale), { seconds: cooldownSeconds })}` : ''}
          </div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <TextField
            label={t('auth.forgot.username', locale)}
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onBlur={(event) => setUsername(trimmed(event.target.value))}
            autoComplete="username"
            required
          />
          <Button type="submit" className="w-full" loading={loading} disabled={cooldownSeconds > 0}>
            {t('auth.forgot.submit', locale)}
          </Button>
        </form>

        <Link href="/login" className="inline-flex text-sm font-medium text-brand-700 hover:text-brand-800">
          {t('auth.forgot.back_to_login', locale)}
        </Link>
      </div>
    </div>
  );
}
