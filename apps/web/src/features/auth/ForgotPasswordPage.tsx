'use client';

import { useEffect, useState } from 'react';
import type { ApiError } from '@/common/models/api-error.model';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { Button } from '@/common/components/button';
import { ChoiceRow, TextField } from '@/common/components/field';
import { Notice } from '@/common/components/notice';
import { trimmed } from '@/common/forms/trim';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useLocale } from '@/common/i18n/use-locale';
import { formatMessage, localizedErrorMessage } from '@/common/i18n/error-message.logic';
import { requestPasswordReset } from './auth.api';
import { AuthFrame, authTitleClass, BackToLoginLink } from './AuthFrame';

function remainingCooldown(cooldownUntil: number | null): number {
  if (!cooldownUntil) return 0;
  return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

export default function ForgotPasswordPage() {
  const [locale, setLocale] = useLocale();
  const [channel,setChannel]=useState<'EMAIL'|'LINE'>('EMAIL');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Said under the field in the page's own words; the browser's bubble speaks the browser's language.
  const [fieldError, setFieldError] = useState<string | null>(null);
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
    if (!trimmed(username)) {
      setFieldError(t('auth.login.error.identifier_required', locale));
      setError(null);
      document.getElementById('username')?.focus();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await requestPasswordReset(trimmed(username),channel);
      setSubmitted(true);setCooldownUntil(Date.now()+60000);
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

  const text=(th:string,en:string)=>locale==='th'?th:en;
  const wait = cooldownSeconds>0 ? formatMessage(t('auth.forgot.retry_in',locale),{seconds:cooldownSeconds}) : null;
  return <AuthFrame below={<BackToLoginLink label={t('auth.forgot.back_to_login',locale)} />}>
    <div className="flex items-center justify-between gap-3">
      <h1 className={authTitleClass}>{submitted?(channel==='EMAIL'?text('ส่งแล้ว ดูที่อีเมล','Sent. Check your email'):t('auth.forgot.submitted.title',locale)):t('auth.forgot.title',locale)}</h1>
      <button type="button" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 px-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50" aria-label={t('shell.language',locale)} onClick={()=>setLocale(locale==='th'?'en':'th')}>{locale==='th'?'EN':'ไทย'}</button>
    </div>
    {submitted?<div className="mt-3 space-y-3 text-[15px] leading-7 text-gray-700">
      <p role="status">{channel==='EMAIL'?text('ถ้าบัญชีนี้มีอีเมลที่ยืนยันไว้ ระบบส่งลิงก์ตั้งรหัสผ่านไปที่อีเมลนั้นแล้ว ลิงก์ใช้ได้ 30 นาที ถ้าไม่เจอ ดูในอีเมลขยะ','If this account has a verified email, a reset link was sent there. The link works for 30 minutes. Check your spam folder too.'):t('auth.forgot.submitted.body',locale)}</p>
      <p className="text-sm text-gray-600">{t('auth.forgot.support_line',locale)}</p>
      {/* One button on its own line: the countdown is its name while it waits, so it never runs into the link below. */}
      <ActionGroup className="pt-2">
        <Button type="button" variant="secondary" disabled={cooldownSeconds>0} onClick={()=>setSubmitted(false)}>{wait??text('ส่งอีกครั้ง','Send again')}</Button>
      </ActionGroup>
    </div>:<>
      {error&&<Notice tone="error" className="mt-4">{error}{wait?` ${wait}`:''}</Notice>}
      {/* The order of the screen is the order of the work: who, then where to send, then send. */}
      <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
        <TextField label={t('auth.forgot.username',locale)} name="username" value={username} onChange={event=>{setUsername(event.target.value);if(fieldError)setFieldError(null);}} onBlur={event=>setUsername(trimmed(event.target.value))} maxLength={254} autoComplete="username" required error={fieldError??undefined}/>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-gray-700">{text('ส่งไปที่','Send to')}</legend>
          {(['EMAIL','LINE'] as const).map(value=><ChoiceRow key={value} framed name="channel" value={value} checked={channel===value} disabled={loading} onChange={()=>setChannel(value)}
            label={value==='EMAIL'?text('อีเมลที่ยืนยันไว้กับบัญชีนี้','The email verified for this account'):text('LINE ที่เชื่อมไว้กับบัญชีนี้','The LINE account linked to this account')}/>)}
        </fieldset>
        <Button type="submit" className="w-full" loading={loading} disabled={cooldownSeconds>0}>{channel==='EMAIL'?text('ส่งลิงก์ตั้งรหัสผ่าน','Send reset link'):t('auth.forgot.submit',locale)}</Button>
      </form>
    </>}
  </AuthFrame>;
}
