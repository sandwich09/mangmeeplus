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
  const [channel,setChannel]=useState<'EMAIL'|'LINE'>('EMAIL');
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
  return <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-4">
    <main className="w-full max-w-md space-y-5 rounded-xl border border-gray-200 bg-white p-6 text-base sm:p-8 [&_label]:text-base">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">{submitted?(channel==='EMAIL'?text('ตรวจสอบอีเมลของคุณ','Check your email'):t('auth.forgot.submitted.title',locale)):t('auth.forgot.title',locale)}</h1>
        <button type="button" className="min-h-11 min-w-11 rounded-lg border p-2" aria-label={t('shell.language',locale)} onClick={()=>setLocale(locale==='th'?'en':'th')}>{locale==='th'?'EN':'ไทย'}</button>
      </div>
      {submitted?<>
        <p role="status">{channel==='EMAIL'?text('หากบัญชีนี้มีอีเมลที่ยืนยันไว้ ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้','If this account has a verified email, we will send a password reset link.'):t('auth.forgot.submitted.body',locale)}</p>
        <p>{channel==='EMAIL'?text('ลิงก์ใช้ได้ 30 นาที ตรวจโฟลเดอร์สแปมด้วย หากยังไม่ได้รับ รอ 1 นาทีแล้วขอใหม่ หรือติดต่อผู้ดูแลบริษัท','The link expires in 30 minutes. Check spam. Wait 1 minute before requesting another, or contact your administrator.'):t('auth.forgot.support_line',locale)}</p>
        <button className="min-h-11 underline disabled:opacity-50" disabled={cooldownSeconds>0} onClick={()=>setSubmitted(false)}>{cooldownSeconds>0?formatMessage(t('auth.forgot.retry_in',locale),{seconds:cooldownSeconds}):text('ขอลิงก์ใหม่หรือเปลี่ยนช่องทาง','Request again or change method')}</button>
      </>:<>
        <p>{text('กรอกชื่อผู้ใช้หรืออีเมล แล้วเลือกช่องทางกู้รหัสผ่าน','Enter your username or email and choose a recovery method.')}</p>
        {error&&<p role="alert" className="rounded-lg bg-red-50 p-3">{error}{cooldownSeconds>0?' '+formatMessage(t('auth.forgot.retry_in',locale),{seconds:cooldownSeconds}):''}</p>}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <fieldset className="space-y-2"><legend>{text('รับคำแนะนำทางไหน','Recovery method')}</legend>
            {(['EMAIL','LINE'] as const).map(value=><label key={value} className="flex min-h-11 items-center gap-3 rounded-lg border px-3">
              <input type="radio" name="channel" value={value} checked={channel===value} disabled={loading} onChange={()=>setChannel(value)}/>
              {value==='EMAIL'?text('รับลิงก์ทางอีเมล','Email link'):text('รับรหัสชั่วคราวทาง LINE','Temporary password via LINE')}
            </label>)}
          </fieldset>
          <p>{channel==='EMAIL'?text('ส่งไปที่อีเมลที่ยืนยันไว้กับบัญชีนี้','Sent only to the email verified for this account.'):text('ส่งไปที่ LINE ที่ผูกไว้กับบัญชีนี้','Sent only to the LINE identity linked to this account.')}</p>
          <TextField label={t('auth.forgot.username',locale)} name="username" value={username} onChange={event=>setUsername(event.target.value)} onBlur={event=>setUsername(trimmed(event.target.value))} className="sm:h-11 sm:text-base" maxLength={254} autoComplete="username" required/>
          <Button type="submit" className="min-h-11 w-full text-base" loading={loading} disabled={cooldownSeconds>0}>{channel==='EMAIL'?text('ส่งลิงก์กู้รหัสผ่าน','Send reset link'):t('auth.forgot.submit',locale)}</Button>
        </form>
      </>}
      <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-brand-700 underline">{t('auth.forgot.back_to_login',locale)}</Link>
    </main>
  </div>;
}
