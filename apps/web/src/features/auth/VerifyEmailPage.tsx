'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useLocale } from '@/common/i18n/use-locale';
import { formatMessage } from '@/common/i18n/error-message.logic';
import { confirmEmailVerification } from './auth.api';
import { readEmailLinkToken } from './auth.logic';

function Confirmation({ token }: { token: string | null }) {
  const [locale] = useLocale(), mounted = useRef(true), pending = useRef(false);
  const [busy, setBusy] = useState(false), [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<'invalid' | 'temporary' | 'conflict' | null>(token ? null : 'invalid');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const confirm = async () => {
    if (!token || pending.current || email) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await confirmEmailVerification(token);
      if (mounted.current && readEmailLinkToken(window.location.search, window.location.hash) === token) setEmail(result.email);
    } catch (failure) {
      if (mounted.current && readEmailLinkToken(window.location.search, window.location.hash) === token) {
        const status = (failure as { statusCode?: number }).statusCode;
        setError(status === 409 ? 'conflict' : status === 400 || status === 403 ? 'invalid' : 'temporary');
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-4">
    <main className="w-full max-w-md break-words space-y-4 rounded-xl border border-gray-200 bg-white p-6 sm:p-8">
      <h1 className="text-xl font-semibold text-gray-900">{t(email ? 'auth.verify.success.title' : 'auth.verify.confirm.title', locale)}</h1>
      {email ? <p role="status">{formatMessage(t('auth.verify.success.body', locale), { email })}</p> : <>
        <p>{t('auth.verify.confirm.body', locale)}</p>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3">{t(error === 'invalid' ? 'auth.verify.error.body' : error === 'conflict' ? 'auth.verify.conflict' : 'auth.verify.temporary', locale)}</p>}
        {token && error !== 'invalid' && error !== 'conflict' && <button className="min-h-11 w-full rounded-lg bg-brand-700 px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={busy} aria-busy={Boolean(busy)} onClick={() => void confirm()}>
          {t(busy ? 'auth.verify.loading' : error === 'temporary' ? 'auth.verify.retry' : 'auth.verify.confirm.action', locale)}
        </button>}
      </>}
      <p className="text-sm text-gray-600">{t(email ? 'auth.verify.success.next' : 'auth.verify.recovery', locale)}</p>
      <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-brand-700 underline">{t('auth.verify.go_login', locale)}</Link>
    </main>
  </div>;
}

export default function VerifyEmailPage() {
  const searchParams = useSearchParams(), [token, setToken] = useState<string | null>();
  const [locale] = useLocale();
  useEffect(() => {
    const read = () => {
      const url = new URL(window.location.href), value = readEmailLinkToken(url.search, url.hash);
      if (value && url.searchParams.has('token')) {
        url.searchParams.delete('token'); url.hash = new URLSearchParams({ token: value }).toString();
        window.history.replaceState(window.history.state, '', url);
      }
      setToken(value);
    };
    read(); window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [searchParams]);
  return token === undefined ? <p role="status" className="p-6">{t('auth.verify.preparing', locale)}</p> : <Confirmation key={token ?? 'invalid'} token={token} />;
}
