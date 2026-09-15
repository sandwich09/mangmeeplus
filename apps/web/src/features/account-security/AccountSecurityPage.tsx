'use client';

import Link from 'next/link';
import { AccountEmailOtpPanel } from '@/features/auth/AccountEmailOtpPanel';
import { useEffect, useState } from 'react';
import { Button } from '@/common/components/button/Button';
import { TextField } from '@/common/components/field/Field';
import { Modal } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { CoverLoader } from '@/common/components/state/CoverLoader';
import { ErrorState } from '@/common/components/state/ErrorState';
import { revokeOtherSessions } from '@/common/auth/session';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { getDefaultLocale, t } from '@/common/i18n/workspace-i18n.logic';
import { formatThaiDateTime as formatSharedThaiDateTime } from '@/common/i18n/thai-date';
import {
  getAccountSecurityState,
  setAiAssistantEnabled,
  type AccountSecurityState as AccountSecurityStateModel,
} from '@/features/auth/auth.api';
import { authErrorMessage } from '@/features/auth/auth.logic';

const LOCALE_STORAGE_KEY = 'watchdog.workspace.locale';
const secondaryButtonClass = 'rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

function formatDateTime(value: string | null): string | null {
  return value ? formatSharedThaiDateTime(value) : null;
}

export function AccountSecurityPage({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [locale, setLocale] = useState<SupportedLocale>(getDefaultLocale());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokedCount, setRevokedCount] = useState<number | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const [state, setState] = useState<AccountSecurityStateModel | null>(null);
  const [aiToggleLoading, setAiToggleLoading] = useState(false);
  const [aiToggleError, setAiToggleError] = useState<string | null>(null);

  const loadState = async () => {
    setLoadingState(true);
    setLoadError(null);
    try {
      const nextState = await getAccountSecurityState();
      setState(nextState);
    } catch (error) {
      setLoadError(authErrorMessage(error, 'Unable to load account security details.'));
    } finally {
      setLoadingState(false);
    }
  };

  useEffect(() => {
    const savedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (savedLocale === 'th' || savedLocale === 'en') setLocale(savedLocale);
    void loadState();
  }, []);

  const handleAiToggle = async (currentlyOptedOut: boolean) => {
    setAiToggleLoading(true);
    setAiToggleError(null);
    try {
      await setAiAssistantEnabled(currentlyOptedOut);
      await loadState();
      toast.success(currentlyOptedOut ? 'เปิดใช้งานผู้ช่วย AI แล้ว' : 'ปิดใช้งานผู้ช่วย AI แล้ว');
    } catch (error) {
      setAiToggleError(authErrorMessage(error, 'ไม่สามารถบันทึกการตั้งค่าผู้ช่วย AI ได้'));
    } finally {
      setAiToggleLoading(false);
    }
  };

  const handleConfirm = async () => {
    setRevoking(true);
    setPageError(null);
    try {
      const result = await revokeOtherSessions();
      setRevokedCount(result.revokedCount);
      setConfirmOpen(false);
    } catch (error) {
      setPageError(authErrorMessage(error, 'Unable to revoke other sessions.'));
    } finally {
      setRevoking(false);
    }
  };


  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('account_security.title', locale)}</h1>
          <p className="text-sm text-gray-500">{t('account_security.subtitle', locale)}</p>
        </div>
        <Link href={`/companies/${companyId}/settings`} className={secondaryButtonClass}>
          {t('common.back', locale)}
        </Link>
      </div>

      {pageError && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{pageError}</div>
      )}

      {revokedCount !== null && (
        <div className="rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('account_security.revoke_others.success', locale).replace('{count}', String(revokedCount))}
        </div>
      )}

      <CoverLoader active={loadingState} scope="section" label="Loading account security...">
        {loadError ? (
          <ErrorState
            title="Unable to load account security"
            description={loadError}
            onRetry={() => { void loadState(); }}
            locale={locale}
          />
        ) : (
          <div className="space-y-6">
            <AccountEmailOtpPanel onState={next => setState(current => current && ({ ...current, email: next.email, emailVerified: next.emailVerified }))} />

            {/* PDPA objection route (M-05 register §3.1): self-service LINE AI assistant toggle. */}
            <section className="max-w-3xl rounded-lg border border-gray-200 bg-white p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-gray-900">ผู้ช่วย AI ทาง LINE</h2>
                  <p className="text-sm text-gray-500">
                    {state?.aiAssistantOptOutAt
                      ? `ปิดใช้งานอยู่ (ตั้งแต่ ${formatDateTime(state.aiAssistantOptOutAt)}) — ข้อความและรูปที่ส่งเข้า LINE ของบัญชีนี้จะไม่ถูกประมวลผลด้วย AI`
                      : 'เปิดใช้งานอยู่ — ผู้ช่วย AI ตอบข้อความและรับใบเสร็จผ่าน LINE ของบัญชีนี้'}
                  </p>
                  <p className="text-xs text-gray-400">
                    การปิดมีผลเฉพาะผู้ช่วยทาง LINE ของคุณ ไม่กระทบการใช้งานเว็บแอปหรือการอัปโหลดใบเสร็จผ่านเว็บ
                    ดูรายละเอียดการประมวลผลข้อมูลได้ใน <Link href="/privacy" className="underline">ประกาศความเป็นส่วนตัว</Link>
                  </p>
                  {aiToggleError ? <p className="text-sm text-red-600">{aiToggleError}</p> : null}
                </div>
                <Button
                  type="button"
                  variant={state?.aiAssistantOptOutAt ? 'primary' : 'secondary'}
                  onClick={() => { void handleAiToggle(Boolean(state?.aiAssistantOptOutAt)); }}
                  disabled={aiToggleLoading} loading={Boolean(aiToggleLoading)}
                >
                  {aiToggleLoading ? t('common.loading', locale) : state?.aiAssistantOptOutAt ? 'เปิดใช้งานผู้ช่วย AI' : 'ปิดใช้งานผู้ช่วย AI'}
                </Button>
              </div>
            </section>

            <section className="max-w-3xl rounded-lg border border-gray-200 bg-white p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-gray-900">{t('account_security.revoke_others.title', locale)}</h2>
                  <p className="text-sm text-gray-500">{t('account_security.revoke_others.description', locale)}</p>
                </div>
                <Button type="button" variant="danger" onClick={() => setConfirmOpen(true)} disabled={revoking}>
                  {revoking ? t('common.loading', locale) : t('account_security.revoke_others.button', locale)}
                </Button>
              </div>
            </section>
          </div>
        )}
      </CoverLoader>

      <Modal
        open={confirmOpen}
        title={t('account_security.revoke_others.confirm_title', locale)}
        onClose={() => !revoking && setConfirmOpen(false)}
        closeLabel={t('common.close', locale)}
        size="sm"
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)} disabled={revoking}>
              {t('common.cancel', locale)}
            </Button>
            <Button type="button" onClick={handleConfirm} loading={revoking}>
              {revoking ? t('common.loading', locale) : t('common.confirm', locale)}
            </Button>
          </>
        )}
      >
        <p className="text-sm text-gray-600">{t('account_security.revoke_others.confirm_body', locale)}</p>
      </Modal>
    </div>
  );
}
