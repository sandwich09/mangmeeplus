'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CoverLoader, ErrorState } from '@/common/components/state';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useLocale } from '@/common/i18n/use-locale';
import { formatMessage } from '@/common/i18n/error-message.logic';
import { confirmEmailVerification } from './auth.api';
import { readTokenParam } from './auth.logic';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = useMemo(() => readTokenParam(searchParams.get('token')), [searchParams]);
  const [locale] = useLocale();
  const [loading, setLoading] = useState(!!token);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [invalidLink, setInvalidLink] = useState(!token);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void confirmEmailVerification(token)
      .then((result) => {
        if (!active) return;
        setVerifiedEmail(result.email);
      })
      .catch(() => {
        if (!active) return;
        setInvalidLink(true);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8">
        <CoverLoader active={loading} scope="section" label={t('auth.verify.loading', locale)}>
          {invalidLink ? (
            <>
              <ErrorState
                title={t('auth.verify.error.title', locale)}
                description={t('auth.verify.error.body', locale)}
              />
              <Link href="/login" className="mt-3 inline-flex text-sm font-medium text-brand-700 hover:text-brand-800">
                {t('auth.verify.go_login', locale)}
              </Link>
            </>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <h1 className="text-xl font-semibold text-gray-900">{t('auth.verify.success.title', locale)}</h1>
                <p className="text-sm text-gray-600">
                  {formatMessage(t('auth.verify.success.body', locale), { email: verifiedEmail ?? '' })}
                </p>
              </div>
              <Link href="/login" className="inline-flex text-sm font-medium text-brand-700 hover:text-brand-800">
                {t('auth.verify.go_login', locale)}
              </Link>
            </div>
          )}
        </CoverLoader>
      </div>
    </div>
  );
}
